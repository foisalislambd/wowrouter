import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { useUi } from '@/stores/ui';
import { pickOption, signInAs } from '@/test/utils';

import { ProvidersScreen } from '../components/providers-screen';
import { EMPTY_PROVIDER, providerSchema, suggestName, toProviderSpec } from '../form';
import { keyState, latestTest, providerKeyStatus, rotation } from '../keys';
import { useProviderModels } from '../models';
import { useProviders } from '../store';

const TYPES = [
  {
    type: 'openai',
    core: true,
    default_base_url: 'https://api.openai.com/v1',
    dialects: ['openai_chat'],
    auth_methods: ['api_key'],
  },
  {
    type: 'bedrock',
    core: true,
    default_base_url: 'https://bedrock-runtime.{region}.amazonaws.com',
    dialects: ['bedrock_converse'],
    auth_methods: ['aws_sigv4', 'api_key'],
  },
  {
    type: 'openai_compatible',
    core: true,
    default_base_url: null,
    dialects: ['openai_chat'],
    auth_methods: ['api_key', 'none'],
  },
];

const meta = {
  etag: '"1"',
  generation: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  managed_by: 'api',
};

function handlers(providers: unknown[]) {
  server.use(
    http.get('*/admin/v1/providers', () => HttpResponse.json({ items: providers, next_cursor: null })),
    http.get('*/admin/v1/provider-types', () => HttpResponse.json({ items: TYPES, next_cursor: null })),
    http.get('*/admin/v1/runtime/providers', () => HttpResponse.json({ items: [], next_cursor: null })),
    http.get('*/admin/v1/deployments', () => HttpResponse.json({ items: [], next_cursor: null })),
    http.get('*/admin/v1/runtime/deployments', () => HttpResponse.json({ items: [], next_cursor: null })),
  );
}

function reset() {
  useProviders.setState({
    providers: emptySlot(),
    status: emptySlot(),
    types: emptySlot(),
    deployments: emptySlot(),
    health: emptySlot(),
    tests: {},
  });
  useProviderModels.setState({ byProvider: {}, resolved: {} });
}

