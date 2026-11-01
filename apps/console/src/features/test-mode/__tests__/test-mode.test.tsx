import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { GatewayNotices } from '@/features/settings/components/gateway-notices';
import { server } from '@/mocks/node';
import { useSession } from '@/stores/session';
import { useShell } from '@/stores/shell';
import { useQueryWindow, useTimeRange } from '@/stores/time-range';
import { signInAs } from '@/test/utils';

import { useTestClock } from '../clock';
import { TestModePanel } from '../components/test-mode-panel';

function admin() {
  const me = signInAs(['config:read']);
  useSession.setState({
    me: {
      ...me,
      bindings: [
        { id: 'rb', principal: { type: 'user', id: 'tester' }, role: 'gateway_admin', scope: 'gateway' },
      ],
    },
  });
}

describe('Test-mode tools', () => {
  beforeEach(() => useShell.setState({ status: { test_mode: true } as never }));

  it('is absent outside test mode and for principals who are not gateway admins', () => {
    useShell.setState({ status: { test_mode: false } as never });
    admin();
    const { unmount } = render(<TestModePanel />);
    expect(screen.queryByText('Test mode')).not.toBeInTheDocument();
    unmount();
    useShell.setState({ status: { test_mode: true } as never });
    signInAs(['config:read']);
    render(<TestModePanel />);
    expect(screen.queryByText('Test mode')).not.toBeInTheDocument();
  });

  it('advances the clock, resets the chosen state and sets the seed', async () => {
    const calls: { path: string; body: unknown }[] = [];
    server.use(
      http.get('*/admin/v1/test/clock', () => HttpResponse.json({ now: '2026-10-15T10:00:00Z' })),
      http.post('*/admin/v1/test/clock', async ({ request }) => {
        calls.push({ path: 'clock', body: await request.json() });
        return HttpResponse.json({ now: '2026-10-16T10:00:00Z' });
      }),
      http.post('*/admin/v1/test/reset', async ({ request }) => {
        calls.push({ path: 'reset', body: await request.json() });
        return new HttpResponse(null, { status: 204 });
      }),
      http.put('*/admin/v1/test/seed', async ({ request }) => {
        calls.push({ path: 'seed', body: await request.json() });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    admin();
    render(<TestModePanel />);
    expect(await screen.findByText(/Oct 15, 2026/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: '1 day' }));
    await userEvent.click(screen.getByRole('button', { name: 'Advance' }));
    await waitFor(() => expect(calls[0]).toEqual({ path: 'clock', body: { advance: '1d' } }));
    expect(await screen.findByText(/Oct 16, 2026/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Request log' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Audit log' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset selected' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Reset the selected state?' });
    expect(within(dialog).getByText(/configuration, keys and accounts are kept/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset state' }));
    await waitFor(() =>
      expect(calls[1]).toEqual({
        path: 'reset',
        body: { scopes: ['counters', 'budgets', 'health', 'affinity', 'cache', 'sessions'] },
      }),
    );

    await userEvent.type(screen.getByLabelText('Seed'), '42');
    await userEvent.click(screen.getByRole('button', { name: 'Set seed' }));
    await waitFor(() => expect(calls[2]).toEqual({ path: 'seed', body: { seed: 42 } }));
  });
});

const DAY = 86_400_000;

function Window() {
  const w = useQueryWindow();
  return <output aria-label="Window end">{w.to}</output>;
}

describe('Test-mode banner', () => {
  beforeEach(() => {
    useTestClock.setState({ now: null, offset: 0 });
    useTimeRange.setState({ clockOffset: 0, anchoredAt: Date.now() });
  });

  it('says so on every page, with the moved clock, and anchors the time ranges on it', async () => {
    const ahead = new Date(Date.now() + 3 * DAY).toISOString();
    server.use(http.get('*/admin/v1/test/clock', () => HttpResponse.json({ now: ahead })));
    useShell.setState({ status: { test_mode: true } as never });
    admin();
    render(
      <>
        <GatewayNotices />
        <Window />
      </>,
    );
    const banner = await screen.findByText(/^Test mode · gateway clock/);
    expect(banner).toBeInTheDocument();
    expect(screen.getByText(/3 days ahead of real time/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Test tools' })).toHaveAttribute(
      'href',
      expect.stringContaining('settings=status') as string,
    );
    // "Last 6 h" now ends at the gateway's time, not the browser's.
    await waitFor(() =>
      expect(Date.parse(screen.getByLabelText('Window end').textContent)).toBeGreaterThan(
        Date.now() + 2 * DAY,
      ),
    );
  });

  it('shows a plain notice to readers who may not read the clock, and nothing outside test mode', () => {
    let asked = 0;
    server.use(
      http.get('*/admin/v1/test/clock', () => {
        asked += 1;
        return HttpResponse.json({ now: new Date().toISOString() });
      }),
    );
    useShell.setState({ status: { test_mode: true } as never });
    signInAs(['config:read']);
    const { unmount } = render(<GatewayNotices />);
    expect(screen.getByText('Test mode')).toBeInTheDocument();
    expect(screen.getByText(/its clock can be moved/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Test tools' })).not.toBeInTheDocument();
    expect(asked).toBe(0);
    unmount();
    useShell.setState({ status: { test_mode: false } as never });
    render(<GatewayNotices />);
    expect(screen.queryByText(/Test mode/)).not.toBeInTheDocument();
  });

  it('does not call a clock that follows real time moved', async () => {
    server.use(http.get('*/admin/v1/test/clock', () => HttpResponse.json({ now: new Date().toISOString() })));
    useShell.setState({ status: { test_mode: true } as never });
    admin();
    render(<GatewayNotices />);
    await waitFor(() => expect(useTestClock.getState().now).not.toBeNull());
    expect(screen.getByText('Test mode')).toBeInTheDocument();
    expect(useTimeRange.getState().clockOffset).toBe(0);
  });
});
