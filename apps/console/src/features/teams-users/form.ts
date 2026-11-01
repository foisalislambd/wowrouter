import { z } from 'zod';

import type { ProjectResource, TeamResource, TeamSpec } from '@/lib/api/types';
import { duration, money, resourceName } from '@/lib/validation';

import {
  accessFrom,
  accessShape,
  type AccessSpec,
  accessSpec,
  type AccessValues,
  labelsFrom,
  labelsShape,
  labelsSpec,
  type LabelValues,
  withMembers,
} from '../keys/access';

type ProjectSpec = ProjectResource['spec'];

/** The colours a team can take. */
export const TEAM_COLORS = [
  '#3e72cb',
  '#2f9e6f',
  '#c9891a',
  '#cb3e3e',
  '#8b5cf6',
  '#0ea5a4',
  '#d97757',
  '#64748b',
];

/* ------------------------------------------------------------------ Tenancy policies */

/** One rate limit of a team or project as the drawer edits it. */
export interface LimitRow {
  /** The name it is stored under; empty for a new one. */
  id: string;
  name: string;
  unit: 'requests' | 'tokens' | 'concurrency';
  limit: string;
  /** A duration such as `1m`; unused at once (concurrency). */
  per: string;
  /** One partition attribute, empty for the whole level, or `kept` for a list kept as declared. */
  split: string;
}

/**
 * What a team, project or organization says about who may call through it (the same members as a
 * key), its labels, the lifetime of keys made in it and its own rate limits.
 */
export interface TenantValues extends AccessValues, LabelValues {
  maxKeyLifetime: string;
  defaultLifetime: string;
  rotationMaxAge: string;
  limits: LimitRow[];
}

type TenantSpec = AccessSpec & {
  max_key_lifetime?: string;
  key_policy?: Record<string, unknown>;
  policies?: { limits?: Record<string, unknown> } & Record<string, unknown>;
};

/** Reserved members of `policies.limits` that are not limits. */
const LIMIT_RESERVED = ['locked', 'request_overridable'];

const SPLITS = ['', 'key', 'user', 'project', 'team', 'model', 'end_user'];

/** The drawer's values for a tenancy level's spec. */
export function tenantValues(spec: TenantSpec): TenantValues {
  const limits = Object.entries(spec.policies?.limits ?? {})
    .filter(([name]) => !LIMIT_RESERVED.includes(name))
    .map(([name, raw]): LimitRow => {
      const l = (raw ?? {}) as { unit?: string; limit?: number; per?: string; partition_by?: string[] };
      const partition = l.partition_by ?? [];
      const only = partition.length === 1 ? (partition[0] ?? '') : '';
      return {
        id: name,
        name,
        unit: l.unit === 'tokens' || l.unit === 'concurrency' ? l.unit : 'requests',
        limit: l.limit !== undefined ? String(l.limit) : '',
        per: l.per ?? '1m',
        split: partition.length === 0 ? '' : partition.length === 1 && SPLITS.includes(only) ? only : 'kept',
      };
    });
  return {
    ...accessFrom(spec),
    ...labelsFrom(spec),
    maxKeyLifetime: spec.max_key_lifetime ?? '',
    defaultLifetime:
      typeof spec.key_policy?.default_lifetime === 'string' ? spec.key_policy.default_lifetime : '',
    rotationMaxAge:
      typeof spec.key_policy?.rotation_max_age === 'string' ? spec.key_policy.rotation_max_age : '',
    limits,
  };
}

