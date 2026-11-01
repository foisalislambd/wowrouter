import { z } from 'zod';

import { money, resourceName } from '@/lib/validation';

export type Enforcement = 'soft' | 'hard' | 'approval' | 'downgrade';
export type BudgetUnit = 'usd' | 'tokens';
/** Which tokens a token budget counts: all of them, one direction, or weighted by pricing class. */
export type TokenCount = 'total' | 'input' | 'output' | 'weighted';
export type Period = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'lifetime' | 'rolling';

/** The rolling windows the drawer offers (any duration is kept as written). */
export const ROLLING_WINDOWS = ['1h', '24h', '7d', '30d'] as const;

/** Where a budget can be declared: the gateway, a tenancy level, a Model or a route. */
export const BUDGET_LEVELS = ['gateway', 'organization', 'team', 'project', 'key', 'model', 'route'] as const;
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];

/** The owner name of the gateway's own budgets. */
export const GATEWAY_OWNER = '-';

export interface BudgetFormValues {
  level: BudgetLevel;
  owner: string;
  name: string;
  /** What the amount counts: dollars, or tokens. */
  unit: BudgetUnit;
  /** With `tokens`: which tokens count. */
  tokens: TokenCount;
  amount: string;
  period: Period;
  /** With `rolling`: the window's length, a duration such as `7d`. */
  window: string;
  enforcement: Enforcement;
  alerts: string;
  hardCap: string;
  budgetOwner: string;
  downgradeAt: string;
  /** A downgrade's target: a Model or a tier. */
  downgradeTo: 'model' | 'tier';
  downgradeModel: string;
  downgradeTier: string;
  /** `cache_hits_bypass_budgets`: a request this budget refuses may still be served from the cache. */
  cacheBypass: boolean;
  /** `match` / `exclude`: the Models (globs), request tags (globs) and endpoints the budget counts. */
  matchModels: string[];
  excludeModels: string[];
  matchTags: string[];
  excludeTags: string[];
  matchEndpoints: string[];
  excludeEndpoints: string[];
  /** `partition_by`: one amount per value of these attributes; empty for one shared amount. */
  partitionBy: string[];
  /** `on_missing`: what a request without a value of the split counts in. */
  onMissing: 'shared' | 'skip' | 'reject';
  /** Rolling windows: how many steps the window slides in; empty for one an hour. */
  precision: string;
  /** Calendar periods: the zone the period starts in; empty for UTC. */
  timezone: string;
  /** Weekly periods: the day a week starts; empty for Monday. */
  weekStart: string;
  /** `on_store_unavailable`: empty for the gateway's default. */
  onStoreUnavailable: '' | 'fail_closed' | 'local_share';
  /** `allow_above_parent`: the amount may exceed the budget it sits in. */
  allowAboveParent: boolean;
}

/** The endpoints a budget can be limited to (`Match.endpoints`). */
export const BUDGET_ENDPOINTS = [
  'chat_completions',
  'responses',
  'messages',
  'completions',
  'embeddings',
  'images',
  'audio',
  'moderations',
  'rerank',
  'files',
  'batches',
  'realtime',
  'count_tokens',
  'models',
  'gemini',
  'bedrock',
] as const;

/** The attributes a budget is split by (`tag:<name>` splits by one tag's value). */
const PARTITION =
  /^(key|project|team|organization|user|end_user|model|ip|endpoint|mcp_server|mcp_tool|a2a_agent|tag:[A-Za-z0-9:_.-]{1,64})$/;

export const EMPTY_BUDGET: BudgetFormValues = {
  level: 'team',
  owner: '',
  name: 'monthly',
  unit: 'usd',
  tokens: 'total',
  amount: '',
  period: 'monthly',
  window: '7d',
  enforcement: 'soft',
  alerts: '50, 80, 100',
  hardCap: '',
  budgetOwner: '',
  downgradeAt: '90',
  downgradeTo: 'model',
  downgradeModel: '',
  downgradeTier: 'fast',
  cacheBypass: false,
  matchModels: [],
  excludeModels: [],
  matchTags: [],
  excludeTags: [],
  matchEndpoints: [],
  excludeEndpoints: [],
  partitionBy: [],
  onMissing: 'shared',
  precision: '',
  timezone: '',
  weekStart: '',
  onStoreUnavailable: '',
  allowAboveParent: false,
};

