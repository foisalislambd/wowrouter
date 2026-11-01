import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { DeploymentResource, DeploymentSpec } from '@/lib/api/types';
import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { signInAs } from '@/test/utils';

import { DeploymentDrawer } from '../components/deployment-drawer';
import { deploymentErrors, fromDeploymentSpec, toDeploymentSpec } from '../deployment-form';
import { overridePrice, useCatalog } from '../store';

const meta = {
  etag: '"d7"',
  generation: 7,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  managed_by: 'api' as const,
};

/** A deployment with every group set, including members the editor doesn't show. */
const full: DeploymentSpec = {
  provider: 'vertex-eu',
  model: 'claude-sonnet-4@20250514',
  base_model: 'claude-sonnet-4',
  enabled: false,
  region: 'europe-west4',
  location: 'europe-west4',
  vertex: { publisher: 'anthropic' },
  default_max_tokens: 8192,
  byok: 'allowed',
  headers: { 'anthropic-beta': 'context-1m', 'x-secret': '[REDACTED]' },
  params: {
    remove: ['/logprobs'],
    defaults: { '/temperature': 0.2 },
    overrides: { '/metadata/source': 'gateway' },
  },
  capabilities: {
    vision: true,
    reasoning: false,
    context_window: 1_000_000,
    dialects: ['anthropic_messages'],
    tool_name_max_len: 64,
  },
  limits: {
    rpm: { unit: 'requests', limit: 600, per: '1m', algorithm: 'sliding_window', partition_by: ['key'] },
    inflight: { unit: 'concurrency', limit: 20 },
  },
  price: {
    input: '3',
    output: '15',
    cache_read: '0.3',
    per_request: '0.001',
    tiers: [{ above_input_tokens: 200_000, input: '6', output: '22.5' }],
    batch_multiplier: '0.5',
  },
};

describe('deployment form', () => {
  it('sends an untouched spec back exactly as it was read, in either price unit', () => {
    for (const unit of ['1M', '1K'] as const) {
      const values = fromDeploymentSpec(full, unit, 'claude-eu');
      expect(toDeploymentSpec(full, values, unit)).toEqual(full);
      expect(deploymentErrors(values, false)).toEqual({});
    }
    const bare: DeploymentSpec = { provider: 'openai', model: 'gpt-6-luna' };
    expect(toDeploymentSpec(bare, fromDeploymentSpec(bare, '1M'), '1M')).toEqual(bare);
  });

  it('changes only the members of the fields edited, keeping what the form does not show', () => {
    const values = fromDeploymentSpec(full, '1K');
    values.model = 'claude-sonnet-5@20260101';
    values.enabled = true;
    values.flags.vision = 'inherit';
    values.flags.tools = 'yes';
    values.limits = values.limits.map((l) => (l.name === 'rpm' ? { ...l, limit: '900' } : l));
    // Typed per 1K tokens; written per 1M.
    values.price.input = '0.0035';
    values.price.cache_read = '';
    const out = toDeploymentSpec(full, values, '1K');
    expect(out.model).toBe('claude-sonnet-5@20260101');
    expect(out.enabled).toBeUndefined();
    expect(out.capabilities).toEqual({
      reasoning: false,
      context_window: 1_000_000,
      dialects: ['anthropic_messages'],
      tool_name_max_len: 64,
      tools: true,
    });
    expect(out.limits).toEqual({
      rpm: { unit: 'requests', limit: 900, per: '1m', algorithm: 'sliding_window', partition_by: ['key'] },
      inflight: { unit: 'concurrency', limit: 20 },
    });
    expect(out.price).toEqual({
      input: '3.5',
      output: '15',
      per_request: '0.001',
      tiers: [{ above_input_tokens: 200_000, input: '6', output: '22.5' }],
      batch_multiplier: '0.5',
    });
    // Untouched groups are the same objects' values.
    expect(out.headers).toEqual(full.headers);
    expect(out.params).toEqual(full.params);
    expect(out.vertex).toEqual(full.vertex);
  });

  it('says what to fix before saving', () => {
    const values = fromDeploymentSpec(full, '1M');
    values.model = ' ';
    values.paramsDefaults = '{"/model": "x"}';
    values.limits = [
      ...values.limits,
      { original: '', name: 'rpm', unit: 'tokens', limit: 'x', per: '', burst: '' },
    ];
    values.price.output = 'free';
    expect(deploymentErrors(values, false)).toEqual({
      model: expect.stringContaining('model ID') as string,
      paramsDefaults: expect.stringContaining('/model') as string,
      'limits.2.name': 'Two limits have this name',
      'limits.2.limit': expect.stringContaining('whole number') as string,
      'limits.2.per': expect.stringContaining('duration') as string,
      'price.output': expect.stringContaining('US dollars') as string,
    });
  });
});

