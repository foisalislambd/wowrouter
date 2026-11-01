import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@/mocks/node';
import { pickOption, signInAs } from '@/test/utils';

import { BindingDialog, InviteDialog } from '../components/forms';
import { setLevelEnabled, useDirectory, userActions, useTeams, useUsers } from '../store';

const meta = {
  etag: '"7"',
  generation: 7,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  managed_by: 'api' as const,
};

interface Seen {
  method: string;
  path: string;
  body: unknown;
  ifMatch: string | null;
  reason: string | null;
}

/** Records the writes a test makes, answering each with the resource it names. */
function record(): Seen[] {
  const seen: Seen[] = [];
  const answer = async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    seen.push({
      method: request.method,
      path: url.pathname.replace('/admin/v1', ''),
      body: await request.json(),
      ifMatch: request.headers.get('if-match'),
      reason: request.headers.get('x-antirion-change-reason'),
    });
    const name = url.pathname.split('/').at(-1) ?? '';
    return HttpResponse.json({ id: 'b1', name, spec: { organization: 'acme' }, metadata: meta });
  };
  server.use(
    http.patch('*/admin/v1/users/:name', answer),
    http.patch('*/admin/v1/teams/:name', answer),
    http.post('*/admin/v1/role_bindings', answer),
  );
  return seen;
}

describe('tenancy actions', () => {
  it('turns a user off with a merge patch of enabled and the reason', async () => {
    useUsers.setState({
      items: [{ name: 'ada', spec: { kind: 'human', role_bindings: [] }, metadata: meta }],
    });
    const seen = record();
    await userActions.setEnabled('ada', false, 'left the company');
    expect(seen).toEqual([
      {
        method: 'PATCH',
        path: '/users/ada',
        body: { spec: { enabled: false } },
        ifMatch: '"7"',
        reason: 'left the company',
      },
    ]);
  });

  it('turns a team off with a merge patch of enabled', async () => {
    useTeams.setState({ items: [{ name: 'core', spec: { organization: 'acme' }, metadata: meta }] });
    const seen = record();
    await setLevelEnabled('team', 'core', false, 'paused');
    expect(seen).toEqual([
      {
        method: 'PATCH',
        path: '/teams/core',
        body: { spec: { enabled: false } },
        ifMatch: '"7"',
        reason: 'paused',
      },
    ]);
  });

  it('gives a role to an admin token', async () => {
    signInAs(['role_bindings:create']);
    useDirectory.setState({
      roles: {
        data: [{ name: 'auditor', builtin: true, bindable_at: ['gateway'], permissions: ['audit:read'] }],
        status: 'ready',
        error: null,
        at: Date.now(),
      },
      bindings: { data: [], status: 'ready', error: null, at: Date.now() },
    });
    const seen = record();
    render(<BindingDialog user="ada" token={{ kid: 'k1', hint: 'adm-k1…wxyz' }} onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'Give a role to token adm-k1…wxyz' });
    await pickOption(within(dialog).getByLabelText('Role'), /auditor/i);
    await pickOption(within(dialog).getByLabelText('Scope'), 'Whole gateway');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign role' }));
    await waitFor(() =>
      expect(seen[0]?.body).toEqual({
        principal: { type: 'token', id: 'k1' },
        role: 'auditor',
        scope: 'gateway',
      }),
    );
  });

  it('invites with a whole-gateway role at the whole gateway, not at a team', async () => {
    signInAs(['invitations:create', 'role_bindings:create']);
    useTeams.setState({ items: [{ name: 'default', spec: { organization: 'acme' }, metadata: meta }] });
    useDirectory.setState({
      roles: {
        data: [
          {
            name: 'developer',
            builtin: true,
            bindable_at: ['organization', 'team', 'project'],
            permissions: [],
          },
          { name: 'gateway_admin', builtin: true, bindable_at: ['gateway'], permissions: [] },
        ],
        status: 'ready',
        error: null,
        at: Date.now(),
      },
    });
    const seen: unknown[] = [];
    server.use(
      http.post('*/admin/v1/invitations', async ({ request }) => {
        seen.push(await request.json());
        return HttpResponse.json({ id: 'i1', email: 'ada@example.com' }, { status: 201 });
      }),
    );
    render(<InviteDialog onClose={() => undefined} onLink={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'Invite people' });
    expect(within(dialog).getByLabelText('Team')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Email/), 'ada@example.com');
    await pickOption(within(dialog).getByLabelText('Role'), 'Gateway admin');
    expect(within(dialog).queryByLabelText('Team')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invite' }));
    await waitFor(() =>
      expect(seen[0]).toEqual({
        email: 'ada@example.com',
        role_bindings: [
          { principal: { type: 'user', id: 'ada@example.com' }, role: 'gateway_admin', scope: 'gateway' },
        ],
      }),
    );
  });
});