const percentList = z
  .string()
  .refine(
    (v) => v.trim() === '' || v.split(',').every((p) => /^\s*\d{1,3}\s*$/.test(p) && Number(p) <= 100),
    'Percentages from 0 to 100, separated by commas',
  )
  .refine((v) => {
    const n = v
      .split(',')
      .filter((p) => p.trim())
      .map(Number);
    return n.every((x, i) => i === 0 || x > (n[i - 1] ?? -1));
  }, 'Each threshold above the previous one');

const DURATION = /^\d+(ms|s|m|h|d)$/;

export const budgetSchema = z
  .object({
    level: z.enum(BUDGET_LEVELS),
    owner: z.string().trim().min(1),
    name: z.string().regex(/^[a-z0-9_]{1,64}$/, 'Lowercase letters, digits and _'),
    unit: z.enum(['usd', 'tokens']),
    tokens: z.enum(['total', 'input', 'output', 'weighted']),
    amount: z.string().trim(),
    period: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'lifetime', 'rolling']),
    window: z.string().trim(),
    enforcement: z.enum(['soft', 'hard', 'approval', 'downgrade']),
    alerts: percentList,
    hardCap: z
      .string()
      .trim()
      .refine((v) => v === '' || /^\d{2,3}$/.test(v), 'A percentage such as 110'),
    budgetOwner: z.string(),
    downgradeAt: z
      .string()
      .trim()
      .regex(/^\d{1,3}$/, 'A percentage'),
    downgradeTo: z.enum(['model', 'tier']),
    downgradeModel: z.string(),
    downgradeTier: z.string(),
    cacheBypass: z.boolean(),
    matchModels: z.array(z.string()),
    excludeModels: z.array(z.string()),
    matchTags: z.array(z.string()),
    excludeTags: z.array(z.string()),
    matchEndpoints: z.array(z.string()),
    excludeEndpoints: z.array(z.string()),
    partitionBy: z.array(z.string()),
    onMissing: z.enum(['shared', 'skip', 'reject']),
    precision: z.string().trim(),
    timezone: z.string().trim(),
    weekStart: z.string(),
    onStoreUnavailable: z.enum(['', 'fail_closed', 'local_share']),
    allowAboveParent: z.boolean(),
  })
  .refine((v) => v.partitionBy.every((p) => PARTITION.test(p)), {
    path: ['partitionBy'],
    message: 'Name the tag to split by: letters, digits and :_.-',
  })
  .refine((v) => v.precision === '' || (/^\d+$/.test(v.precision) && Number(v.precision) >= 1), {
    path: ['precision'],
    message: 'A whole number from 1',
  })
  .refine((v) => v.timezone === '' || /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(v.timezone), {
    path: ['timezone'],
    message: 'A time zone such as Europe/Lisbon',
  })
  .refine((v) => v.level !== 'gateway' || v.owner === GATEWAY_OWNER, { path: ['owner'] })
  .refine((v) => ['gateway', 'model'].includes(v.level) || resourceName.safeParse(v.owner).success, {
    path: ['owner'],
  })
  .refine((v) => (v.unit === 'tokens' ? /^\d+$/.test(v.amount) : money.safeParse(v.amount).success), {
    path: ['amount'],
    message: 'Enter an amount',
  })
  .refine((v) => v.hardCap === '' || v.enforcement === 'soft', {
    path: ['hardCap'],
    message: 'A hard cap only adds to an alert-only budget',
  })
  .refine((v) => v.hardCap === '' || Number(v.hardCap) > 100, {
    path: ['hardCap'],
    message: 'The cap is above 100%',
  })
  .refine((v) => v.period !== 'rolling' || DURATION.test(v.window), {
    path: ['window'],
    message: 'A length such as 24h or 7d',
  })
  .refine((v) => v.enforcement !== 'downgrade' || v.downgradeTo !== 'model' || v.downgradeModel !== '', {
    path: ['downgradeModel'],
    message: 'Choose the Model to switch to',
  });

