import type { DeploymentHealth, DeploymentResource, ProviderResource } from '@/lib/api/types';
import { parseDuration } from '@/lib/format';

import type { ProviderStatus, ProviderTestResult } from './api';

export type RateLimits = NonNullable<ProviderStatus['rate_limits']>;

/** The name the gateway gives the key of a provider with one `api_key`. */
export const SINGLE_KEY = 'default';

export interface KeyState {
  state: 'working' | 'resting' | 'not_working' | 'untested' | 'unknown';
  /** Why it is not working, as the gateway put it. */
  reason: string | null;
  /** When it is tried again (not working) or used again (resting). */
  until: string | null;
}

export interface ProviderKeyRow {
  name: string;
  hint: string | undefined;
  weight: number | null;
  rotatedAt: string | null;
  health: KeyState;
  /** Its latest test, stored by the gateway or run in this session. */
  test: KeyTest | null;
  readings: RateLimits | null;
}

/** The provider's named API keys, or the one key of `api_key`. */
function keyNames(p: ProviderResource): { name: string; weight: number | null; hintPath: string }[] {
  const auth = p.spec.auth;
  if (auth?.api_keys && auth.api_keys.length > 0)
    return auth.api_keys.map((k, i) => ({
      name: k.name,
      weight: k.weight ?? 1,
      hintPath: `auth.api_keys[${String(i)}].key`,
    }));
  if (auth?.api_key) return [{ name: SINGLE_KEY, weight: null, hintPath: 'auth.api_key' }];
  return [];
}

/** A key's state over the deployments of its provider: dead anywhere wins, then resting. */
export function keyState(name: string, deployments: string[], health: DeploymentHealth[] | null): KeyState {
  if (!health) return { state: 'unknown', reason: null, until: null };
  const entries = health
    .filter((h) => deployments.includes(h.name))
    .flatMap((h) => h.keys.filter((k) => k.key === name));
  const dead = entries.find((k) => k.scope_state === 'dead');
  if (dead) return { state: 'not_working', reason: dead.dead_reason ?? null, until: dead.recheck_at ?? null };
  const resting = entries.filter((k) => k.pair_state !== 'alive');
  if (resting.length > 0) {
    const until = resting
      .map((k) => k.cooldown_until ?? null)
      .filter((t): t is string => t !== null)
      .sort()
      .pop();
    return {
      state: resting.some((k) => k.pair_state === 'dead') ? 'not_working' : 'resting',
      reason: null,
      until: until ?? null,
    };
  }
  // Nothing failing is no evidence: a key works once an attempt with it has succeeded.
  if (!entries.some((k) => k.last_success_at)) return { state: 'untested', reason: null, until: null };
  return { state: 'working', reason: null, until: null };
}

/** A test's outcome as the key status reads it: the gateway's stored one or this session's. */
export interface KeyTest {
  ok: boolean;
  tested_at: string;
  error: string | null;
  method: ProviderTestResult['method'];
}

/** The newer of two tests (by `tested_at`), or the one there is. */
export function newer(a: KeyTest | null | undefined, b: KeyTest | null | undefined): KeyTest | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(b.tested_at) > Date.parse(a.tested_at) ? b : a;
}

/** The provider's latest test: the gateway's stored one (any key), or a newer one from this session. */
export function latestTest(status: ProviderStatus | undefined, session: KeyTest | undefined): KeyTest | null {
  const stored = [status?.credential.last_test, ...(status?.tests ?? [])].reduce<KeyTest | null>(
    (a, b) => newer(a, b ?? null),
    null,
  );
  return newer(stored, session);
}

/**
 * The provider's key status for its table row, from its latest test: Working or Failed. Without a
 * test, a key that has answered real requests is Working too; "Not tested yet" only while there
 * is neither. A credential the gateway reports failing, refreshing or not needed says so.
 */
export function providerKeyStatus(
  credentialState: string | undefined,
  latest: KeyTest | null,
  servedRequests = false,
): string | undefined {
  if (credentialState === undefined) return undefined;
  if (credentialState !== 'valid') return credentialState;
  if (!latest) return servedRequests ? 'valid' : 'untested';
  return latest.ok ? 'valid' : 'failed';
}

