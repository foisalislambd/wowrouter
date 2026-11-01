'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { useScopedHref } from '@/components/layout/url-sync';
import { Checkbox, Switch } from '@/components/ui/choice';
import { Field, Input, MultiSelect, NumberInput, Select } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { InlineError, LoadError, LoadingRows } from '@/components/ui/states';
import { formatPercent, plural } from '@/lib/format';
import type { FieldErrors } from '@/lib/validation';
import { scopeOrganization, useScope } from '@/stores/scope';
import { notify } from '@/stores/ui';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';

import { settingsApi, type UserResource } from '../api';
import { deepMerge, durationOptions, rangeError } from '../choices';
import { detailErrors, DURATION_RE, mergePatch, same } from '../form-errors';
import { useOrgSettings } from '../store';
import { Card, Facts, SaveBar } from './parts';
import { Advanced } from './settings-form';
import { TestSignInOutcome } from './test-sign-in-outcome';

type Factor = 'totp' | 'webauthn';

interface PolicyValues {
  local: boolean;
  orgLocal: boolean;
  factors: Factor[];
  minLength: string;
  history: string;
  maxAge: string;
  denyCommon: boolean;
  domains: string[];
  trusted: boolean;
  trustedMaxAge: string;
  idle: string;
  absolute: string;
  trustedIdle: string;
  lockFailures: string;
  lockWindow: string;
  lockDuration: string;
  throttleFailures: string;
  throttleWindow: string;
  inviteTtl: string;
  maxLength: string;
  recoveryCodes: string;
  rpId: string;
  rpName: string;
  resetTtl: string;
  showVersion: boolean;
  ticker: boolean;
  /** Empty: no cap. */
  maxUsers: string;
}

/** The members added to the sign-in policy, written only when they change. */
function extrasSpec(v: PolicyValues): Record<string, unknown> {
  return {
    admin: {
      local: {
        lockout: {
          max_failures: Number(v.lockFailures),
          window: v.lockWindow,
          duration: v.lockDuration,
        },
        password_policy: { max_length: Number(v.maxLength) },
        mfa: {
          recovery_codes: Number(v.recoveryCodes),
          webauthn: { ...(v.rpId.trim() ? { rp_id: v.rpId.trim() } : {}), rp_name: v.rpName.trim() },
        },
        reset_token_ttl: v.resetTtl,
      },
      login_page: { show_version: v.showVersion, ticker: { enabled: v.ticker } },
      max_active_users: v.maxUsers.trim() ? Number(v.maxUsers) : null,
      login_throttle: { max_failures: Number(v.throttleFailures), window: v.throttleWindow },
      invitations: { ttl: v.inviteTtl },
      session: { trusted_device: { idle_timeout: v.trustedIdle } },
    },
  };
}

const LOCK_WINDOWS = ['5m', '15m', '30m', '1h'];
const LOCK_DURATIONS = ['5m', '15m', '30m', '1h', '24h'];
const THROTTLE_WINDOWS = ['30s', '1m', '5m', '15m'];
const INVITE_TTLS = ['1d', '3d', '7d', '14d', '30d'];
const TRUSTED_IDLE = ['1d', '3d', '7d', '14d', '30d'];
const RESET_TTLS = ['5m', '15m', '30m', '1h', '4h', '24h'];

const MAX_AGES = [
  { value: 'none', label: 'Never' },
  { value: '30d', label: '30 days' },
  { value: '60d', label: '60 days' },
  { value: '90d', label: '90 days' },
  { value: '180d', label: '180 days' },
  { value: '365d', label: '1 year' },
];

const TRUST_AGES = [
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '14d', label: '14 days' },
  { value: '30d', label: '30 days' },
];

const withCurrent = (options: { value: string; label: string }[], current: string) =>
  options.some((o) => o.value === current) ? options : [...options, { value: current, label: current }];

