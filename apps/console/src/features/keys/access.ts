import { z } from 'zod';

import { cidr, modelName, splitList } from '@/lib/validation';

import { ENDPOINT_FAMILIES } from './types';

/**
 * Who may call through a key, a project, a team or an organization: the endpoints, Models,
 * providers, deployments, addresses and regions. Every level states the same members, and each
 * level narrows the one above it.
 */
export interface AccessValues {
  endpoints: string[];
  /** Allowed Models, comma separated (`gpt-4o, claude-*`). */
  models: string;
  denyModels: string[];
  providers: string[];
  denyProviders: string[];
  deployments: string[];
  /** One address or range per line. */
  allowedIps: string;
  /** Named IP sets of the gateway's settings, written as `set:<name>` entries of `allowed_ips`. */
  ipSets: string[];
  regions: string[];
  denyRegions: string[];
}

/** One `metadata` entry as the form edits it. */
export interface MetadataRow {
  key: string;
  value: string;
}

/** Tags and metadata: the labels budgets, limits, routing and analytics group by. */
export interface LabelValues {
  tags: string[];
  metadata: MetadataRow[];
}

export const EMPTY_ACCESS: AccessValues = {
  endpoints: [],
  models: '',
  denyModels: [],
  providers: [],
  denyProviders: [],
  deployments: [],
  allowedIps: '',
  ipSets: [],
  regions: [],
  denyRegions: [],
};

export const EMPTY_LABELS: LabelValues = { tags: [], metadata: [] };

/** The access and label members of a key, project, team or organization spec. */
export interface AccessSpec {
  endpoints?: string[];
  models?: string[];
  deny_models?: string[];
  providers?: string[];
  deny_providers?: string[];
  deployments?: string[];
  allowed_ips?: string[];
  regions?: string[];
  deny_regions?: string[];
  tags?: string[];
  metadata?: Record<string, string>;
}

/** The form values of a spec's access members. */
export function accessFrom(spec: AccessSpec): AccessValues {
  return {
    endpoints: (spec.endpoints ?? []).filter((e) => e !== '*'),
    models: (spec.models ?? []).join(', '),
    denyModels: spec.deny_models ?? [],
    providers: spec.providers ?? [],
    denyProviders: spec.deny_providers ?? [],
    deployments: spec.deployments ?? [],
    allowedIps: (spec.allowed_ips ?? []).filter((ip) => !ip.startsWith('set:')).join('\n'),
    ipSets: (spec.allowed_ips ?? []).filter((ip) => ip.startsWith('set:')).map((ip) => ip.slice(4)),
    regions: spec.regions ?? [],
    denyRegions: spec.deny_regions ?? [],
  };
}

/** The form values of a spec's tags and metadata. */
export function labelsFrom(spec: AccessSpec): LabelValues {
  return {
    tags: spec.tags ?? [],
    metadata: Object.entries(spec.metadata ?? {}).map(([key, value]) => ({ key, value })),
  };
}

/**
 * The access members the values describe; an empty list is `undefined`, so the spec states only
 * what is set. `base` keeps an explicit "every endpoint" (`*`) when no endpoint is chosen.
 */
export function accessSpec(values: AccessValues, base: AccessSpec = {}): AccessSpec {
  const list = (l: string[]) => (l.length > 0 ? l : undefined);
  return {
    endpoints: list(values.endpoints) ?? (base.endpoints?.includes('*') ? base.endpoints : undefined),
    models: list(splitList(values.models)),
    deny_models: list(values.denyModels),
    providers: list(values.providers),
    deny_providers: list(values.denyProviders),
    deployments: list(values.deployments),
    allowed_ips: list([...splitList(values.allowedIps), ...values.ipSets.map((n) => `set:${n}`)]),
    regions: list(values.regions),
    deny_regions: list(values.denyRegions),
  };
}

/** The tags and metadata the values describe; empty is `undefined`. */
export function labelsSpec(values: LabelValues): Pick<AccessSpec, 'tags' | 'metadata'> {
  const rows = values.metadata.filter((r) => r.key.trim() !== '');
  return {
    tags: values.tags.length > 0 ? values.tags : undefined,
    metadata: rows.length > 0 ? Object.fromEntries(rows.map((r) => [r.key.trim(), r.value])) : undefined,
  };
}

/** Writes `next` over `base`: members `next` states replace base's, `undefined` ones are removed. */
export function withMembers<T extends object>(base: T, next: object): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) Reflect.deleteProperty(out, k);
    else out[k] = v;
  }
  return out as T;
}

const NAME_PATTERN = /^(\*|\*?[^*]+|[^*]+\*)$/;
const MODEL_PATTERN = /^(group:[A-Za-z0-9._-]+|\*|\*?[^*]+|[^*]+\*)$/;
const TAG = /^[A-Za-z0-9:_.-]{1,64}$/;

const patterns = (message: string) =>
  z.array(z.string()).refine((l) => l.every((p) => NAME_PATTERN.test(p)), message);

/** Validation of the access members, shared by the key and tenancy forms. */
export const accessShape = {
  endpoints: z.array(z.enum(ENDPOINT_FAMILIES)),
  models: z
    .string()
    .refine(
      (v) => splitList(v).every((m) => m === '*' || modelName.safeParse(m.replace(/\*$/, 'x')).success),
      'Enter model names separated by commas, e.g. gpt-4o, claude-*',
    ),
  denyModels: z
    .array(z.string())
    .refine((l) => l.every((p) => MODEL_PATTERN.test(p)), 'One * at the start or the end, e.g. gpt-4*'),
  providers: patterns('A provider name, with one * at the start or the end'),
  denyProviders: patterns('A provider name, with one * at the start or the end'),
  deployments: patterns('A deployment name, with one * at the start or the end'),
  allowedIps: z
    .string()
    .refine(
      (v) => splitList(v).every((ip) => cidr.safeParse(ip).success),
      'Enter one IP address or range per line, e.g. 10.0.0.0/8',
    ),
  ipSets: z.array(z.string()),
  regions: z.array(z.string()),
  denyRegions: z.array(z.string()),
};

/** Validation of tags and metadata. */
export const labelsShape = {
  tags: z
    .array(z.string())
    .refine(
      (l) => l.every((t) => TAG.test(t) && !/^antirion\./i.test(t)),
      'Letters, digits and :_.- up to 64; antirion. is reserved',
    ),
  metadata: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .refine((rows) => rows.filter((r) => r.key.trim()).length <= 32, 'At most 32 entries')
    .refine(
      (rows) => rows.every((r) => r.key.trim().length <= 64 && r.value.length <= 512),
      'Keys up to 64 characters, values up to 512',
    )
    .refine((rows) => {
      const keys = rows.map((r) => r.key.trim()).filter(Boolean);
      return new Set(keys).size === keys.length;
    }, 'Each key once'),
};

/** How many access members the values set, for a collapsed section's summary. */
export function accessCount(v: AccessValues): number {
  return [
    v.endpoints,
    splitList(v.models),
    v.denyModels,
    v.providers,
    v.denyProviders,
    v.deployments,
    splitList(v.allowedIps),
    v.ipSets,
    v.regions,
    v.denyRegions,
  ].filter((l) => l.length > 0).length;
}