/**
 * The declaration(s) the form describes, as a merge patch on the owner's budgets: the budget, and
 * its hard twin at the cap. Members the form turned off are `null`, so the patch removes them.
 *
 * With `pristine` (the values as loaded), only what the person changed is written: members of the
 * declaration the form shows but nobody touched stay exactly as they are stored. The twin is removed
 * only when the loaded declaration had one, so an unrelated budget named `<name>_cap` is left alone.
 */
export function toDeclarations(
  v: BudgetFormValues,
  pristine?: BudgetFormValues,
): Record<string, Record<string, unknown> | null> {
  const changed = (...keys: (keyof BudgetFormValues)[]) =>
    !pristine || keys.some((k) => JSON.stringify(v[k]) !== JSON.stringify(pristine[k]));
  const rolling = v.period === 'rolling';
  const period = rolling ? v.window.trim() : v.period;
  const tokens = v.unit === 'tokens';
  const base: Record<string, unknown> = {};
  if (changed('unit', 'tokens')) {
    base.unit = v.unit;
    // `tokens` and `weights` only exist on a token budget; the default count is left unwritten.
    if (!tokens) Object.assign(base, { tokens: null, weights: null });
    else if (v.tokens !== 'total' || (pristine && pristine.tokens !== 'total')) base.tokens = v.tokens;
  }
  if (changed('unit', 'amount')) base.amount = amountOf(v.unit, v.amount);
  if (changed('period', 'window')) {
    base.period = period;
    base.algorithm = rolling ? 'sliding_window' : null;
    if (!rolling) base.precision = null;
    // A time zone belongs to calendar periods, a week start to weekly ones.
    if (rolling || v.period === 'lifetime') base.timezone = null;
    if (v.period !== 'weekly') base.week_start = null;
  }
  if (changed('enforcement', 'downgradeAt', 'downgradeTo', 'downgradeModel', 'downgradeTier')) {
    base.mode = v.enforcement === 'approval' ? 'approval' : v.enforcement === 'hard' ? 'hard' : 'soft';
    base.downgrade =
      v.enforcement === 'downgrade'
        ? {
            at: Number(v.downgradeAt) / 100,
            ...(v.downgradeTo === 'model'
              ? { to_model: v.downgradeModel, to_tier: null }
              : { to_tier: v.downgradeTier, to_model: null }),
          }
        : null;
  }
  if (changed('alerts')) {
    const alerts = v.alerts
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => Number(p) / 100);
    base.alert_at = alerts.length > 0 ? alerts : null;
  }
  if (changed('budgetOwner')) base.owner = v.budgetOwner ? v.budgetOwner : null;
  if (changed('cacheBypass')) base.cache_hits_bypass_budgets = v.cacheBypass ? true : null;
  // A merge patch of `match` changes only the lists the drawer shows; MCP and agent lists stay.
  if (changed('matchModels', 'matchTags', 'matchEndpoints'))
    base.match = matchPatch(v.matchModels, v.matchTags, v.matchEndpoints, Boolean(pristine));
  if (changed('excludeModels', 'excludeTags', 'excludeEndpoints'))
    base.exclude = matchPatch(v.excludeModels, v.excludeTags, v.excludeEndpoints, Boolean(pristine));
  if (base.match === undefined) delete base.match;
  if (base.exclude === undefined) delete base.exclude;
  if (changed('partitionBy')) {
    base.partition_by = listOrNull(v.partitionBy);
    // Amounts of their own belong to the values of the old split.
    if (pristine) base.overrides = null;
  }
  if (changed('onMissing') && (v.partitionBy.length > 0 || pristine))
    base.on_missing = v.onMissing === 'shared' ? null : v.onMissing;
  if (changed('precision') && rolling) base.precision = v.precision ? Number(v.precision) : null;
  if (changed('timezone') && !rolling && v.period !== 'lifetime') base.timezone = v.timezone.trim() || null;
  if (changed('weekStart', 'period') && v.period === 'weekly') base.week_start = v.weekStart || null;
  if (changed('onStoreUnavailable')) base.on_store_unavailable = v.onStoreUnavailable || null;
  if (changed('allowAboveParent')) base.allow_above_parent = v.allowAboveParent ? true : null;
  const out: Record<string, Record<string, unknown> | null> = { [v.name]: base };
  const capName = capNameOf(v.name);
  if (v.hardCap) {
    if (changed('hardCap', 'amount', 'unit', 'tokens', 'period', 'window')) {
      const capAmount = (Number(v.amount) * Number(v.hardCap)) / 100;
      out[capName] = {
        unit: v.unit,
        amount: tokens ? Math.round(capAmount) : String(capAmount),
        tokens: tokens && v.tokens !== 'total' ? v.tokens : null,
        ...(tokens ? {} : { weights: null }),
        period,
        algorithm: rolling ? 'sliding_window' : null,
        mode: 'hard',
      };
    }
  } else if (pristine?.hardCap) {
    out[capName] = null;
  }
  return out;
}