describe('provider form', () => {
  it('suggests a free name for a type', () => {
    expect(suggestName('openai', [])).toBe('openai');
    expect(suggestName('openai', ['openai', 'openai-2'])).toBe('openai-3');
  });

  it('writes only what the operator set, with the type blocks it needs', () => {
    expect(toProviderSpec({ ...EMPTY_PROVIDER, type: 'openai', name: 'openai', apiKey: ' sk-1 ' })).toEqual({
      type: 'openai',
      auth: { method: 'api_key', api_key: 'sk-1' },
    });
    expect(
      toProviderSpec({
        ...EMPTY_PROVIDER,
        type: 'bedrock',
        name: 'b',
        method: 'aws_sigv4',
        region: 'us-east-1',
      }),
    ).toEqual({ type: 'bedrock', aws: { region: 'us-east-1' }, auth: { method: 'aws_sigv4' } });
  });

  it('asks for a base URL only when the type has no default, and for the key with api_key', () => {
    const compatible = TYPES[2];
    const result = providerSchema(compatible, ['taken']).safeParse({
      ...EMPTY_PROVIDER,
      type: 'openai_compatible',
      name: 'taken',
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join('.')) ?? [];
    expect(paths).toEqual(expect.arrayContaining(['name', 'baseUrl', 'apiKey']));
    expect(
      providerSchema(TYPES[0], []).safeParse({ ...EMPTY_PROVIDER, type: 'openai', name: 'o', apiKey: 'k' })
        .success,
    ).toBe(true);
  });
});

describe('Settings › Providers', () => {
  it('teaches the first step on a new gateway and adds a provider', async () => {
    reset();
    signInAs(['providers:read', 'providers:write', 'models:read']);
    handlers([]);
    let posted: unknown = null;
    server.use(
      http.post('*/admin/v1/providers', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          {
            name: 'openai',
            spec: { type: 'openai', auth: { api_key: '[REDACTED]' } },
            metadata: { ...meta, secret_hints: { 'auth.api_key': '…1234' } },
          },
          { status: 201 },
        );
      }),
    );
    render(<ProvidersScreen />);
    expect(await screen.findByText('No providers yet')).toBeInTheDocument();
    // The page header's primary action, and the empty state's.
    expect(screen.getAllByRole('button', { name: 'Add provider' })).toHaveLength(2);
    const [headerAdd] = screen.getAllByRole('button', { name: 'Add provider' });
    await userEvent.click(headerAdd ?? document.body);
    const drawer = screen.getByRole('dialog', { name: 'Add provider' });
    const save = () => within(drawer).getByRole('button', { name: 'Add provider' });
    expect(save()).toBeDisabled();
    await pickOption(await within(drawer).findByRole('combobox', { name: /^Provider/ }), 'OpenAI');
    expect(within(drawer).getByLabelText(/^Name/)).toHaveValue('openai');
    expect(within(drawer).getByText('Leave blank to use https://api.openai.com/v1.')).toBeInTheDocument();
    await userEvent.type(within(drawer).getByLabelText(/^API key/), 'sk-test-1234');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Test connection' }));
    expect(await within(drawer).findByText('Connected · 10 models · 412 ms')).toBeInTheDocument();
    await userEvent.click(save());
    expect(await screen.findByRole('table', { name: 'Providers' })).toBeInTheDocument();
    expect(posted).toEqual({
      name: 'openai',
      spec: { type: 'openai', auth: { method: 'api_key', api_key: 'sk-test-1234' } },
    });
    expect(screen.queryByRole('dialog', { name: 'Add provider' })).not.toBeInTheDocument();
    // The models the test listed are kept for the Add model form.
    expect(useProviderModels.getState().byProvider.openai?.list?.items).toHaveLength(10);
  });

  it('saves a new provider only after a test of exactly the current values passed', async () => {
    reset();
    signInAs(['providers:read', 'providers:write', 'models:read']);
    handlers([]);
    const tested: unknown[] = [];
    server.use(
      http.post(/\/admin\/v1\/providers:test$/, async ({ request }) => {
        tested.push(await request.json());
        const body = tested.at(-1) as { spec: { auth: { api_key: string } } };
        const bad = body.spec.auth.api_key.includes('bad');
        return HttpResponse.json({
          ok: !bad,
          method: 'list_models',
          status_code: bad ? 401 : 200,
          latency_ms: 120,
          error: bad ? 'Incorrect API key provided' : null,
          models: bad ? null : [],
          tested_at: '2026-10-17T12:00:00Z',
        });
      }),
    );
    render(<ProvidersScreen />);
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Add provider' }))[0] ?? document.body,
    );
    const drawer = screen.getByRole('dialog', { name: 'Add provider' });
    const save = () => within(drawer).getByRole('button', { name: 'Add provider' });
    const testButton = () => within(drawer).getByRole('button', { name: 'Test connection' });
    await pickOption(await within(drawer).findByRole('combobox', { name: /^Provider/ }), 'OpenAI');
    const key = within(drawer).getByLabelText(/^API key/);

    // Before a test: disabled.
    await userEvent.type(key, 'sk-bad-1');
    expect(save()).toBeDisabled();

    // A failed test keeps it disabled and says why in plain words, with the details behind a disclosure.
    await userEvent.click(testButton());
    expect(await within(drawer).findByText(/The provider refused the key/)).toBeInTheDocument();
    expect(within(drawer).getByText('Incorrect API key provided')).not.toBeVisible();
    await userEvent.click(within(drawer).getByText('Details'));
    expect(within(drawer).getByText('Incorrect API key provided')).toBeVisible();
    expect(save()).toBeDisabled();

    // A passing test of these values: enabled.
    await userEvent.clear(key);
    await userEvent.type(key, 'sk-good-1');
    await userEvent.click(testButton());
    expect(await within(drawer).findByText('Connected · 0 models · 120 ms')).toBeInTheDocument();
    expect(save()).toBeEnabled();
    expect(tested.at(-1)).toEqual({
      name: 'openai',
      spec: { type: 'openai', auth: { method: 'api_key', api_key: 'sk-good-1' } },
    });

    // Any change to what the test covers: disabled again until it is tested again.
    await userEvent.type(within(drawer).getByLabelText(/^Base URL/), 'https://eu.api.openai.com/v1');
    expect(save()).toBeDisabled();
    expect(within(drawer).getByText('Changed since the last test.')).toBeInTheDocument();
    await userEvent.clear(within(drawer).getByLabelText(/^Base URL/));
    expect(save()).toBeEnabled();
    // The name is not part of the connection: renaming keeps the test.
    await userEvent.type(within(drawer).getByLabelText(/^Name/), '-eu');
    expect(save()).toBeEnabled();
  });

  it('asks before turning a provider off, and the toast undoes it', async () => {
    reset();
    signInAs(['providers:read', 'providers:write', 'models:read']);
    handlers([{ name: 'openai', spec: { type: 'openai' }, metadata: meta }]);
    const patches: unknown[] = [];
    server.use(
      http.patch('*/admin/v1/providers/openai', async ({ request }) => {
        const body = (await request.json()) as { spec: { enabled: boolean } };
        patches.push(body.spec.enabled);
        return HttpResponse.json({ name: 'openai', spec: { type: 'openai', ...body.spec }, metadata: meta });
      }),
    );
    render(<ProvidersScreen />);
    await userEvent.click(await screen.findByRole('switch', { name: /openai/ }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn openai off?' });
    expect(patches).toEqual([]);
    expect(dialog).toHaveTextContent('No deployment uses it yet');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(patches).toEqual([false]));
    const toast = useUi.getState().toasts.find((t) => t.title === 'openai turned off');
    expect(toast?.action?.label).toBe('Undo');
    toast?.action?.onClick();
    await waitFor(() => expect(patches).toEqual([false, true]));
  });

  it('hides writes from a viewer', async () => {
    reset();
    signInAs(['providers:read']);
    handlers([{ name: 'openai', spec: { type: 'openai' }, metadata: meta }]);
    render(<ProvidersScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Providers' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Providers' });
    expect(within(table).getByText('openai', { selector: '.mono' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add provider' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /openai/ })).toBeDisabled();
  });

  it('keeps the providers on screen when a refresh fails, with a notice and no error state', async () => {
    reset();
    signInAs(['providers:read', 'providers:write', 'models:read']);
    handlers([{ name: 'openai', spec: { type: 'openai' }, metadata: meta }]);
    render(<ProvidersScreen />);
    await screen.findByRole('table', { name: 'Providers' });

    let calls = 0;
    server.use(
      http.get('*/admin/v1/providers', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ error: { code: 'unavailable', message: 'restarting' } }, { status: 503 })
          : HttpResponse.json({ items: [{ name: 'openai', spec: { type: 'openai' }, metadata: meta }] });
      }),
    );
    await act(() => useProviders.getState().load({ quiet: true }));

    const notice = await screen.findByText(/Couldn.t refresh providers/);
    expect(notice).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Providers' })).getByText('openai', { selector: '.mono' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Couldn.t load providers/)).not.toBeInTheDocument();
    expect(screen.queryByText('No providers yet')).not.toBeInTheDocument();

    // Try again refreshes; a success clears the notice.
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/Couldn.t refresh providers/)).not.toBeInTheDocument());
    expect(screen.getByRole('table', { name: 'Providers' })).toBeInTheDocument();
  });

  it('shows only the error state when the first load fails', async () => {
    reset();
    signInAs(['providers:read', 'providers:write', 'models:read']);
    handlers([]);
    server.use(
      http.get('*/admin/v1/providers', () =>
        HttpResponse.json({ error: { code: 'unavailable', message: 'restarting' } }, { status: 503 }),
      ),
    );
    render(<ProvidersScreen />);
    expect(await screen.findByText(/Couldn.t load providers/)).toBeInTheDocument();
    expect(screen.queryByText('No providers yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Providers' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn.t refresh/)).not.toBeInTheDocument();
  });
});

