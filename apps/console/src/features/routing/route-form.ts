/**
 * A route's own settings as the route drawer edits them: on or off, session affinity, the tag
 * filter, what happens when every target is unhealthy, and the policies the console manages
 * (request and token limits, guardrails, retries). The rest of `policies` is kept as written.
 */

import type { components } from '@/lib/api/schema';

import { isRecord, type Json } from './types';

type Route = components['schemas']['Route'];

export type AffinityScope = 'project' | 'key' | 'organization';

export interface RouteSettingsForm {
  enabled: boolean;
  session: boolean;
  mode: 'prefer' | 'strict';
  /** Where the session id is read from: `header:<name>` or `body:<path>`; empty for the gateway's list. */
  sources: string[];
  promptPrefix: boolean;
  scope: AffinityScope;
  /** How long a binding lasts; empty for the gateway's (1h unless set). */
  ttl: string;
  tagFilter: boolean;
  defaultTag: string;
  /** Empty: follow the gateway's setting. */
  onAllUnhealthy: '' | 'reject' | 'ignore_health';
  /** Requests and tokens per minute; empty for no limit at the route. */
  rpm: string;
  tpm: string;
  guardIn: string[];
  guardOut: string[];
  /** Attempts per request, 1 to 10; empty for the gateway's. */
  maxAttempts: string;
  /** Whether a failed attempt may move on to another deployment. */
  fallback: boolean;
}

