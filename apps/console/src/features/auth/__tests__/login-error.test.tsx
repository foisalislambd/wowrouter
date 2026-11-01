import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { server } from '@/mocks/node';
import { useSession } from '@/stores/session';

import { callbackError } from '../callback-error';
import { LoginScreen } from '../components/login-screen';
import { useLogin } from '../store';

describe('a failed single sign-on, in words', () => {
  it.each([
    ['sso_state_invalid', 'The sign-in link expired or was opened in another browser. Start again.'],
    ['sso_denied', 'Your identity provider or this gateway did not let you sign in.'],
    ['sso_response_invalid', 'The answer from your identity provider could not be verified.'],
    ['sso_provider_error', 'Your identity provider could not be reached, or answered with an error.'],
    ['sso_provider_unknown', 'This sign-in option is not set up on the gateway any more.'],
    ['sso_rate_limited', 'Too many sign-in attempts. Wait a minute, then try again.'],
    ['sso_error', 'The gateway could not finish signing you in. Try again in a moment.'],
  ])('words %s', (code, title) => {
    expect(callbackError(code, null)?.title).toBe(title);
  });

  it('adds the gateway message as the detail', () => {
    expect(callbackError('sso_denied', 'This email domain may not sign in.')).toEqual({
      title: 'Your identity provider or this gateway did not let you sign in.',
      detail: 'This email domain may not sign in.',
    });
    expect(callbackError('sso_denied', 'User cancelled the login')?.detail).toBe('User cancelled the login.');
  });

  it('says what to do next when there is no message', () => {
    expect(callbackError('sso_state_invalid', null)?.detail).toBe('Try again, or sign in another way.');
    expect(callbackError('something_new', '')).toEqual({
      title: 'Single sign-on did not work.',
      detail: 'Try again, or sign in another way.',
    });
  });

  it('shows a message without a code, cuts a long one and ignores an empty address', () => {
    expect(callbackError(null, 'Upstream said no')?.title).toBe('Single sign-on did not work.');
    expect(callbackError('sso_error', 'x'.repeat(500))?.detail).toHaveLength(300);
    expect(callbackError(null, null)).toBeNull();
    expect(callbackError('', '   ')).toBeNull();
  });
});

describe('sign-in page after a failed single sign-on', () => {
  beforeEach(() => {
    useLogin.setState({
      options: null,
      step: { kind: 'start' },
      error: null,
      passwordError: null,
      organization: '',
      email: '',
      flow: 'sign-in',
      busy: false,
      trustDevice: false,
    });
    useSession.setState({ status: 'unknown', me: null, expiredAt: null });
    server.use(
      http.get('*/admin/v1/auth/me', () =>
        HttpResponse.json(
          { error: { code: 'unauthenticated', message: 'no', request_id: 'x' } },
          { status: 401 },
        ),
      ),
    );
  });

  it('shows the error the gateway sent back, above the sign-in methods', async () => {
    window.history.replaceState(
      null,
      '',
      '/login/?error=sso_denied&message=This%20email%20domain%20may%20not%20sign%20in.',
    );
    render(<LoginScreen />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your identity provider or this gateway did not let you sign in.');
    expect(alert).toHaveTextContent('This email domain may not sign in.');
    expect(await screen.findByRole('link', { name: /Continue with Google Workspace/ })).toBeInTheDocument();
  });

  it('still explains the failure when the message is missing', async () => {
    window.history.replaceState(null, '', '/login/?error=sso_state_invalid');
    render(<LoginScreen />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The sign-in link expired or was opened in another browser.');
    expect(alert).toHaveTextContent('Try again, or sign in another way.');
  });

  it('shows nothing when the address carries no error', async () => {
    window.history.replaceState(null, '', '/login/');
    render(<LoginScreen />);
    expect(await screen.findByRole('link', { name: /Continue with Google Workspace/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
