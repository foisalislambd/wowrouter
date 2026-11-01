import { describe, expect, it } from 'vitest';

import type { OrganizationResource, ProjectResource, TeamResource } from '@/lib/api/types';

import { cascadeOf } from '../components/tenancy-detail';
import {
  inheritedKeyPolicy,
  projectSchema,
  projectValues,
  teamSchema,
  teamValues,
  tenantFacts,
  tenantSchema,
  tenantSpec,
  tenantValues,
  toProjectSpec,
  toTeamSpec,
} from '../form';

const meta = {
  etag: '"1"',
  generation: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  managed_by: 'api' as const,
};

const team = (spec: TeamResource['spec']): TeamResource => ({ name: 'core', spec, metadata: meta });

describe('team form', () => {
  const spec: TeamResource['spec'] = {
    organization: 'acme',
    display_name: 'Core',
    color: '#2f9e6f',
    lead: 'ada',
    enabled: false,
    tags: ['env:prod'],
    metadata: { cost_center: '42' },
    models: ['gpt-*'],
    deny_models: ['gpt-4o-mini'],
    providers: ['openai'],
    deny_providers: ['legacy*'],
    deployments: ['azure-*'],
    endpoints: ['chat', 'embeddings'],
    allowed_ips: ['10.0.0.0/8', 'set:office'],
    regions: ['eu-west-1'],
    deny_regions: ['us-east-1'],
    max_key_lifetime: '365d',
    key_policy: { default_lifetime: '90d', reminder_days: [7, 1] },
    policies: {
      budgets: {
        monthly: {
          unit: 'tokens',
          amount: 5_000_000,
          period: 'monthly',
          mode: 'approval',
          alert_at: [0.333],
          match: { models: ['claude-*'] },
          owner: 'ada',
        },
        daily: { unit: 'usd', amount: '20', period: 'daily' },
      },
      limits: {
        locked: ['rpm'],
        rpm: { unit: 'requests', limit: 100, per: '1m', burst: 10, match: { models: ['gpt-*'] } },
        tpm: { unit: 'tokens', limit: 9000, per: '1h', tokens: 'output', partition_by: ['key', 'model'] },
        // `locked` is a reserved member next to the limits, which the generated type can't state.
      } as never,
      guardrails: { input: ['pii'] },
    },
  };

  it('saves a team unchanged when nothing was edited', () => {
    const values = teamValues(team(spec), 'default');
    expect(teamSchema.safeParse(values).success).toBe(true);
    expect(toTeamSpec(values, spec)).toEqual(spec);
  });

  it('changes only the number of a limit, and drops what belongs to another unit', () => {
    const values = teamValues(team(spec), 'default');
    const limits = values.limits.map((r) =>
      r.name === 'rpm' ? { ...r, limit: '200' } : { ...r, unit: 'requests' as const },
    );
    const out = toTeamSpec({ ...values, limits }, spec).policies?.limits as Record<string, unknown>;
    expect(out.rpm).toEqual({ ...(spec.policies?.limits?.rpm as object), limit: 200 });
    expect(out.tpm).toEqual({ unit: 'requests', limit: 9000, per: '1h', partition_by: ['key', 'model'] });
    expect(out.locked).toEqual(['rpm']);
  });

  it('adds, renames and removes limits', () => {
    const values = teamValues(team(spec), 'default');
    const [rpm] = values.limits;
    if (!rpm) throw new Error('the team declares rpm');
    const atOnce = {
      id: '',
      name: 'at_once',
      unit: 'concurrency' as const,
      limit: '5',
      per: '1m',
      split: 'key',
    };
    const limits = [{ ...rpm, name: 'requests_per_minute' }, atOnce];
    const out = toTeamSpec({ ...values, limits }, spec).policies?.limits as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(['at_once', 'locked', 'requests_per_minute']);
    expect(out.at_once).toEqual({ unit: 'concurrency', limit: 5, partition_by: ['key'] });
    expect(teamSchema.safeParse({ ...values, limits: [{ ...atOnce, name: 'Bad' }] }).success).toBe(false);
  });

  it('sets access, labels and key lifetimes, keeping the rest of the key policy', () => {
    const values = teamValues(team(spec), 'default');
    const out = toTeamSpec(
      {
        ...values,
        models: '',
        denyModels: ['o1*'],
        tags: [],
        metadata: [{ key: 'tier', value: 'gold' }],
        maxKeyLifetime: '',
        defaultLifetime: '30d',
        rotationMaxAge: '180d',
      },
      spec,
    );
    expect(out.models).toBeUndefined();
    expect(out.deny_models).toEqual(['o1*']);
    expect(out.tags).toBeUndefined();
    expect(out.metadata).toEqual({ tier: 'gold' });
    expect(out.max_key_lifetime).toBeUndefined();
    expect(out.key_policy).toEqual({
      default_lifetime: '30d',
      rotation_max_age: '180d',
      reminder_days: [7, 1],
    });
  });

  it('keeps a token monthly budget in tokens and changes only its amount', () => {
    const values = teamValues(team(spec), 'default');
    expect(values.budgetUnit).toBe('tokens');
    expect(values.mode).toBe('kept');
    const out = toTeamSpec({ ...values, budget: '6000000' }, spec);
    expect(out.policies?.budgets?.monthly).toEqual({
      ...(spec.policies?.budgets?.monthly as object),
      amount: 6_000_000,
    });
  });

  it('declares a new monthly budget in dollars', () => {
    const values = { ...teamValues(undefined, 'acme'), name: 'new', budget: '300', mode: 'hard' as const };
    expect(toTeamSpec(values).policies?.budgets?.monthly).toEqual({
      unit: 'usd',
      amount: '300',
      period: 'monthly',
      mode: 'hard',
      alert_at: [0.5, 0.8, 1],
    });
  });

  it('reads a monthly budget without a mode as blocking', () => {
    const plain = { organization: 'acme', policies: { budgets: { monthly: { unit: 'usd', amount: '5' } } } };
    expect(teamValues(team(plain as TeamResource['spec']), 'acme').mode).toBe('hard');
  });
});

