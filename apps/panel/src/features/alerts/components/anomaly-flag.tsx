'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useScopedHref } from '@/components/layout/url-sync';
import { Badge, Dot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Segmented, Select } from '@/components/ui/form';
import { Gate } from '@/components/ui/gate';
import { DefinitionGrid } from '@/components/ui/layout';
import { Drawer } from '@/components/ui/overlay';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { describeError } from '@/lib/api/client';
import { formatCount } from '@/lib/format';
import { formatDateTime, formatRelative } from '@/lib/time';
import { usePreferences } from '@/stores/preferences';
import { notify } from '@/stores/ui';

import {
  type Anomaly,
  ANOMALY_KINDS,
  anomaliesApi,
  anomalyDetail,
  anomalyKindWords,
  type AnomalyFilter,
  type AnomalyKind,
} from '../anomalies';

const TONE = { critical: 'error', warning: 'warn', info: 'info' } as const;

function DismissButton({ flag, onDone }: { flag: Anomaly; onDone: (a: Anomaly) => void }) {
  const [busy, setBusy] = useState(false);
  if (flag.state !== 'open') return null;
  return (
    <Gate operation="dismissAnomaly">
      <Button
        size="sm"
        busy={busy}
        onClick={() => {
          setBusy(true);
          anomaliesApi.dismiss(flag.id).then(
            (a) => {
              notify('success', 'Flag dismissed', `${flag.key}: ${anomalyKindWords(flag.kind)}`);
              setBusy(false);
              onDone(a);
            },
            (e: unknown) => {
              notify('error', "Couldn't dismiss the flag", describeError(e));
              setBusy(false);
            },
          );
        }}
      >
        Dismiss
      </Button>
    </Gate>
  );
}

/**
 * The flag behind an alert raised by unusual key activity (`GET /anomalies/{id}`): what was seen,
 * when, how often and what the gateway recorded, with a dismissal and the key's other flags.
 */