/** Server paths of the policy's members, for its field errors. */
const PATHS: Record<string, keyof PolicyValues> = {
  'auth.admin.local.enabled': 'local',
  'auth.admin.local.mfa.factors': 'factors',
  'auth.admin.local.password_policy.min_length': 'minLength',
  'auth.admin.local.password_policy.history': 'history',
  'auth.admin.local.password_policy.max_age': 'maxAge',
  'auth.admin.local.sso_required_domains': 'domains',
  'auth.admin.session.trusted_device': 'trustedMaxAge',
  'auth.admin.session.idle_timeout': 'idle',
  'auth.admin.session.absolute_timeout': 'absolute',
  'auth.admin.session.trusted_device.idle_timeout': 'trustedIdle',
  'auth.admin.local.lockout.max_failures': 'lockFailures',
  'auth.admin.local.lockout.window': 'lockWindow',
  'auth.admin.local.lockout.duration': 'lockDuration',
  'auth.admin.login_throttle.max_failures': 'throttleFailures',
  'auth.admin.login_throttle.window': 'throttleWindow',
  'auth.admin.invitations.ttl': 'inviteTtl',
  'auth.admin.local.password_policy.max_length': 'maxLength',
  'auth.admin.local.mfa.recovery_codes': 'recoveryCodes',
  'auth.admin.local.mfa.webauthn.rp_id': 'rpId',
  'auth.admin.local.mfa.webauthn.rp_name': 'rpName',
  'auth.admin.local.reset_token_ttl': 'resetTtl',
  'auth.admin.max_active_users': 'maxUsers',
};

function check(v: PolicyValues): FieldErrors {
  const e: FieldErrors = {};
  const min = Number(v.minLength);
  if (!/^\d+$/.test(v.minLength) || min < 8 || min > 128) e.minLength = 'Enter a length from 8 to 128';
  const longest = rangeError(v.maxLength, 8, 1024);
  if (longest) e.maxLength = longest;
  else if (!e.minLength && Number(v.maxLength) < min) e.maxLength = 'Make it at least the minimum length';
  const codes = rangeError(v.recoveryCodes, 5, 20);
  if (codes) e.recoveryCodes = codes;
  if (v.rpId.trim() && !/^[a-z0-9.-]+$/i.test(v.rpId.trim()))
    e.rpId = 'Enter a domain such as console.example.com';
  if (!v.rpName.trim()) e.rpName = 'Enter the name people see when they use a security key';
  if (v.maxUsers.trim()) {
    const cap = rangeError(v.maxUsers, 1);
    if (cap) e.maxUsers = cap;
  }
  const history = Number(v.history);
  if (!/^\d+$/.test(v.history) || history > 24) e.history = 'Enter a number from 0 to 24';
  if (v.factors.length === 0) e.factors = 'Keep at least one verification method';
  const lock = rangeError(v.lockFailures, 1, 1000);
  if (lock) e.lockFailures = lock;
  const throttle = rangeError(v.throttleFailures, 1);
  if (throttle) e.throttleFailures = throttle;
  if (!DURATION_RE.test(v.idle.trim())) e.idle = 'Enter a duration such as 30m or 1h';
  if (!DURATION_RE.test(v.absolute.trim())) e.absolute = 'Enter a duration such as 12h or 7d';
  const bad = v.domains.find((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d));
  if (bad) e.domains = `"${bad}" isn't a domain such as example.com`;
  return e;
}

/** People with a second step, by kind, among active people. */
function coverage(users: UserResource[]) {
  const people = users.filter(
    (u) => (u.spec.kind ?? 'human') === 'human' && (u.metadata.state ?? 'active') === 'active',
  );
  const has = (u: UserResource, m: string) => (u.metadata.mfa_methods ?? []).includes(m as never);
  const covered = people.filter((u) => (u.metadata.mfa_methods ?? []).length > 0);
  return {
    total: people.length,
    covered: covered.length,
    totp: people.filter((u) => has(u, 'totp')).length,
    webauthn: people.filter((u) => has(u, 'webauthn')).length,
    idp: people.filter((u) => has(u, 'idp')).length,
  };
}

function Coverage({ users }: { users: UserResource[] | null }) {
  const href = useScopedHref('/teams/', { tab: 'access' });
  if (!users) return null;
  const c = coverage(users);
  const ratio = c.total ? c.covered / c.total : 0;
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line px-3.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-ui text-fg">
          <span className="font-semibold">
            {c.total
              ? `${c.covered} of ${plural(c.total, 'active person', 'active people')}`
              : 'No active people'}
          </span>{' '}
          {c.total ? `have a second step (${formatPercent(ratio, 0)})` : 'yet'}
        </p>
        <Link href={href} className="text-caption text-accent hover:underline">
          See who in Teams & users
        </Link>
      </div>
      {c.total ? (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-sunken"
          role="img"
          aria-label={`${formatPercent(ratio, 0)} enrolled`}
        >
          <div
            className="h-full rounded-full bg-accent"
            ref={(el) => {
              if (el) el.style.width = `${Math.round(ratio * 100)}%`;
            }}
          />
        </div>
      ) : null}
      <p className="text-caption text-muted">
        Authenticator app {c.totp} · Security key {c.webauthn} · Identity provider&apos;s own check {c.idp}
      </p>
    </div>
  );
}