/** A route name: the configuration's generic resource name. */
export const ROUTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SOURCE = /^(header:[!#$%&'*+.^_`|~0-9A-Za-z-]+|body:[^\s]+)$/;
const TAG = /^[A-Za-z0-9:_.-]{1,64}$/;
const DURATION = /^([0-9]+(?:\.[0-9]+)?)(ms|s|m|h|d)$/;
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function rec(value: Json): Record<string, Json> {
  return isRecord(value) ? value : {};
}

function ms(value: string): number | null {
  const m = DURATION.exec(value.trim());
  return m ? Number(m[1]) * (UNIT_MS[m[2] ?? 's'] ?? 0) : null;
}

/** The form a route's spec reads as; unset members read as their defaults. */
export function routeSettingsForm(spec: Route): RouteSettingsForm {
  const a = rec(spec.affinity);
  const t = rec(spec.tag_filter);
  const p = rec(spec.policies);
  const limits = rec(p.limits);
  const guards = rec(p.guardrails);
  const retry = rec(rec(p.resilience).retry);
  const count = (l: Json) => {
    const v = rec(l).limit;
    return typeof v === 'number' ? String(v) : '';
  };
  const names = (v: Json) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    enabled: spec.enabled !== false,
    session: a.session !== false,
    mode: a.mode === 'strict' ? 'strict' : 'prefer',
    sources: names(a.sources),
    promptPrefix: a.prompt_prefix === true,
    scope: a.scope === 'key' || a.scope === 'organization' ? a.scope : 'project',
    ttl: typeof a.ttl === 'string' ? a.ttl : '',
    tagFilter: t.enabled === true,
    defaultTag: typeof t.default_tag === 'string' ? t.default_tag : 'default',
    onAllUnhealthy:
      spec.on_all_unhealthy === 'reject' || spec.on_all_unhealthy === 'ignore_health'
        ? spec.on_all_unhealthy
        : '',
    rpm: count(limits.rpm),
    tpm: count(limits.tpm),
    guardIn: names(guards.input),
    guardOut: names(guards.output),
    maxAttempts: typeof retry.max_attempts === 'number' ? String(retry.max_attempts) : '',
    fallback: retry.fallback !== false,
  };
}

/** Errors by form key; empty when the form can be saved. */
export function routeSettingsErrors(f: RouteSettingsForm): Partial<Record<keyof RouteSettingsForm, string>> {
  const out: Partial<Record<keyof RouteSettingsForm, string>> = {};
  if (f.sources.length > 16) out.sources = 'At most 16 places';
  else {
    const bad = f.sources.find((s) => !SOURCE.test(s));
    if (bad !== undefined) out.sources = `“${bad}” isn’t header:<name> or body:<path>`;
  }
  if (f.ttl.trim()) {
    const t = ms(f.ttl);
    if (t === null || t < 1000 || t > 30 * 86_400_000) out.ttl = 'From 1s to 30d, e.g. 1h';
  }
  if (f.tagFilter && !TAG.test(f.defaultTag.trim()))
    out.defaultTag = 'Letters, digits, :, _, . and -, up to 64 characters';
  else if (f.tagFilter && /^antirion\./i.test(f.defaultTag.trim()))
    out.defaultTag = 'Tags starting with antirion. are reserved';
  for (const key of ['rpm', 'tpm'] as const) {
    const v = f[key].trim();
    if (v && !/^\d+$/.test(v)) out[key] = 'A whole number, or empty for no limit';
  }
  const attempts = f.maxAttempts.trim();
  if (attempts && !(/^\d+$/.test(attempts) && Number(attempts) >= 1 && Number(attempts) <= 10))
    out.maxAttempts = 'From 1 to 10';
  return out;
}

/**
 * Sets `key` on a copy of `obj` only when the form changed it: an unchanged value keeps what was
 * written (present or absent), so a spec read and saved untouched comes back the same.
 */
function assign(obj: Record<string, Json>, key: string, changed: boolean, value: Json): Record<string, Json> {
  if (!changed) return obj;
  const out = { ...obj };
  if (value === undefined) Reflect.deleteProperty(out, key);
  else out[key] = value;
  return out;
}

function nonEmpty(obj: Record<string, Json>): Record<string, Json> | undefined {
  return Object.keys(obj).length > 0 ? obj : undefined;
}

function same(a: Json, b: Json): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A limit with its count changed; its other settings (window, algorithm, partitions) are kept. */
function limitOf(before: Json, count: string, unit: 'requests' | 'tokens'): Json {
  if (!count.trim()) return undefined;
  const base = isRecord(before) ? before : { unit, per: '1m' };
  return { ...base, limit: Number(count) };
}

/** The route's spec with the form applied; everything the form doesn't manage is kept as written. */
export function routeSettingsSpec(spec: Route, f: RouteSettingsForm): Route {
  const was = routeSettingsForm(spec);
  let out: Record<string, Json> = { ...spec };

  out = assign(out, 'enabled', f.enabled !== was.enabled, f.enabled ? undefined : false);

  let a = rec(spec.affinity);
  a = assign(a, 'session', f.session !== was.session, f.session ? undefined : false);
  a = assign(a, 'mode', f.mode !== was.mode, f.mode === 'prefer' ? undefined : f.mode);
  a = assign(a, 'sources', !same(f.sources, was.sources), f.sources.length > 0 ? f.sources : undefined);
  a = assign(a, 'prompt_prefix', f.promptPrefix !== was.promptPrefix, f.promptPrefix || undefined);
  a = assign(a, 'scope', f.scope !== was.scope, f.scope === 'project' ? undefined : f.scope);
  a = assign(a, 'ttl', f.ttl.trim() !== was.ttl, f.ttl.trim() || undefined);
  out = assign(out, 'affinity', !same(a, rec(spec.affinity)), nonEmpty(a));

  let t = rec(spec.tag_filter);
  t = assign(t, 'enabled', f.tagFilter !== was.tagFilter, f.tagFilter || undefined);
  t = assign(
    t,
    'default_tag',
    f.tagFilter && f.defaultTag.trim() !== was.defaultTag,
    f.defaultTag.trim() === 'default' ? undefined : f.defaultTag.trim(),
  );
  out = assign(out, 'tag_filter', !same(t, rec(spec.tag_filter)), nonEmpty(t));

  out = assign(
    out,
    'on_all_unhealthy',
    f.onAllUnhealthy !== was.onAllUnhealthy,
    f.onAllUnhealthy || undefined,
  );

  const p0 = rec(spec.policies);
  let limits = rec(p0.limits);
  limits = assign(limits, 'rpm', f.rpm.trim() !== was.rpm, limitOf(limits.rpm, f.rpm, 'requests'));
  limits = assign(limits, 'tpm', f.tpm.trim() !== was.tpm, limitOf(limits.tpm, f.tpm, 'tokens'));
  let guards = rec(p0.guardrails);
  guards = assign(guards, 'input', !same(f.guardIn, was.guardIn), f.guardIn.length ? f.guardIn : undefined);
  guards = assign(
    guards,
    'output',
    !same(f.guardOut, was.guardOut),
    f.guardOut.length ? f.guardOut : undefined,
  );
  const r0 = rec(p0.resilience);
  let retry = rec(r0.retry);
  retry = assign(
    retry,
    'max_attempts',
    f.maxAttempts.trim() !== was.maxAttempts,
    f.maxAttempts.trim() ? Number(f.maxAttempts) : undefined,
  );
  retry = assign(retry, 'fallback', f.fallback !== was.fallback, f.fallback ? undefined : false);
  const resilience = assign(r0, 'retry', !same(retry, rec(r0.retry)), nonEmpty(retry));
  let p = assign(p0, 'limits', !same(limits, rec(p0.limits)), nonEmpty(limits));
  p = assign(p, 'guardrails', !same(guards, rec(p0.guardrails)), nonEmpty(guards));
  p = assign(p, 'resilience', !same(resilience, r0), nonEmpty(resilience));
  out = assign(out, 'policies', !same(p, p0), nonEmpty(p));

  return out as Route;
}

/**
 * The RFC 7396 merge patch that turns `before` into `after`: changed members, `null` for removed
 * ones, nested objects patched member by member; arrays are replaced whole.
 */
export function mergePatchOf(before: Json, after: Json): Record<string, Json> {
  const out: Record<string, Json> = {};
  const b = rec(before);
  const a = rec(after);
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (!(key in a)) out[key] = null;
    else if (!(key in b)) out[key] = a[key];
    else if (isRecord(a[key]) && isRecord(b[key])) {
      const inner = mergePatchOf(b[key], a[key]);
      if (Object.keys(inner).length > 0) out[key] = inner;
    } else if (!same(a[key], b[key])) out[key] = a[key];
  }
  return out;
}

