import type { ModelSpec } from '@/lib/api/types';
import type { FieldErrors } from '@/lib/validation';

/**
 * A Model's own policies, as the model page edits them: its requests and tokens a minute, the
 * guardrails it adds on input and output, and how its requests are retried. Every other member of
 * `policies` is kept as written, and shown read-only.
 */

type Json = Record<string, unknown>;

export interface PolicyValues {
  rpm: string;
  tpm: string;
  input: string[];
  output: string[];
  maxAttempts: string;
  fallback: 'inherit' | 'yes' | 'no';
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rec(value: unknown): Json {
  return isRecord(value) ? value : {};
}

function limitOf(limits: Json, name: string): string {
  const l = rec(limits[name]);
  return typeof l.limit === 'number' ? String(l.limit) : '';
}

export function fromModelPolicies(spec: ModelSpec): PolicyValues {
  const p = rec(spec.policies);
  const limits = rec(p.limits);
  const guardrails = rec(p.guardrails);
  const retry = rec(rec(p.resilience).retry);
  return {
    rpm: limitOf(limits, 'rpm'),
    tpm: limitOf(limits, 'tpm'),
    input: Array.isArray(guardrails.input) ? (guardrails.input as string[]) : [],
    output: Array.isArray(guardrails.output) ? (guardrails.output as string[]) : [],
    maxAttempts: typeof retry.max_attempts === 'number' ? String(retry.max_attempts) : '',
    fallback: retry.fallback === true ? 'yes' : retry.fallback === false ? 'no' : 'inherit',
  };
}

function put(target: Json, key: string, value: unknown): void {
  if (value === undefined || (Array.isArray(value) && value.length === 0))
    Reflect.deleteProperty(target, key);
  else target[key] = value;
}

/** Drops the members left empty by an edit, so a cleared policy leaves no `{}` behind. */
function prune(target: Json, key: string): void {
  if (isRecord(target[key]) && Object.keys(target[key]).length === 0) Reflect.deleteProperty(target, key);
}

/** A per-minute limit: its amount changed over the existing declaration, or a new one. */
function limitWith(existing: unknown, unit: 'requests' | 'tokens', value: string): Json | undefined {
  if (!value.trim()) return undefined;
  const base = rec(existing);
  return Object.keys(base).length > 0
    ? { ...base, limit: Number(value) }
    : { unit, limit: Number(value), per: '1m' };
}

/** Writes the form over the Model's policies; a field left as it was keeps its member as written. */
export function applyModelPolicies(spec: ModelSpec, v: PolicyValues): ModelSpec {
  const init = fromModelPolicies(spec);
  const policies = structuredClone(rec(spec.policies));
  if (v.rpm !== init.rpm || v.tpm !== init.tpm) {
    const limits = rec(policies.limits);
    if (v.rpm !== init.rpm) put(limits, 'rpm', limitWith(limits.rpm, 'requests', v.rpm));
    if (v.tpm !== init.tpm) put(limits, 'tpm', limitWith(limits.tpm, 'tokens', v.tpm));
    policies.limits = limits;
    prune(policies, 'limits');
  }
  if (JSON.stringify([v.input, v.output]) !== JSON.stringify([init.input, init.output])) {
    const guardrails = rec(policies.guardrails);
    put(guardrails, 'input', v.input);
    put(guardrails, 'output', v.output);
    policies.guardrails = guardrails;
    prune(policies, 'guardrails');
  }
  if (v.maxAttempts !== init.maxAttempts || v.fallback !== init.fallback) {
    const resilience = rec(policies.resilience);
    const retry = rec(resilience.retry);
    if (v.maxAttempts !== init.maxAttempts)
      put(retry, 'max_attempts', v.maxAttempts.trim() ? Number(v.maxAttempts) : undefined);
    if (v.fallback !== init.fallback)
      put(retry, 'fallback', v.fallback === 'inherit' ? undefined : v.fallback === 'yes');
    resilience.retry = retry;
    prune(resilience, 'retry');
    policies.resilience = resilience;
    prune(policies, 'resilience');
  }
  const { policies: _p, ...rest } = spec;
  return Object.keys(policies).length > 0 ? { ...rest, policies: policies } : rest;
}

export function policyErrors(v: PolicyValues): FieldErrors {
  const e: FieldErrors = {};
  const whole = (s: string) => /^\d+$/.test(s.trim());
  if (v.rpm.trim() && !whole(v.rpm)) e.rpm = 'A whole number of requests; 0 refuses every request';
  if (v.tpm.trim() && !whole(v.tpm)) e.tpm = 'A whole number of tokens; 0 refuses every request';
  if (
    v.maxAttempts.trim() &&
    !(whole(v.maxAttempts) && Number(v.maxAttempts) >= 1 && Number(v.maxAttempts) <= 10)
  )
    e.maxAttempts = 'From 1 to 10 attempts';
  return e;
}

/** The policies the page doesn't edit (cache, budgets, headers…), for a read-only view; null when none. */
export function otherPolicies(spec: ModelSpec): Json | null {
  const policies = structuredClone(rec(spec.policies));
  const limits = rec(policies.limits);
  delete limits.rpm;
  delete limits.tpm;
  prune(policies, 'limits');
  const guardrails = rec(policies.guardrails);
  delete guardrails.input;
  delete guardrails.output;
  prune(policies, 'guardrails');
  const resilience = rec(policies.resilience);
  const retry = rec(resilience.retry);
  delete retry.max_attempts;
  delete retry.fallback;
  prune(resilience, 'retry');
  prune(policies, 'resilience');
  return Object.keys(policies).length > 0 ? policies : null;
}
