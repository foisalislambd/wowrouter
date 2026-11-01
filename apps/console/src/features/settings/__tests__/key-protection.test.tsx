import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { signInAs } from '@/test/utils';

import { KeyProtectionCard } from '../components/key-protection';
import { KeyRequirementCard } from '../components/key-requirement-card';
import { useOrgSettings } from '../store';

const meta = {
  etag: '"4"',
  generation: 4,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  managed_by: 'api',
};

function authServer(spec: Record<string, unknown>) {
  const patches: unknown[] = [];
  server.use(
    http.get('*/admin/v1/settings/auth', () => HttpResponse.json({ spec, metadata: meta })),
    http.patch('*/admin/v1/settings/auth', async ({ request }) => {
      patches.push(await request.json());
      return HttpResponse.json({ spec, metadata: meta });
    }),
    http.get('*/admin/v1/settings/observability', () => HttpResponse.json({ spec: {}, metadata: meta })),
    http.get('*/admin/v1/settings/limits', () => HttpResponse.json({ spec: {}, metadata: meta })),
    http.get('*/admin/v1/settings/security', () => HttpResponse.json({ spec: {}, metadata: meta })),
  );
  return patches;
}

describe('Unusual key activity', () => {
  beforeEach(() => {
    signInAs(['security:read', 'security:write', 'config:read', 'policies:read']);
    useOrgSettings.setState({
      auth: emptySlot(),
      observability: emptySlot(),
      limits: emptySlot(),
      security: emptySlot(),
    });
  });

  it('shows detection on while nothing is stored, and writes only what changed', async () => {
    const patches = authServer({});
    render(<KeyProtectionCard />);
    const on = await screen.findByRole('switch', { name: 'Flag unusual key activity' });
    expect(on).toBeChecked();
    expect(screen.getByText('Apps must send a key')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /A new country/ }));
    const attempts = screen.getByLabelText('Attempts allowed');
    expect(attempts).toHaveValue('50');
    await userEvent.clear(attempts);
    await userEvent.type(attempts, '20');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(patches).toEqual([
        {
          spec: {
            anomaly_detection: { new_country: false },
            failed_auth_throttle: { max_failures: 20 },
          },
        },
      ]),
    );
  });

  it('turns detection off', async () => {
    const patches = authServer({ anomaly_detection: { enabled: true } });
    render(<KeyProtectionCard />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Flag unusual key activity' }));
    expect(screen.getByRole('checkbox', { name: /A new network/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patches).toEqual([{ spec: { anomaly_detection: { enabled: false } } }]));
  });

  it('stops requiring a key only after the words are typed', async () => {
    const patches = authServer({});
    render(<KeyRequirementCard />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Require an API key' }));
    const confirm = await screen.findByRole('button', { name: 'Stop requiring a key' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /no key/ }), 'no key');
    await userEvent.click(confirm);
    await waitFor(() => expect(patches).toEqual([{ spec: { mode: 'disabled' } }]));
  });
});
