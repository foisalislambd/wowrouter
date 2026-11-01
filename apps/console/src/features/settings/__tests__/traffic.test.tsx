import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { pickOption, signInAs } from '@/test/utils';

import { BudgetsPricingSection, pricingValues } from '../components/budgets-pricing-section';
import { CacheSection } from '../components/cache-section';
import { GuardrailsSection } from '../components/guardrails-section';
import {
  RoutingResilienceSection,
  watermarkText,
  watermarkValue,
} from '../components/routing-resilience-section';
import { durationWords } from '../choices';
import { useTraffic } from '../traffic-store';

const meta = {
  etag: '"5"',
  generation: 5,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  managed_by: 'api',
};

function resetTraffic() {
  useTraffic.setState({
    budgets: emptySlot(),
    pricing: emptySlot(),
    cache: emptySlot(),
    guardrails: emptySlot(),
    resilience: emptySlot(),
    routing: emptySlot(),
    server: emptySlot(),
    policies: emptySlot(),
  });
}

/** Serves `/settings/<key>` from `spec` and records each PATCH body. */
function settings(key: string, spec: Record<string, unknown>) {
  const patches: unknown[] = [];
  server.use(
    http.get(`*/admin/v1/settings/${key}`, () => HttpResponse.json({ spec, metadata: meta })),
    http.patch(`*/admin/v1/settings/${key}`, async ({ request }) => {
      patches.push(await request.json());
      return HttpResponse.json({ spec, metadata: meta });
    }),
  );
  return patches;
}

const section = (title: string) =>
  screen.getByText(title, { selector: 'h3' }).closest('section') ?? document.body;

