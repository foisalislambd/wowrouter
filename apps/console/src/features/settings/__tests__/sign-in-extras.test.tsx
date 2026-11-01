import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { pickOption, signInAs } from '@/test/utils';

import { SignInExtras } from '../components/sign-in-extras';
import { navigation } from '@/test/setup';

import { bootstrapWords, SignInSection } from '../components/sign-in-section';
import { useOrgSettings } from '../store';

const meta = {
  etag: '"8"',
  generation: 8,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  managed_by: 'api',
};

function authServer(spec: Record<string, unknown>) {
  const patches: { spec: Record<string, unknown> }[] = [];
  server.use(
    http.get('*/admin/v1/settings/auth', () => HttpResponse.json({ spec, metadata: meta })),
    http.patch('*/admin/v1/settings/auth', async ({ request }) => {
      patches.push((await request.json()) as { spec: Record<string, unknown> });
      return HttpResponse.json({ spec, metadata: meta });
    }),
    http.get('*/admin/v1/settings/observability', () => HttpResponse.json({ spec: {}, metadata: meta })),
    http.get('*/admin/v1/settings/limits', () => HttpResponse.json({ spec: {}, metadata: meta })),
    http.get('*/admin/v1/settings/security', () => HttpResponse.json({ spec: {}, metadata: meta })),
    http.get('*/admin/v1/organizations/default', () =>
      HttpResponse.json({ name: 'default', spec: {}, metadata: meta }),
    ),
    http.get('*/admin/v1/users', () => HttpResponse.json({ items: [], next_cursor: null })),
  );
  return patches;
}

const card = (title: string) =>
  screen.getByText(title, { selector: 'h3' }).closest('section') ?? document.body;

beforeEach(() => {
  signInAs(['security:read', 'security:write', 'organizations:read', 'organizations:update']);
  useOrgSettings.setState({
    auth: emptySlot(),
    organization: emptySlot(),
    observability: emptySlot(),
    limits: emptySlot(),
    security: emptySlot(),
  });
});

describe('Sign-in policy', () => {
  it('shows the lockout, throttle and invitation defaults and writes only the one changed', async () => {
    const patches = authServer({ admin: { local: { enabled: true } } });
    render(<SignInSection />);
    const lock = await screen.findByLabelText('Lock an account after');
    expect(lock).toHaveValue('10');
    expect(screen.getByLabelText('Slow down an address after')).toHaveValue('10');
    expect(screen.getByRole('combobox', { name: 'Invitation links last' })).toHaveTextContent('7 days');
    await pickOption(screen.getByRole('combobox', { name: 'Locked for' }), '1 hour');
    await pickOption(screen.getByRole('combobox', { name: 'Invitation links last' }), '14 days');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    const admin = (patches[0]?.spec.admin ?? {}) as Record<string, Record<string, unknown>>;
    expect(admin.local?.lockout).toEqual({ duration: '1h' });
    expect(admin.invitations).toEqual({ ttl: '14d' });
    expect(admin.login_throttle).toBeUndefined();
    expect(admin.session?.trusted_device).toEqual({ enabled: false, max_age: '30d' });
  });
});

