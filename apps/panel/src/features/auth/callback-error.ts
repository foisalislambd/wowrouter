/**
 * A failed single sign-on comes back to the sign-in page as `?error=<code>&message=<text>`. These
 * are the words the page shows for it: what happened, by code, then the gateway's own message
 * when it sent one.
 */
const BY_CODE: Record<string, string> = {
  sso_state_invalid: 'The sign-in link expired or was opened in another browser. Start again.',
  sso_denied: 'Your identity provider or this gateway did not let you sign in.',
  sso_response_invalid: 'The answer from your identity provider could not be verified.',
  sso_provider_error: 'Your identity provider could not be reached, or answered with an error.',
  sso_provider_unknown: 'This sign-in option is not set up on the gateway any more.',
  sso_rate_limited: 'Too many sign-in attempts. Wait a minute, then try again.',
  sso_error: 'The gateway could not finish signing you in. Try again in a moment.',
};

const GENERAL = 'Single sign-on did not work.';
const NEXT_STEP = 'Try again, or sign in another way.';

/** The longest message shown from the address bar (the gateway sends at most 200); longer is cut. */
const MAX_MESSAGE = 300;

export interface CallbackError {
  title: string;
  detail: string;
}

/** The error a failed sign-in left in the address, in plain words; null when there is none. */
export function callbackError(code: string | null, message: string | null): CallbackError | null {
  const key = code?.trim().toLowerCase() ?? '';
  const text = (message ?? '').replace(/\s+/g, ' ').trim();
  if (!key && !text) return null;
  const title = BY_CODE[key] ?? GENERAL;
  if (!text || text === title) return { title, detail: NEXT_STEP };
  const cut = text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1).trimEnd()}…` : text;
  return { title, detail: /[.!?…]$/.test(cut) ? cut : `${cut}.` };
}
