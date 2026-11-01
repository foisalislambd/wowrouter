'use client';

import { useEffect } from 'react';

import { Field, Input, NumberInput, Select, Switch } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { Icon } from '@/components/ui/icon';
import { LoadError, LoadingRows } from '@/components/ui/states';
import type { components } from '@/lib/api/schema';
import type { FieldErrors } from '@/lib/validation';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';

import { durationOptions, rangeError } from '../choices';
import { URL_RE } from '../form-errors';
import { useOrgSettings } from '../store';
import { Card } from './parts';
import { Advanced, Hint, SettingsForm } from './settings-form';

type Admin = NonNullable<components['schemas']['AuthSettings']['spec']['admin']>;

/** The auth settings for the cards below, loaded once; null while they can't be read. */
function useAdmin() {
  const auth = useOrgSettings((s) => s.auth);
  const loadSettings = useOrgSettings((s) => s.loadSettings);
  const saveAuth = useOrgSettings((s) => s.saveAuth);
  const canRead = useCan('getAuthSettings');
  const canEdit = useCan('patchAuthSettings');
  useEffect(() => {
    if (canRead && auth.status === 'idle') void loadSettings();
  }, [canRead, auth.status, loadSettings]);
  return {
    auth,
    canRead,
    canEdit,
    admin: auth.data?.spec.admin ?? {},
    etag: auth.data?.metadata.etag,
    save: (admin: Record<string, unknown>) => saveAuth({ admin }),
  };
}

/** The built-in values of the sign-in settings on this page. */
const PD = SETTINGS_DEFAULTS.auth.admin;

/* ---------------------------------------------------------------- Personal tokens */

const TOKEN_LIFETIMES = ['1d', '7d', '30d', '60d', '90d', '180d', '365d'];

export interface TokenRuleValues {
  enabled: boolean;
  maxLifetime: string;
}

export function tokenRuleValues(admin: Admin): TokenRuleValues {
  return {
    enabled: admin.personal_tokens?.enabled ?? PD.personal_tokens.enabled,
    maxLifetime: admin.personal_tokens?.max_lifetime ?? PD.personal_tokens.max_lifetime,
  };
}