const DAY = 86_400_000;

describe('provider keys', () => {
  it('measures the oldest key against the rotation policy', () => {
    const p = {
      name: 'o',
      spec: { type: 'openai', credential_rotation_max_age: '30d' },
      metadata: {
        ...meta,
        credential_rotated_at: { a: '2026-01-01T00:00:00Z', b: '2026-01-20T00:00:00Z' },
        rotation_due: true,
      },
    };
    const r = rotation(p as never, Date.parse('2026-02-05T00:00:00Z'));
    expect(r).toEqual({ ageDays: 35, maxDays: 30, due: true });
    expect(rotation({ ...p, metadata: meta } as never, Date.now())).toBeNull();
    expect(Math.round((r?.ageDays ?? 0) * DAY)).toBe(35 * DAY);
  });

  it('says a key is not working when any deployment set it aside', () => {
    const health = [
      {
        name: 'd1',
        keys: [
          { key: 'a', scope_state: 'alive', pair_state: 'cooling', cooldown_until: '2026-01-01T00:01:00Z' },
        ],
      },
      {
        name: 'd2',
        keys: [
          {
            key: 'a',
            scope_state: 'dead',
            dead_reason: 'quota',
            recheck_at: '2026-01-01T01:00:00Z',
            pair_state: 'dead',
          },
        ],
      },
      {
        name: 'd3',
        keys: [
          { key: 'b', scope_state: 'alive', pair_state: 'alive', last_success_at: '2026-01-01T00:00:00Z' },
          { key: 'c', scope_state: 'alive', pair_state: 'alive', last_success_at: null },
        ],
      },
    ];
    expect(keyState('a', ['d1', 'd2'], health as never)).toEqual({
      state: 'not_working',
      reason: 'quota',
      until: '2026-01-01T01:00:00Z',
    });
    expect(keyState('a', ['d1'], health as never).state).toBe('resting');
    expect(keyState('b', ['d3'], health as never).state).toBe('working');
    expect(keyState('b', ['d3'], null).state).toBe('unknown');
    // Nothing failing is not evidence: a key that never answered is untested.
    expect(keyState('c', ['d3'], health as never).state).toBe('untested');
  });

  it('reads the key status from the latest test, stored by the gateway or run here', () => {
    const t = (ok: boolean, at: string) => ({
      ok,
      tested_at: `2026-10-17T${at}:00Z`,
      error: ok ? null : 'refused',
      method: 'list_models' as const,
    });
    expect(providerKeyStatus('valid', null)).toBe('untested');
    // A key that answered real requests works, even before anyone tests it.
    expect(providerKeyStatus('valid', null, true)).toBe('valid');
    expect(providerKeyStatus('valid', t(false, '10:00'), true)).toBe('failed');
    expect(providerKeyStatus('valid', t(true, '10:00'))).toBe('valid');
    expect(providerKeyStatus('valid', t(false, '10:00'))).toBe('failed');
    expect(providerKeyStatus('failed', t(true, '10:00'))).toBe('failed');
    expect(providerKeyStatus(undefined, null)).toBeUndefined();
    const status = {
      name: 'o',
      type: 'openai',
      tls_verify: true,
      credential: {
        method: 'api_key',
        state: 'failed' as const,
        last_test: { key: 'default', ...t(false, '10:00') },
      },
      tests: [{ key: 'default', ...t(false, '10:00') }],
    };
    expect(latestTest(status, undefined)?.ok).toBe(false);
    expect(latestTest(status, t(true, '11:00'))?.ok).toBe(true);
    expect(latestTest(status, t(true, '09:00'))?.ok).toBe(false);
  });
});

