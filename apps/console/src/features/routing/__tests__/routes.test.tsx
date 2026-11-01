import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { DeploymentResource, RouteResource } from '@/lib/api/types';
import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { pickOption, signInAs } from '@/test/utils';

import { DefaultTargetDrawer, NewRouteDrawer, RouteSettingsDrawer } from '../components/route-drawer';
import { RuleWizard } from '../components/rule-wizard';
import {
  mergePatchOf,
  otherPolicies,
  routeSettingsErrors,
  routeSettingsForm,
  routeSettingsSpec,
} from '../route-form';
import { useRouting } from '../store';

const WRITER = ['models:read', 'models:write', 'policies:read'];
const META = { etag: '"r1"', generation: 1, created_at: '', updated_at: '', managed_by: 'api' as const };

const ready = <T,>(data: T) => ({ data, status: 'ready' as const, error: null, at: Date.now() });

function deployment(name: string, provider: string, model: string): DeploymentResource {
  return { name, spec: { provider, model }, metadata: META };
}

function route(name: string, spec: Record<string, unknown>): RouteResource {
  return { name, spec, metadata: META } as RouteResource;
}

function seed(routes: RouteResource[] = []) {
  useRouting.setState({
    routes: ready(routes),
    deployments: ready([deployment('dep-a', 'openai', 'gpt-4o'), deployment('dep-b', 'anthropic', 'haiku')]),
    tiers: ready([]),
    guardrails: ready(['pii', 'secrets', 'toxicity']),
    simulation: emptySlot(),
  });
}

/** Records the route writes and answers them with the written route. */
function routeWrites() {
  const box: {
    created: { name: string; spec: unknown } | null;
    put: { name: string; spec: unknown } | null;
    patched: { name: string; spec: unknown } | null;
    ifMatch: string | null;
  } = { created: null, put: null, patched: null, ifMatch: null };
  server.use(
    http.post('*/admin/v1/routes', async ({ request }) => {
      const body = (await request.json()) as { name: string; spec: Record<string, unknown> };
      box.created = body;
      return HttpResponse.json(route(body.name, body.spec), { status: 201 });
    }),
    http.put('*/admin/v1/routes/:name', async ({ request, params }) => {
      const body = (await request.json()) as { spec: Record<string, unknown> };
      box.put = { name: String(params.name), spec: body.spec };
      box.ifMatch = request.headers.get('if-match');
      return HttpResponse.json(route(String(params.name), body.spec));
    }),
    http.patch('*/admin/v1/routes/:name', async ({ request, params }) => {
      const body = (await request.json()) as { spec: Record<string, unknown> };
      box.patched = { name: String(params.name), spec: body.spec };
      box.ifMatch = request.headers.get('if-match');
      return HttpResponse.json(route(String(params.name), { tree: 'dep-a' }));
    }),
  );
  return box;
}

