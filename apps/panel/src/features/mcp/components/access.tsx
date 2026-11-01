'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm';
import { MultiSelect, RadioGroup, Select } from '@/components/ui/form';
import type { SelectHandle } from '@/components/ui/select';
import { useCan, usePermission } from '@/components/ui/gate';
import { EmptyPill, LoadError } from '@/components/ui/states';
import { describeError, isChangeControl } from '@/lib/api/client';
import { OPERATIONS } from '@/lib/api/operations';
import { notify } from '@/stores/ui';

import {
  type Access,
  everyKeyPlan,
  gatewayReach,
  type Grantee,
  grantees,
  type Holder,
  holderName,
  LEVEL_LABEL,
  LEVEL_NOUN,
  LEVELS,
  listOf,
  removalEffect,
  serverReach,
  type TargetLevel,
  withoutServers,
  withServers,
  words,
} from '../access';
import { type AccessRead, useMcp } from '../store';
import { Callout, Section } from './parts';

/** The id of the "Who can use it" section, for the links that open it. */
export const ACCESS_SECTION = 'mcp-access';

/** The levels the principal may read. Stable while its permissions are, so it can key a load. */
export function useAccessRead(): AccessRead {
  const gateway = usePermission(OPERATIONS.getPoliciesSettings.permission);
  const organization = usePermission(OPERATIONS.listOrganizations.permission);
  const team = usePermission(OPERATIONS.listTeams.permission);
  const project = usePermission(OPERATIONS.listProjects.permission);
  const key = usePermission(OPERATIONS.listKeys.permission);
  return useMemo(() => {
    const may: Record<TargetLevel, boolean> = { organization, team, project, key };
    return { gateway, levels: LEVELS.map((l) => l.value).filter((l) => may[l]) };
  }, [gateway, organization, team, project, key]);
}

/** The levels whose server lists the principal may change. */
function useAccessWrite(): { gateway: boolean; levels: Set<TargetLevel> } {
  const gateway = useCan('patchPoliciesSettings');
  const organization = useCan('patchOrganization');
  const team = useCan('patchTeam');
  const project = useCan('patchProject');
  const key = useCan('patchKey');
  return useMemo(() => {
    const may: Record<TargetLevel, boolean> = { organization, team, project, key };
    return { gateway, levels: new Set(LEVELS.map((l) => l.value).filter((l) => may[l])) };
  }, [gateway, organization, team, project, key]);
}

/** Reads who may use MCP servers once the principal's permissions are known. */
export function useLoadAccess(enabled: boolean): void {
  const read = useAccessRead();
  const loadAccess = useMcp((s) => s.loadAccess);
  useEffect(() => {
    if (enabled) void loadAccess(read);
  }, [enabled, read, loadAccess]);
}

/** Whether any API key can use a gateway's servers, from the levels read (`unknown` until then). */
export function useGatewayReach(servers: string[]): 'granted' | 'none' | 'unknown' {
  const access = useMcp((s) => s.access.data);
  return gatewayReach(access, servers);
}

/** The warning of a gateway no key can use, with the way to grant it. */
export function NoAccessCallout({ servers, onOpen }: { servers: string[]; onOpen: () => void }) {
  const reach = useGatewayReach(servers);
  if (reach !== 'none') return null;
  return (
    <Callout
      tone="warn"
      title="No API key can use this gateway yet"
      action={
        <Button size="sm" onClick={onOpen}>
          Choose who can use it
        </Button>
      }
    >
      Access to MCP servers is closed until a policy grants it: to every API key, or to an organization, team,
      project or key.
    </Callout>
  );
}

function GranteeRow({
  grantee,
  servers,
  onRemove,
}: {
  grantee: Grantee;
  servers: string[];
  onRemove: (() => void) | null;
}) {
  const { holder } = grantee;
  const partial = grantee.servers !== '*' && grantee.servers.length < servers.length;
  return (
    <li className="flex items-center gap-2 border-line px-3 py-1.5 [&+&]:border-t">
      <span className="w-28 shrink-0 text-caption text-muted max-sm:w-20">{LEVEL_LABEL[holder.level]}</span>
      <span className="mono min-w-0 flex-1 truncate text-ui text-fg">{holder.name}</span>
      {grantee.servers === '*' ? (
        <Badge title='Its list is "*"'>Every server</Badge>
      ) : partial ? (
        <span className="flex flex-wrap gap-1">
          {grantee.servers.map((s) => (
            <Badge key={s} mono>
              {s}
            </Badge>
          ))}
        </span>
      ) : null}
      {onRemove ? (
        <IconButton icon="x" label={`Remove access for ${holderName(holder)}`} onClick={onRemove} />
      ) : null}
    </li>
  );
}

type Choice = 'all' | 'these';

