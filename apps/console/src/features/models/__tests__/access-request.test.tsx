import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { ModelResource } from '@/lib/api/types';
import { server } from '@/mocks/node';
import { useSession } from '@/stores/session';
import { pickOption, signInAs } from '@/test/utils';

import { AccessPanel, requestScopes } from '../components/access-panel';
import { useCatalog } from '../store';
import { toModelView } from '../types';

const meta = {
  etag: '"1"',
  generation: 1,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  managed_by: 'api' as const,
};

const model: ModelResource = {
  name: 'luna-preview',
  spec: { target: 'openai-gpt-6-luna', lifecycle: { state: 'restricted' }, access: { teams: ['research'] } },
  metadata: meta,
};

function setup(permissions: string[]) {
  const me = signInAs(permissions);
  useSession.setState({
    me: {
      ...me,
      user: { name: 'tester', primary_team: 'search' },
      bindings: [
        { id: 'b1', principal: { type: 'user', id: 'tester' }, role: 'viewer', scope: 'project/search-api' },
        { id: 'b2', principal: { type: 'user', id: 'tester' }, role: 'viewer', scope: 'gateway' },
      ],
    },
  });
  useCatalog.setState({ access: {} });
  const posts: unknown[] = [];
  server.use(
    http.get('*/admin/v1/models/:name/access_requests', () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
    http.post('*/admin/v1/models/:name/access_requests', async ({ request, params }) => {
      const body = (await request.json()) as { scope: string; reason?: string };
      posts.push({ model: params.name, ...body });
      return HttpResponse.json(
        {
          id: 'ar1',
          model: String(params.name),
          scope: body.scope,
          reason: body.reason ?? '',
          requested_by: 'tester',
          requested_at: new Date().toISOString(),
          state: 'open',
          decided_by: null,
          decided_at: null,
        },
        { status: 201 },
      );
    }),
  );
  render(<AccessPanel view={toModelView(model, new Map(), new Map())} onEdit={() => undefined} />);
  return posts;
}

describe('requesting access to a model', () => {
  it('offers the person’s own team first, then where their roles apply', () => {
    expect(
      requestScopes({
        principal: { type: 'user', id: 'a' },
        permissions: {},
        bindings: [
          { id: '1', principal: { type: 'user', id: 'a' }, role: 'r', scope: 'team/search' },
          { id: '2', principal: { type: 'user', id: 'a' }, role: 'r', scope: 'organization/acme' },
          { id: '3', principal: { type: 'user', id: 'a' }, role: 'r', scope: 'gateway' },
        ],
        user: { name: 'a', primary_team: 'search' },
      }),
    ).toEqual(['team/search', 'organization/acme']);
    expect(requestScopes(null)).toEqual([]);
  });

  it('files a request for the person’s team, with a reason, and lists it as waiting', async () => {
    const posts = setup(['models:read', 'keys:update']);
    await userEvent.click(await screen.findByRole('button', { name: 'Request access' }));
    const dialog = screen.getByRole('dialog', { name: 'Request access to luna-preview' });
    expect(within(dialog).getByRole('combobox', { name: 'For' })).toHaveTextContent('Team search');
    await userEvent.type(within(dialog).getByLabelText(/Why you need it/), 'Evaluating search ranking');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request access' }));
    await waitFor(() =>
      expect(posts).toEqual([
        { model: 'luna-preview', scope: 'team/search', reason: 'Evaluating search ranking' },
      ]),
    );
    expect(await screen.findByText('1 waiting')).toBeInTheDocument();
  });

  it('takes any team, project or key typed in', async () => {
    const posts = setup(['models:read', 'keys:update']);
    await userEvent.click(await screen.findByRole('button', { name: 'Request access' }));
    const dialog = screen.getByRole('dialog', { name: 'Request access to luna-preview' });
    await pickOption(within(dialog).getByRole('combobox', { name: 'For' }), 'Another team, project or key');
    await pickOption(within(dialog).getByRole('combobox', { name: 'Kind' }), 'API key');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request access' }));
    expect(await within(dialog).findByText(/Enter the key’s name/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'ci-bot');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request access' }));
    await waitFor(() => expect(posts).toEqual([{ model: 'luna-preview', scope: 'key/ci-bot' }]));
  });

  it('offers editing, not requesting, to those who can change the access list', async () => {
    setup(['models:read', 'models:write', 'keys:update']);
    expect(await screen.findByRole('button', { name: 'Edit access' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request access' })).not.toBeInTheDocument();
  });
});
