import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { signInAs } from '@/test/utils';

import { ProvidersScreen } from '../components/providers-screen';
import { useProviderModels } from '../models';
import { useProviders } from '../store';

const meta = {
  etag: '"1"',
  generation: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  managed_by: 'api',
};

const TYPES = [
  {
    type: 'openai',
    core: true,
    default_base_url: 'https://api.openai.com/v1',
    dialects: ['openai_chat'],
    auth_methods: ['api_key'],
  },
];

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function setup(provider: unknown, status: unknown = null, health: unknown[] = []) {
  useProviders.setState({
    providers: emptySlot(),
    status: emptySlot(),
    types: emptySlot(),
    deployments: emptySlot(),
    health: emptySlot(),
    tests: {},
    keyTests: {},
  });
  useProviderModels.setState({ byProvider: {}, resolved: {} });
  signInAs(['providers:read', 'providers:write', 'models:read', 'health:read', 'health:write']);
  server.use(
    http.get('*/admin/v1/providers', () => HttpResponse.json({ items: [provider], next_cursor: null })),
    http.get('*/admin/v1/provider-types', () => HttpResponse.json({ items: TYPES, next_cursor: null })),
    http.get('*/admin/v1/runtime/providers', () =>
      HttpResponse.json({ items: status ? [status] : [], next_cursor: null }),
    ),
    http.get('*/admin/v1/deployments', () =>
      HttpResponse.json({
        items:
          health.length > 0
            ? [{ name: 'gpt', spec: { provider: 'openai', model: 'gpt' }, metadata: meta }]
            : [],
        next_cursor: null,
      }),
    ),
    http.get('*/admin/v1/runtime/deployments', () =>
      HttpResponse.json({
        items: health.length > 0 ? [{ name: 'gpt', state: 'closed', keys: health }] : [],
        next_cursor: null,
      }),
    ),
    http.get('*/admin/v1/models', () => HttpResponse.json({ items: [], next_cursor: null })),
    http.get('*/admin/v1/routes', () => HttpResponse.json({ items: [], next_cursor: null })),
  );
  render(<ProvidersScreen />);
}

async function openDrawer() {
  const table = await screen.findByRole('table', { name: 'Providers' });
  await userEvent.click(within(table).getByRole('row', { name: 'openai: keys and limits' }));
  return screen.findByRole('dialog', { name: 'openai' });
}

const single = {
  name: 'openai',
  spec: { type: 'openai', auth: { method: 'api_key', api_key: '[REDACTED]' } },
  metadata: { ...meta, secret_hints: { 'auth.api_key': '…1234' } },
};