describe('route settings form', () => {
  const full = {
    tree: { type: 'conditional', rules: [{ name: 'a', target: 'dep-a' }], default: 'dep-b' },
    enabled: false,
    affinity: {
      session: true,
      mode: 'strict' as const,
      sources: ['header:x-session', 'body:metadata.user_id'],
      prompt_prefix: false,
      scope: 'key' as const,
      ttl: '2h',
    },
    tag_filter: { enabled: true, default_tag: 'gold' },
    on_all_unhealthy: 'reject' as const,
    policies: {
      limits: {
        rpm: { unit: 'requests', limit: 600, per: '1m', algorithm: 'sliding_window' },
        tpm: { unit: 'tokens', limit: 90000, per: '1m' },
        inflight: { unit: 'concurrency', limit: 20 },
      },
      guardrails: { input: ['pii'], output: ['toxicity'], exclude: ['secrets'] },
      resilience: { retry: { max_attempts: 3, fallback: false, backoff: { initial: '1s' } } },
      cache: { enabled: true },
    },
  };

  it('reads a spec into the form and writes the same spec back, untouched', () => {
    for (const spec of [full, { tree: 'dep-a' }, { tree: 'dep-a', affinity: { session: true } }]) {
      const out = routeSettingsSpec(spec as never, routeSettingsForm(spec as never));
      expect(out).toEqual(spec);
      expect(mergePatchOf(spec, out)).toEqual({});
    }
  });

  it('writes only what changed, as a merge patch that keeps a limit’s other settings', () => {
    const form = {
      ...routeSettingsForm(full as never),
      enabled: true,
      mode: 'prefer' as const,
      sources: [],
      ttl: '',
      tagFilter: false,
      onAllUnhealthy: '' as const,
      rpm: '1200',
      tpm: '',
      guardIn: ['pii', 'secrets'],
      maxAttempts: '',
      fallback: true,
    };
    expect(mergePatchOf(full, routeSettingsSpec(full as never, form))).toEqual({
      enabled: null,
      affinity: { mode: null, sources: null, ttl: null },
      tag_filter: { enabled: null },
      on_all_unhealthy: null,
      policies: {
        limits: { rpm: { limit: 1200 }, tpm: null },
        guardrails: { input: ['pii', 'secrets'] },
        resilience: { retry: { max_attempts: null, fallback: null } },
      },
    });
  });

  it('adds new settings with the gateway’s defaults left out', () => {
    const spec = { tree: 'dep-a' };
    const form = {
      ...routeSettingsForm(spec),
      session: false,
      tagFilter: true,
      defaultTag: 'eu',
      rpm: '100',
      guardOut: ['toxicity'],
      maxAttempts: '2',
    };
    expect(routeSettingsSpec(spec as never, form)).toEqual({
      tree: 'dep-a',
      affinity: { session: false },
      tag_filter: { enabled: true, default_tag: 'eu' },
      policies: {
        limits: { rpm: { unit: 'requests', per: '1m', limit: 100 } },
        guardrails: { output: ['toxicity'] },
        resilience: { retry: { max_attempts: 2 } },
      },
    });
  });

  it('shows the policies it does not edit, as written', () => {
    expect(otherPolicies(full.policies)).toEqual({
      limits: { inflight: { unit: 'concurrency', limit: 20 } },
      guardrails: { exclude: ['secrets'] },
      resilience: { retry: { backoff: { initial: '1s' } } },
      cache: { enabled: true },
    });
    expect(otherPolicies({ limits: { rpm: { unit: 'requests', limit: 1, per: '1m' } } })).toBeNull();
  });

  it('checks session places, the binding time, the tag and the numbers', () => {
    const base = routeSettingsForm({ tree: 'dep-a' });
    expect(
      routeSettingsErrors({
        ...base,
        sources: ['cookie:x'],
        ttl: '45d',
        tagFilter: true,
        defaultTag: 'has space',
        rpm: '1.5',
        maxAttempts: '11',
      }),
    ).toEqual({
      sources: '“cookie:x” isn’t header:<name> or body:<path>',
      ttl: 'From 1s to 30d, e.g. 1h',
      defaultTag: 'Letters, digits, :, _, . and -, up to 64 characters',
      rpm: 'A whole number, or empty for no limit',
      maxAttempts: 'From 1 to 10',
    });
    expect(routeSettingsErrors({ ...base, sources: ['header:x-session'], ttl: '1h' })).toEqual({});
  });
});