/**
 * The policies the drawer doesn't edit, as written: everything but rpm and tpm, the input and
 * output guardrail lists, and the retry attempts and fallback.
 */
export function otherPolicies(policies: Json): Record<string, Json> | null {
  const p: Record<string, Json> = { ...rec(policies) };
  const strip = (obj: Json, keys: string[]): Record<string, Json> | undefined => {
    const o = { ...rec(obj) };
    for (const k of keys) Reflect.deleteProperty(o, k);
    return nonEmpty(o);
  };
  const set = (key: string, value: Record<string, Json> | undefined) => {
    if (value === undefined) Reflect.deleteProperty(p, key);
    else p[key] = value;
  };
  set('limits', strip(p.limits, ['rpm', 'tpm']));
  set('guardrails', strip(p.guardrails, ['input', 'output']));
  const r = { ...rec(p.resilience) };
  const retry = strip(r.retry, ['max_attempts', 'fallback']);
  if (retry) r.retry = retry;
  else Reflect.deleteProperty(r, 'retry');
  set('resilience', nonEmpty(r));
  return nonEmpty(p) ?? null;
}

/** The facts the route's settings show in words, for the drawer's header and the screen. */
export function describeRouteSettings(spec: Route): string[] {
  const f = routeSettingsForm(spec);
  const out: string[] = [];
  if (!f.enabled) out.push('off');
  if (!f.session) out.push('no session affinity');
  else if (f.mode === 'strict') out.push('strict session affinity');
  if (f.tagFilter) out.push(`tag filter (default ${f.defaultTag})`);
  if (f.onAllUnhealthy === 'reject') out.push('refuses when every target is unhealthy');
  if (f.onAllUnhealthy === 'ignore_health') out.push('ignores health when every target is unhealthy');
  return out;
}
