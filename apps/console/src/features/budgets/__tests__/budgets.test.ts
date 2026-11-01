import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { BudgetCounter } from '@/lib/api/types';
import { server } from '@/mocks/node';

import { budgetsApi } from '../api';

import { grantExpiry } from '../components/overage-dialog';
import { recostRange } from '../components/cost-tools';
import {
  budgetPath,
  budgetSchema,
  EMPTY_BUDGET,
  GATEWAY_OWNER,
  fromDeclaration,
  modelsCovered,
  toDeclarations,
  toOverride,
} from '../form';
import { peopleFacts } from '../people';
import {
  buildTree,
  flatten,
  isCounted,
  limitsReachedToday,
  parsePartition,
  partitionLabel,
  project,
  stateOf,
  topIssue,
} from '../types';

const counter = (
  level: BudgetCounter['level'],
  owner: string,
  spent: string,
  amount = '100',
  mode: 'hard' | 'soft' = 'soft',
): BudgetCounter => ({
  level,
  owner,
  name: 'monthly',
  partition: null,
  unit: 'usd',
  mode,
  amount,
  spent,
  reserved: '0',
  remaining: '0',
  period_start: '2026-06-01T00:00:00Z',
  resets_at: '2026-07-01T00:00:00Z',
});
const NOW = new Date('2026-06-16T00:00:00Z').getTime();
const FORECAST = {
  rate_per_day: '1',
  projected_spend: '120',
  projected_ratio: 1.2,
  runs_out_at: '2026-06-28T00:00:00Z',
  basis_from: '2026-06-09T00:00:00Z',
  basis_to: '2026-06-16T00:00:00Z',
};

/** Applies a JSON merge patch the way the gateway does. */
function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = new Map<string, unknown>(
    target !== null && typeof target === 'object' && !Array.isArray(target) ? Object.entries(target) : [],
  );
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) out.delete(k);
    else out.set(k, mergePatch(out.get(k), v));
  }
  return Object.fromEntries(out);
}

describe('budget forecasts', () => {
  it('projects linearly over the period', () => {
    const { projected, elapsed } = project(counter('team', 't', '50'), NOW);
    expect(elapsed).toBeCloseTo(0.5, 2);
    expect(projected).toBeCloseTo(100, 0);
  });
  it('states over, blocked, at risk and on pace', () => {
    expect(stateOf(counter('team', 't', '120'), 240)).toBe('over');
    expect(stateOf(counter('team', 't', '120', '100', 'hard'), 240)).toBe('blocked');
    expect(stateOf(counter('team', 't', '60'), 120)).toBe('at_risk');
    expect(stateOf(counter('team', 't', '10'), 20)).toBe('on_pace');
  });
  it('nests projects under their team and picks the top issue', () => {
    const parentOf = (level: string, owner: string) =>
      level === 'project' && owner === 'p' ? { level: 'team', owner: 't' } : null;
    const tree = buildTree(
      [counter('team', 't', '10'), counter('project', 'p', '90', '100', 'hard')],
      parentOf,
      NOW,
    );
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children[0]?.owner).toBe('p');
    expect(flatten(tree)).toHaveLength(2);
    expect(topIssue(tree)?.owner).toBe('p');
  });
});