describe('creating routes', () => {
  it('creates a route with one strategy by POST, under the chosen name', async () => {
    signInAs(WRITER);
    seed([route('global', { tree: 'dep-a' })]);
    const box = routeWrites();
    const created = vi.fn();
    render(
      <NewRouteDrawer taken={['global']} onClose={() => undefined} onRules={vi.fn()} onCreated={created} />,
    );
    const user = userEvent.setup();
    const drawer = await screen.findByRole('dialog', { name: 'New route' });
    await user.type(within(drawer).getByLabelText(/Name/), 'global');
    await user.click(within(drawer).getByRole('radio', { name: 'With one strategy' }));
    await user.click(within(drawer).getByRole('button', { name: 'Create route' }));
    expect(await within(drawer).findByText('Route global already exists')).toBeInTheDocument();
    expect(box.created).toBeNull();

    await user.clear(within(drawer).getByLabelText(/Name/));
    await user.type(within(drawer).getByLabelText(/Name/), 'wp2-fast');
    await pickOption(within(drawer).getByLabelText('Strategy'), 'Try primary, then fall back');
    await pickOption(within(drawer).getByLabelText('Deployment 1'), /dep-a/);
    await user.click(within(drawer).getByRole('button', { name: 'Add deployment' }));
    await pickOption(within(drawer).getByLabelText('Deployment 2'), /dep-b/);
    await user.click(within(drawer).getByRole('button', { name: 'Create route' }));
    await waitFor(() => expect(box.created).not.toBeNull());
    expect(box.created).toEqual({
      name: 'wp2-fast',
      spec: { tree: { type: 'fallback', children: ['dep-a', 'dep-b'] } },
    });
    expect(created).toHaveBeenCalledWith('wp2-fast');
    expect(useRouting.getState().routes.data?.map((r) => r.name)).toEqual(['global', 'wp2-fast']);
  });

  it('hands a route with rules to the rule wizard, which creates it with its first rule', async () => {
    signInAs(WRITER);
    seed([route('global', { tree: 'dep-a' })]);
    const box = routeWrites();
    const onRules = vi.fn();
    render(
      <NewRouteDrawer taken={['global']} onClose={() => undefined} onRules={onRules} onCreated={vi.fn()} />,
    );
    const user = userEvent.setup();
    const drawer = await screen.findByRole('dialog', { name: 'New route' });
    await user.type(within(drawer).getByLabelText(/Name/), 'wp2-rules');
    await user.click(within(drawer).getByRole('button', { name: 'Next: first rule' }));
    expect(onRules).toHaveBeenCalledWith('wp2-rules');
    expect(box.created).toBeNull();
  });

  it('creates the named route from the wizard’s first rule', async () => {
    signInAs(WRITER);
    seed([route('global', { tree: 'dep-a' })]);
    const box = routeWrites();
    const saved = vi.fn();
    render(
      <RuleWizard
        route={null}
        tree={null}
        rules={[]}
        editing={null}
        newRoute="wp2-rules"
        onSaved={saved}
        onClose={() => undefined}
      />,
    );
    const user = userEvent.setup();
    const drawer = await screen.findByRole('dialog', { name: 'Create rule' });
    await user.type(within(drawer).getByLabelText(/^Name/), 'support');
    await user.type(within(drawer).getByLabelText('Value of condition 1'), 'support');
    await user.click(within(drawer).getByRole('button', { name: 'Next: strategy' }));
    await user.click(within(drawer).getByRole('button', { name: 'Next: targets' }));
    await pickOption(within(drawer).getByLabelText('Deployment 1'), /dep-b/);
    await user.click(within(drawer).getByRole('button', { name: 'Next: review' }));
    expect(drawer).toHaveTextContent('This first rule also creates the shared route wp2-rules');
    await pickOption(within(drawer).getByLabelText('Everything else'), /dep-a/);
    await user.click(within(drawer).getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(box.created).not.toBeNull());
    expect(box.created).toEqual({
      name: 'wp2-rules',
      spec: {
        tree: {
          type: 'conditional',
          rules: [{ name: 'support', when: { field: 'identity.team', eq: 'support' }, target: 'dep-b' }],
          default: 'dep-a',
        },
      },
    });
    expect(saved).toHaveBeenCalledWith('wp2-rules');
  });
});

