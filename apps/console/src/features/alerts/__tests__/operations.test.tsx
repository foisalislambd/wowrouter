import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { server } from '@/mocks/node';
import { useShell } from '@/stores/shell';
import { signInAs } from '@/test/utils';

import { AlertsScreen } from '../components/alerts-screen';
import { useAlertEditors } from '../editors';
import { useAlerts } from '../store';

const READ = ['alerts:read', 'config:read', 'security:read'];
const HOUR = 3_600_000;

let deliveries: URLSearchParams[];

function reset() {
  window.history.replaceState(null, '', '/alerts/');
  useAlerts.setState(useAlerts.getInitialState(), true);
  useAlertEditors.setState({ stack: [] });
  useShell.setState({ status: null });
  deliveries = [];
  server.use(
    http.get('*/admin/v1/alerts/deliveries', ({ request }) => {
      deliveries.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        items: [
          {
            event_id: 'ev-0001-aaaaaaaaaaaaaaaa',
            webhook: 'oncall-slack',
            target_kind: 'channel',
            event_type: 'budget.exhausted',
            attempt: 2,
            time: new Date().toISOString(),
            status_code: 500,
            result: 'failed',
          },
        ],
        next_cursor: null,
      });
    }),
  );
}

describe('Alerts: deliveries and maintenance', () => {
  beforeEach(reset);

  it('opens the delivery log of every target from the page, and filters it by result', async () => {
    signInAs(READ);
    render(<AlertsScreen />);
    await screen.findByRole('listbox', { name: 'Alerts' });
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delivery log' }));
    const drawer = await screen.findByRole('dialog', { name: 'Alert deliveries' });
    expect(await within(drawer).findByRole('table', { name: 'Deliveries' })).toHaveTextContent(
      'oncall-slack',
    );
    expect(deliveries[0]?.get('webhook')).toBeNull();
    await userEvent.click(within(drawer).getByRole('combobox', { name: 'Result' }));
    const options = screen.getAllByRole('listbox').filter((l) => l.getAttribute('aria-label') !== 'Alerts');
    await userEvent.click(within(options[0] ?? document.body).getByRole('option', { name: 'Failed' }));
    await waitFor(() => expect(deliveries.at(-1)?.get('result')).toBe('failed'));
  });

  it("opens a channel's failed deliveries from the failure count in its drawer", async () => {
    server.use(
      http.get('*/admin/v1/runtime/alerts/channels', () =>
        HttpResponse.json({
          items: [
            {
              name: 'oncall-slack',
              last_delivery_at: new Date().toISOString(),
              last_status: 500,
              deliveries_24h: 12,
              failures_24h: 2,
              queued: 0,
            },
          ],
          next_cursor: null,
        }),
      ),
    );
    signInAs(READ);
    render(<AlertsScreen />);
    await screen.findByRole('listbox', { name: 'Alerts' });
    await waitFor(() => expect(useAlerts.getState().channelStatus.data).not.toBeNull());
    useAlertEditors.getState().show({ kind: 'channel', name: 'oncall-slack' });
    const channel = await screen.findByRole('dialog', { name: 'oncall-slack' });
    await userEvent.click(within(channel).getByRole('button', { name: '2 failed' }));
    const log = await screen.findByRole('dialog', { name: 'Deliveries to oncall-slack' });
    await waitFor(() => expect(deliveries.at(-1)?.get('webhook')).toBe('oncall-slack'));
    expect(deliveries.at(-1)?.get('result')).toBe('failed');
    expect(within(log).getByRole('combobox', { name: 'Result' })).toHaveTextContent('Failed');
  });

  it('opens the maintenance windows from the page and shows the next one in the figures', async () => {
    const start = new Date(Date.now() + 60 * HOUR).toISOString();
    const end = new Date(Date.now() + 62 * HOUR).toISOString();
    const window = { start, end, description: 'Database upgrade' };
    server.use(
      http.get('*/admin/v1/settings/governance', () =>
        HttpResponse.json({
          spec: { maintenance_windows: [window] },
          metadata: { etag: '"g1"', generation: 1, created_at: '', updated_at: '', managed_by: 'api' },
        }),
      ),
    );
    useShell.setState({ status: { maintenance_window: { ...window, active: false } } as never });
    signInAs(READ);
    render(<AlertsScreen />);
    const summary = await screen.findByRole('region', { name: 'Alert summary' });
    expect(summary).toHaveTextContent('Maintenancein 2d');
    await userEvent.click(within(summary).getByRole('button', { name: /Maintenance/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Maintenance windows' });
    expect(await within(drawer).findByRole('table', { name: 'Maintenance windows' })).toHaveTextContent(
      'Database upgrade',
    );
  });
});
