import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { server } from '@/mocks/node';
import type { Alert } from '@/lib/api/types';
import { signInAs } from '@/test/utils';

import type { Anomaly } from '../anomalies';
import { AlertDetail } from '../components/alert-detail';
import { AnomalyHistory } from '../components/anomaly-flag';
import { useAlertEditors } from '../editors';
import { useAlerts } from '../store';

const flag = (over: Partial<Anomaly>): Anomaly => ({
  id: 'an-9',
  key: 'support-bot',
  owner: 'ada',
  kind: 'country',
  severity: 'critical',
  first_seen: '2026-10-15T08:00:00Z',
  last_seen: '2026-10-15T09:30:00Z',
  count: 42,
  detail: { country: 'BR', network: '203.0.113.0/24' },
  state: 'open',
  ...over,
});

const alert = {
  id: 'al-anomaly',
  rule: 'key-anomaly',
  fingerprint: 'fp',
  category: 'security',
  severity: 'critical',
  status: 'firing',
  summary: 'support-bot used from a new country',
  fired_at: '2026-10-15T09:31:00Z',
  scope: { key: 'support-bot', anomaly: 'an-9' },
  timeline: [],
} as unknown as Alert;

describe('Anomaly detail and history', () => {
  beforeEach(() => {
    useAlerts.setState(useAlerts.getInitialState(), true);
    useAlertEditors.setState({ stack: [] });
  });

  it("shows an alert's flag from GET /anomalies/{id}, dismisses it and opens the key's flags", async () => {
    let dismissed = false;
    server.use(
      http.get('*/admin/v1/anomalies/an-9', () =>
        HttpResponse.json(flag({ state: dismissed ? 'dismissed' : 'open' })),
      ),
      http.post('*/admin/v1/anomalies/an-9:dismiss', () => {
        dismissed = true;
        return HttpResponse.json(flag({ state: 'dismissed' }));
      }),
    );
    signInAs(['alerts:read', 'keys:read', 'keys:update']);
    render(<AlertDetail alert={alert} onOpen={() => undefined} />);
    expect(await screen.findByRole('heading', { name: 'Flagged key activity' })).toBeInTheDocument();
    expect(await screen.findByText('BR')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.0/24')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    // The flag's id is no longer hidden among the scope badges, nor shown raw.
    expect(screen.queryByText(/anomaly: an-9/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByText('Dismissed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Flags on this key' }));
    expect(useAlertEditors.getState().stack.at(-1)).toEqual({ kind: 'anomalies', key: 'support-bot' });
  });

  it('hides the flag from principals who may not read keys', () => {
    signInAs(['alerts:read']);
    render(<AlertDetail alert={alert} onOpen={() => undefined} />);
    expect(screen.queryByRole('heading', { name: 'Flagged key activity' })).not.toBeInTheDocument();
  });

  it('lists open and dismissed flags, by state and kind', async () => {
    const asked: URLSearchParams[] = [];
    server.use(
      http.get('*/admin/v1/anomalies', ({ request }) => {
        const q = new URL(request.url).searchParams;
        asked.push(q);
        const all = [flag({}), flag({ id: 'an-1', kind: 'spike', state: 'dismissed', detail: {} })];
        return HttpResponse.json({
          items: all.filter((a) => !q.get('state') || a.state === q.get('state')),
          next_cursor: null,
        });
      }),
    );
    signInAs(['keys:read']);
    render(<AnomalyHistory keyName="support-bot" onClose={() => undefined} />);
    const table = await screen.findByRole('table', { name: 'Flags' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('Dismissed')).toBeInTheDocument();
    expect(asked[0]?.get('key')).toBe('support-bot');
    expect(asked[0]?.get('state')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Dismissed' }));
    await waitFor(() => expect(asked.at(-1)?.get('state')).toBe('dismissed'));
    expect(await screen.findByText('Sudden spike in requests')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Kind' }));
    await userEvent.click(
      within(screen.getByRole('listbox')).getByRole('option', { name: 'Used from a new country' }),
    );
    await waitFor(() => expect(asked.at(-1)?.get('kind')).toBe('country'));
  });
});