/** Whether any key of the provider has answered a real request on one of its deployments. */
export function servedRequests(
  provider: string,
  deployments: DeploymentResource[] | null,
  health: DeploymentHealth[] | null,
): boolean {
  const mine = new Set((deployments ?? []).filter((d) => d.spec.provider === provider).map((d) => d.name));
  return (health ?? []).some((h) => mine.has(h.name) && h.keys.some((k) => k.last_success_at));
}

/** Each key's latest test: the gateway's stored one or this session's, whichever is newer. */
function keyTest(
  name: string,
  single: boolean,
  status: ProviderStatus | undefined,
  session: { test?: KeyTest | undefined; keyTests?: Record<string, KeyTest | undefined> },
): KeyTest | null {
  const stored = (status?.tests ?? [])
    .filter((t) => t.key === name || (single && (t.key === null || t.key === SINGLE_KEY)))
    .reduce<KeyTest | null>((a, b) => newer(a, b), null);
  const last = status?.credential.last_test;
  const fromLast = last && (last.key === name || (single && last.key === null)) ? last : null;
  return newer(newer(stored, fromLast), newer(session.keyTests?.[name], single ? session.test : undefined));
}

/**
 * A key's state: set aside or cooling down on a deployment (the runtime's word), else its latest
 * test (working, or not working when it failed), else working when it has answered real
 * requests, else not tested yet.
 */
function stateOf(health: KeyState, test: KeyTest | null): KeyState {
  if (health.state === 'not_working' || health.state === 'resting') return health;
  if (test)
    return test.ok
      ? { state: 'working', reason: null, until: null }
      : { state: 'not_working', reason: 'test', until: null };
  if (health.state === 'working') return health;
  return { state: 'untested', reason: null, until: null };
}

/** Each key of a provider with its last replacement, its state, its latest test and rate-limit reading. */
export function providerKeys(
  p: ProviderResource,
  status: ProviderStatus | undefined,
  deployments: DeploymentResource[] | null,
  health: DeploymentHealth[] | null,
  session: { test?: KeyTest | undefined; keyTests?: Record<string, KeyTest | undefined> } = {},
): ProviderKeyRow[] {
  const mine = (deployments ?? []).filter((d) => d.spec.provider === p.name).map((d) => d.name);
  const rotated = p.metadata.credential_rotated_at ?? {};
  const hints = (p.metadata.secret_hints ?? {}) as Record<string, string>;
  const credentials = status?.credentials ?? [];
  const named = keyNames(p);
  const single = named.length === 1;
  const rows: ProviderKeyRow[] = named.map((k) => {
    const test = keyTest(k.name, single, status, session);
    return {
      name: k.name,
      hint: hints[k.hintPath],
      weight: k.weight,
      rotatedAt: rotated[k.name] ?? null,
      health: stateOf(keyState(k.name, mine, health), test),
      test,
      readings: (credentials.find((c) => c.name === k.name)?.rate_limits as RateLimits | undefined) ?? null,
    };
  });
  for (const c of credentials) {
    if (rows.some((r) => r.name === c.name)) continue;
    rows.push({
      name: c.name,
      hint: undefined,
      weight: null,
      rotatedAt: rotated[c.name] ?? null,
      health: { state: 'unknown', reason: null, until: null },
      test: null,
      readings: c.rate_limits,
    });
  }
  return rows;
}

export interface Rotation {
  /** Age of the oldest credential, in days. */
  ageDays: number;
  maxDays: number | null;
  due: boolean;
}

/** How old the provider's oldest credential is, against its rotation policy. */
export function rotation(p: ProviderResource, now: number): Rotation | null {
  const times = Object.values(p.metadata.credential_rotated_at ?? {})
    .map((t) => Date.parse(t))
    .filter((t) => !Number.isNaN(t));
  if (times.length === 0) return null;
  const ageDays = Math.max(0, (now - Math.min(...times)) / 86_400_000);
  const max = p.spec.credential_rotation_max_age ? parseDuration(p.spec.credential_rotation_max_age) : null;
  return {
    ageDays,
    maxDays: max === null ? null : max / 86_400,
    due: p.metadata.rotation_due === true,
  };
}

/** "12 days", "less than a day". */
export function ageText(days: number): string {
  if (days < 1) return 'less than a day';
  const n = Math.floor(days);
  return n === 1 ? '1 day' : `${String(n)} days`;
}
