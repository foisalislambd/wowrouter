import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { signInAs } from '@/test/utils';

import { RecordFieldsCard, recordValues } from '../components/record-fields';
import { useOrgSettings } from '../store';

const meta = {
  etag: '"2"',
  generation: 2,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  managed_by: 'api',
};

describe('What each record keeps', () => {
  beforeEach(() => {
    signInAs(['config:read', 'config:apply']);
    useOrgSettings.setState({
      auth: emptySlot(),
      observability: emptySlot(),
      limits: emptySlot(),
      security: emptySlot(),
    });
  });

  it('starts from the defaults while nothing is stored', () => {
    expect(recordValues(undefined)).toMatchObject({
      enabled: true,
      clientIp: 'full',
      userAgent: true,
      requestHeaders: [],
    });
  });

  it('keeps only the network of the address, drops the user agent and keeps a header', async () => {
    const patches: unknown[] = [];
    server.use(
      http.get('*/admin/v1/settings/observability', () =>
        HttpResponse.json({
          spec: { request_logs: { sinks: { store: { retention: '30d' } } } },
          metadata: meta,
        }),
      ),
      http.patch('*/admin/v1/settings/observability', async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json({ spec: {}, metadata: meta });
      }),
    );
    render(<RecordFieldsCard />);
    await useOrgSettings.getState().loadSettings();
    await userEvent.click(await screen.findByRole('radio', { name: /Keep only its network/ }));
    await userEvent.click(screen.getByRole('switch', { name: "Keep the caller's user agent" }));
    const headers = screen.getByRole('combobox', { name: 'Request headers to keep' });
    await userEvent.type(headers, 'X-Request-Source{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(patches).toEqual([
        {
          spec: {
            request_logs: {
              client_ip: 'truncated',
              user_agent: false,
              headers: { request: ['x-request-source'] },
            },
          },
        },
      ]),
    );
  });

  it('warns before the request log is turned off', async () => {
    server.use(
      http.get('*/admin/v1/settings/observability', () => HttpResponse.json({ spec: {}, metadata: meta })),
    );
    render(<RecordFieldsCard />);
    await useOrgSettings.getState().loadSettings();
    await userEvent.click(await screen.findByRole('switch', { name: 'Keep a request log' }));
    expect(screen.getByRole('status')).toHaveTextContent('Saving stops recording requests');
    expect(screen.getByRole('switch', { name: "Keep the caller's user agent" })).toBeDisabled();
  });
});