/** A limit row written over the limit it was read from: only what the row edits changes. */
function limitOf(row: LimitRow, declared: Record<string, unknown> | undefined): Record<string, unknown> {
  const before = declared ?? {};
  const out: Record<string, unknown> = { ...before, unit: row.unit, limit: Number(row.limit) };
  if (row.unit === 'concurrency') delete out.per;
  else out.per = row.per;
  // Members that only belong to another unit go with it.
  if (row.unit !== 'tokens') {
    delete out.tokens;
    delete out.weights;
  }
  if (row.unit !== 'requests') delete out.count;
  if (row.split !== 'kept') {
    const before = Array.isArray(out.partition_by) ? (out.partition_by as string[]) : [];
    if (row.split) {
      if (before.length !== 1 || before[0] !== row.split) {
        out.partition_by = [row.split];
        delete out.overrides;
      }
    } else if (before.length > 0) {
      delete out.partition_by;
      delete out.overrides;
    }
  }
  return out;
}

/**
 * The spec with the drawer's tenancy members written over `base`: access, labels, key lifetimes
 * (`withKeys`) and rate limits (`withLimits`). Members the drawer does not show stay as stored.
 */
export function tenantSpec<T extends object>(
  v: TenantValues,
  base: T,
  options: { withKeys?: boolean; withLimits?: boolean } = {},
): T {
  const b = base as TenantSpec;
  const next: Record<string, unknown> = { ...accessSpec(v, b), ...labelsSpec(v) };
  if (options.withKeys) {
    next.max_key_lifetime = v.maxKeyLifetime.trim() || undefined;
    const policy: Record<string, unknown> = { ...(b.key_policy ?? {}) };
    if (v.defaultLifetime.trim()) policy.default_lifetime = v.defaultLifetime.trim();
    else delete policy.default_lifetime;
    if (v.rotationMaxAge.trim()) policy.rotation_max_age = v.rotationMaxAge.trim();
    else delete policy.rotation_max_age;
    next.key_policy = Object.keys(policy).length > 0 ? policy : undefined;
  }
  if (options.withLimits) {
    const declared = (b.policies?.limits ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const limits: Record<string, unknown> = Object.fromEntries(
      Object.entries(declared).filter(([name]) => LIMIT_RESERVED.includes(name)),
    );
    for (const row of v.limits) limits[row.name.trim()] = limitOf(row, row.id ? declared[row.id] : undefined);
    const policies: Record<string, unknown> = { ...(b.policies ?? {}) };
    if (Object.keys(limits).length > 0) policies.limits = limits;
    else delete policies.limits;
    next.policies = Object.keys(policies).length > 0 ? policies : undefined;
  }
  return withMembers(base, next);
}

const LIMIT_NAME = /^[a-z0-9_]{1,64}$/;

/** Validation of the tenancy members. */
export const tenantShape = {
  ...accessShape,
  ...labelsShape,
  maxKeyLifetime: z
    .string()
    .refine((v) => v.trim() === '' || duration.safeParse(v).success, 'A duration such as 90d'),
  defaultLifetime: z
    .string()
    .refine((v) => v.trim() === '' || duration.safeParse(v).success, 'A duration such as 30d'),
  rotationMaxAge: z
    .string()
    .refine((v) => v.trim() === '' || duration.safeParse(v).success, 'A duration such as 180d'),
  limits: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        unit: z.enum(['requests', 'tokens', 'concurrency']),
        limit: z.string(),
        per: z.string(),
        split: z.string(),
      }),
    )
    .refine(
      (rows) => rows.every((r) => LIMIT_NAME.test(r.name.trim()) && !LIMIT_RESERVED.includes(r.name.trim())),
      'Name each limit with lowercase letters, digits and _',
    )
    .refine((rows) => new Set(rows.map((r) => r.name.trim())).size === rows.length, 'Each limit name once')
    .refine((rows) => rows.every((r) => /^\d+$/.test(r.limit.trim())), 'Each limit is a whole number')
    .refine(
      (rows) => rows.every((r) => r.unit === 'concurrency' || duration.safeParse(r.per).success),
      'Each limit counts over a duration such as 1m',
    ),
};

export const tenantSchema = z.object(tenantShape);

/* ------------------------------------------------------------------ Teams */

/**
 * What happens when the team's monthly budget is reached: alert only, block, or (for a budget set up
 * on the Budgets page with approval or a downgrade) what it states, unchanged.
 */
