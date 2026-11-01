import type { components } from '@/lib/api/schema';

/** A level's `policies.mcp`: its server list, tool, prompt and resource lists, conditional rules. */
export type McpPolicy = components['schemas']['PolicyMcp'];

/** A policy level that can grant MCP servers. `gateway` is the level every API key is under. */
export type GrantLevel = 'gateway' | 'organization' | 'team' | 'project' | 'key';

/** The levels below the gateway, with the operations that read and change them. */
export const LEVELS = [
  { value: 'organization', label: 'Organization', list: 'listOrganizations', patch: 'patchOrganization' },
  { value: 'team', label: 'Team', list: 'listTeams', patch: 'patchTeam' },
  { value: 'project', label: 'Project', list: 'listProjects', patch: 'patchProject' },
  { value: 'key', label: 'API key', list: 'listKeys', patch: 'patchKey' },
] as const;

export type TargetLevel = (typeof LEVELS)[number]['value'];

export const LEVEL_LABEL: Record<GrantLevel, string> = {
  gateway: 'Every API key',
  organization: 'Organization',
  team: 'Team',
  project: 'Project',
  key: 'API key',
};

/** A level's kind in the middle of a sentence: "team support", "key ci-bot". */
export const LEVEL_NOUN: Record<GrantLevel, string> = {
  gateway: 'every API key',
  organization: 'organization',
  team: 'team',
  project: 'project',
  key: 'key',
};

/** One level's MCP grants as written, with the ETag its next write is checked against. */
export interface Holder {
  level: GrantLevel;
  /** The resource's name; empty for the gateway level. */
  name: string;
  etag: string | undefined;
  mcp: McpPolicy | undefined;
}

/** Every level the principal could read, as the MCP screen shows who may use a server. */
export interface Access {
  /** The gateway level, or null when it can't be read. */
  gateway: Holder | null;
  /** The organizations, teams, projects and keys read. */
  levels: Holder[];
  /** Whether every level could be read, so a grant not seen is known to be missing. */
  complete: boolean;
}

/** "team support", "every API key": a level as a sentence names it. */
export function holderName(h: Holder): string {
  return h.level === 'gateway' ? LEVEL_NOUN.gateway : `${LEVEL_NOUN[h.level]} ${h.name}`;
}