describe('Budgets & pricing', () => {
  beforeEach(() => {
    resetTraffic();
    signInAs(['pricing:read', 'pricing:write', 'policies:read', 'policies:write', 'config:read']);
    server.use(
      http.get('*/admin/v1/settings/observability', () =>
        HttpResponse.json({ spec: { alerts: { webhooks: { finance: {} } } }, metadata: meta }),
      ),
    );
  });

  it('starts from the default for unpriced requests while nothing is stored', () => {
    expect(pricingValues({})).toEqual({
      onUnpriced: 'reject_if_budgeted',
      catalog: 'bundled',
      inBody: false,
    });
    expect(pricingValues({ on_unpriced: 'zero' }).onUnpriced).toBe('zero');
  });

  it('counts unpriced requests as free, writing only on_unpriced', async () => {
    const pricing = settings('pricing', {});
    settings('budgets', {});
    render(<BudgetsPricingSection />);
    const free = await screen.findByRole('radio', { name: /Count them as free/ });
    expect(screen.getByRole('radio', { name: /Refuse them when a budget applies/ })).toBeChecked();
    await userEvent.click(free);
    await userEvent.click(within(section('Prices')).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(pricing).toEqual([{ spec: { on_unpriced: 'zero' } }]));
  });

  it('refuses them again from a stored "zero"', async () => {
    const pricing = settings('pricing', { on_unpriced: 'zero' });
    settings('budgets', {});
    render(<BudgetsPricingSection />);
    await userEvent.click(await screen.findByRole('radio', { name: /Refuse them when a budget applies/ }));
    await userEvent.click(within(section('Prices')).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(pricing).toEqual([{ spec: { on_unpriced: 'reject_if_budgeted' } }]));
  });

  it('sends budget threshold alerts to a webhook and keeps going while the store is down', async () => {
    settings('pricing', {});
    const budgets = settings('budgets', { expose_headers: true });
    render(<BudgetsPricingSection />);
    const card = await waitFor(() => section('Budgets'));
    expect(await within(card).findByRole('switch', { name: /Tell apps what is left/ })).toBeChecked();
    await pickOption(within(card).getByRole('combobox', { name: /If the budget store/ }), /Keep going/);
    await pickOption(within(card).getByRole('combobox', { name: 'Send threshold alerts to' }), 'finance');
    await userEvent.click(within(card).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(budgets).toEqual([
        { spec: { on_store_unavailable: 'local_share', alerts: { sink: 'finance' } } },
      ]),
    );
  });

  it('shows the settings read-only without the write permission', async () => {
    signInAs(['pricing:read', 'policies:read']);
    settings('pricing', {});
    settings('budgets', {});
    render(<BudgetsPricingSection />);
    expect(await screen.findByRole('radio', { name: /Count them as free/ })).toBeDisabled();
    expect(within(section('Prices')).getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
});

describe('duration words', () => {
  it('reads each duration in its largest whole unit', () => {
    expect(durationWords('300s')).toBe('5 minutes');
    expect(durationWords('24h')).toBe('1 day');
    expect(durationWords('90s')).toBe('90 seconds');
    expect(durationWords('365d')).toBe('1 year');
    expect(durationWords('50ms')).toBe('50 milliseconds');
  });
});

describe('Cache', () => {
  beforeEach(() => {
    resetTraffic();
    signInAs(['policies:read', 'policies:write']);
  });

  it('turns caching on for every Model and keeps answers longer', async () => {
    const policies = settings('policies', {});
    settings('cache', {});
    render(<CacheSection />);
    const card = await waitFor(() => section('Default for every Model'));
    await userEvent.click(within(card).getByRole('switch', { name: 'Cache answers' }));
    await pickOption(within(card).getByRole('combobox', { name: 'Keep answers for' }), '6 hours');
    await userEvent.click(within(card).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(policies).toEqual([{ spec: { cache: { enabled: true, ttl: '6h' } } }]));
  });

  it('asks for the Redis address before keeping answers in Redis', async () => {
    settings('policies', {});
    const cache = settings('cache', {});
    render(<CacheSection />);
    const card = await waitFor(() => section('Storage'));
    await userEvent.click(within(card).getByRole('radio', { name: /Redis/ }));
    await userEvent.click(within(card).getByRole('button', { name: 'Save changes' }));
    expect(await within(card).findByText('Enter the Redis address')).toBeInTheDocument();
    await userEvent.type(within(card).getByLabelText(/Redis address/), 'redis://cache:6379');
    await userEvent.click(within(card).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(cache).toEqual([{ spec: { backend: { type: 'redis', redis: { url: 'redis://cache:6379' } } } }]),
    );
  });
});

describe('Guardrails', () => {
  beforeEach(() => {
    resetTraffic();
    signInAs(['policies:read', 'policies:write']);
    server.use(
      http.get('*/admin/v1/guardrails', () =>
        HttpResponse.json({
          items: [{ name: 'pii', spec: { type: 'pii', action: 'redact' }, metadata: meta }],
          next_cursor: null,
        }),
      ),
    );
  });

  it('refuses what guardrails cannot read and checks streamed answers as they stream', async () => {
    const guardrails = settings('guardrails', {});
    const policies = settings('policies', {});
    render(<GuardrailsSection />);
    const behaviour = await waitFor(() => section('Guardrail behaviour'));
    await userEvent.click(within(behaviour).getByRole('radio', { name: /Refuse it/ }));
    await userEvent.click(within(behaviour).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(guardrails).toEqual([{ spec: { on_uninspectable: 'block' } }]));

    const policy = section('Default for every request');
    await userEvent.click(within(policy).getByText('Streamed answers'));
    await userEvent.click(within(policy).getByRole('radio', { name: /Check as it streams/ }));
    await pickOption(
      within(policy).getByRole('combobox', { name: 'Check tool calls to MCP servers' }),
      'pii',
    );
    await userEvent.click(within(policy).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(policies).toEqual([
        { spec: { guardrails: { mcp_input: ['pii'], streaming: { mode: 'window' } } } },
      ]),
    );
  });
});

describe('Routing & resilience', () => {
  beforeEach(() => {
    resetTraffic();
    signInAs([
      'policies:read',
      'policies:write',
      'models:read',
      'models:write',
      'config:read',
      'config:apply',
    ]);
  });

  it('reads and writes memory limits as a size or a share', () => {
    expect(watermarkText(0.8)).toBe('80%');
    expect(watermarkText('6GiB')).toBe('6GiB');
    expect(watermarkText(null)).toBe('');
    expect(watermarkValue('85 %')).toBe(0.85);
    expect(watermarkValue('6GiB')).toBe('6GiB');
    expect(watermarkValue('')).toBeNull();
  });

  it('writes each card to its own settings', async () => {
    const resilience = settings('resilience', {});
    const routing = settings('routing', {});
    const server = settings('server', { admission: { max_in_flight: 100 } });
    const policies = settings('policies', {});
    render(<RoutingResilienceSection />);

    const health = await waitFor(() => section('Unhealthy deployments'));
    await userEvent.click(within(health).getByRole('radio', { name: /Try them anyway/ }));
    await userEvent.click(
      within(health).getByRole('switch', { name: /Check deployments in the background/ }),
    );
    await userEvent.click(within(health).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(resilience).toEqual([
        { spec: { health: { all_unhealthy: 'ignore_health', active_checks: { enabled: true } } } },
      ]),
    );

    const behaviour = section('Routing behaviour');
    await userEvent.click(within(behaviour).getByRole('switch', { name: /name a provider/ }));
    await userEvent.click(within(behaviour).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(routing).toEqual([{ spec: { provider_addressing: { enabled: false } } }]));

    const pass = section('Headers and translation');
    await userEvent.click(within(pass).getByRole('radio', { name: /Refuse it/ }));
    await userEvent.click(within(pass).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(policies).toEqual([{ spec: { translation: { on_lossy: 'reject' } } }]));

    const admission = section('Admission');
    await userEvent.click(within(admission).getByRole('radio', { name: /Take turns between projects/ }));
    await userEvent.type(within(admission).getByLabelText(/Stop letting requests in above/), '80%');
    await userEvent.click(within(admission).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(server).toEqual([{ spec: { admission: { fairness: 'project', memory_high_watermark: 0.8 } } }]),
    );
  });
});