describe('budget form', () => {
  it('declares a soft budget with a hard cap twin', () => {
    const d = toDeclarations({ ...EMPTY_BUDGET, owner: 'core', amount: '500', hardCap: '110' });
    expect(d.monthly).toMatchObject({ unit: 'usd', amount: '500', mode: 'soft', alert_at: [0.5, 0.8, 1] });
    expect(d.monthly_cap).toMatchObject({ amount: '550', mode: 'hard' });
  });
  it('keeps a token budget in tokens when it is saved again', () => {
    const decl = { unit: 'tokens', amount: 2_000_000, period: 'monthly', mode: 'hard', tokens: 'output' };
    const values = fromDeclaration('team', 'core', 'monthly', decl, undefined);
    expect(values.unit).toBe('tokens');
    expect(values.tokens).toBe('output');
    const out = toDeclarations({ ...values, amount: '3000000' }).monthly;
    expect(out).toMatchObject({ unit: 'tokens', amount: 3_000_000, tokens: 'output', mode: 'hard' });
    expect(out?.amount).toBeTypeOf('number');
  });
  it('creates a token budget when the unit is chosen, and a dollar one by default', () => {
    const tokens = toDeclarations({ ...EMPTY_BUDGET, owner: 'core', unit: 'tokens', amount: '500000' });
    expect(tokens.monthly).toMatchObject({ unit: 'tokens', amount: 500_000 });
    expect(tokens.monthly).not.toHaveProperty('tokens');
    const usd = toDeclarations({ ...EMPTY_BUDGET, owner: 'core', amount: '500' });
    expect(usd.monthly).toMatchObject({ unit: 'usd', amount: '500', tokens: null, weights: null });
  });
  it('asks for whole tokens on a token budget', () => {
    const base = { ...EMPTY_BUDGET, owner: 'core', unit: 'tokens' as const };
    expect(budgetSchema.safeParse({ ...base, amount: '12.5' }).success).toBe(false);
    expect(budgetSchema.safeParse({ ...base, amount: '1200' }).success).toBe(true);
  });
  it('reads a declaration without a mode as blocking, its default', () => {
    expect(fromDeclaration('team', 'core', 'm', { unit: 'usd', amount: '5' }, undefined).enforcement).toBe(
      'hard',
    );
  });
  it('writes a token override as a whole number', () => {
    expect(toOverride('seats', 'ada', '1000', 'tokens')).toEqual({ seats: { overrides: { ada: 1000 } } });
  });
  it('removes the cap twin when the cap is cleared', () => {
    const decl = { unit: 'usd', amount: '500', period: 'monthly', mode: 'soft' };
    const cap = { unit: 'usd', amount: '550', period: 'monthly', mode: 'hard' };
    const stored = fromDeclaration('team', 'core', 'monthly', decl, cap);
    expect(stored.hardCap).toBe('110');
    expect(toDeclarations({ ...stored, hardCap: '' }, stored).monthly_cap).toBeNull();
  });
  it('leaves an unrelated budget named like the twin alone', () => {
    expect(toDeclarations({ ...EMPTY_BUDGET, owner: 'core', amount: '500' })).not.toHaveProperty(
      'monthly_cap',
    );
    const decl = { unit: 'usd', amount: '500', period: 'monthly', mode: 'soft' };
    const other = { unit: 'usd', amount: '50', period: 'daily', mode: 'soft' };
    const stored = fromDeclaration('team', 'core', 'monthly', decl, other);
    expect(stored.hardCap).toBe('');
    expect(toDeclarations({ ...stored, amount: '600' }, stored)).not.toHaveProperty('monthly_cap');
  });
  it('changes the Models covered and keeps the other match lists', () => {
    const decl = {
      unit: 'usd',
      amount: '50',
      period: 'monthly',
      match: { models: ['gpt-*'], tags: ['env:prod'], mcp_servers: ['github'] },
    };
    const stored = fromDeclaration('team', 'core', 'monthly', decl, undefined);
    const patch = toDeclarations(
      { ...stored, matchModels: ['claude-*'], excludeModels: ['claude-3*'] },
      stored,
    );
    expect(mergePatch({ monthly: decl }, patch)).toEqual({
      monthly: {
        ...decl,
        match: { models: ['claude-*'], tags: ['env:prod'], mcp_servers: ['github'] },
        exclude: { models: ['claude-3*'] },
      },
    });
  });
  it('splits a budget, and drops the amounts of the old split when it changes', () => {
    const created = toDeclarations({
      ...EMPTY_BUDGET,
      owner: 'core',
      amount: '5',
      partitionBy: ['tag:customer'],
      onMissing: 'reject',
    }).monthly;
    expect(created).toMatchObject({ partition_by: ['tag:customer'], on_missing: 'reject' });
    expect(created).not.toHaveProperty('match');
    const decl = {
      unit: 'usd',
      amount: '5',
      period: 'monthly',
      partition_by: ['user'],
      overrides: { ada: '9' },
    };
    const stored = fromDeclaration('organization', 'acme', 'monthly', decl, undefined);
    expect(toDeclarations({ ...stored, partitionBy: ['key'] }, stored).monthly).toEqual({
      partition_by: ['key'],
      overrides: null,
    });
    expect(budgetSchema.safeParse({ ...stored, owner: 'acme', partitionBy: ['tag:'] }).success).toBe(false);
  });
  it('writes the steps of a rolling window and keeps them when the window changes', () => {
    const decl = { unit: 'usd', amount: '5', period: '7d', algorithm: 'sliding_window', precision: 168 };
    const stored = fromDeclaration('team', 'core', 'r', decl, undefined);
    expect(stored.precision).toBe('168');
    expect(toDeclarations({ ...stored, precision: '24' }, stored).r).toEqual({ precision: 24 });
    expect(toDeclarations({ ...stored, window: '30d' }, stored).r).toEqual({
      period: '30d',
      algorithm: 'sliding_window',
      timezone: null,
      week_start: null,
    });
    expect(budgetSchema.safeParse({ ...stored, precision: '0' }).success).toBe(false);
  });
  it('writes the time zone, week start and store choices', () => {
    const stored = fromDeclaration(
      'team',
      'core',
      'w',
      { unit: 'usd', amount: '5', period: 'weekly' },
      undefined,
    );
    expect(
      toDeclarations(
        {
          ...stored,
          timezone: 'America/Sao_Paulo',
          weekStart: 'sunday',
          onStoreUnavailable: 'fail_closed',
          allowAboveParent: true,
        },
        stored,
      ).w,
    ).toEqual({
      timezone: 'America/Sao_Paulo',
      week_start: 'sunday',
      on_store_unavailable: 'fail_closed',
      allow_above_parent: true,
    });
  });
  it('writes only what changed, so a saved budget keeps every member as stored', () => {
    const decl = {
      unit: 'tokens',
      amount: 1_000_000,
      period: 'weekly',
      week_start: 'sunday',
      timezone: 'Europe/Lisbon',
      mode: 'approval',
      alert_at: [0.333, 0.9],
      tokens: 'weighted',
      weights: { output_text: '4' },
      match: { models: ['gpt-*'], tags: ['env:prod'] },
      exclude: { models: ['gpt-4o-mini'] },
      partition_by: ['user'],
      on_missing: 'skip',
      overrides: { ada: 2_000_000 },
      owner: 'ada',
      on_store_unavailable: 'local_share',
      allow_above_parent: true,
    };
    const stored = fromDeclaration('team', 'core', 'weekly', decl, undefined);
    const patch = toDeclarations(stored, stored);
    expect(patch).toEqual({ weekly: {} });
    expect(mergePatch({ weekly: decl }, patch)).toEqual({ weekly: decl });
    expect(toDeclarations({ ...stored, amount: '1500000' }, stored)).toEqual({
      weekly: { amount: 1_500_000 },
    });
  });
  it('rejects decreasing thresholds and a cap on a hard budget', () => {
    expect(
      budgetSchema.safeParse({ ...EMPTY_BUDGET, owner: 'core', amount: '5', alerts: '80, 50' }).success,
    ).toBe(false);
    expect(
      budgetSchema.safeParse({
        ...EMPTY_BUDGET,
        owner: 'core',
        amount: '5',
        enforcement: 'hard',
        hardCap: '110',
      }).success,
    ).toBe(false);
  });
});