/** Grants the servers to every API key, or to the organizations, teams, projects or keys picked. */
function GrantForm({
  access,
  servers,
  write,
  focus,
}: {
  access: Access;
  servers: string[];
  write: { gateway: boolean; levels: Set<TargetLevel> };
  focus: number;
}) {
  const setServersAt = useMcp((s) => s.setServersAt);
  const loadAccess = useMcp((s) => s.loadAccess);
  const read = useAccessRead();
  const plan = everyKeyPlan(access, servers);
  const offerGateway = write.gateway && access.gateway !== null && plan.kind !== 'granted';
  const kinds = LEVELS.filter((l) => write.levels.has(l.value) && read.levels.includes(l.value));
  const [level, setLevel] = useState<TargetLevel | 'gateway' | ''>('');
  const [targets, setTargets] = useState<string[]>([]);
  const [choice, setChoice] = useState<Choice>('all');
  const [busy, setBusy] = useState(false);
  const select = useRef<SelectHandle>(null);

  useEffect(() => {
    if (focus > 0) select.current?.focus();
  }, [focus]);

  if (!offerGateway && kinds.length === 0) return null;

  const candidates = access.levels.filter((h) => {
    if (h.level !== level) return false;
    const list = listOf(h);
    return !list || !servers.every((s) => list.includes('*') || list.includes(s));
  });
  const top = listOf(access.gateway);
  const leftOut = top && !top.includes('*') ? servers.filter((s) => !top.includes(s)) : [];

  async function grant() {
    setBusy(true);
    try {
      if (level === 'gateway' && access.gateway && plan.kind !== 'granted') {
        const next = plan.kind === 'narrows' && choice === 'all' ? ['*'] : plan.next;
        await setServersAt(access.gateway, next);
        notify('success', 'Access granted', 'Every API key');
      } else {
        const picked = candidates.filter((h) => targets.includes(h.name));
        for (const h of picked) await setServersAt(h, withServers(listOf(h), servers));
        notify('success', 'Access granted', words(picked.map(holderName)));
      }
      setLevel('');
      setTargets([]);
      setChoice('all');
    } catch (e) {
      if (!isChangeControl(e)) notify('error', "Couldn't grant access", describeError(e));
      void loadAccess(read, { quiet: true });
    } finally {
      setBusy(false);
    }
  }

  const ready = level === 'gateway' || (level !== '' && targets.length > 0);
  return (
    <div className="flex flex-col gap-3" role="group" aria-label="Grant access">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-start gap-2 max-sm:grid-cols-1">
        <Select
          ref={select}
          aria-label="Grant to"
          value={level}
          placeholder="Grant to"
          onChange={(v) => {
            setLevel(v as TargetLevel | 'gateway');
            setTargets([]);
          }}
          options={[
            ...(offerGateway ? [{ value: 'gateway', label: LEVEL_LABEL.gateway }] : []),
            ...kinds.map((k) => ({ value: k.value, label: k.label })),
          ]}
        />
        {level === 'gateway' ? (
          <p className="self-center text-caption text-muted">
            {plan.kind === 'append'
              ? `Adds ${words(leftOut)} to the servers every API key may use.`
              : plan.kind === 'create'
                ? `Every API key may use ${words(servers)}.`
                : 'Choose below what every API key gets.'}
          </p>
        ) : (
          <MultiSelect
            aria-label="Which ones"
            value={targets}
            disabled={!level}
            noun={level ? LEVEL_NOUN[level] : 'level'}
            placeholder={level ? `Choose ${LEVEL_NOUN[level]}s` : 'Choose a level first'}
            onChange={setTargets}
            options={candidates.map((h) => ({ value: h.name, label: h.name }))}
          />
        )}
        <Button size="sm" busy={busy} disabled={!ready} onClick={() => void grant()}>
          Grant access
        </Button>
      </div>
      {level === 'gateway' && plan.kind === 'narrows' ? (
        <>
          <Callout tone="warn" title="A list for every API key narrows the others">
            {capitalFirst(words(plan.narrowed.map(holderName)))}{' '}
            {plan.narrowed.length === 1 ? 'grants' : 'grant'} other MCP servers today. Each level&apos;s list
            narrows the others, so a list for every API key with only {words(servers)} would leave{' '}
            {plan.narrowed.length === 1 ? 'its' : 'their'} keys only what both lists include.
          </Callout>
          <RadioGroup<Choice>
            label="What every API key gets"
            value={choice}
            onChange={setChoice}
            options={[
              {
                value: 'all',
                label: 'Every MCP server',
                description:
                  'Every key may use every MCP server, through any gateway. Nothing changes for the levels that grant servers today.',
              },
              {
                value: 'these',
                label: `Only ${words(servers)}`,
                description: `What ${words(plan.narrowed.map(holderName))} grant${plan.narrowed.length === 1 ? 's' : ''} beyond ${words(servers)} stops working.`,
              },
            ]}
          />
        </>
      ) : null}
      {level !== '' && level !== 'gateway' && leftOut.length > 0 ? (
        <p className="text-caption text-muted">
          The list for every API key leaves out {words(leftOut)}, so keys get{' '}
          {leftOut.length === 1 ? 'it' : 'them'} only once that list includes{' '}
          {leftOut.length === 1 ? 'it' : 'them'} too.
        </p>
      ) : null}
    </div>
  );
}

function capitalFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Who can use these servers: the levels whose server lists include them, a note on the ones no key
 * can reach, and (with `editable`) a form to grant them and a way to take a grant away. `focus`
 * scrolls here and focuses the form each time it grows.
 */
export function WhoCanUse({
  servers,
  editable,
  focus = 0,
}: {
  servers: string[];
  editable: boolean;
  focus?: number;
}) {
  const access = useMcp((s) => s.access);
  const loadAccess = useMcp((s) => s.loadAccess);
  const setServersAt = useMcp((s) => s.setServersAt);
  const read = useAccessRead();
  const write = useAccessWrite();
  const [removing, setRemoving] = useState<Holder | null>(null);
  const section = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadAccess(read, { quiet: true });
  }, [read, loadAccess]);
  useEffect(() => {
    if (focus > 0) section.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focus]);

  if (!read.gateway && read.levels.length === 0) return null;
  const data = access.data;
  const list = data ? grantees(data, servers) : [];
  const reach = data ? servers.map((s) => ({ server: s, reach: serverReach(data, s) })) : [];
  const blocked = reach.filter((r) => r.reach === 'blocked').map((r) => r.server);
  const unreached = reach.filter((r) => r.reach === 'none').map((r) => r.server);
  const conditional = data
    ? [...(data.gateway ? [data.gateway] : []), ...data.levels].some((h) => h.mcp?.when !== undefined)
    : false;
  const mayRemove = (h: Holder) =>
    editable && (h.level === 'gateway' ? write.gateway : write.levels.has(h.level));

  return (
    <Section title="Who can use it" aside="API keys need a grant">
      <div ref={section} id={ACCESS_SECTION} className="flex scroll-mt-4 flex-col gap-3">
        <LoadError of={access} subject="Who can use it" size="sm" />
        {data ? (
          <>
            <ul aria-label="Levels that grant access" className="flex flex-col border-y border-line">
              {list.length === 0 ? (
                <li className="flex justify-center px-3 py-3">
                  <EmptyPill>No API key can use {servers.length === 1 ? 'it' : 'them'} yet</EmptyPill>
                </li>
              ) : null}
              {list.map((g) => (
                <GranteeRow
                  key={`${g.holder.level}/${g.holder.name}`}
                  grantee={g}
                  servers={servers}
                  onRemove={mayRemove(g.holder) ? () => setRemoving(g.holder) : null}
                />
              ))}
            </ul>
            {blocked.length > 0 ? (
              <Callout tone="warn" title={`No API key can use ${words(blocked)}`}>
                The list for every API key leaves {blocked.length === 1 ? 'it' : 'them'} out, and each
                level&apos;s list narrows the others, so what the levels below grant doesn&apos;t reach any
                key. Grant {blocked.length === 1 ? 'it' : 'them'} to every API key to open{' '}
                {blocked.length === 1 ? 'it' : 'them'}.
              </Callout>
            ) : null}
            {unreached.length > 0 && unreached.length < servers.length ? (
              <p className="text-caption text-muted">No level grants {words(unreached)} yet.</p>
            ) : null}
            {conditional ? (
              <p className="text-caption text-muted">
                Some levels also grant servers through conditional rules, which only the Admin API shows.
              </p>
            ) : null}
            {!data.complete ? (
              <p className="text-caption text-muted">
                Some levels can&apos;t be read with your access, so others may grant these servers too.
              </p>
            ) : null}
            {editable ? (
              <GrantForm access={data} servers={servers} write={write} focus={focus} />
            ) : (
              <p className="text-caption text-muted">
                Grant or remove access from a gateway that combines{' '}
                {servers.length === 1 ? 'this server' : 'these servers'}.
              </p>
            )}
          </>
        ) : null}
      </div>
      {removing && data ? (
        <ConfirmDialog
          open
          onClose={() => setRemoving(null)}
          title={`Remove access for ${holderName(removing)}?`}
          confirmLabel="Remove access"
          effect={removalEffect(data, removing, servers)}
          onConfirm={async (reason) => {
            try {
              await setServersAt(removing, withoutServers(listOf(removing), servers), reason);
            } catch (e) {
              // A level changed since it was read (412): show it as it is now for the next try.
              void loadAccess(read, { quiet: true });
              throw e;
            }
            notify('success', 'Access removed', capitalFirst(holderName(removing)));
          }}
        />
      ) : null}
    </Section>
  );
}