export type TeamBudgetMode = 'soft' | 'hard' | 'kept';

export const teamSchema = z
  .object({
    ...tenantShape,
    name: resourceName,
    displayName: z.string().trim().max(200, 'At most 200 characters'),
    organization: resourceName,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour like #3366ff'),
    lead: z.string(),
    /** The unit of the stored monthly budget; a new one counts dollars. */
    budgetUnit: z.enum(['usd', 'tokens']),
    budget: z.string().trim(),
    mode: z.enum(['soft', 'hard', 'kept']),
  })
  .refine(
    (v) =>
      v.budget === '' ||
      (v.budgetUnit === 'tokens' ? /^\d+$/.test(v.budget) : money.safeParse(v.budget).success),
    { path: ['budget'], message: 'A monthly amount, or empty' },
  );

export type TeamValues = Omit<z.input<typeof teamSchema>, keyof TenantValues> & TenantValues;

type Declaration = Record<string, unknown> & { amount?: string | number; mode?: string; unit?: string };

function monthlyOf(spec: TeamSpec | undefined): Declaration | undefined {
  const d = (spec?.policies?.budgets as Record<string, unknown> | undefined)?.monthly;
  return d && typeof d === 'object' ? (d as Declaration) : undefined;
}

/** The team drawer's values for a team, or for a new one in `organization`. */
export function teamValues(team: TeamResource | undefined, organization: string): TeamValues {
  const monthly = monthlyOf(team?.spec);
  // A declaration without a mode blocks (the default is `hard`); approval and downgrade are kept.
  const mode = monthly ? (monthly.mode ?? 'hard') : 'soft';
  return {
    ...tenantValues(team?.spec ?? { organization }),
    name: team?.name ?? '',
    displayName: team?.spec.display_name ?? '',
    organization: team?.spec.organization ?? organization,
    color: team?.spec.color ?? TEAM_COLORS[0] ?? '#3e72cb',
    lead: team?.spec.lead ?? '',
    budgetUnit: monthly?.unit === 'tokens' ? 'tokens' : 'usd',
    budget: monthly?.amount !== undefined ? String(monthly.amount) : '',
    mode: mode === 'hard' || mode === 'soft' ? mode : 'kept',
  };
}

/**
 * The team spec the drawer describes, written over `base` so everything it does not show stays as
 * stored. The monthly budget is rewritten only when its amount or mode changed, and then only those
 * two members: its unit, alerts, match and the rest stay as declared.
 */
export function toTeamSpec(v: TeamValues, base?: TeamSpec): TeamSpec {
  const before = monthlyOf(base);
  const budgets = { ...((base?.policies?.budgets ?? {}) as Record<string, unknown>) };
  const amount = v.budgetUnit === 'tokens' ? Number(v.budget) : v.budget;
  if (!v.budget) delete budgets.monthly;
  else if (!before)
    budgets.monthly = {
      unit: 'usd',
      amount,
      period: 'monthly',
      mode: v.mode === 'hard' ? 'hard' : 'soft',
      alert_at: [0.5, 0.8, 1],
    };
  else {
    const next: Declaration = { ...before };
    if (String(before.amount) !== v.budget) next.amount = amount;
    if (v.mode !== 'kept' && v.mode !== (before.mode ?? 'hard')) next.mode = v.mode;
    budgets.monthly = next;
  }
  const spec = tenantSpec(v, base ?? { organization: v.organization }, {
    withKeys: true,
    withLimits: true,
  });
  spec.organization = v.organization;
  spec.color = v.color;
  if (v.displayName) spec.display_name = v.displayName;
  else delete spec.display_name;
  if (v.lead) spec.lead = v.lead;
  else delete spec.lead;
  const policies: NonNullable<TeamSpec['policies']> = { ...(spec.policies ?? {}) };
  if (Object.keys(budgets).length > 0) policies.budgets = budgets as typeof policies.budgets;
  else delete policies.budgets;
  if (Object.keys(policies).length > 0) spec.policies = policies;
  else delete spec.policies;
  return spec;
}