/** The `match` or `exclude` patch; a new budget that matches everything states none. */
function matchPatch(
  models: string[],
  tags: string[],
  endpoints: string[],
  stored: boolean,
): Record<string, string[] | null> | undefined {
  const patch = { models: listOrNull(models), tags: listOrNull(tags), endpoints: listOrNull(endpoints) };
  return stored || Object.values(patch).some((l) => l !== null) ? patch : undefined;
}

function listOrNull(list: string[]): string[] | null {
  return list.length > 0 ? list : null;
}

/** The name of a budget's hard twin. */
export function capNameOf(name: string): string {
  return `${name}_cap`.slice(0, 64);
}

/**
 * Whether `cap` is the hard twin the drawer writes for `decl`: blocking, in the same unit and over
 * the same period. Another budget that happens to be named `<name>_cap` is not.
 */
export function isCapTwin(
  decl: Record<string, unknown> | undefined,
  cap: Record<string, unknown> | undefined,
): boolean {
  if (!decl || !cap) return false;
  return (
    (cap.mode === undefined || cap.mode === 'hard') &&
    unitOf(cap) === unitOf(decl) &&
    cap.period === decl.period &&
    (cap.algorithm ?? null) === (decl.algorithm ?? null)
  );
}

/** Where a budget sits in the configuration, for placing the gateway's field errors. */
export function budgetPath(level: string, owner: string, name: string): string {
  return level === 'gateway' ? `policies.budgets.${name}` : `${level}s.${owner}.policies.budgets.${name}`;
}

/** An amount as a declaration writes it: a decimal string of dollars, or a whole number of tokens. */
export function amountOf(unit: BudgetUnit, amount: string): string | number {
  return unit === 'tokens' ? Number(amount.trim()) : amount.trim();
}

/** A merge patch that sets or removes one partition value's own amount. */
export function toOverride(
  name: string,
  value: string,
  amount: string | null,
  unit: BudgetUnit = 'usd',
): Record<string, Record<string, unknown>> {
  return { [name]: { overrides: { [value]: amount === null ? null : amountOf(unit, amount) } } };
}

/** The unit a declaration counts in; a declaration without one is read as dollars. */
export function unitOf(decl: Record<string, unknown> | undefined): BudgetUnit {
  return decl?.unit === 'tokens' ? 'tokens' : 'usd';
}

const PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'lifetime'];