/** "a", "a and b", "a, b and c". */
export function words(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/** The servers a level lists, or null when it lists none and so takes no part in the decision. */
export function listOf(h: Holder | null | undefined): string[] | null {
  return h?.mcp?.servers ?? null;
}

function covers(list: string[], server: string): boolean {
  return list.includes('*') || list.includes(server);
}

/** The list with the servers added: those missing go at the end, and a `"*"` already has them all. */
export function withServers(list: string[] | null, servers: string[]): string[] {
  const current = list ?? [];
  if (current.includes('*')) return current;
  return [...current, ...servers.filter((s) => !current.includes(s))];
}

/**
 * The list with the servers taken off, or null when nothing is left. A `"*"` goes too: it names
 * every server, so the level can't keep it and lose some.
 *
 * An emptied list is dropped rather than written as `[]`. The two differ: a level without a list
 * takes no part, so the caller's other levels decide, while `[]` is a list that includes no server,
 * and since every listing level must include a server, it would deny every MCP server to every key
 * under that level, whatever the others grant. Taking a level's last servers away means it stops
 * granting them, not that it starts forbidding all of them.
 */
export function withoutServers(list: string[] | null, servers: string[]): string[] | null {
  const next = (list ?? []).filter((s) => s !== '*' && !servers.includes(s));
  return next.length > 0 ? next : null;
}

/**
 * The merge patch of a level's `policies.mcp` that sets its server list (null removes it). Only
 * `servers` is named, so the tools, prompts, resources, conditional rules and the rest stay as
 * they are.
 */
export function serversPatch(next: string[] | null): { policies: { mcp: { servers: string[] | null } } } {
  return { policies: { mcp: { servers: next } } };
}

/** Which of the servers a level's list includes: `'*'` when it names every server. */
export function coverage(list: string[] | null, servers: string[]): string[] | '*' {
  if (!list) return [];
  if (list.includes('*')) return '*';
  return servers.filter((s) => list.includes(s));
}

/** A level that grants some of the servers, and which. */
export interface Grantee {
  holder: Holder;
  servers: string[] | '*';
}

/** The levels whose server lists include any of these servers or `"*"`, the gateway level first. */
export function grantees(access: Access, servers: string[]): Grantee[] {
  const all = [...(access.gateway ? [access.gateway] : []), ...access.levels];
  return all.flatMap((holder) => {
    const c = coverage(listOf(holder), servers);
    return c === '*' || c.length > 0 ? [{ holder, servers: c }] : [];
  });
}

/**
 * Whether a key can use a server:
 * - `granted`: the gateway level's list includes it, or there is no such list and some level's does;
 * - `blocked`: some level below grants it, but the gateway level's list leaves it out, and lists at
 *   different levels narrow each other, so no key gets it;
 * - `none`: no level lists it;
 * - `unknown`: a level could not be read, or conditional rules may grant it.
 */
export type ServerReach = 'granted' | 'blocked' | 'none' | 'unknown';

export function serverReach(access: Access, server: string): ServerReach {
  if (!access.gateway) return 'unknown';
  const top = listOf(access.gateway);
  const below = access.levels.some((h) => {
    const list = listOf(h);
    return list !== null && covers(list, server);
  });
  if (top) return covers(top, server) ? 'granted' : below ? 'blocked' : 'none';
  if (below) return 'granted';
  const conditional = [access.gateway, ...access.levels].some((h) => h.mcp?.when !== undefined);
  return conditional || !access.complete ? 'unknown' : 'none';
}

/** Whether any key can use a gateway: `none` only when it is known that no key can use any of its servers. */
export function gatewayReach(access: Access | null, servers: string[]): 'granted' | 'none' | 'unknown' {
  if (!access || servers.length === 0) return 'unknown';
  const each = servers.map((s) => serverReach(access, s));
  if (each.includes('granted')) return 'granted';
  if (each.includes('unknown')) return 'unknown';
  return 'none';
}

/**
 * What granting the servers to every API key writes at the gateway level:
 * - `granted`: its list already includes them all;
 * - `append`: its list exists, and the missing ones are added (a wider grant, nothing narrows);
 * - `create`: there is no list yet, and no level has one that the new list would narrow;
 * - `narrows`: there is no list yet, and creating one with only these servers would narrow the
 *   lists of `narrowed`, since every listing level must include a server; `["*"]` (every server for
 *   every key) changes nothing for them.
 */
export type EveryKeyPlan =
  | { kind: 'granted' }
  | { kind: 'append'; next: string[] }
  | { kind: 'create'; next: string[] }
  | { kind: 'narrows'; next: string[]; narrowed: Holder[] };

export function everyKeyPlan(access: Access, servers: string[]): EveryKeyPlan {
  const top = listOf(access.gateway);
  if (top) {
    const next = withServers(top, servers);
    return next.length === top.length ? { kind: 'granted' } : { kind: 'append', next };
  }
  const narrowed = access.levels.filter((h) => listOf(h)?.some((s) => !servers.includes(s)));
  return narrowed.length > 0
    ? { kind: 'narrows', next: [...servers], narrowed }
    : { kind: 'create', next: [...servers] };
}

/**
 * What taking the servers away from a level does, in a sentence for the confirmation: a `"*"`
 * goes as a whole, and the gateway level's last servers take its list away, which lifts the limit
 * it put on the levels below.
 */
export function removalEffect(access: Access, holder: Holder, servers: string[]): string {
  const list = listOf(holder) ?? [];
  const who = holderName(holder);
  const next = withoutServers(list, servers);
  const lost = list.includes('*') ? null : servers.filter((s) => list.includes(s));
  const parts = [
    lost
      ? `${capital(who)} loses ${words(lost)}.`
      : `${capital(who)} can use every MCP server today; this takes that away, not only this gateway's servers.`,
  ];
  if (holder.level === 'gateway' && next === null) {
    // The levels this list narrowed: those listing a server it leaves out, or every server.
    const freed = list.includes('*')
      ? []
      : access.levels.filter((h) => listOf(h)?.some((s) => s === '*' || !list.includes(s)));
    parts.push(
      freed.length > 0
        ? `Without a list for every API key, ${words(freed.map(holderName))} also get${freed.length === 1 ? 's' : ''} the other servers ${freed.length === 1 ? 'it lists' : 'they list'}.`
        : 'Keys keep what their organization, team, project or own grants give them.',
    );
  } else {
    parts.push('Keys still reach these servers through any other level that grants them.');
  }
  return parts.join(' ');
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