describe('partitions and Unassigned', () => {
  const seat = (user: string, spent: string, amount = '3'): BudgetCounter => ({
    ...counter('organization', 'acme', spent, amount, 'hard'),
    name: 'seats',
    partition: `user=${user}`,
  });
  const parentOf = (level: string, owner: string) =>
    level === 'team' && owner ? { level: 'organization', owner: 'acme' } : null;
  it('groups a partitioned budget and places seats under the team budget or Unassigned', () => {
    const tree = buildTree(
      [
        counter('organization', 'acme', '10'),
        counter('team', 'core', '5'),
        seat('ada', '1', '6'),
        seat('bob', '4'),
      ],
      { parentOf, teamOfUser: (u) => (u === 'ada' ? 'core' : 'ghost') },
      NOW,
    );
    const rows = flatten(tree);
    const group = rows.find((r) => r.kind === 'partitioned');
    expect(group?.partitions).toBe(2);
    expect(group?.spent).toBeCloseTo(5);
    expect(group?.amount).toBeCloseTo(9);
    const ada = rows.find((r) => r.partition?.value === 'ada');
    expect(rows.find((r) => r.id === ada?.parentId)?.owner).toBe('core');
    const unassigned = rows.find((r) => r.kind === 'unassigned');
    expect(unassigned?.children.map((r) => r.partition?.value)).toEqual(['bob']);
    expect(rows.filter(isCounted)).toHaveLength(4);
  });
  it('reads partitions and labels the shared counter', () => {
    expect(parsePartition('user=ada')).toEqual({ attr: 'user', value: 'ada' });
    expect(parsePartition(null)).toBeNull();
    expect(partitionLabel({ attr: 'user', value: '' })).toBe('Without a person');
  });
  it("uses the gateway's state and forecast when it reports them", () => {
    const c = {
      ...counter('team', 't', '10'),
      state: 'at_risk' as const,
      forecast: FORECAST,
    };
    const [row] = buildTree([c], () => null, NOW);
    expect(row?.state).toBe('at_risk');
    expect(row?.projected).toBe(120);
    expect(row?.ratePerDay).toBe(1);
    expect(row?.runsOutAt).toBe('2026-06-28T00:00:00Z');
  });
  it('reads a counter without a forecast or an end as a rolling budget', () => {
    const c: BudgetCounter = { ...counter('team', 't', '30'), resets_at: null, state: 'on_pace' };
    const [row] = buildTree([c], () => null, NOW);
    expect(row?.rolling).toBe(true);
    expect(row?.projected).toBe(30);
    expect(row?.runsOutAt).toBeNull();
    expect(row?.ratePerDay).toBeNull();
    const lifetime = buildTree(
      [{ ...c, forecast: { ...FORECAST, projected_spend: '30', runs_out_at: null } }],
      () => null,
      NOW,
    );
    expect(lifetime[0]?.rolling).toBe(false);
  });
});