describe('Providers › edit a provider', () => {
  it('adds a second key after a passing test, turning the one key into a weighted list', async () => {
    let patched: { body: unknown; ifMatch: string | null } | null = null;
    server.use(
      http.patch('*/admin/v1/providers/openai', async ({ request }) => {
        patched = { body: await request.json(), ifMatch: request.headers.get('if-match') };
        return HttpResponse.json({
          name: 'openai',
          spec: {
            type: 'openai',
            auth: {
              method: 'api_key',
              api_keys: [
                { name: 'default', key: '[REDACTED]', weight: 3 },
                { name: 'key-2', key: '[REDACTED]', weight: 1 },
              ],
            },
          },
          metadata: {
            ...meta,
            etag: '"2"',
            secret_hints: { 'auth.api_keys[0].key': '…1234', 'auth.api_keys[1].key': '…-two' },
          },
        });
      }),
    );
    setup(single);
    const drawer = await openDrawer();
    const save = () => within(drawer).getByRole('button', { name: 'Save changes' });
    expect(save()).toBeDisabled();
    // One key: no names or weights to edit yet.
    expect(within(drawer).queryByLabelText('Weight')).not.toBeInTheDocument();

    await userEvent.click(within(drawer).getByRole('button', { name: 'Add key' }));
    expect(within(drawer).getByText('New key')).toBeInTheDocument();
    await userEvent.type(within(drawer).getByLabelText(/^API key/), 'sk-two');
    // A new key saves only after its test passed.
    expect(save()).toBeDisabled();
    const [firstWeight] = within(drawer).getAllByRole('spinbutton', { name: 'Weight' });
    await userEvent.clear(firstWeight ?? document.body);
    await userEvent.type(firstWeight ?? document.body, '3');
    expect(within(drawer).getByText('75% of requests')).toBeInTheDocument();
    expect(within(drawer).getByText('25% of requests')).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Test this key' }));
    expect(await within(drawer).findByText(/^Connected/)).toBeInTheDocument();
    expect(save()).toBeEnabled();

    await userEvent.click(save());
    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched).toEqual({
      ifMatch: '"1"',
      body: {
        spec: {
          auth: {
            api_key: null,
            api_keys: [
              { name: 'default', key: '[REDACTED]', weight: 3 },
              { name: 'key-2', key: 'sk-two', weight: 1 },
            ],
          },
        },
      },
    });
    expect(await within(drawer).findByText('Keys (2)')).toBeInTheDocument();
  });

  it('keeps a failed new key from being saved, and a provider keeps at least one key', async () => {
    setup(single);
    const drawer = await openDrawer();
    expect(within(drawer).getByRole('button', { name: 'Remove' })).toBeDisabled();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Add key' }));
    await userEvent.type(within(drawer).getByLabelText(/^API key/), 'sk-bad-2');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Test this key' }));
    expect(await within(drawer).findByText(/The provider refused the key/)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('shows each key’s state: working, cooling down, failed its test, not tested yet', async () => {
    const provider = {
      name: 'openai',
      spec: {
        type: 'openai',
        auth: {
          method: 'api_key',
          api_keys: [
            { name: 'primary', key: '[REDACTED]' },
            { name: 'backup', key: '[REDACTED]' },
            { name: 'burst', key: '[REDACTED]' },
            { name: 'fresh', key: '[REDACTED]', weight: 0 },
          ],
        },
      },
      metadata: meta,
    };
    const test = (key: string, ok: boolean, at: string) => ({
      key,
      ok,
      method: 'list_models',
      tested_at: at,
      error: ok ? null : 'Incorrect API key provided',
    });
    const status = {
      name: 'openai',
      type: 'openai',
      tls_verify: true,
      credential: { method: 'api_key', state: 'valid', last_test: test('primary', true, minutesAgo(1)) },
      tests: [
        test('primary', true, minutesAgo(1)),
        test('backup', false, minutesAgo(5)),
        test('burst', true, minutesAgo(9)),
      ],
    };
    const health = [
      { key: 'primary', scope_state: 'alive', pair_state: 'alive' },
      { key: 'backup', scope_state: 'alive', pair_state: 'alive' },
      {
        key: 'burst',
        scope_state: 'alive',
        pair_state: 'cooling',
        cooldown_until: new Date(Date.now() + 120_000).toISOString(),
      },
    ];
    setup(provider, status, health);
    // The table reads the stored test: Working, not "Not tested yet".
    const table = await screen.findByRole('table', { name: 'Providers' });
    expect(await within(table).findByText('Working')).toBeInTheDocument();
    expect(within(table).queryByText('Not tested yet')).not.toBeInTheDocument();

    const drawer = await openDrawer();
    const card = (name: string) => {
      const item = within(drawer)
        .getAllByRole('listitem')
        .find((li) => li.querySelector('.mono')?.textContent === name);
      if (!item) throw new Error(`no key ${name}`);
      return within(item);
    };
    expect(card('primary').getByText('Working')).toBeInTheDocument();
    expect(card('backup').getByText('Not working')).toBeInTheDocument();
    expect(card('backup').getByText(/its last test failed/)).toBeInTheDocument();
    expect(card('burst').getByText('Cooling down')).toBeInTheDocument();
    expect(card('burst').getByText(/Used again in/)).toBeInTheDocument();
    expect(card('fresh').getByText('Not tested yet')).toBeInTheDocument();
    expect(card('fresh').getByText('Standby: takes no requests')).toBeInTheDocument();
    expect(card('primary').getByText('33% of requests')).toBeInTheDocument();
  });

  it('asks for a key to test a changed base URL, and saves only the settings that changed', async () => {
    let patched: unknown = null;
    const tested: unknown[] = [];
    server.use(
      http.post(/\/admin\/v1\/providers:test$/, async ({ request }) => {
        tested.push(await request.json());
        return HttpResponse.json({
          ok: true,
          method: 'list_models',
          status_code: 200,
          latency_ms: 80,
          error: null,
          models: [],
          tested_at: new Date().toISOString(),
        });
      }),
      http.patch('*/admin/v1/providers/openai', async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ ...single, metadata: { ...meta, etag: '"2"' } });
      }),
    );
    setup(single);
    const drawer = await openDrawer();
    await userEvent.type(within(drawer).getByLabelText(/^Account tier/), 'Tier 5');
    await userEvent.type(within(drawer).getByLabelText(/^Base URL/), 'https://eu.api.openai.com/v1');
    expect(within(drawer).getByText(/won’t send the saved key to the new address/)).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: 'Test these settings' })).toBeDisabled();
    await userEvent.type(within(drawer).getByLabelText(/^API key for the test/), 'sk-eu');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Test these settings' }));
    expect(await within(drawer).findByText(/^Connected/)).toBeInTheDocument();
    expect(tested).toEqual([
      {
        name: 'openai',
        spec: {
          type: 'openai',
          account_tier: 'Tier 5',
          base_url: 'https://eu.api.openai.com/v1',
          auth: { method: 'api_key', api_key: 'sk-eu' },
        },
      },
    ]);
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(patched).toEqual({ spec: { account_tier: 'Tier 5', base_url: 'https://eu.api.openai.com/v1' } }),
    );
  });
});
