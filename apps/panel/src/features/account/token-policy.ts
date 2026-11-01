import type { Me } from '@/lib/api/types';
import { parseDuration, plural } from '@/lib/format';

/**
 * The gateway's rule for personal tokens, as `GET /auth/me` reports it: the longest lifetime a new
 * token may have, and the one the form starts on (durations such as "90d").
 */
export interface TokenPolicy {
  max_lifetime: string;
  default_lifetime: string | null;
}

/** The gateway's own default when `/auth/me` does not report the rule. */
export const FALLBACK_POLICY: TokenPolicy = { max_lifetime: '90d', default_lifetime: null };

const DAY = 86_400;

/** The lifetimes the form offers, in seconds, when the rule allows them. */
const CHOICES = [DAY, 7 * DAY, 30 * DAY, 60 * DAY, 90 * DAY, 180 * DAY, 365 * DAY];

/** The form's preferred lifetime when the rule names none. */
const PREFERRED = 30 * DAY;

/** The principal's token rule, or the gateway default when it is not reported. */
export function tokenPolicy(me: Me | null): TokenPolicy {
  const reported: unknown = me && 'token_policy' in me ? me.token_policy : null;
  if (typeof reported !== 'object' || reported === null) return FALLBACK_POLICY;
  const { max_lifetime: max, default_lifetime: initial } = reported as Partial<TokenPolicy>;
  if (typeof max !== 'string' || parseDuration(max) === null) return FALLBACK_POLICY;
  return { max_lifetime: max, default_lifetime: typeof initial === 'string' ? initial : null };
}

/** A lifetime in words: "1 year", "90 days", "12 hours". */
export function lifetimeWords(seconds: number): string {
  if (seconds % (365 * DAY) === 0) return plural(seconds / (365 * DAY), 'year');
  if (seconds >= DAY && seconds % DAY === 0) return plural(seconds / DAY, 'day');
  if (seconds >= 3600 && seconds % 3600 === 0) return plural(seconds / 3600, 'hour');
  return plural(Math.max(1, Math.round(seconds / 60)), 'minute');
}

export interface LifetimeChoice {
  /** Seconds, as text for the Select. */
  value: string;
  label: string;
}

/**
 * The Expires options under the rule: the usual lifetimes up to the longest allowed, the longest
 * itself, and the rule's default; and which one the form starts on.
 */
export function lifetimeChoices(policy: TokenPolicy): { options: LifetimeChoice[]; initial: string } {
  const max = parseDuration(policy.max_lifetime) ?? 90 * DAY;
  const asked = policy.default_lifetime ? parseDuration(policy.default_lifetime) : null;
  const initial = Math.min(asked ?? Math.min(PREFERRED, max), max);
  const seconds = [...new Set([...CHOICES.filter((s) => s <= max), max, initial])].sort((a, b) => a - b);
  return {
    options: seconds.map((s) => ({ value: String(s), label: `In ${lifetimeWords(s)}` })),
    initial: String(initial),
  };
}

/**
 * The expiry to send for a lifetime: a minute short of the longest allowed, so a browser clock a
 * little ahead of the gateway's is not refused.
 */
export function expiryFor(seconds: number, policy: TokenPolicy, now: number = Date.now()): string {
  const max = parseDuration(policy.max_lifetime) ?? 90 * DAY;
  const lifetime = Math.min(seconds, max - 60);
  return new Date(now + lifetime * 1000).toISOString();
}
