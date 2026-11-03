'use client';

import { useEffect, useState } from 'react';

import { OWNER_KINDS, listPolicyOwners, type OwnerKind, type PolicyOwner } from '@/features/plugins/api';
import { useOwnerAccess } from '@/features/plugins/components/attached-to';

const LABEL = Object.fromEntries(OWNER_KINDS.map((k) => [k.value, k.label])) as Record<OwnerKind, string>;

const LISTS: { key: string; label: string }[] = [
  { key: 'input', label: 'prompts' },
  { key: 'output', label: 'answers' },
  { key: 'mcp_input', label: 'tool calls' },
  { key: 'mcp_output', label: 'tool results' },
];

/** Where one level names a guardrail: the lists it is in, or that it excludes it. */
export function namedIn(owner: PolicyOwner, name: string): { lists: string[]; excluded: boolean } {
  const g = owner.policies.guardrails;
  const rec = typeof g === 'object' && g !== null ? (g as Record<string, unknown>) : {};
  const has = (key: string) => Array.isArray(rec[key]) && (rec[key] as unknown[]).includes(name);
  return { lists: LISTS.filter((l) => has(l.key)).map((l) => l.label), excluded: has('exclude') };
}

/**
 * The levels below the gateway whose own policies run a guardrail (an organization, team,
 * project, key, Model or route), read-only: each level changes it in its own policies.
 */
export function NamedBy({ name }: { name: string }) {
  const access = useOwnerAccess();
  const readKey = access.read.join(',');
  const [owners, setOwners] = useState<PolicyOwner[] | null>(null);
  useEffect(() => {
    if (!readKey) return;
    let live = true;
    listPolicyOwners(readKey.split(',') as OwnerKind[])
      .then((o) => {
        if (live) setOwners(o);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [readKey]);
  if (!owners) return null;
  const named = owners.flatMap((o) => {
    const n = namedIn(o, name);
    return n.lists.length > 0 || n.excluded ? [{ owner: o, ...n }] : [];
  });
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="Named below the gateway">
      <span className="text-caption font-medium text-fg">Also named by</span>
      {named.length === 0 ? (
        <p className="text-caption text-muted">No organization, team, project, key, Model or route.</p>
      ) : (
        <ul className="flex flex-col gap-0.5 text-caption text-muted">
          {named.map(({ owner, lists, excluded }) => (
            <li key={`${owner.kind}/${owner.name}`}>
              {LABEL[owner.kind]} <span className="mono text-fg">{owner.name}</span>
              {lists.length > 0 ? `: ${lists.join(', ')}` : ''}
              {excluded ? `${lists.length > 0 ? '; ' : ': '}excluded there` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