/* ------------------------------------------------------------------ Projects */

export interface ProjectValues extends TenantValues {
  name: string;
  team: string;
  enabled: boolean;
}

export const projectSchema = z.object({
  ...tenantShape,
  name: resourceName,
  team: resourceName,
  enabled: z.boolean(),
});

export function projectValues(project: ProjectResource): ProjectValues {
  return {
    ...tenantValues(project.spec),
    name: project.name,
    team: project.spec.team,
    enabled: project.spec.enabled !== false,
  };
}

/** The project spec the drawer describes, over the stored one. */
export function toProjectSpec(v: ProjectValues, base: ProjectSpec): ProjectSpec {
  const spec = tenantSpec(v, base, { withKeys: true, withLimits: true });
  spec.team = v.team;
  if (v.enabled) {
    // Enabled is the default; a spec that said so keeps saying it.
    if (base.enabled === false) delete spec.enabled;
  } else spec.enabled = false;
  return spec;
}

/* ------------------------------------------------------------------ Inherited key lifetimes */

/** A value set above a level, and where: "90d from organization acme". */
export interface Inherited {
  value: string;
  from: string;
}

/**
 * The key lifetimes a level inherits when it sets none: for each, the narrowest level above it
 * that sets one (`levels` from the nearest parent up).
 */
export function inheritedKeyPolicy(
  levels: { label: string; spec: TenantSpec | undefined }[],
): Record<'maxKeyLifetime' | 'defaultLifetime' | 'rotationMaxAge', Inherited | null> {
  const find = (pick: (s: TenantSpec) => unknown): Inherited | null => {
    for (const l of levels) {
      const v = l.spec ? pick(l.spec) : undefined;
      if (typeof v === 'string' && v) return { value: v, from: l.label };
    }
    return null;
  };
  return {
    maxKeyLifetime: find((s) => s.max_key_lifetime),
    defaultLifetime: find((s) => s.key_policy?.default_lifetime),
    rotationMaxAge: find((s) => s.key_policy?.rotation_max_age),
  };
}

/** The access, labels and limits a level states, in words, for its detail; empty when it sets none. */
export function tenantFacts(spec: TenantSpec): { label: string; value: string }[] {
  const list = (l: string[] | undefined) => (l && l.length > 0 ? l.join(', ') : null);
  const limits = Object.keys(spec.policies?.limits ?? {}).filter((n) => !LIMIT_RESERVED.includes(n));
  const facts: [string, string | null][] = [
    ['Endpoints', list(spec.endpoints?.filter((e) => e !== '*'))],
    ['Models', list(spec.models)],
    ['Never these models', list(spec.deny_models)],
    ['Providers', list(spec.providers)],
    ['Never these providers', list(spec.deny_providers)],
    ['Deployments', list(spec.deployments)],
    [
      'IP addresses',
      list(spec.allowed_ips?.map((ip) => (ip.startsWith('set:') ? `${ip.slice(4)} (set)` : ip))),
    ],
    ['Regions', list(spec.regions)],
    ['Never these regions', list(spec.deny_regions)],
    ['Tags', list(spec.tags)],
    ['Metadata', list(Object.entries(spec.metadata ?? {}).map(([k, v]) => `${k}=${v}`))],
    ['Rate limits', list(limits)],
    [
      'Default key lifetime',
      typeof spec.key_policy?.default_lifetime === 'string' ? spec.key_policy.default_lifetime : null,
    ],
    [
      'Rotate keys older than',
      typeof spec.key_policy?.rotation_max_age === 'string' ? spec.key_policy.rotation_max_age : null,
    ],
  ];
  return facts
    .filter((f): f is [string, string] => f[1] !== null)
    .map(([label, value]) => ({ label, value }));
}
