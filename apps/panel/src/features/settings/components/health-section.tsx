'use client';

import { useEffect, useState } from 'react';

import { Badge, Dot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Meter } from '@/components/ui/charts';
import { Gate, useCan } from '@/components/ui/gate';
import { Icon } from '@/components/ui/icon';
import { DefinitionGrid, Section } from '@/components/ui/layout';
import { MenuButton } from '@/components/ui/menu';
import { UpdatedAt } from '@/components/ui/misc';
import { EmptyState, LoadError, LoadingRows } from '@/components/ui/states';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { formatBytes, formatCount } from '@/lib/format';
import { usePolling } from '@/lib/hooks';
import { formatRelative } from '@/lib/time';
import { useShell } from '@/stores/shell';

import {
  resumeNow,
  RuntimeState,
  TurnOffDialog,
  turnOn,
  useDisablesFor,
} from '@/features/models/components/deployment-runtime';
import { runtimeStatus, useDeploymentDisables } from '@/features/models/deployment-state';
import { healthName } from '@/features/models/types';
import { TestModePanel } from '@/features/test-mode/components/test-mode-panel';

import { useRuntime } from '../store';
import { ClusterSection } from './cluster-section';

const DEPENDENCY_LABEL: Record<string, string> = {
  store: 'Database',
  cache: 'Cache',
  queue: 'Queue',
};

