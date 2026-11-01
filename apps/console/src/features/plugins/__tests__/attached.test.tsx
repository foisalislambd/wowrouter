import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { pickOption, signInAs } from '@/test/utils';

import { AttachedTo } from '../components/attached-to';
import { usePlugins } from '../store';

const meta = (etag: string) => ({
  etag,
  generation: 1,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  managed_by: 'api' as const,
});

function serve() {
  const patches: { path: string; body: unknown; ifMatch: string | null }[] = [];
  const list = (items: unknown[]) => () => HttpResponse.json({ items, next_cursor: null });
  server.use(
    http.get(
      '*/admin/v1/teams',
      list([
        {
          name: 'support',
          spec: { policies: { plugins: { attach: ['audit', 'redact'] } } },
          metadata: meta('"t1"'),
        },
        { name: 'sales', spec: { policies: { plugins: { detach: ['redact'] } } }, metadata: meta('"t2"') },
      ]),
    ),
    http.get('*/admin/v1/models', list([])),
    http.get('*/admin/v1/routes', list([{ name: 'global', spec: { tree: 'a' }, metadata: meta('"r1"') }])),
    http.patch('*/admin/v1/:kind/:name', async ({ request, params }) => {
      const body = await request.json();
      patches.push({
        path: `${String(params.kind)}/${String(params.name)}`,
        body,
        ifMatch: request.headers.get('if-match'),
      });
      return HttpResponse.json({
        name: params.name,
        spec: (body as { spec: unknown }).spec,
        metadata: meta('"next"'),
      });
    }),
  );
  return patches;
}

describe('a plugin attached below the gateway', () => {
  beforeEach(() => usePlugins.setState({ owners: emptySlot() }));

  it('lists the levels that attach or detach it, and attaches it to one more', async () => {
    const patches = serve();
    signInAs(['teams:read', 'teams:update', 'models:read', 'models:write']);
    render(<AttachedTo name="redact" />);
    const group = await screen.findByRole('group', { name: 'Attached below the gateway' });
    await waitFor(() => expect(group).toHaveTextContent('Teamsupport'));
    expect(group).toHaveTextContent('Detached by team sales.');

    await pickOption(within(group).getByLabelText('Attach to a level'), 'Route');
    await pickOption(within(group).getByLabelText('Which one'), 'global');
    await userEvent.click(within(group).getByRole('button', { name: 'Attach' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      path: 'routes/global',
      body: { spec: { policies: { plugins: { attach: ['redact'] } } } },
      ifMatch: '"r1"',
    });

    await userEvent.click(within(group).getByRole('button', { name: 'Take redact off team support' }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({
      path: 'teams/support',
      body: { spec: { policies: { plugins: { attach: ['audit'] } } } },
      ifMatch: '"t1"',
    });
  });

  it('shows nothing to a principal who can read no level', () => {
    signInAs([]);
    const { container } = render(<AttachedTo name="redact" />);
    expect(container).toBeEmptyDOMElement();
  });
});
