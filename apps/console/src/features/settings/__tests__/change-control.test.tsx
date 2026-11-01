import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { pickOption, signInAs } from '@/test/utils';

import { ChangeControlCard, changeControlSpec, changeControlValues } from '../components/change-control-card';
import { useDanger } from '../danger-store';

const STATUS = {
  version: '0.1.0',
  commit: 'abc',
  mode: 'standalone',
  test_mode: true,
  config_generation: 7,
  dry_run_all: false,
  ingress_pauses: [],
  maintenance_window: null,
};

/** A gateway that keeps the governance settings it is sent, as the real one does (merge patch). */
function governanceServer(initial: Record<string, unknown>) {
  let spec: Record<string, unknown> = initial;
  let generation = 1;
  const patches: unknown[] = [];
  const metadata = () => ({
    etag: `"g${generation}"`,
    generation,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    managed_by: 'api',
  });
  server.use(
    http.get('*/admin/v1/settings/governance', () => HttpResponse.json({ spec, metadata: metadata() })),
    http.patch('*/admin/v1/settings/governance', async ({ request }) => {
      const body = (await request.json()) as { spec: { change_control: Record<string, unknown> } };
      patches.push(body);
      const before = (spec.change_control ?? {}) as Record<string, unknown>;
      const merged = Object.fromEntries(
        Object.entries({ ...before, ...body.spec.change_control }).filter(([, v]) => v !== null),
      );
      spec = { ...spec, change_control: merged };
      generation += 1;
      return HttpResponse.json({ spec, metadata: metadata() });
    }),
    http.get('*/admin/v1/status', () => HttpResponse.json(STATUS)),
  );
  return { patches, spec: () => spec };
}

async function renderLoaded() {
  render(<ChangeControlCard />);
  await useDanger.getState().load();
  return (await screen.findByText('Change control')).closest('section') ?? document.body;
}

describe('change control values', () => {
  it('reads defaults while nothing is stored and writes resources in the configuration order', () => {
    const v = changeControlValues(undefined);
    expect(v).toEqual({ kinds: [], approvals: '1', ttl: '7d', paths: [] });
    expect(
      changeControlSpec({ ...v, kinds: ['settings', 'providers'], paths: [{ path: ' a.b ', above: '' }] }),
    ).toEqual({
      resources: ['providers', 'settings'],
      approvals_required: 1,
      request_ttl: '7d',
      protected_paths: [{ path: 'a.b' }],
    });
  });
});

describe('Change control', () => {
  beforeEach(() => {
    signInAs(['security:read', 'security:write']);
    useDanger.setState({
      status: emptySlot(),
      governance: emptySlot(),
      organizations: emptySlot(),
      target: emptySlot(),
      pending: emptySlot(),
    });
    server.use(
      http.get('*/admin/v1/organizations', () => HttpResponse.json({ items: [], next_cursor: null })),
      http.get('*/admin/v1/change_requests', () => HttpResponse.json({ items: [], next_cursor: null })),
    );
  });

  it('turns change control on, writes only what changed and shows it again once saved', async () => {
    const gateway = governanceServer({ dual_control: { actions: ['cache_flush_all'] } });
    const card = await renderLoaded();
    const providers = within(card).getByRole('checkbox', { name: 'Providers' });
    expect(providers).not.toBeChecked();
    await userEvent.click(providers);
    await userEvent.click(within(card).getByRole('checkbox', { name: 'Gateway settings' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Add setting' }));
    await userEvent.type(
      within(card).getByRole('textbox', { name: 'Setting 1' }),
      'observability.request_logs.sinks.store.retention',
    );
    await userEvent.type(within(card).getByRole('textbox', { name: /Above/ }), '90d');
    await pickOption(within(card).getByRole('combobox', { name: 'A request expires after' }), '3 days');
    await userEvent.click(within(card).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(gateway.patches).toHaveLength(1));
    expect(gateway.patches[0]).toEqual({
      spec: {
        change_control: {
          resources: ['providers', 'settings'],
          request_ttl: '3d',
          protected_paths: [{ path: 'observability.request_logs.sinks.store.retention', above: '90d' }],
        },
      },
    });
    expect(gateway.spec().dual_control).toEqual({ actions: ['cache_flush_all'] });

    // The form comes back from the gateway's copy, with nothing left unsaved.
    await waitFor(() => expect(within(card).getByRole('checkbox', { name: 'Providers' })).toBeChecked());
    expect(within(card).getByRole('checkbox', { name: 'Gateway settings' })).toBeChecked();
    expect(within(card).getByRole('textbox', { name: 'Setting 1' })).toHaveValue(
      'observability.request_logs.sinks.store.retention',
    );
    expect(within(card).getByRole('combobox', { name: 'A request expires after' })).toHaveTextContent(
      '3 days',
    );
    expect(within(card).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(within(card).queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('turns it off again by clearing every kind and setting', async () => {
    const gateway = governanceServer({
      change_control: {
        resources: ['keys'],
        protected_paths: [{ path: 'pricing.on_unpriced' }],
        approvals_required: 2,
      },
    });
    const card = await renderLoaded();
    expect(within(card).getByLabelText('Approvals needed')).toHaveValue('2');
    await userEvent.click(within(card).getByRole('checkbox', { name: 'API keys' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Remove setting 1' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(gateway.patches).toHaveLength(1));
    expect(gateway.patches[0]).toEqual({ spec: { change_control: { resources: [], protected_paths: [] } } });
  });

  it('refuses a setting that is not a configuration path', async () => {
    const gateway = governanceServer({});
    const card = await renderLoaded();
    await userEvent.click(within(card).getByRole('button', { name: 'Add setting' }));
    await userEvent.type(within(card).getByRole('textbox', { name: 'Setting 1' }), 'not a path');
    await userEvent.click(within(card).getByRole('button', { name: 'Save changes' }));
    expect(await within(card).findByText(/Enter a setting such as/)).toBeInTheDocument();
    expect(gateway.patches).toHaveLength(0);
  });
});