describe('Sign-in policy extras', () => {
  it('writes the seat cap, the sign-in page and the advanced fields only once changed', async () => {
    const patches = authServer({
      admin: { local: { enabled: true }, bootstrap_token: '${env:ANTIRION_BOOTSTRAP_TOKEN}' },
    });
    render(<SignInSection />);
    expect(await screen.findByLabelText('Maximum length')).toHaveValue('128');
    expect(screen.getByLabelText('Recovery codes per person')).toHaveValue('10');
    await userEvent.type(screen.getByLabelText(/Most active people/), '50');
    await userEvent.click(screen.getByRole('checkbox', { name: "Show the gateway's version" }));
    await userEvent.click(screen.getByText('Advanced'));
    expect(
      screen.getByText('Set, from the environment variable ANTIRION_BOOTSTRAP_TOKEN'),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Security key domain/), 'console.example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    const admin = (patches[0]?.spec.admin ?? {}) as Record<string, Record<string, unknown>>;
    expect(admin.max_active_users).toBe(50);
    expect(admin.login_page).toEqual({ show_version: true });
    expect(admin.local?.mfa).toEqual({
      factors: ['totp', 'webauthn'],
      webauthn: { rp_id: 'console.example.com' },
    });
    expect(admin.local?.password_policy).not.toHaveProperty('max_length');
    expect(admin.local).not.toHaveProperty('reset_token_ttl');
  });

  it('refuses a maximum length under the minimum', async () => {
    const patches = authServer({ admin: { local: { enabled: true } } });
    render(<SignInSection />);
    const longest = await screen.findByLabelText('Maximum length');
    await userEvent.clear(longest);
    await userEvent.type(longest, '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Make it at least the minimum length')).toBeInTheDocument();
    expect(patches).toHaveLength(0);
  });

  it('says whether the bootstrap token is set, never its value', () => {
    expect(bootstrapWords(undefined)).toBe('Not set');
    expect(bootstrapWords('[REDACTED]')).toBe('Set in the configuration');
    expect(bootstrapWords('${file:/run/secrets/boot}')).toBe('Set, read from a file');
    expect(bootstrapWords('${vault:kv/antirion#boot}')).toBe('Set, read from a secret store');
  });
});

describe('Sign-in extras', () => {
  it('limits personal admin tokens to a shorter lifetime', async () => {
    const patches = authServer({});
    render(<SignInExtras />);
    const tokens = await waitFor(() => card('Personal admin tokens'));
    expect(within(tokens).getByRole('switch', { name: 'Let people create personal tokens' })).toBeChecked();
    await pickOption(within(tokens).getByRole('combobox', { name: 'Longest lifetime' }), '30 days');
    await userEvent.click(within(tokens).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(patches).toEqual([{ spec: { admin: { personal_tokens: { max_lifetime: '30d' } } } }]),
    );
  });

  it('turns CLI sign-in on, and removes the console address once it is cleared', async () => {
    const patches = authServer({ admin: { public_origin: 'https://old.example.com' } });
    render(<SignInExtras />);
    const cli = await waitFor(() => card('CLI sign-in'));
    await userEvent.click(within(cli).getByRole('switch', { name: /sign the CLI in/ }));
    await userEvent.click(within(cli).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ spec: { admin: { device_authorization: { enabled: true } } } });

    const address = card('Console address');
    await userEvent.clear(within(address).getByRole('textbox', { name: /Address/ }));
    expect(within(address).getByRole('status')).toHaveTextContent(/return addresses/);
    await userEvent.click(within(address).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ spec: { admin: { public_origin: null } } });
  });

  it('refuses a Playground limit out of range', async () => {
    const patches = authServer({});
    render(<SignInExtras />);
    const playground = await waitFor(() => card('Playground'));
    const requests = within(playground).getByLabelText('Requests per key');
    await userEvent.clear(requests);
    await userEvent.type(requests, '0');
    await userEvent.click(within(playground).getByRole('button', { name: 'Save changes' }));
    expect(await within(playground).findByText('Enter a number from 1 to 10000')).toBeInTheDocument();
    expect(patches).toHaveLength(0);
  });
});

describe('test sign-in outcome', () => {
  it('shows a failed test sign-in in words, then takes it out of the address', async () => {
    authServer({});
    window.history.replaceState(
      null,
      '',
      '/?settings=sign-in&error=sso_denied&message=This%20email%20domain%20may%20not%20sign%20in.',
    );
    render(<SignInSection />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The test sign-in failed.');
    expect(alert).toHaveTextContent('Your identity provider or this gateway did not let you sign in.');
    expect(alert).toHaveTextContent('This email domain may not sign in.');
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenLastCalledWith('/?settings=sign-in', { scroll: false }),
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
