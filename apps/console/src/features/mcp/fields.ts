/**
 * Form helpers shared by the MCP, agent and plugin editors: header maps whose values are secrets,
 * durations and names as the configuration writes them.
 */

/** What the gateway reads back in place of a secret; written back, it keeps the stored value. */
export const REDACTED = '[REDACTED]';

/** One header of a header map: its value is write-only once stored. */
export interface HeaderRow {
  name: string;
  value: string;
  /** The gateway holds a value for this header (read back hidden). */
  stored: boolean;
}

export function headerRows(map: Record<string, string> | null | undefined): HeaderRow[] {
  return Object.entries(map ?? {}).map(([name, value]) => {
    const stored = value === REDACTED;
    return { name, value: stored ? '' : value, stored };
  });
}

/** The header map to write: a stored value left empty is sent as `[REDACTED]`, which keeps it. */
export function headerMap(rows: HeaderRow[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    const value = row.value.trim();
    if (value) out[name] = value;
    else if (row.stored) out[name] = REDACTED;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Header names: RFC 9110 tokens. */
export function headerErrors(rows: HeaderRow[]): string | undefined {
  const seen = new Set<string>();
  for (const row of rows) {
    const name = row.name.trim();
    if (!name && !row.value.trim()) continue;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return `“${name || '(empty)'}” isn't a header name`;
    const key = name.toLowerCase();
    if (seen.has(key)) return `${name} is listed twice`;
    seen.add(key);
    if (!row.value.trim() && !row.stored) return `Enter a value for ${name}`;
  }
  return undefined;
}

/** Who made a request, as an identity header can pass it on to a server or an agent. */
export type IdentitySource =
  'key_id' | 'key_name' | 'project' | 'team' | 'organization' | 'user' | 'end_user' | 'tags' | 'jwt';

export const IDENTITY_SOURCES: { value: IdentitySource; label: string }[] = [
  { value: 'key_id', label: 'API key id' },
  { value: 'key_name', label: 'API key name' },
  { value: 'project', label: 'Project' },
  { value: 'team', label: 'Team' },
  { value: 'organization', label: 'Organization' },
  { value: 'user', label: 'User' },
  { value: 'end_user', label: 'End user' },
  { value: 'tags', label: 'Key tags' },
  { value: 'jwt', label: 'Sign-in token claim' },
];

/** One identity header: its name, and what of the caller it carries (a JWT claim names the claim). */
export interface IdentityRow {
  name: string;
  source: IdentitySource;
  claim: string;
}

export function identityRows(map: Record<string, string> | null | undefined): IdentityRow[] {
  return Object.entries(map ?? {}).map(([name, value]) =>
    value.startsWith('jwt.')
      ? { name, source: 'jwt', claim: value.slice('jwt.'.length) }
      : { name, source: value as IdentitySource, claim: '' },
  );
}

export function identityMap(rows: IdentityRow[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    out[name] = row.source === 'jwt' ? `jwt.${row.claim.trim()}` : row.source;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Header names (RFC 9110 tokens), each once, and a claim for every JWT source. */
export function identityErrors(rows: IdentityRow[]): string | undefined {
  const seen = new Set<string>();
  for (const row of rows) {
    const name = row.name.trim();
    if (!name && !(row.source === 'jwt' && row.claim.trim())) continue;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return `“${name || '(empty)'}” isn't a header name`;
    const key = name.toLowerCase();
    if (seen.has(key)) return `${name} is listed twice`;
    seen.add(key);
    if (row.source === 'jwt' && !row.claim.trim()) return `Name the claim ${name} carries`;
  }
  return undefined;
}

/** "x-team: team, x-sub: claim sub", for a read-only view. */
export function identityText(map: Record<string, string> | null | undefined): string {
  return identityRows(map)
    .map(
      (r) =>
        `${r.name}: ${r.source === 'jwt' ? `claim ${r.claim}` : (IDENTITY_SOURCES.find((s) => s.value === r.source)?.label ?? r.source).toLowerCase()}`,
    )
    .join(', ');
}

export const DURATION = /^[0-9]+(\.[0-9]+)?(ms|s|m|h|d)$/;

/** An error for a duration field, or undefined; empty is allowed (the gateway's default). */
export function durationError(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  return DURATION.test(v) ? undefined : 'A duration such as 500ms, 30s, 5m or 1h';
}

/** MCP server and A2A agent names (they become tool prefixes and paths). */
export const MCP_NAME = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

export function mcpNameError(value: string, taken: string[]): string | undefined {
  const v = value.trim();
  if (!v) return 'Required';
  if (!MCP_NAME.test(v))
    return 'Lowercase letters, digits and -, up to 32 characters; start and end with a letter or digit';
  if (taken.includes(v)) return `${v} is already used`;
  return undefined;
}

export function urlError(value: string, required: boolean): string | undefined {
  const v = value.trim();
  if (!v) return required ? 'Required' : undefined;
  return /^https?:\/\/[^\s/]+/i.test(v) ? undefined : 'A URL starting with https://';
}

/** Sets `key` on `target` when `value` is set, removes it otherwise (a PUT drops what is cleared). */
export function put<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined | '' | null,
): void {
  if (value === undefined || value === '' || value === null || (Array.isArray(value) && value.length === 0))
    Reflect.deleteProperty(target, key);
  else target[key] = value;
}

/** The address clients use for a path on the data plane, or the path alone when it isn't known. */
export function dataPlaneAddress(base: string | null | undefined, path: string): string {
  return base ? `${base.replace(/\/+$/, '')}${path}` : path;
}