/**
 * Whether a secret is set, never its value: the API sends a reference (`${env:NAME}`,
 * `${file:/path}`) as it is, and a literal as `[REDACTED]`.
 */
export function bootstrapWords(value: unknown): string {
  if (typeof value !== 'string' || value === '') return 'Not set';
  const env = /^\$\{env:([^}]+)\}$/.exec(value);
  if (env) return `Set, from the environment variable ${env[1]}`;
  if (value.startsWith('${file:')) return 'Set, read from a file';
  if (/^\$\{\w+:/.test(value)) return 'Set, read from a secret store';
  return 'Set in the configuration';
}

function PolicyForm({
  org,
  initial,
  hasSso,
  bootstrap,
}: {
  org: string;
  initial: PolicyValues;
  hasSso: boolean;
  /** `auth.admin.bootstrap_token` as the API reports it. */
  bootstrap: unknown;
}) {
  const saveAuth = useOrgSettings((s) => s.saveAuth);
  const saveOrg = useOrgSettings((s) => s.saveOrganization);
  const canEdit = useCan('patchAuthSettings');
  const canEditOrg = useCan('patchOrganization');
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dirty = !same(values, initial);
  const set = <K extends keyof PolicyValues>(key: K, value: PolicyValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };

  async function submit() {
    const found = check(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      const authChanged = !same({ ...values, orgLocal: null }, { ...initial, orgLocal: null });
      if (authChanged) {
        const base = {
          admin: {
            local: {
              enabled: values.local,
              mfa: { factors: values.factors },
              password_policy: {
                min_length: Number(values.minLength),
                history: Number(values.history),
                max_age: values.maxAge,
                deny_common: values.denyCommon,
              },
              sso_required_domains: values.domains,
            },
            session: {
              idle_timeout: values.idle.trim(),
              absolute_timeout: values.absolute.trim(),
              trusted_device: { enabled: values.trusted, max_age: values.trustedMaxAge },
            },
          },
        };
        // The added members are written only once changed, so their defaults stay defaults.
        await saveAuth(deepMerge(base, mergePatch(extrasSpec(initial), extrasSpec(values))));
      }
      if (values.orgLocal !== initial.orgLocal) await saveOrg(org, { local_login: values.orgLocal });
      notify('success', 'Sign-in settings saved');
    } catch (e) {
      setError(e);
      setErrors({
        ...detailErrors(e, PATHS),
        ...detailErrors(e, { [`organizations.${org}.local_login`]: 'orgLocal' }),
      });
    } finally {
      setBusy(false);
    }
  }

  const disabled = !canEdit;
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <InlineError error={error} />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-ui font-semibold text-fg">Password sign-in</legend>
        <div className="flex flex-col gap-1">
          <Switch
            checked={values.local}
            disabled={disabled}
            onChange={(v) => set('local', v)}
            label="Let people sign in with an email and password"
          />
          <p className="text-caption text-muted">
            Password accounts always ask for a second step. Admin tokens keep working either way.
          </p>
          {errors.local ? (
            <p role="alert" className="text-caption text-error">
              {errors.local}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <Switch
            checked={values.orgLocal}
            disabled={!canEditOrg || !values.local}
            disabledReason={!values.local ? 'Password sign-in is off for the whole gateway' : undefined}
            onChange={(v) => set('orgLocal', v)}
            label={`Allow it in the ${org} organization`}
          />
          <p className="text-caption text-muted">
            Turn off to make this organization&apos;s people use single sign-on.
          </p>
          {errors.orgLocal ? (
            <p role="alert" className="text-caption text-error">
              {errors.orgLocal}
            </p>
          ) : null}
        </div>
      </fieldset>

      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={errors.factors ? 'factors-error' : undefined}
      >
        <legend className="mb-1 text-ui font-semibold text-fg">Second step</legend>
        <Checkbox
          checked={values.factors.includes('totp')}
          disabled={disabled}
          onChange={(on) =>
            set('factors', on ? [...values.factors, 'totp'] : values.factors.filter((f) => f !== 'totp'))
          }
          label="Authenticator app"
          description="A six-digit code from an app on their phone."
        />
        <Checkbox
          checked={values.factors.includes('webauthn')}
          disabled={disabled}
          onChange={(on) =>
            set(
              'factors',
              on ? [...values.factors, 'webauthn'] : values.factors.filter((f) => f !== 'webauthn'),
            )
          }
          label="Security key or passkey"
          description="A hardware key, or the fingerprint or face check of their device."
        />
        {errors.factors ? (
          <p id="factors-error" role="alert" className="text-caption text-error">
            {errors.factors}
          </p>
        ) : null}
        <Field
          label="Recovery codes per person"
          error={errors.recoveryCodes}
          hint="One-time codes for when the second step is lost, 5 to 20."
          className="mt-2 w-56 max-sm:w-full"
        >
          <NumberInput
            value={values.recoveryCodes}
            min={5}
            max={20}
            disabled={disabled}
            onChange={(v) => set('recoveryCodes', v)}
          />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-ui font-semibold text-fg">Password rules</legend>
        <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
          <Field label="Minimum length" error={errors.minLength} hint="8 to 128 characters.">
            <NumberInput
              value={values.minLength}
              min={8}
              max={128}
              disabled={disabled}
              onChange={(v) => set('minLength', v)}
            />
          </Field>
          <Field label="Maximum length" error={errors.maxLength} hint="8 to 1,024 characters.">
            <NumberInput
              value={values.maxLength}
              min={8}
              max={1024}
              disabled={disabled}
              onChange={(v) => set('maxLength', v)}
            />
          </Field>
          <Field label="Can't reuse the last" error={errors.history} hint="Passwords; 0 allows reuse.">
            <NumberInput
              value={values.history}
              min={0}
              max={24}
              disabled={disabled}
              onChange={(v) => set('history', v)}
            />
          </Field>
          <Field label="Must change every" error={errors.maxAge}>
            <Select
              value={values.maxAge}
              disabled={disabled}
              onChange={(v) => set('maxAge', v)}
              options={withCurrent(MAX_AGES, values.maxAge)}
            />
          </Field>
        </div>
        <Checkbox
          checked={values.denyCommon}
          disabled={disabled}
          onChange={(v) => set('denyCommon', v)}
          label="Refuse common and leaked passwords"
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-ui font-semibold text-fg">Failed sign-ins</legend>
        <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
          <Field
            label="Lock an account after"
            error={errors.lockFailures}
            hint="Wrong passwords in a row, 1 to 1,000."
          >
            <NumberInput
              value={values.lockFailures}
              min={1}
              max={1000}
              disabled={disabled}
              onChange={(v) => set('lockFailures', v)}
            />
          </Field>
          <Field label="Within" error={errors.lockWindow}>
            <Select
              value={values.lockWindow}
              disabled={disabled}
              onChange={(v) => set('lockWindow', v)}
              options={durationOptions(LOCK_WINDOWS, values.lockWindow)}
            />
          </Field>
          <Field label="Locked for" error={errors.lockDuration}>
            <Select
              value={values.lockDuration}
              disabled={disabled}
              onChange={(v) => set('lockDuration', v)}
              options={durationOptions(LOCK_DURATIONS, values.lockDuration)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
          <Field
            label="Slow down an address after"
            error={errors.throttleFailures}
            hint="Failed sign-ins and admin tokens from one address."
          >
            <NumberInput
              value={values.throttleFailures}
              min={1}
              disabled={disabled}
              onChange={(v) => set('throttleFailures', v)}
            />
          </Field>
          <Field label="Within" error={errors.throttleWindow}>
            <Select
              value={values.throttleWindow}
              disabled={disabled}
              onChange={(v) => set('throttleWindow', v)}
              options={durationOptions(THROTTLE_WINDOWS, values.throttleWindow)}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-ui font-semibold text-fg">Single sign-on required</legend>
        <Field
          label="Email domains that must use single sign-on"
          error={errors.domains}
          hint={
            hasSso
              ? 'People with these addresses can’t sign in with a password. Domains aren’t verified.'
              : 'Add a single sign-on provider below first.'
          }
        >
          <MultiSelect
            creatable
            noun="domain"
            placeholder="example.com"
            disabled={disabled || (!hasSso && values.domains.length === 0)}
            value={values.domains}
            options={values.domains.map((d) => ({ value: d, label: d }))}
            onChange={(v) =>
              set(
                'domains',
                v.map((d) => d.trim().toLowerCase().replace(/^@/, '')),
              )
            }
          />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-ui font-semibold text-fg">Sessions</legend>
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Field label="Sign out after inactivity" error={errors.idle} hint="For example 30m, 1h or 8h.">
            <Input
              mono
              value={values.idle}
              disabled={disabled}
              onChange={(e) => set('idle', e.target.value)}
            />
          </Field>
          <Field
            label="Maximum session length"
            error={errors.absolute}
            hint="People must sign in again after this, even if active."
          >
            <Input
              mono
              value={values.absolute}
              disabled={disabled}
              onChange={(e) => set('absolute', e.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
            <Switch
              checked={values.trusted}
              disabled={disabled}
              onChange={(v) => set('trusted', v)}
              label="Offer “trust this browser”"
            />
            <p className="text-caption text-muted">
              A trusted browser skips the second step until it expires.
            </p>
          </div>
          <Field label="Trusted for" error={errors.trustedMaxAge} className="w-44">
            <Select
              value={values.trustedMaxAge}
              disabled={disabled || !values.trusted}
              onChange={(v) => set('trustedMaxAge', v)}
              options={withCurrent(TRUST_AGES, values.trustedMaxAge)}
            />
          </Field>
          <Field label="Or unused for" error={errors.trustedIdle} className="w-44">
            <Select
              value={values.trustedIdle}
              disabled={disabled || !values.trusted}
              onChange={(v) => set('trustedIdle', v)}
              options={durationOptions(TRUSTED_IDLE, values.trustedIdle)}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-ui font-semibold text-fg">Invitations and seats</legend>
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Field
            label="Invitation links last"
            error={errors.inviteTtl}
            hint="A link not used by then must be sent again."
          >
            <Select
              value={values.inviteTtl}
              disabled={disabled}
              onChange={(v) => set('inviteTtl', v)}
              options={durationOptions(INVITE_TTLS, values.inviteTtl)}
            />
          </Field>
          <Field
            label="Most active people"
            optional
            error={errors.maxUsers}
            hint="Invitations and new accounts are refused past it. Empty: no cap."
          >
            <NumberInput
              value={values.maxUsers}
              min={1}
              disabled={disabled}
              placeholder="No cap"
              onChange={(v) => set('maxUsers', v)}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-ui font-semibold text-fg">Sign-in page</legend>
        <Checkbox
          checked={values.showVersion}
          disabled={disabled}
          onChange={(v) => set('showVersion', v)}
          label="Show the gateway's version"
        />
        <Checkbox
          checked={values.ticker}
          disabled={disabled}
          onChange={(v) => set('ticker', v)}
          label="Show the last day's traffic"
          description="Requests, errors and latency of the last 24 hours, to anyone who opens the page."
        />
      </fieldset>

      <Advanced>
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Field
            label="Security key domain"
            optional
            error={errors.rpId}
            hint="Keys registered for one domain don't work on another. Empty: the console's host."
          >
            <Input
              mono
              value={values.rpId}
              disabled={disabled}
              placeholder="console.example.com"
              onChange={(e) => set('rpId', e.target.value)}
            />
          </Field>
          <Field label="Name shown with security keys" error={errors.rpName}>
            <Input
              value={values.rpName}
              disabled={disabled}
              onChange={(e) => set('rpName', e.target.value)}
            />
          </Field>
          <Field label="Password reset links last" error={errors.resetTtl}>
            <Select
              value={values.resetTtl}
              disabled={disabled}
              onChange={(v) => set('resetTtl', v)}
              options={durationOptions(RESET_TTLS, values.resetTtl)}
            />
          </Field>
        </div>
        <Facts
          items={[
            {
              label: 'Bootstrap token',
              value: bootstrapWords(bootstrap),
              hint: 'An admin token for the first sign-in. Change it in the configuration file.',
            },
          ]}
        />
      </Advanced>
      <SaveBar dirty={dirty} busy={busy} canEdit={canEdit} onDiscard={() => setValues(initial)} />
    </form>
  );
}

/**
 * The sign-in policy: password sign-in for the gateway and the organization, second steps and
 * their coverage, password rules, domains that must use single sign-on, sessions and trusted
 * browsers.
 */
export function SignInSection() {
  const loadSettings = useOrgSettings((s) => s.loadSettings);
  const loadOrganization = useOrgSettings((s) => s.loadOrganization);
  const auth = useOrgSettings((s) => s.auth);
  const organization = useOrgSettings((s) => s.organization);
  const scope = useScope((s) => s.scope);
  const org = scopeOrganization(scope) ?? 'default';
  const canReadUsers = useCan('listUsers');
  const [users, setUsers] = useState<UserResource[] | null>(null);
  const [usersError, setUsersError] = useState<unknown>(null);
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);
  useEffect(() => {
    void loadOrganization(org);
  }, [org, loadOrganization]);
  useEffect(() => {
    if (canReadUsers) settingsApi.users().then(setUsers, setUsersError);
  }, [canReadUsers]);
  const admin = auth.data?.spec.admin;
  const sso = admin?.sso;
  const hasSso =
    Object.keys(sso?.oidc ?? {}).length +
      Object.keys(sso?.saml ?? {}).length +
      Object.keys(sso?.oauth ?? {}).length >
    0;
  const initial = useMemo<PolicyValues | null>(() => {
    if (!admin || organization.data?.name !== org) return null;
    const local = admin.local;
    const policy = local?.password_policy;
    const A = SETTINGS_DEFAULTS.auth.admin;
    return {
      local: local?.enabled ?? A.local.enabled,
      orgLocal: organization.data.spec.local_login ?? true,
      factors: local?.mfa?.factors ?? [...A.local.mfa.factors],
      minLength: String(policy?.min_length ?? SETTINGS_DEFAULTS.auth.admin.local.password_policy.min_length),
      history: String(policy?.history ?? SETTINGS_DEFAULTS.auth.admin.local.password_policy.history),
      maxAge: policy?.max_age ?? A.local.password_policy.max_age,
      denyCommon: policy?.deny_common ?? A.local.password_policy.deny_common,
      domains: local?.sso_required_domains ?? [],
      trusted: admin.session?.trusted_device?.enabled ?? A.session.trusted_device.enabled,
      trustedMaxAge: admin.session?.trusted_device?.max_age ?? A.session.trusted_device.max_age,
      idle: admin.session?.idle_timeout ?? A.session.idle_timeout,
      absolute: admin.session?.absolute_timeout ?? A.session.absolute_timeout,
      trustedIdle:
        admin.session?.trusted_device?.idle_timeout ??
        SETTINGS_DEFAULTS.auth.admin.session.trusted_device.idle_timeout,
      lockFailures: String(
        local?.lockout?.max_failures ?? SETTINGS_DEFAULTS.auth.admin.local.lockout.max_failures,
      ),
      lockWindow: local?.lockout?.window ?? SETTINGS_DEFAULTS.auth.admin.local.lockout.window,
      lockDuration: local?.lockout?.duration ?? SETTINGS_DEFAULTS.auth.admin.local.lockout.duration,
      throttleFailures: String(
        admin.login_throttle?.max_failures ?? SETTINGS_DEFAULTS.auth.admin.login_throttle.max_failures,
      ),
      throttleWindow: admin.login_throttle?.window ?? SETTINGS_DEFAULTS.auth.admin.login_throttle.window,
      inviteTtl: admin.invitations?.ttl ?? SETTINGS_DEFAULTS.auth.admin.invitations.ttl,
      maxLength: String(policy?.max_length ?? A.local.password_policy.max_length),
      recoveryCodes: String(local?.mfa?.recovery_codes ?? A.local.mfa.recovery_codes),
      rpId: local?.mfa?.webauthn?.rp_id ?? '',
      rpName: local?.mfa?.webauthn?.rp_name ?? A.local.mfa.webauthn.rp_name,
      resetTtl: local?.reset_token_ttl ?? A.local.reset_token_ttl,
      showVersion: admin.login_page?.show_version ?? A.login_page.show_version,
      ticker: admin.login_page?.ticker?.enabled ?? A.login_page.ticker.enabled,
      maxUsers: admin.max_active_users ? String(admin.max_active_users) : '',
    };
  }, [admin, organization.data, org]);
  return (
    <>
      <TestSignInOutcome />
      <Card
        title="Sign-in & sessions"
        description="How people prove who they are, and how long they stay signed in."
      >
        <LoadError of={auth} subject="Sign-in settings" size="sm" />
        {auth.status === 'loading' && !auth.data ? <LoadingRows rows={4} /> : null}
        <div className="flex flex-col gap-5">
          {usersError ? null : <Coverage users={users} />}
          {initial && auth.data ? (
            <PolicyForm
              key={`${auth.data.metadata.etag}${organization.data?.metadata.etag ?? ''}`}
              org={org}
              initial={initial}
              hasSso={hasSso}
              bootstrap={admin?.bootstrap_token}
            />
          ) : null}
        </div>
      </Card>
    </>
  );
}