describe('Providers › keys and limits', () => {
  it('opens a provider with its tier, the age, limits and state of each key, and puts a key back in use', async () => {
    reset();
    signInAs(['providers:read', 'providers:write', 'models:read', 'health:read', 'health:write']);
    const now = new Date();
    const provider = {
      name: 'openai',
      spec: {
        type: 'openai',
        account_tier: 'Tier 4',
        credential_rotation_max_age: '30d',
        auth: {
          api_keys: [
            { name: 'primary', key: '[REDACTED]' },
            { name: 'backup', key: '[REDACTED]' },
          ],
        },
      },
      metadata: {
        ...meta,
        secret_hints: { 'auth.api_keys[0].key': '…0001', 'auth.api_keys[1].key': '…0002' },
        credential_rotated_at: {
          primary: new Date(now.getTime() - 40 * DAY).toISOString(),
          backup: new Date(now.getTime() - 2 * DAY).toISOString(),
        },
        rotation_due: true,
      },
    };
    handlers([provider]);
    const resets: string[] = [];
    server.use(
      http.get('*/admin/v1/runtime/providers', () =>
        HttpResponse.json({
          items: [
            {
              name: 'openai',
              type: 'openai',
              credential: { method: 'api_key', state: 'valid' },
              account_tier: 'Tier 4',
              rate_limits: null,
              credentials: [
                {
                  name: 'primary',
                  rate_limits: {
                    requests: { limit: 500, remaining: 120, reset_at: null },
                    observed_at: now.toISOString(),
                  },
                },
              ],
            },
          ],
          next_cursor: null,
        }),
      ),
      http.get('*/admin/v1/deployments', () =>
        HttpResponse.json({
          items: [{ name: 'gpt', spec: { provider: 'openai', model: 'gpt' }, metadata: meta }],
          next_cursor: null,
        }),
      ),
      http.get('*/admin/v1/runtime/deployments', () =>
        HttpResponse.json({
          items: [
            {
              name: 'gpt',
              state: 'closed',
              trips: 0,
              consecutive: 0,
              window: { requests: 1, failures: 0 },
              open_until: null,
              cooldown_until: null,
              disabled_until: null,
              keys: [
                { key: 'primary', scope_state: 'alive', pair_state: 'alive' },
                { key: 'backup', scope_state: 'dead', dead_reason: 'credential', pair_state: 'dead' },
              ],
            },
          ],
          next_cursor: null,
        }),
      ),
      http.post('*/admin/v1/runtime/providers/:provider/keys/:key', ({ params }) => {
        resets.push(`${String(params.provider)}/${String(params.key)}`);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(<ProvidersScreen />);
    const table = await screen.findByRole('table', { name: 'Providers' });
    expect(await within(table).findByText('40 days old')).toBeInTheDocument();
    expect(within(table).getByText('Replace now')).toBeInTheDocument();
    await userEvent.click(within(table).getByRole('row', { name: 'openai: keys and limits' }));
    const drawer = await screen.findByRole('dialog', { name: 'openai' });
    expect(within(drawer).getByLabelText(/^Account tier/)).toHaveValue('Tier 4');
    expect(within(drawer).getByRole('combobox', { name: 'Warn when a key is older than' })).toHaveTextContent(
      '30 days',
    );
    expect(within(drawer).getByText(/120 of 500 left/)).toBeInTheDocument();
    expect(within(drawer).getByText('Not working')).toBeInTheDocument();
    expect(within(drawer).getByText(/the provider refused it/)).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Use it again now' }));
    await waitFor(() => expect(resets).toEqual(['openai/backup:reset']));
  });
});

describe('providers', () => {
  it('tests a provider with no deployment, and the key status shows the outcome at once', async () => {
    reset();
    signInAs(['providers:read', 'providers:write', 'models:read']);
    handlers([{ name: 'lonely', spec: { type: 'openai', auth: { api_key: '[REDACTED]' } }, metadata: meta }]);
    let pass = true;
    let statusReads = 0;
    server.use(
      http.get('*/admin/v1/runtime/providers', () => {
        statusReads += 1;
        return HttpResponse.json({
          items: [
            {
              name: 'lonely',
              type: 'openai',
              credential: { method: 'api_key', state: 'valid' },
              tls_verify: true,
            },
          ],
          next_cursor: null,
        });
      }),
      http.post(/\/admin\/v1\/providers\/lonely:test$/, () =>
        HttpResponse.json({
          ok: pass,
          method: 'list_models',
          status_code: pass ? 200 : 401,
          latency_ms: 98,
          error: pass ? null : 'invalid_api_key',
          models: pass ? [] : null,
          tested_at: new Date().toISOString(),
        }),
      ),
    );
    render(<ProvidersScreen />);
    const table = await screen.findByRole('table', { name: 'Providers' });
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    expect(await within(table).findByText('Not tested yet')).toBeInTheDocument();
    const reads = statusReads;

    await userEvent.click(screen.getByRole('button', { name: 'Actions for lonely' }));
    const item = await screen.findByRole('menuitem', { name: /Test connection/ });
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(item);
    expect(await within(table).findByText('Working')).toBeInTheDocument();
    expect(useUi.getState().toasts.some((t) => t.title === 'lonely answered')).toBe(true);
    // The gateway's state is read again too.
    await waitFor(() => expect(statusReads).toBeGreaterThan(reads));

    pass = false;
    await userEvent.click(screen.getByRole('button', { name: 'Actions for lonely' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Test connection/ }));
    expect(await within(table).findByText('Failed')).toBeInTheDocument();
    expect(useUi.getState().toasts.some((t) => t.title === "lonely didn't pass the test")).toBe(true);
  });

  it('replaces a key only after the new key passed a test', async () => {
    reset();
    signInAs(['providers:read', 'providers:write', 'models:read']);
    handlers([{ name: 'openai', spec: { type: 'openai', auth: { api_key: '[REDACTED]' } }, metadata: meta }]);
    const tested: unknown[] = [];
    let rotated: unknown = null;
    server.use(
      http.post(/\/admin\/v1\/providers:test$/, async ({ request }) => {
        tested.push(await request.json());
        return HttpResponse.json({
          ok: true,
          method: 'list_models',
          status_code: 200,
          latency_ms: 50,
          error: null,
          models: [],
          tested_at: new Date().toISOString(),
        });
      }),
      http.post(/\/admin\/v1\/providers\/openai:rotate_credential$/, async ({ request }) => {
        rotated = await request.json();
        return HttpResponse.json({ name: 'openai', spec: { type: 'openai' }, metadata: meta });
      }),
    );
    render(<ProvidersScreen />);
    await screen.findByRole('table', { name: 'Providers' });
    await userEvent.click(screen.getByRole('button', { name: 'Actions for openai' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Replace API key/ }));
    const dialog = await screen.findByRole('alertdialog', { name: /Replace the API key of openai/ });
    const confirm = () => within(dialog).getByRole('button', { name: 'Replace key' });
    expect(confirm()).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('New API key'), 'sk-new-1');
    expect(confirm()).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Test the new key' }));
    expect(await within(dialog).findByText(/^Connected/)).toBeInTheDocument();
    expect(tested).toEqual([
      { name: 'openai', spec: { type: 'openai', auth: { method: 'api_key', api_key: 'sk-new-1' } } },
    ]);
    expect(confirm()).toBeEnabled();
    await userEvent.click(confirm());
    await waitFor(() => expect(rotated).toMatchObject({ credential: 'sk-new-1' }));
  });

  it('says what the base URL accepts', () => {
    const parse = (baseUrl: string) =>
      providerSchema(TYPES[2], []).safeParse({
        ...EMPTY_PROVIDER,
        type: 'openai_compatible',
        name: 'x',
        apiKey: 'k',
        baseUrl,
      });
    expect(parse('http://127.0.0.1:8080/v1').success).toBe(true);
    const bad = parse('ftp://x');
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe('Enter a URL that starts with https:// or http://');
  });
});
