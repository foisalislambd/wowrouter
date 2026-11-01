import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Me } from '@/lib/api/types';
import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { useSession } from '@/stores/session';

import { TokensSection } from '../components/tokens-section';
import { useAccount } from '../store';
import { expiryFor, FALLBACK_POLICY, lifetimeChoices, tokenPolicy } from '../token-policy';

const DAY = 86_400;

function person(policy?: { max_lifetime: string; default_lifetime: string | null }): Me {
  return {
    principal: { type: 'user', id: 'ada', authenticated_by: 'session' },
    bindings: [],
    permissions: { gateway: [] },
    session: null,
    ...(policy ? { token_policy: policy } : {}),
  };
}

describe('token lifetimes under the gateway rule', () => {
  it('falls back to a 90-day limit when the rule is not reported', () => {
    expect(tokenPolicy(person())).toEqual(FALLBACK_POLICY);
    const { options, initial } = lifetimeChoices(FALLBACK_POLICY);
    expect(options.map((o) => o.label)).toEqual([
      'In 1 day',
      'In 7 days',
      'In 30 days',
      'In 60 days',
      'In 90 days',
    ]);
    expect(initial).toBe(String(30 * DAY));
  });

  it('offers nothing longer than the rule and starts on its default', () => {
    const policy = tokenPolicy(person({ max_lifetime: '45d', default_lifetime: '14d' }));
    const { options, initial } = lifetimeChoices(policy);
    expect(options.map((o) => o.label)).toEqual([
      'In 1 day',
      'In 7 days',
      'In 14 days',
      'In 30 days',
      'In 45 days',
    ]);
    expect(initial).toBe(String(14 * DAY));
  });

  it('keeps a short rule and caps a default longer than it', () => {
    expect(lifetimeChoices({ max_lifetime: '12h', default_lifetime: null })).toEqual({
      options: [{ value: String(12 * 3600), label: 'In 12 hours' }],
      initial: String(12 * 3600),
    });
    expect(lifetimeChoices({ max_lifetime: '365d', default_lifetime: '2y' }).initial).toBe(String(30 * DAY));
    expect(lifetimeChoices({ max_lifetime: '365d', default_lifetime: '400d' }).initial).toBe(
      String(365 * DAY),
    );
    expect(lifetimeChoices({ max_lifetime: '365d', default_lifetime: null }).options.at(-1)?.label).toBe(
      'In 1 year',
    );
  });

  it('sends the longest lifetime a minute short, so the gateway never refuses it', () => {
    const now = Date.parse('2026-10-17T00:00:00Z');
    expect(expiryFor(90 * DAY, FALLBACK_POLICY, now)).toBe(
      new Date(now + (90 * DAY - 60) * 1000).toISOString(),
    );
    expect(expiryFor(7 * DAY, FALLBACK_POLICY, now)).toBe(new Date(now + 7 * DAY * 1000).toISOString());
  });
});

describe('Personal tokens', () => {
  beforeEach(() => {
    useAccount.setState({ sessions: emptySlot(), tokens: emptySlot(), factors: emptySlot() });
  });

  it('offers only the lifetimes the rule allows and creates a token within it', async () => {
    useSession.setState({
      status: 'authenticated',
      me: person({ max_lifetime: '60d', default_lifetime: '7d' }),
    });
    const bodies: { expires_at: string }[] = [];
    server.use(
      http.post('*/admin/v1/auth/me/tokens', async ({ request }) => {
        const body = (await request.json()) as { expires_at: string; description: string };
        bodies.push(body);
        return HttpResponse.json(
          {
            kid: 'pt1',
            description: body.description,
            access: 'read_only',
            created_at: new Date().toISOString(),
            expires_at: body.expires_at,
            last_used_at: null,
            token: 'secret-value',
          },
          { status: 201 },
        );
      }),
    );
    render(<TokensSection />);
    const expires = await screen.findByRole('combobox', { name: 'Expires' });
    expect(expires).toHaveTextContent('In 7 days');
    expect(screen.getByText('At most 60 days.')).toBeInTheDocument();
    await userEvent.click(expires);
    const list = await screen.findByRole('listbox');
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['In 1 day', 'In 7 days', 'In 30 days', 'In 60 days']);
    await userEvent.click(within(list).getByRole('option', { name: 'In 60 days' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Deploy script');
    const before = Date.now();
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    const lifetime = (Date.parse(bodies[0]?.expires_at ?? '') - before) / 1000;
    expect(lifetime).toBeLessThanOrEqual(60 * DAY);
    expect(lifetime).toBeGreaterThan(60 * DAY - 120);
  });

  it('says so, and offers no form, while personal tokens are turned off', async () => {
    useSession.setState({ status: 'authenticated', me: person() });
    server.use(
      http.get('*/admin/v1/auth/me/tokens', () =>
        HttpResponse.json(
          { error: { code: 'not_found', message: 'The resource does not exist.', request_id: 'r' } },
          { status: 404 },
        ),
      ),
    );
    render(<TokensSection />);
    expect(await screen.findByText(/Personal tokens are turned off on this gateway/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create token' })).not.toBeInTheDocument();
  });
});
