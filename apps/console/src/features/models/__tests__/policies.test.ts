import { describe, expect, it } from 'vitest';

import type { ModelSpec } from '@/lib/api/types';

import { applyModelPolicies, fromModelPolicies, otherPolicies, policyErrors } from '../policies';

const spec: ModelSpec = {
  target: 'dep',
  policies: {
    limits: {
      rpm: { unit: 'requests', limit: 600, per: '1m', burst: 50, partition_by: ['key'] },
      daily: { unit: 'tokens', limit: 1_000_000, per: '1d' },
    },
    guardrails: { input: ['pii'], execution_order: 'sequential' },
    resilience: { retry: { max_attempts: 3, backoff: { initial: '250ms' } } },
    cache: { mode: 'exact' },
  } as ModelSpec['policies'],
};

describe('model policies', () => {
  it('sends untouched policies back as written', () => {
    expect(applyModelPolicies(spec, fromModelPolicies(spec))).toEqual(spec);
    const bare: ModelSpec = { target: 'dep' };
    expect(applyModelPolicies(bare, fromModelPolicies(bare))).toEqual(bare);
  });

  it('merges a new amount into the existing limit and adds new ones per minute', () => {
    const out = applyModelPolicies(spec, {
      ...fromModelPolicies(spec),
      rpm: '900',
      tpm: '200000',
      output: ['secrets'],
      maxAttempts: '',
      fallback: 'no',
    });
    expect(out.policies).toEqual({
      limits: {
        rpm: { unit: 'requests', limit: 900, per: '1m', burst: 50, partition_by: ['key'] },
        daily: { unit: 'tokens', limit: 1_000_000, per: '1d' },
        tpm: { unit: 'tokens', limit: 200_000, per: '1m' },
      },
      guardrails: { input: ['pii'], output: ['secrets'], execution_order: 'sequential' },
      resilience: { retry: { backoff: { initial: '250ms' }, fallback: false } },
      cache: { mode: 'exact' },
    });
  });

  it('leaves no empty policy behind when everything is cleared', () => {
    const only: ModelSpec = {
      target: 'dep',
      policies: { limits: { rpm: { unit: 'requests', limit: 5, per: '1m' } }, guardrails: { output: ['x'] } },
    };
    const out = applyModelPolicies(only, { ...fromModelPolicies(only), rpm: '', output: [] });
    expect(out).toEqual({ target: 'dep' });
  });

  it('lists what the page does not edit, and checks the numbers', () => {
    expect(otherPolicies(spec)).toEqual({
      limits: { daily: { unit: 'tokens', limit: 1_000_000, per: '1d' } },
      guardrails: { execution_order: 'sequential' },
      resilience: { retry: { backoff: { initial: '250ms' } } },
      cache: { mode: 'exact' },
    });
    expect(otherPolicies({ target: 'dep' })).toBeNull();
    expect(policyErrors({ ...fromModelPolicies(spec), rpm: '1.5', maxAttempts: '11' })).toEqual({
      rpm: expect.stringContaining('whole number') as string,
      maxAttempts: 'From 1 to 10 attempts',
    });
  });
});