describe('rolling windows, downgrades and partitions in the form', () => {
  it('declares a rolling budget with the sliding window and clears it again', () => {
    const rolling = toDeclarations({
      ...EMPTY_BUDGET,
      owner: 'core',
      amount: '50',
      period: 'rolling',
      window: '7d',
      cacheBypass: true,
    });
    expect(rolling.monthly).toMatchObject({
      period: '7d',
      algorithm: 'sliding_window',
      cache_hits_bypass_budgets: true,
    });
    const monthly = toDeclarations({ ...EMPTY_BUDGET, owner: 'core', amount: '50' });
    expect(monthly.monthly).toMatchObject({
      period: 'monthly',
      algorithm: null,
      precision: null,
      cache_hits_bypass_budgets: null,
      downgrade: null,
    });
    expect(
      fromDeclaration(
        'team',
        'core',
        'r',
        { amount: '5', period: '24h', algorithm: 'sliding_window' },
        undefined,
      ),
    ).toMatchObject({ period: 'rolling', window: '24h' });
  });
  it('downgrades to a Model or a tier, and needs the Model', () => {
    const d = toDeclarations({
      ...EMPTY_BUDGET,
      owner: 'core',
      amount: '5',
      enforcement: 'downgrade',
      downgradeTo: 'model',
      downgradeModel: 'gpt-4o-mini',
    });
    expect(d.monthly?.downgrade).toEqual({ at: 0.9, to_model: 'gpt-4o-mini', to_tier: null });
    expect(
      fromDeclaration(
        'team',
        'core',
        'monthly',
        { amount: '5', downgrade: { at: 0.8, to_model: 'small' } },
        undefined,
      ),
    ).toMatchObject({
      enforcement: 'downgrade',
      downgradeTo: 'model',
      downgradeModel: 'small',
      downgradeAt: '80',
    });
    expect(
      budgetSchema.safeParse({
        ...EMPTY_BUDGET,
        owner: 'core',
        amount: '5',
        enforcement: 'downgrade',
        downgradeModel: '',
      }).success,
    ).toBe(false);
  });
  it('sets and removes a partition value of its own', () => {
    expect(toOverride('seats', 'ada', '6')).toEqual({ seats: { overrides: { ada: '6' } } });
    expect(toOverride('seats', 'ada', null)).toEqual({ seats: { overrides: { ada: null } } });
  });
  it('words the Models a budget covers', () => {
    expect(modelsCovered(undefined).label).toBe('All Models');
    expect(
      modelsCovered({ match: { models: ['gpt-4o*'] }, exclude: { models: ['gpt-4o-mini'] } }).label,
    ).toBe('gpt-4o* (not gpt-4o-mini)');
  });
});

describe('overage, re-costing and people', () => {
  it('ends an approval at the period end at the latest', () => {
    expect(grantExpiry('2026-06-20', '2026-07-01T00:00:00Z')).toBe('2026-06-20T23:59:59Z');
    expect(grantExpiry('2026-07-05', '2026-07-01T00:00:00Z')).toBe('2026-07-01T00:00:00Z');
    expect(grantExpiry('2026-07-05', null)).toBe('2026-07-05T23:59:59Z');
  });
  it('re-costs whole days', () => {
    expect(recostRange('2026-06-01', '2026-06-03')).toEqual({
      from: '2026-06-01T00:00:00Z',
      to: '2026-06-04T00:00:00Z',
    });
  });
  it('marks people spending over twice their team mean', () => {
    const user = (name: string, team: string, kind: 'human' | 'service' = 'human') =>
      ({ name, spec: { kind, primary_team: team }, metadata: {} }) as never;
    const people = peopleFacts(
      [user('a', 't'), user('b', 't'), user('c', 't'), user('d', 't', 'service')],
      new Map([
        ['a', { requests: 10, cost: 10 }],
        ['b', { requests: 10, cost: 1 }],
        ['c', { requests: 10, cost: 1 }],
      ]),
    );
    expect(people[0]?.name).toBe('a');
    expect(people[0]?.outlier).toBe(true);
    expect(people[0]?.perRequest).toBe(1);
    expect(people.find((p) => p.name === 'b')?.outlier).toBe(false);
    expect(people.find((p) => p.name === 'd')).toMatchObject({ service: true, perRequest: null });
  });
});