export function AnomalyFlag({ id, onHistory }: { id: string; onHistory: (key: string) => void }) {
  const timeZone = usePreferences((s) => s.timeZone);
  const [flag, setFlag] = useState<{ id: string; data: Anomaly | null; error: unknown } | null>(null);
  useEffect(() => {
    let live = true;
    anomaliesApi.get(id).then(
      (data) => {
        if (live) setFlag({ id, data, error: null });
      },
      (error: unknown) => {
        if (live) setFlag({ id, data: null, error });
      },
    );
    return () => {
      live = false;
    };
  }, [id]);
  const current = flag?.id === id ? flag : null;
  const a = current?.data ?? null;
  const logHref = useScopedHref('/request-log/', a ? { key: a.key } : undefined);
  if (!current) return <LoadingRows rows={2} label="Loading the flag" />;
  if (current.error || !a) return <ErrorState error={current.error} subject="The flag" size="sm" />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-ui">
        <Dot tone={TONE[a.severity]} />
        <span className="text-fg">
          <span className="mono font-semibold">{a.key}</span> {anomalyKindWords(a.kind).toLowerCase()}
        </span>
        <Badge tone={a.state === 'open' ? 'warn' : 'neutral'}>
          {a.state === 'open' ? 'Open' : 'Dismissed'}
        </Badge>
        {a.owner ? <span className="text-caption text-muted">owner {a.owner}</span> : null}
      </div>
      <DefinitionGrid
        columns={3}
        items={[
          { label: 'First seen', value: formatDateTime(a.first_seen, timeZone) },
          { label: 'Last seen', value: formatDateTime(a.last_seen, timeZone) },
          { label: 'Times seen', value: formatCount(a.count) },
          ...anomalyDetail(a),
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <DismissButton flag={a} onDone={(next) => setFlag({ id, data: next, error: null })} />
        <Button size="sm" variant="ghost" icon="history" onClick={() => onHistory(a.key)}>
          Flags on this key
        </Button>
        <Link href={logHref} className="ml-auto text-caption text-accent hover:underline">
          See its requests
        </Link>
      </div>
    </div>
  );
}

type StateChoice = 'open' | 'dismissed' | 'all';

/**
 * Every flag the gateway raised, open and dismissed, newest first: by key, state and kind, with a
 * dismissal of an open one. Alerts and Keys open the same history.
 */
export function AnomalyHistory({ keyName = '', onClose }: { keyName?: string; onClose: () => void }) {
  const timeZone = usePreferences((s) => s.timeZone);
  const [key, setKey] = useState(keyName);
  const [keyText, setKeyText] = useState(keyName);
  const [state, setState] = useState<StateChoice>('all');
  const [kind, setKind] = useState<AnomalyKind | ''>('');
  const [items, setItems] = useState<Anomaly[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const filter: AnomalyFilter = { key, state: state === 'all' ? '' : state, kind };
  const filterKey = JSON.stringify(filter);
  const load = useCallback(
    (after?: string) => {
      const f = JSON.parse(filterKey) as AnomalyFilter;
      anomaliesApi.list(f, after).then((page) => {
        setItems((prev) => (after ? [...(prev ?? []), ...page.items] : page.items));
        setCursor(page.next_cursor ?? null);
        setError(null);
      }, setError);
    },
    [filterKey],
  );
  useEffect(() => load(), [load]);
  const refilter = (apply: () => void) => {
    setItems(null);
    apply();
  };
  const filtered = key !== '' || state !== 'all' || kind !== '';
  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={key ? `Flags on ${key}` : 'Unusual key activity'}
      subtitle="Every flag the gateway raised on a key's use, open and dismissed, newest first."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented<StateChoice>
          label="State"
          value={state}
          onChange={(v) => refilter(() => setState(v))}
          options={[
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Open' },
            { value: 'dismissed', label: 'Dismissed' },
          ]}
        />
        <div className="w-56 max-sm:w-full">
          <Select
            aria-label="Kind"
            value={kind}
            onChange={(v) => refilter(() => setKind(v as AnomalyKind | ''))}
            emptyOption="Any kind"
            options={ANOMALY_KINDS}
          />
        </div>
        <div className="w-40 max-sm:w-full">
          <Input
            icon="filter"
            aria-label="Key"
            placeholder="Key"
            value={keyText}
            onChange={(e) => setKeyText(e.target.value)}
            onBlur={() => keyText.trim() !== key && refilter(() => setKey(keyText.trim()))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && keyText.trim() !== key) refilter(() => setKey(keyText.trim()));
            }}
          />
        </div>
      </div>
      {error ? <ErrorState error={error} subject="Flags" size="sm" onRetry={() => load()} /> : null}
      {!items && !error ? <LoadingRows rows={4} label="Loading flags" /> : null}
      {items?.length === 0 ? (
        <EmptyState size="sm" title={filtered ? 'No flags match these filters' : 'No flags yet'} />
      ) : null}
      {items && items.length > 0 ? (
        <div className="flex flex-col gap-3">
          <Table label="Flags">
            <thead>
              <tr>
                <Th>Last seen</Th>
                <Th>Key</Th>
                <Th>What</Th>
                <Th numeric>Times</Th>
                <Th>State</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <Tr key={a.id}>
                  <Td muted>
                    {formatRelative(a.last_seen)}
                    <span className="mono block text-caption text-dim">
                      {formatDateTime(a.last_seen, timeZone)}
                    </span>
                  </Td>
                  <Td mono>{a.key}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <Dot tone={TONE[a.severity]} />
                      {anomalyKindWords(a.kind)}
                    </span>
                    {anomalyDetail(a).length > 0 ? (
                      <span className="block text-caption text-muted">
                        {anomalyDetail(a)
                          .slice(0, 2)
                          .map((d) => `${d.label} ${d.value}`)
                          .join(' · ')}
                      </span>
                    ) : null}
                  </Td>
                  <Td numeric>{formatCount(a.count)}</Td>
                  <Td>
                    <Badge tone={a.state === 'open' ? 'warn' : 'neutral'}>
                      {a.state === 'open' ? 'Open' : 'Dismissed'}
                    </Badge>
                  </Td>
                  <Td>
                    <DismissButton
                      flag={a}
                      onDone={(next) =>
                        setItems((prev) => (prev ?? []).map((x) => (x.id === next.id ? next : x)))
                      }
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {cursor ? (
            <div>
              <Button size="sm" onClick={() => load(cursor)}>
                Show more
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