/** Runtime health: dependencies, admission, spool, nodes, deployment breakers and provider credentials. */
export function HealthSection() {
  const health = useRuntime((s) => s.health);
  const deployments = useRuntime((s) => s.deployments);
  const providers = useRuntime((s) => s.providerStatus);
  const load = useRuntime((s) => s.load);
  const canAudit = useCan('listAudit');
  const loadDeployments = useRuntime((s) => s.loadDeployments);
  const loadDisables = useDeploymentDisables((s) => s.load);
  const canDisable = useCan('disableDeployment');
  const [turningOff, setTurningOff] = useState<string | null>(null);
  useDisablesFor(deployments.data);
  const reloadDeployments = async () => {
    await Promise.all([loadDeployments(), canAudit ? loadDisables() : Promise.resolve()]);
  };
  const status = useShell((s) => s.status);

  useEffect(() => {
    void load();
  }, [load]);
  usePolling(() => void load({ quiet: true }));

  const h = health.data;
  return (
    <div className="flex flex-col">
      <Section
        title="Gateway"
        subtitle={
          status
            ? `Version ${status.version}${status.test_mode ? ' · Test mode' : ''} · ${status.mode === 'standalone' ? 'Single node' : 'Cluster'}`
            : undefined
        }
        actions={<UpdatedAt at={health.at} />}
      >
        {health.status === 'loading' && !h ? <LoadingRows rows={3} /> : null}
        <LoadError of={health} subject="Health" onRetry={() => void load()} />
        {h ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={h.status === 'ok' ? 'success' : h.status === 'draining' ? 'info' : 'warn'} dot>
                {h.status === 'ok' ? 'Operational' : h.status === 'draining' ? 'Draining' : 'Degraded'}
              </Badge>
              <span className="text-ui text-muted">Configuration version {h.config.generation}</span>
            </div>
            <details className="group order-last">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-caption text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
                <Icon name="chevronRight" size={12} className="transition-transform group-open:rotate-90" />
                Technical details
              </summary>
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-caption">
                <dt className="text-muted">Build</dt>
                <dd className="mono text-fg">{status?.commit ?? '—'}</dd>
                <dt className="text-muted">Configuration hash</dt>
                <dd className="mono break-all text-fg">{h.config.hash}</dd>
                <dt className="text-muted">Clock difference</dt>
                <dd className="mono text-fg">{h.clock_skew_ms ?? '—'} ms</dd>
              </dl>
            </details>
            <DefinitionGrid
              columns={4}
              items={[
                {
                  label: 'Active requests',
                  value: `${formatCount(h.admission.in_flight)} / ${formatCount(h.admission.max_in_flight)}`,
                },
                {
                  label: 'Waiting requests',
                  value: `${formatCount(h.admission.queued)} / ${formatCount(h.admission.max_queue)}`,
                },
                {
                  label: 'Log buffer',
                  value: `${formatBytes(h.spool.bytes)} / ${formatBytes(h.spool.max_bytes)}`,
                },
                { label: 'Records waiting to be written', value: formatCount(h.spool.records) },
              ]}
            />
            <Meter
              value={h.admission.in_flight}
              max={h.admission.max_in_flight}
              label="Active requests against the most this node accepts at once"
            />
            <ul className="flex flex-col gap-1.5">
              {Object.entries(h.dependencies).map(([name, d]) => (
                <li key={name} className="flex items-center gap-2 text-ui">
                  <Dot tone={d.status === 'up' ? 'success' : 'error'} />
                  <span className="text-fg">{DEPENDENCY_LABEL[name] ?? name}</span>
                  <span className="text-muted">{d.status === 'up' ? 'Healthy' : 'Not responding'}</span>
                  {d.latency_ms !== null ? (
                    <span className="mono text-caption text-dim">{d.latency_ms} ms</span>
                  ) : null}
                  {d.last_error ? (
                    <span className="truncate text-caption text-error">{d.last_error}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>
      <TestModePanel />
      <ClusterSection running={h?.config.generation ?? null} />
      <Section
        title="Deployments"
        subtitle="A deployment that keeps failing is paused for a while, then tried again. One turned off by hand stays off until someone turns it on."
      >
        <LoadError of={deployments} subject="Deployment health" size="sm" />
        {deployments.data?.length === 0 ? <EmptyState size="sm" title="No deployments yet" /> : null}
        {deployments.data && deployments.data.length > 0 ? (
          <Table label="Deployment health">
            <thead>
              <tr>
                <Th>Deployment</Th>
                <Th>Status</Th>
                <Th numeric>Errors / requests</Th>
                <Th numeric>Times paused</Th>
                <Th>Until</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {deployments.data.map((d) => {
                const name = healthName(d);
                const state = runtimeStatus(d);
                return (
                  <Tr key={name}>
                    <Td mono>{name}</Td>
                    <Td>
                      <RuntimeState name={name} health={d} withUntil={false} />
                    </Td>
                    <Td numeric>
                      {d.window.failures} / {d.window.requests}
                    </Td>
                    <Td numeric>{d.trips}</Td>
                    <Td muted>{state.until ? formatRelative(state.until) : '—'}</Td>
                    <Td className="text-right">
                      <span className="flex items-center justify-end gap-1">
                        {state.action === 'enable' ? (
                          <Gate operation="enableDeployment" mode="hide">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void turnOn(name, reloadDeployments)}
                            >
                              Turn on
                            </Button>
                          </Gate>
                        ) : null}
                        {state.action === 'reset' ? (
                          <Gate operation="resetDeployment" mode="hide">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void resumeNow(name, reloadDeployments)}
                            >
                              Resume now
                            </Button>
                          </Gate>
                        ) : null}
                        {state.kind !== 'off' && canDisable ? (
                          <MenuButton
                            iconOnly
                            icon="more"
                            variant="ghost"
                            size="sm"
                            align="right"
                            label={`Actions for ${name}`}
                            items={[
                              { label: 'Turn off…', icon: 'pause', onSelect: () => setTurningOff(name) },
                            ]}
                          />
                        ) : null}
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        ) : null}
        <TurnOffDialog
          name={turningOff ?? ''}
          open={turningOff !== null}
          onClose={() => setTurningOff(null)}
          onDone={reloadDeployments}
        />
      </Section>
      <Section title="Provider keys" subtitle="Whether the gateway's key for each provider works.">
        <LoadError of={providers} subject="Provider status" size="sm" />
        {providers.data?.length === 0 ? <EmptyState size="sm" title="No providers yet" /> : null}
        <ul className="flex flex-col gap-1.5">
          {(providers.data ?? []).map((p) => (
            <li key={p.name} className="flex items-center gap-2 text-ui">
              <Dot tone={p.credential.state === 'valid' ? 'success' : 'error'} />
              <span className="mono text-fg">{p.name}</span>
              <span className="text-muted">
                {p.type} · {p.credential.state === 'valid' ? 'Valid' : p.credential.state}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
