import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@/mocks/node';
import { signInAs } from '@/test/utils';

import { NamedBy, namedIn } from '../components/named-by';

const meta = { etag: '"x"', generation: 1, created_at: '', updated_at: '', managed_by: 'api' };

describe('where a guardrail is named below the gateway', () => {
  it('reads the lists a level names it in, and its exclusions', () => {
    const owner = {
      kind: 'route' as const,
      name: 'global',
      policies: { guardrails: { input: ['pii'], output: ['pii', 'x'], exclude: ['secrets'] } },
    };
    expect(namedIn(owner, 'pii')).toEqual({ lists: ['prompts', 'answers'], excluded: false });
    expect(namedIn(owner, 'secrets')).toEqual({ lists: [], excluded: true });
    expect(namedIn({ ...owner, policies: {} }, 'pii')).toEqual({ lists: [], excluded: false });
  });

  it('lists the routes and Models that run it', async () => {
    signInAs(['models:read']);
    server.use(
      http.get('*/admin/v1/routes', () =>
        HttpResponse.json({
          items: [
            {
              name: 'global',
              spec: { tree: 'a', policies: { guardrails: { input: ['pii'] } } },
              metadata: meta,
            },
          ],
          next_cursor: null,
        }),
      ),
      http.get('*/admin/v1/models', () =>
        HttpResponse.json({
          items: [{ name: 'gpt', spec: { policies: { guardrails: { exclude: ['pii'] } } }, metadata: meta }],
          next_cursor: null,
        }),
      ),
    );
    render(<NamedBy name="pii" />);
    const group = await screen.findByRole('group', { name: 'Named below the gateway' });
    await waitFor(() => expect(group).toHaveTextContent('Route global: prompts'));
    expect(group).toHaveTextContent('Model gpt: excluded there');
  });
});
