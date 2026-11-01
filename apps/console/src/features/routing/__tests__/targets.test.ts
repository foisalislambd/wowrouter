import { describe, expect, it } from 'vitest';

import { validateRule } from '../components/rule-wizard';
import { blankDraft, describeDraft, draftFrom, toRule } from '../draft';
import { rulesOf, strategyOf } from '../types';

const rule = (target: unknown) => {
  const parsed = rulesOf({ type: 'conditional', rules: [{ name: 'r', target }] });
  const r = parsed?.rules[0];
  if (!r) throw new Error('no rule');
  return r;
};

describe('provider models, route references and request parameters in the wizard', () => {
  it('reads each new target kind and writes it back unchanged', () => {
    for (const target of [
      {
        type: 'provider_model',
        provider: 'openai',
        upstream_model: '{model}',
        tags: ['eu'],
        upstream_body: { store: false },
      },
      { route: 'shared-fast' },
      { type: 'route', route: 'shared-fast', policies: { resilience: { timeouts: { attempt: '5s' } } } },
      {
        type: 'deployment',
        deployment: 'dep-a',
        params: { set: { temperature: 0.2 }, remove: ['metadata.trace'] },
      },
      {
        type: 'fallback',
        children: ['dep-a', 'dep-b'],
        params: { remove: ['user'] },
      },
    ]) {
      const r = rule(target);
      expect(toRule(draftFrom(r))).toEqual({ name: 'r', target });
    }
    expect(strategyOf({ route: 'x' })).toBe('route');
    expect(strategyOf({ type: 'provider_model', provider: 'p', upstream_model: 'm' })).toBe('provider_model');
  });

  it('writes a new provider model and a route reference, and says them in words', () => {
    const pm = {
      ...blankDraft(),
      name: 'wild',
      conditions: [],
      strategy: 'provider_model' as const,
      providerModel: { provider: 'openai', upstreamModel: 'gpt-4o-mini' },
    };
    expect(toRule(pm).target).toEqual({
      type: 'provider_model',
      provider: 'openai',
      upstream_model: 'gpt-4o-mini',
    });
    expect(describeDraft(pm)).toBe('For every request, send the request to gpt-4o-mini at openai.');
    const ref = { ...pm, strategy: 'route' as const, routeRef: 'shared-fast' };
    expect(toRule(ref).target).toEqual({ type: 'route', route: 'shared-fast' });
    expect(describeDraft(ref)).toBe('For every request, hand the request to route shared-fast.');
  });

  it('turns a bare deployment into a node when it gets parameters', () => {
    const d = {
      ...draftFrom(rule('dep-a')),
      params: { set: '{"max_tokens": 512}', remove: [] },
    };
    expect(toRule(d).target).toEqual({
      type: 'deployment',
      deployment: 'dep-a',
      params: { set: { max_tokens: 512 } },
    });
    expect(toRule({ ...d, params: { set: '', remove: [] } }).target).toBe('dep-a');
  });

  it('checks the new target kinds and the parameters', () => {
    const base = { ...blankDraft(), name: 'r', conditions: [] };
    const locked = { when: false, targets: false };
    expect(validateRule({ ...base, strategy: 'provider_model' }, locked)).toMatchObject({
      'providerModel.provider': 'The provider’s name',
      'providerModel.upstreamModel': 'The provider’s id for the model',
    });
    expect(validateRule({ ...base, strategy: 'route' }, locked).routeRef).toBe('Choose the route');
    const params = validateRule(
      {
        ...base,
        targets: [{ deployment: 'dep-a', weight: 1, role: '' }],
        params: { set: '[1]', remove: ['.bad'] },
      },
      locked,
    );
    expect(params['params.set']).toBe('A JSON object, such as {"temperature": 0.2}');
    expect(params['params.remove']).toBe('“.bad” isn’t a dot path, such as metadata.trace');
  });
});