function setup(spec: DeploymentSpec = full) {
  signInAs(['models:read', 'deployments:write', 'providers:read']);
  const deployment: DeploymentResource = { name: 'claude-eu', spec, metadata: meta };
  useCatalog.setState({
    providers: {
      data: [{ name: 'vertex-eu', spec: { type: 'vertex' }, metadata: meta }],
      status: 'ready',
      error: null,
      at: Date.now(),
    },
    deployments: { data: [deployment], status: 'ready', error: null, at: Date.now() },
    prices: {},
    capabilities: {},
    tiers: emptySlot(),
  });
  const puts: { body: unknown; ifMatch: string | null }[] = [];
  server.use(
    http.put('*/admin/v1/deployments/:name', async ({ request }) => {
      const body = (await request.json()) as { spec: DeploymentSpec };
      puts.push({ body, ifMatch: request.headers.get('if-match') });
      return HttpResponse.json({ name: 'claude-eu', spec: body.spec, metadata: { ...meta, etag: '"d8"' } });
    }),
    http.get('*/admin/v1/pricing/deployments/:name', () => HttpResponse.json({}, { status: 404 })),
    http.get('*/admin/v1/deployments/:name/capabilities', () => HttpResponse.json({}, { status: 404 })),
  );
  let closed = false;
  render(<DeploymentDrawer deployment={deployment} onClose={() => (closed = true)} />);
  return { drawer: screen.getByRole('dialog', { name: 'Edit claude-eu' }), puts, closed: () => closed };
}

describe('deployment drawer', () => {
  it('shows every field from the spec and saves an edit over it with the ETag', async () => {
    const { drawer, puts, closed } = setup();
    expect(within(drawer).getByLabelText(/^Provider’s model ID/)).toHaveValue('claude-sonnet-4@20250514');
    expect(within(drawer).getByLabelText(/^Region/)).toHaveValue('europe-west4');
    expect(within(drawer).getByLabelText(/^Location/)).toHaveValue('europe-west4');
    expect(within(drawer).getByLabelText(/^Default max tokens/)).toHaveValue('8192');
    expect(within(drawer).getByRole('switch', { name: 'Serves requests' })).not.toBeChecked();
    expect(within(drawer).getByLabelText('Header 1 value')).toHaveValue('context-1m');
    expect(within(drawer).getByLabelText('Header 2 value')).toHaveAttribute(
      'placeholder',
      'Stored, hidden. Type to replace',
    );
    expect(within(drawer).getByText(/2 more set in the configuration are kept/)).toBeInTheDocument();

    const tokens = within(drawer).getByLabelText(/^Default max tokens/);
    await userEvent.clear(tokens);
    await userEvent.type(tokens, '16000');
    await userEvent.click(within(drawer).getByRole('switch', { name: 'Serves requests' }));
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.ifMatch).toBe('"d7"');
    const { enabled: _e, ...rest } = full;
    expect(puts[0]?.body).toEqual({ spec: { ...rest, default_max_tokens: 16000 } });
    await waitFor(() => expect(closed()).toBe(true));
    expect(useCatalog.getState().deployments.data?.[0]?.metadata.etag).toBe('"d8"');
  });

  it('keeps the drawer open and says what to fix', async () => {
    const { drawer, puts } = setup();
    await userEvent.clear(within(drawer).getByLabelText(/^Provider’s model ID/));
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save changes' }));
    expect(await within(drawer).findByText(/Enter the model ID the provider uses/)).toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });
});

describe('price override', () => {
  it('merges the rates typed and removes the ones cleared', async () => {
    signInAs(['models:read', 'deployments:write']);
    const deployment: DeploymentResource = {
      name: 'luna',
      spec: {
        provider: 'openai',
        model: 'gpt-6-luna',
        price: { input: '1', output: '2', cache_read: '0.1' },
      },
      metadata: meta,
    };
    useCatalog.setState({
      deployments: { data: [deployment], status: 'ready', error: null, at: Date.now() },
      prices: {},
    });
    const patches: unknown[] = [];
    server.use(
      http.patch('*/admin/v1/deployments/:name', async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json({ ...deployment, metadata: { ...meta, etag: '"d8"' } });
      }),
      http.get('*/admin/v1/pricing/deployments/:name', () => HttpResponse.json({}, { status: 404 })),
    );
    await overridePrice('luna', { input: '1.5', output: '2', cache_read: null, reasoning: '4' });
    expect(patches).toEqual([
      { spec: { price: { input: '1.5', output: '2', cache_read: null, reasoning: '4' } } },
    ]);
  });
});