export function fromDeclaration(
  level: BudgetFormValues['level'],
  owner: string,
  name: string,
  decl: Record<string, unknown> | undefined,
  cap: Record<string, unknown> | undefined,
): BudgetFormValues {
  const d = decl ?? {};
  // A declaration without a mode blocks at the limit (the default is `hard`).
  const mode = typeof d.mode === 'string' ? d.mode : decl ? 'hard' : 'soft';
  const tokens = ['total', 'input', 'output', 'weighted'].includes(d.tokens as string)
    ? (d.tokens as TokenCount)
    : 'total';
  const downgrade = d.downgrade as { at?: number; to_tier?: string; to_model?: string } | undefined;
  const alerts = Array.isArray(d.alert_at)
    ? (d.alert_at as unknown[]).map((a) => String(Math.round(Number(a) * 100))).join(', ')
    : '';
  const amount = typeof d.amount === 'string' || typeof d.amount === 'number' ? String(d.amount) : '';
  const twin = isCapTwin(decl, cap) ? cap : undefined;
  const capAmount =
    twin && (typeof twin.amount === 'string' || typeof twin.amount === 'number') ? Number(twin.amount) : null;
  const period = typeof d.period === 'string' ? d.period : 'monthly';
  const match = (d.match ?? {}) as Record<string, unknown>;
  const exclude = (d.exclude ?? {}) as Record<string, unknown>;
  const rolling = d.algorithm === 'sliding_window' || !PERIODS.includes(period);
  return {
    level,
    owner,
    name,
    unit: unitOf(decl),
    tokens,
    amount,
    period: rolling ? 'rolling' : (period as Period),
    window: rolling ? period : '7d',
    enforcement: downgrade
      ? 'downgrade'
      : mode === 'approval'
        ? 'approval'
        : mode === 'hard'
          ? 'hard'
          : 'soft',
    alerts,
    hardCap: capAmount && Number(amount) > 0 ? String(Math.round((capAmount / Number(amount)) * 100)) : '',
    budgetOwner: typeof d.owner === 'string' ? d.owner : '',
    downgradeAt: downgrade?.at !== undefined ? String(Math.round(downgrade.at * 100)) : '90',
    downgradeTo: downgrade?.to_tier ? 'tier' : 'model',
    downgradeModel: downgrade?.to_model ?? '',
    downgradeTier: downgrade?.to_tier ?? 'fast',
    cacheBypass: d.cache_hits_bypass_budgets === true,
    matchModels: listOf(match.models),
    excludeModels: listOf(exclude.models),
    matchTags: listOf(match.tags),
    excludeTags: listOf(exclude.tags),
    matchEndpoints: listOf(match.endpoints),
    excludeEndpoints: listOf(exclude.endpoints),
    partitionBy: listOf(d.partition_by),
    onMissing: d.on_missing === 'skip' || d.on_missing === 'reject' ? d.on_missing : 'shared',
    precision: typeof d.precision === 'number' ? String(d.precision) : '',
    timezone: typeof d.timezone === 'string' ? d.timezone : '',
    weekStart: typeof d.week_start === 'string' ? d.week_start : '',
    onStoreUnavailable:
      d.on_store_unavailable === 'fail_closed' || d.on_store_unavailable === 'local_share'
        ? d.on_store_unavailable
        : '',
    allowAboveParent: d.allow_above_parent === true,
  };
}

function listOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** The Models a declaration covers, in words ("All Models", "gpt-4o*, claude-*", "All but …"). */
export function modelsCovered(decl: Record<string, unknown> | undefined): {
  label: string;
  patterns: string[];
  all: boolean;
} {
  const match = (decl?.match as { models?: string[] } | undefined)?.models ?? [];
  const exclude = (decl?.exclude as { models?: string[] } | undefined)?.models ?? [];
  if (match.length === 0 && exclude.length === 0) return { label: 'All Models', patterns: [], all: true };
  if (match.length === 0)
    return { label: `All Models but ${exclude.join(', ')}`, patterns: exclude, all: false };
  return {
    label: `${match.join(', ')}${exclude.length ? ` (not ${exclude.join(', ')})` : ''}`,
    patterns: match,
    all: false,
  };
}