describe('editing routes', () => {
  it('puts a first rule before a route’s one strategy, which then gets everything else', async () => {
    signInAs(WRITER);
    const one = { type: 'least_busy', children: ['dep-a', 'dep-b'] };
    seed([route('wp2-one', { tree: one })]);
    const box = routeWrites();
    render(
      <RuleWizard
        route="wp2-one"
        tree={{ type: 'conditional', rules: [], default: one }}
        rules={[]}
        editing={null}
        wrapping
        onClose={() => undefined}
      />,
    );
    const user = userEvent.setup();
    const drawer = await screen.findByRole('dialog', { name: 'Create rule' });
    await user.type(within(drawer).getByLabelText(/^Name/), 'big');
    await pickOption(within(drawer).getByLabelText('Field of condition 1'), 'input tokens');
    await pickOption(within(drawer).getByLabelText('Operator of condition 1'), '>');
    await user.type(within(drawer).getByLabelText('Value of condition 1'), '1000');
    await user.click(within(drawer).getByRole('button', { name: 'Next: strategy' }));
    await user.click(within(drawer).getByRole('button', { name: 'Next: targets' }));
    await pickOption(within(drawer).getByLabelText('Deployment 1'), /dep-b/);
    await user.click(within(drawer).getByRole('button', { name: 'Next: review' }));
    expect(drawer).toHaveTextContent('that strategy now gets everything else');
    await user.click(within(drawer).getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(box.put).not.toBeNull());
    expect(box.put).toEqual({
      name: 'wp2-one',
      spec: {
        tree: {
          type: 'conditional',
          rules: [{ name: 'big', when: { field: 'request.input_tokens', gt: 1000 }, target: 'dep-b' }],
          default: one,
        },
      },
    });
    expect(box.ifMatch).toBe('"r1"');
  });

  it('saves route settings as a merge patch with the route’s ETag', async () => {
    signInAs(WRITER);
    const r = route('wp2-route', {
      tree: 'dep-a',
      policies: { limits: { rpm: { unit: 'requests', limit: 10, per: '1m', burst: 20 } } },
    });
    seed([r]);
    const box = routeWrites();
    const closed = vi.fn();
    render(<RouteSettingsDrawer route={r} onClose={closed} />);
    const user = userEvent.setup();
    const drawer = await screen.findByRole('dialog', { name: 'Settings of route wp2-route' });
    await user.click(within(drawer).getByRole('switch', { name: 'Route on' }));
    await user.click(within(drawer).getByRole('radio', { name: 'Fail the request' }));
    await user.type(within(drawer).getByLabelText(/A session is kept for/), '30m');
    await pickOption(within(drawer).getByLabelText('Requests then'), 'Get an error');
    await user.click(
      within(drawer).getByRole('switch', { name: 'Filter deployments by the request’s tags' }),
    );
    const rpm = within(drawer).getByLabelText(/Requests per minute/);
    await user.clear(rpm);
    await user.type(rpm, '50');
    await pickOption(within(drawer).getByLabelText(/Guardrails on prompts/), 'pii');
    await user.keyboard('{Escape}');
    await user.type(within(drawer).getByLabelText(/Attempts per request/), '2');
    await user.click(within(drawer).getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(box.patched).not.toBeNull());
    expect(box.patched).toEqual({
      name: 'wp2-route',
      spec: {
        enabled: false,
        affinity: { mode: 'strict', ttl: '30m' },
        tag_filter: { enabled: true },
        on_all_unhealthy: 'reject',
        policies: {
          limits: { rpm: { limit: 50 } },
          guardrails: { input: ['pii'] },
          resilience: { retry: { max_attempts: 2 } },
        },
      },
    });
    expect(box.ifMatch).toBe('"r1"');
    await waitFor(() => expect(closed).toHaveBeenCalled());
  });

  it('closes without writing when nothing changed', async () => {
    signInAs(WRITER);
    const r = route('wp2-route', { tree: 'dep-a', affinity: { scope: 'organization' } });
    seed([r]);
    const box = routeWrites();
    const closed = vi.fn();
    render(<RouteSettingsDrawer route={r} onClose={closed} />);
    const user = userEvent.setup();
    const drawer = await screen.findByRole('dialog', { name: 'Settings of route wp2-route' });
    await user.click(within(drawer).getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(closed).toHaveBeenCalled());
    expect(box.patched).toBeNull();
  });

  it('edits where everything else goes, and can turn it into an error', async () => {
    signInAs(WRITER);
    const rules = [{ name: 'a', when: { field: 'identity.team', eq: 'x' }, target: 'dep-a' }];
    const r = route('wp2-route', { tree: { type: 'conditional', rules, default: 'dep-a' } });
    seed([r]);
    const box = routeWrites();
    const { unmount } = render(<DefaultTargetDrawer route={r} onClose={() => undefined} />);
    const user = userEvent.setup();
    let drawer = await screen.findByRole('dialog', { name: 'Everything else' });
    await pickOption(within(drawer).getByLabelText('Strategy'), 'Weighted split');
    await user.click(within(drawer).getByRole('button', { name: 'Add deployment' }));
    await pickOption(within(drawer).getByLabelText('Deployment 2'), /dep-b/);
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(box.put).not.toBeNull());
    expect(box.put?.spec).toEqual({
      tree: {
        type: 'conditional',
        rules,
        default: {
          type: 'weighted',
          children: [
            { deployment: 'dep-a', weight: 1 },
            { deployment: 'dep-b', weight: 1 },
          ],
        },
      },
    });
    unmount();

    const again = routeWrites();
    const now = useRouting.getState().routes.data?.[0] ?? r;
    render(<DefaultTargetDrawer route={now} onClose={() => undefined} />);
    drawer = await screen.findByRole('dialog', { name: 'Everything else' });
    await user.click(within(drawer).getByRole('radio', { name: 'Get an error' }));
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(again.put).not.toBeNull());
    expect(again.put?.spec).toEqual({ tree: { type: 'conditional', rules } });
  });
});