function TokensCard() {
  const { auth, canEdit, admin, etag, save } = useAdmin();
  return (
    <Card
      title="Personal admin tokens"
      description="Tokens people create on their Account page, for scripts and the CLI. Each acts as its owner."
    >
      {auth.data ? (
        <SettingsForm
          key={etag}
          initial={tokenRuleValues(admin)}
          toSpec={(v) => ({ personal_tokens: { enabled: v.enabled, max_lifetime: v.maxLifetime } })}
          save={save}
          canEdit={canEdit}
          saved="Personal token settings saved"
          paths={{ 'auth.admin.personal_tokens.max_lifetime': 'maxLifetime' }}
        >
          {({ values, set, errors, disabled }) => (
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
                <Switch
                  label="Let people create personal tokens"
                  checked={values.enabled}
                  disabled={disabled}
                  onChange={(v) => set('enabled', v)}
                />
                <Hint>
                  Off, nobody can create one and CLI sign-in stops. Tokens already made keep working until
                  they expire.
                </Hint>
              </div>
              <Field label="Longest lifetime" error={errors.maxLifetime} className="w-44">
                <Select
                  value={values.maxLifetime}
                  disabled={disabled || !values.enabled}
                  onChange={(v) => set('maxLifetime', v)}
                  options={durationOptions(TOKEN_LIFETIMES, values.maxLifetime)}
                />
              </Field>
            </div>
          )}
        </SettingsForm>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------------- CLI sign-in */

export interface CliValues {
  enabled: boolean;
  tokenTtl: string;
  codeTtl: string;
  poll: string;
  starts: string;
}

export function cliValues(admin: Admin): CliValues {
  const d = admin.device_authorization;
  return {
    enabled: d?.enabled ?? PD.device_authorization.enabled,
    tokenTtl: d?.token_ttl ?? PD.device_authorization.token_ttl,
    codeTtl: d?.code_ttl ?? PD.device_authorization.code_ttl,
    poll: d?.poll_interval ?? PD.device_authorization.poll_interval,
    starts: String(d?.max_starts_per_minute ?? PD.device_authorization.max_starts_per_minute),
  };
}

const cliSpec = (v: CliValues) => ({
  device_authorization: {
    enabled: v.enabled,
    token_ttl: v.tokenTtl,
    code_ttl: v.codeTtl,
    poll_interval: v.poll,
    max_starts_per_minute: Number(v.starts),
  },
});

function CliCard() {
  const { auth, canEdit, admin, etag, save } = useAdmin();
  return (
    <Card
      title="CLI sign-in"
      description="People sign the CLI in with a code they confirm in this console, instead of pasting a token."
    >
      {auth.data ? (
        <SettingsForm
          key={etag}
          initial={cliValues(admin)}
          toSpec={cliSpec}
          save={save}
          canEdit={canEdit}
          saved="CLI sign-in saved"
          check={(v): FieldErrors => {
            const starts = rangeError(v.starts, 1, 1000);
            return starts ? { starts } : {};
          }}
          paths={{
            'auth.admin.device_authorization.token_ttl': 'tokenTtl',
            'auth.admin.device_authorization.code_ttl': 'codeTtl',
            'auth.admin.device_authorization.poll_interval': 'poll',
            'auth.admin.device_authorization.max_starts_per_minute': 'starts',
          }}
        >
          {({ values, set, errors, disabled }) => {
            const off = disabled || !values.enabled;
            return (
              <>
                <div className="flex flex-wrap items-end gap-4">
                  <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
                    <Switch
                      label="Let people sign the CLI in from the console"
                      checked={values.enabled}
                      disabled={disabled}
                      onChange={(v) => set('enabled', v)}
                    />
                    <Hint>
                      {admin.personal_tokens?.enabled === false
                        ? 'Needs personal admin tokens, which are turned off above.'
                        : 'The CLI gets a personal admin token of the person who confirms the code.'}
                    </Hint>
                  </div>
                  <Field label="The CLI stays signed in for" error={errors.tokenTtl} className="w-56">
                    <Select
                      value={values.tokenTtl}
                      disabled={off}
                      onChange={(v) => set('tokenTtl', v)}
                      options={durationOptions(['1h', '8h', '12h', '1d', '7d'], values.tokenTtl)}
                    />
                  </Field>
                </div>
                <Advanced>
                  <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
                    <Field label="A code works for" error={errors.codeTtl}>
                      <Select
                        value={values.codeTtl}
                        disabled={off}
                        onChange={(v) => set('codeTtl', v)}
                        options={durationOptions(['5m', '10m', '15m', '30m', '1h'], values.codeTtl)}
                      />
                    </Field>
                    <Field label="The CLI checks every" error={errors.poll}>
                      <Select
                        value={values.poll}
                        disabled={off}
                        onChange={(v) => set('poll', v)}
                        options={durationOptions(['1s', '2s', '5s', '10s', '30s', '60s'], values.poll)}
                      />
                    </Field>
                    <Field
                      label="Sign-ins per address a minute"
                      error={errors.starts}
                      hint="Codes one address may ask for, 1 to 1,000."
                    >
                      <NumberInput
                        value={values.starts}
                        min={1}
                        max={1000}
                        disabled={off}
                        onChange={(v) => set('starts', v)}
                      />
                    </Field>
                  </div>
                </Advanced>
              </>
            );
          }}
        </SettingsForm>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------------- Playground */

export interface PlaygroundValues {
  enabled: boolean;
  keyTtl: string;
  requests: string;
}

export function playgroundValues(admin: Admin): PlaygroundValues {
  return {
    enabled: admin.playground?.enabled ?? PD.playground.enabled,
    keyTtl: admin.playground?.key_ttl ?? PD.playground.key_ttl,
    requests: String(admin.playground?.max_requests_per_key ?? PD.playground.max_requests_per_key),
  };
}

function PlaygroundCard() {
  const { auth, canEdit, admin, etag, save } = useAdmin();
  return (
    <Card
      title="Playground"
      description="People try Models from the console with a short-lived key the Playground makes for them."
    >
      {auth.data ? (
        <SettingsForm
          key={etag}
          initial={playgroundValues(admin)}
          toSpec={(v) => ({
            playground: {
              enabled: v.enabled,
              key_ttl: v.keyTtl,
              max_requests_per_key: Number(v.requests),
            },
          })}
          save={save}
          canEdit={canEdit}
          saved="Playground settings saved"
          check={(v): FieldErrors => {
            const requests = rangeError(v.requests, 1, 10000);
            return requests ? { requests } : {};
          }}
          paths={{
            'auth.admin.playground.key_ttl': 'keyTtl',
            'auth.admin.playground.max_requests_per_key': 'requests',
          }}
        >
          {({ values, set, errors, disabled }) => (
            <>
              <Switch
                label="Offer the Playground"
                checked={values.enabled}
                disabled={disabled}
                onChange={(v) => set('enabled', v)}
              />
              <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                <Field label="A Playground key lasts" error={errors.keyTtl}>
                  <Select
                    value={values.keyTtl}
                    disabled={disabled || !values.enabled}
                    onChange={(v) => set('keyTtl', v)}
                    options={durationOptions(['5m', '15m', '30m', '1h'], values.keyTtl)}
                  />
                </Field>
                <Field
                  label="Requests per key"
                  error={errors.requests}
                  hint="Then the Playground makes a new key, 1 to 10,000."
                >
                  <NumberInput
                    value={values.requests}
                    min={1}
                    max={10000}
                    disabled={disabled || !values.enabled}
                    onChange={(v) => set('requests', v)}
                  />
                </Field>
              </div>
            </>
          )}
        </SettingsForm>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------------- Console address */

function AddressCard() {
  const { auth, canEdit, admin, etag, save } = useAdmin();
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <Card
      title="Console address"
      description="The address people use to reach this console. Single sign-on and security keys are tied to it."
    >
      {auth.data ? (
        <SettingsForm
          key={etag}
          initial={{ origin: admin.public_origin ?? '' }}
          toSpec={(v) => ({ public_origin: v.origin.trim() ? v.origin.trim().replace(/\/+$/, '') : null })}
          save={save}
          canEdit={canEdit}
          saved="Console address saved"
          check={(v): FieldErrors =>
            v.origin.trim() && !URL_RE.test(v.origin.trim())
              ? { origin: 'Enter an address such as https://gateway.example.com' }
              : {}
          }
          paths={{ 'auth.admin.public_origin': 'origin' }}
        >
          {({ values, set, errors, disabled }) => (
            <>
              <Field
                label="Address"
                optional
                error={errors.origin}
                hint={
                  values.origin.trim()
                    ? undefined
                    : `Empty: each request's own address is used${origin ? `, such as ${origin}` : ''}.`
                }
              >
                <Input
                  mono
                  value={values.origin}
                  disabled={disabled}
                  placeholder="https://gateway.example.com"
                  onChange={(e) => set('origin', e.target.value)}
                />
              </Field>
              {values.origin.trim() !== (admin.public_origin ?? '') ? (
                <p className="flex items-start gap-2 text-ui text-warn" role="status">
                  <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                  The sign-in return addresses of every single sign-on provider change with it: update them at
                  each identity provider. Security keys registered for another address stop working.
                </p>
              ) : null}
            </>
          )}
        </SettingsForm>
      ) : null}
    </Card>
  );
}

/**
 * The rest of sign-in: the console's address, personal admin tokens, CLI sign-in and Playground
 * keys. Shown to people who can read the security settings.
 */
export function SignInExtras() {
  const { auth, canRead } = useAdmin();
  if (!canRead) return null;
  return (
    <>
      {auth.status === 'loading' && !auth.data ? <LoadingRows rows={3} /> : null}
      <LoadError of={auth} subject="Sign-in settings" size="sm" />
      <AddressCard />
      <TokensCard />
      <CliCard />
      <PlaygroundCard />
    </>
  );
}
