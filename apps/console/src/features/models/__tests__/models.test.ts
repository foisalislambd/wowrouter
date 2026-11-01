import { describe, expect, it } from 'vitest';

import type { RouteResource } from '@/lib/api/types';

import { addModelSchema, applyModelEdit, deploymentNameFor, EMPTY_ADD_MODEL, fromModelSpec } from '../form';
import { collectLeaves, fallbackChain, modalityOf } from '../types';
import { paramCount, paramRows, paramsError, paramsOf, withAlias } from '../components/alias-dialog';

const routes = new Map<string, RouteResource>([
  [
    'shared',
    {
      name: 'shared',
      spec: { tree: { type: 'fallback', children: ['b', { deployment: 'c' }] } },
      metadata: { etag: '', generation: 1, created_at: '', updated_at: '', managed_by: 'api' },
    },
  ],
]);

describe('route trees', () => {
  it('collects every reachable deployment, following routes', () => {
    expect(collectLeaves('a', routes)).toEqual(['a']);
    expect(
      collectLeaves(
        { type: 'weighted', children: [{ deployment: 'a', weight: 2 }, { route: 'shared' }] },
        routes,
      ),
    ).toEqual(['a', 'b', 'c']);
  });
  it('reads the fallback chain of a fallback root', () => {
    expect(fallbackChain({ type: 'fallback', children: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(fallbackChain('a')).toBeNull();
  });
  it('derives the modality from operations', () => {
    expect(modalityOf(['generate', 'embed'])).toBe('chat');
    expect(modalityOf(['embed'])).toBe('embeddings');
  });
});

describe('model forms', () => {
  it('names deployments from provider and upstream id', () => {
    expect(deploymentNameFor('openai', 'gpt-4o-2024-08-06')).toBe('openai-gpt-4o-2024-08-06');
  });
  it('requires both prices or neither', () => {
    const v = { ...EMPTY_ADD_MODEL, name: 'm', provider: 'p', upstreamModel: 'x', inputPrice: '1' };
    expect(addModelSchema.safeParse(v).success).toBe(false);
    expect(addModelSchema.safeParse({ ...v, outputPrice: '2' }).success).toBe(true);
  });
  it('keeps the tree and aliases when editing', () => {
    const spec = { target: 'dep', aliases: { fast: {} }, tier: 'fast', display_name: 'Old' };
    const edited = applyModelEdit(spec, {
      ...fromModelSpec(spec),
      displayName: 'New',
      lifecycle: 'deprecated',
      eolAt: '2026-12-31',
    });
    expect(edited.target).toBe('dep');
    expect(edited.aliases).toEqual({ fast: {} });
    expect(edited.display_name).toBe('New');
    expect(edited.lifecycle).toEqual({ state: 'deprecated', eol_at: '2026-12-31T00:00:00Z' });
  });
});

describe('model edits beyond the basics', () => {
  const spec = {
    target: 'dep',
    tier: 'fast',
    visibility: 'internal' as const,
    catalog: { family: 'luna', version: '6', released_at: '2026-09-01' },
    owned_by: 'platform',
    annotations: { runbook: 'https://wiki/luna' },
    aliases: { chat: { params: { set: { temperature: '0.2' }, remove: ['metadata.user'] } } },
  };

  it('sends listing, catalog, owner and annotations back as they were when untouched', () => {
    expect(applyModelEdit(spec, fromModelSpec(spec))).toEqual({ ...spec, lifecycle: { state: 'ga' } });
  });

  it('writes the listing, catalog and annotations typed in the form', () => {
    const out = applyModelEdit(spec, {
      ...fromModelSpec(spec),
      visibility: 'public',
      version: '',
      revision: 'r2',
      ownedBy: '',
      annotations: [
        { key: 'runbook', value: 'https://wiki/luna-6' },
        { key: 'cost_centre', value: 'ml' },
      ],
    });
    expect(out.visibility).toBeUndefined();
    expect(out.catalog).toEqual({ family: 'luna', revision: 'r2', released_at: '2026-09-01' });
    expect(out.owned_by).toBeUndefined();
    expect(out.annotations).toEqual({ runbook: 'https://wiki/luna-6', cost_centre: 'ml' });
  });

  it('keeps an alias’s parameters as written, and writes typed ones as JSON or text', () => {
    // A string that reads as a number stays a string when the parameters are left alone.
    expect(withAlias(spec, 'chat', 'chat', { description: '', owner: '' }).aliases?.chat).toEqual(
      spec.aliases.chat,
    );
    const rows = paramRows(spec.aliases.chat.params);
    expect(rows).toEqual([{ key: 'temperature', value: '0.2' }]);
    const params = paramsOf(
      [...rows, { key: 'response_format', value: '{"type":"json_object"}' }, { key: 'user', value: 'ops' }],
      [],
    );
    expect(params).toEqual({
      set: { temperature: 0.2, response_format: { type: 'json_object' }, user: 'ops' },
    });
    expect(
      withAlias(spec, 'chat', 'chat', { description: '', owner: '', params: { value: undefined } }).aliases
        ?.chat,
    ).toEqual({});
    expect(paramCount(spec.aliases.chat.params)).toBe(2);
    expect(
      paramsError(
        [
          { key: 'a', value: '1' },
          { key: 'a', value: '2' },
        ],
        [],
      ),
    ).toBe('a is set twice');
    expect(paramsError([], ['metadata user'])).toMatch(/no spaces/);
  });
});