const project = (spec: ProjectResource['spec']): ProjectResource => ({ name: 'web', spec, metadata: meta });

describe('project form', () => {
  const spec: ProjectResource['spec'] = {
    team: 'core',
    enabled: true,
    tags: ['app:web'],
    allowed_ips: ['set:office'],
    max_key_lifetime: '30d',
    policies: {
      limits: { rpm: { unit: 'requests', limit: 10, per: '1s', burst: 3 } },
      budgets: { monthly: { unit: 'usd', amount: '50' } },
    },
  };

  it('saves a project unchanged when nothing was edited', () => {
    const values = projectValues(project(spec));
    expect(projectSchema.safeParse(values).success).toBe(true);
    expect(toProjectSpec(values, spec)).toEqual(spec);
  });

  it('moves a project to another team and turns it off', () => {
    const out = toProjectSpec({ ...projectValues(project(spec)), team: 'platform', enabled: false }, spec);
    expect(out).toEqual({ ...spec, team: 'platform', enabled: false });
    const back = toProjectSpec({ ...projectValues(project(out)), enabled: true }, out);
    expect(back.enabled).toBeUndefined();
  });
});

describe('organization access', () => {
  const spec: OrganizationResource['spec'] = {
    display_name: 'Acme',
    timezone: 'Europe/Lisbon',
    max_key_lifetime: '365d',
    providers: ['anthropic'],
    policies: { limits: { rpm: { unit: 'requests', limit: 100, per: '1m' } } },
  };

  it('writes only access and labels, keeping lifetimes and limits', () => {
    const values = tenantValues(spec);
    expect(tenantSchema.safeParse(values).success).toBe(true);
    expect(tenantSpec(values, spec)).toEqual(spec);
    const out = tenantSpec({ ...values, providers: [], regions: ['eu-west-1'], limits: [] }, spec);
    expect(out).toEqual({
      display_name: 'Acme',
      timezone: 'Europe/Lisbon',
      max_key_lifetime: '365d',
      regions: ['eu-west-1'],
      policies: spec.policies,
    });
  });
});

describe('tenancy facts', () => {
  it('names the nearest level that sets each key lifetime', () => {
    const inherited = inheritedKeyPolicy([
      { label: 'team core', spec: { key_policy: { rotation_max_age: '90d' } } },
      {
        label: 'organization acme',
        spec: { max_key_lifetime: '365d', key_policy: { rotation_max_age: '1y' } },
      },
    ]);
    expect(inherited).toEqual({
      maxKeyLifetime: { value: '365d', from: 'organization acme' },
      defaultLifetime: null,
      rotationMaxAge: { value: '90d', from: 'team core' },
    });
  });

  it('lists what a level sets, in words', () => {
    expect(
      tenantFacts({
        models: ['gpt-*'],
        allowed_ips: ['set:office', '10.0.0.1'],
        metadata: { a: 'b' },
        policies: { limits: { locked: ['x'], rpm: { unit: 'requests', limit: 1, per: '1s' } } },
      }),
    ).toEqual([
      { label: 'Models', value: 'gpt-*' },
      { label: 'IP addresses', value: 'office (set), 10.0.0.1' },
      { label: 'Metadata', value: 'a=b' },
      { label: 'Rate limits', value: 'rpm' },
    ]);
    expect(tenantFacts({})).toEqual([]);
  });

  it('counts the projects and keys a team disable stops', () => {
    const projects = [project({ team: 'core' }), { ...project({ team: 'other' }), name: 'api' }];
    const keys = [
      { name: 'k1', spec: { project: 'web' }, metadata: meta },
      { name: 'k2', spec: { project: 'api' }, metadata: meta },
    ];
    expect(cascadeOf('team', 'core', [], projects, keys as never)).toEqual({
      teams: [],
      projects: ['web'],
      keys: ['k1'],
    });
  });
});