describe('budgets at the gateway, on a Model and on a route', () => {
  const meta = { etag: '"e1"', generation: 1, created_at: '', updated_at: '', managed_by: 'api' };
  it('accepts the gateway, a Model and a route as owners', () => {
    const base = { ...EMPTY_BUDGET, amount: '100' };
    expect(budgetSchema.safeParse({ ...base, level: 'gateway', owner: GATEWAY_OWNER }).success).toBe(true);
    expect(budgetSchema.safeParse({ ...base, level: 'gateway', owner: 'x' }).success).toBe(false);
    expect(budgetSchema.safeParse({ ...base, level: 'model', owner: 'gpt-4o' }).success).toBe(true);
    expect(budgetSchema.safeParse({ ...base, level: 'route', owner: 'global' }).success).toBe(true);
    expect(budgetSchema.safeParse({ ...base, level: 'route', owner: '' }).success).toBe(false);
  });
  it('places field errors where each level declares its budgets', () => {
    expect(budgetPath('gateway', GATEWAY_OWNER, 'monthly')).toBe('policies.budgets.monthly');
    expect(budgetPath('model', 'gpt-4o', 'monthly')).toBe('models.gpt-4o.policies.budgets.monthly');
  });
  it('writes a gateway budget on the gateway policies and a Model budget on the Model', async () => {
    const seen: { path: string; body: unknown; ifMatch: string | null }[] = [];
    server.use(
      http.get('*/admin/v1/settings/policies', () =>
        HttpResponse.json({ spec: { budgets: { monthly: { unit: 'usd', amount: '9' } } }, metadata: meta }),
      ),
      http.patch('*/admin/v1/settings/policies', async ({ request }) => {
        seen.push({ path: 'gateway', body: await request.json(), ifMatch: request.headers.get('if-match') });
        return HttpResponse.json({ spec: {}, metadata: meta });
      }),
      http.patch('*/admin/v1/models/:name', async ({ request, params }) => {
        seen.push({ path: `models/${String(params.name)}`, body: await request.json(), ifMatch: null });
        return HttpResponse.json({ name: params.name, spec: {}, metadata: meta });
      }),
      http.patch('*/admin/v1/routes/:name', async ({ request, params }) => {
        seen.push({ path: `routes/${String(params.name)}`, body: await request.json(), ifMatch: null });
        return HttpResponse.json({ name: params.name, spec: {}, metadata: meta });
      }),
    );
    const read = await budgetsApi.declaration('gateway', GATEWAY_OWNER);
    expect(read).toEqual({ budgets: { monthly: { unit: 'usd', amount: '9' } }, etag: '"e1"' });
    const patch = { monthly: { amount: '10' } };
    await budgetsApi.declare('gateway', GATEWAY_OWNER, patch, read?.etag);
    await budgetsApi.declare('model', 'gpt-4o', patch, undefined);
    await budgetsApi.declare('route', 'global', patch, undefined);
    expect(seen).toEqual([
      { path: 'gateway', body: { spec: { budgets: patch } }, ifMatch: '"e1"' },
      { path: 'models/gpt-4o', body: { spec: { policies: { budgets: patch } } }, ifMatch: null },
      { path: 'routes/global', body: { spec: { policies: { budgets: patch } } }, ifMatch: null },
    ]);
  });
});

describe('limits reached today', () => {
  it('counts budgets that ran out, not requests larger than what was left', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const at = (kind: string, time = '2026-10-18T09:00:00Z') => ({ kind, time });
    expect(
      limitsReachedToday(
        [at('request_over_remaining'), at('exhausted'), at('exhausted', '2026-10-16T09:00:00Z'), at('reset')],
        now,
      ),
    ).toBe(1);
    expect(limitsReachedToday([at('request_over_remaining')], now)).toBe(0);
  });
});
