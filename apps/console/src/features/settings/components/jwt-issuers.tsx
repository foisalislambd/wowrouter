'use client';

import { useEffect, useState } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Checkbox, Field, Input, MultiSelect, Segmented, Select } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { MenuButton } from '@/components/ui/menu';
import { CancelButton, Drawer } from '@/components/ui/overlay';
import { EmptyState, InlineError, LoadingRows } from '@/components/ui/states';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import type { components } from '@/lib/api/schema';
import { useEdited } from '@/lib/hooks';
import { plural } from '@/lib/format';
import type { FieldErrors } from '@/lib/validation';
import { notify } from '@/stores/ui';

import { settingsApi } from '../api';
import { durationOptions } from '../choices';
import { detailErrors, mergePatch, NAME_RE, URL_RE } from '../form-errors';
import { useOrgSettings } from '../store';
import { Card } from './parts';
import { Advanced, Hint } from './settings-form';

type JwtSpec = NonNullable<components['schemas']['AuthSettings']['spec']['jwt']>[string];
type Algorithm = NonNullable<JwtSpec['algorithms']>[number];

const ALGORITHMS: Algorithm[] = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'EdDSA',
  'HS256',
  'HS384',
  'HS512',
];
const ASYMMETRIC = ALGORITHMS.filter((a) => !a.startsWith('HS'));
const HMAC = ALGORITHMS.filter((a) => a.startsWith('HS'));

type Source = 'jwks_uri' | 'hmac' | 'inline';

interface MappingRow {
  claim: string;
  /** Comma separated: the claim may hold any of them. */
  values: string;
  key: string;
  /** Other claims of a stored rule, kept as they are. */
  rest: Record<string, string | string[]>;
}

export interface JwtForm {
  name: string;
  issuer: string;
  audiences: string[];
  source: Source;
  jwksUri: string;
  /** Blank on an existing issuer keeps the stored secret. */
  secret: string;
  algorithms: Algorithm[];
  mappings: MappingRow[];
  endUserClaim: string;
  clockSkew: string;
  maxLifetime: string;
  refresh: string;
  maxStale: string;
  insecure: boolean;
}

export function jwtForm(name: string | null, spec: JwtSpec | undefined): JwtForm {
  const source: Source = spec?.jwks ? 'inline' : spec?.hmac_secret && !spec.jwks_uri ? 'hmac' : 'jwks_uri';
  return {
    name: name ?? '',
    issuer: spec?.issuer ?? '',
    audiences: spec?.audiences ?? [],
    source,
    jwksUri: spec?.jwks_uri ?? '',
    secret: '',
    algorithms: spec?.algorithms ?? (source === 'hmac' ? HMAC : ASYMMETRIC),
    mappings: (spec?.mappings ?? []).map((m) => {
      const [first, ...others] = Object.entries(m.match.claims ?? {});
      const value = first?.[1];
      return {
        claim: first?.[0] ?? '',
        values: Array.isArray(value) ? value.join(', ') : (value ?? ''),
        key: m.key,
        rest: Object.fromEntries(others),
      };
    }),
    endUserClaim: spec?.end_user_claim ?? '',
    // Per-entry defaults of `auth.jwt.<name>`, which the generated defaults leave out (fixed paths only).
    clockSkew: spec?.clock_skew ?? '60s',
    maxLifetime: spec?.max_token_lifetime ?? '',
    refresh: spec?.jwks_refresh_interval ?? '5m',
    maxStale: spec?.jwks_max_stale ?? '24h',
    insecure: spec?.allow_insecure_jwks ?? false,
  };
}

/** The issuer as the configuration takes it; the secret only when one was typed. */
export function jwtSpec(f: JwtForm): Record<string, unknown> {
  const values = (text: string) => {
    const list = text
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    return list.length === 1 ? list[0] : list;
  };
  return {
    issuer: f.issuer.trim(),
    audiences: f.audiences,
    ...(f.source === 'jwks_uri' ? { jwks_uri: f.jwksUri.trim(), hmac_secret: null } : {}),
    ...(f.source === 'hmac' ? { jwks_uri: null, ...(f.secret ? { hmac_secret: f.secret } : {}) } : {}),
    algorithms: f.algorithms,
    mappings: f.mappings.map((m) => ({
      match: { claims: { [m.claim.trim()]: values(m.values), ...m.rest } },
      key: m.key,
    })),
    end_user_claim: f.endUserClaim.trim() || null,
    clock_skew: f.clockSkew,
    max_token_lifetime: f.maxLifetime.trim() || null,
    jwks_refresh_interval: f.refresh,
    jwks_max_stale: f.maxStale,
    allow_insecure_jwks: f.insecure,
  };
}

export function jwtErrors(f: JwtForm, isNew: boolean, taken: string[], hasSecret: boolean): FieldErrors {
  const e: FieldErrors = {};
  if (isNew) {
    if (!NAME_RE.test(f.name)) e.name = 'Use letters, digits, . _ and -; start with a letter or digit';
    else if (taken.includes(f.name)) e.name = 'An issuer already has this name';
  }
  if (!f.issuer.trim()) e.issuer = 'Enter the issuer, as tokens name it in "iss"';
  if (f.audiences.length === 0) e.audiences = 'Enter at least one audience';
  if (f.source === 'jwks_uri' && !URL_RE.test(f.jwksUri.trim()))
    e.jwksUri =
      'Enter the address of its public keys, such as https://login.example.com/.well-known/jwks.json';
  if (f.source === 'hmac' && !f.secret && !hasSecret) e.secret = 'Enter the shared secret';
  if (f.algorithms.length === 0) e.algorithms = 'Keep at least one algorithm';
  if (f.maxLifetime.trim() && !/^[0-9]+(\.[0-9]+)?(ms|s|m|h|d)$/.test(f.maxLifetime.trim()))
    e.maxLifetime = 'Enter a duration such as 1h, or leave it empty';
  if (f.mappings.length === 0) e.mappings = 'Add at least one rule: a token that matches none is refused';
  f.mappings.forEach((m, i) => {
    if (!m.claim.trim()) e[`mappings.${i}.claim`] = 'Enter a claim';
    if (!m.values.trim()) e[`mappings.${i}.values`] = 'Enter a value';
    if (!m.key) e[`mappings.${i}.key`] = 'Choose a key';
  });
  return e;
}

/** Keys a token can act as: those of kind `jwt`. */
function useJwtKeys(open: boolean): string[] | null {
  const [keys, setKeys] = useState<string[] | null>(null);
  useEffect(() => {
    if (!open) return;
    settingsApi.keys().then(
      (list) => setKeys(list.filter((k) => k.spec.kind === 'jwt').map((k) => k.name)),
      () => setKeys(null),
    );
  }, [open]);
  return keys;
}

function JwtDrawer({
  name,
  spec,
  taken,
  onClose,
}: {
  name: string | null;
  spec: JwtSpec | undefined;
  taken: string[];
  onClose: () => void;
}) {
  const saveAuth = useOrgSettings((s) => s.saveAuth);
  const canWrite = useCan('patchAuthSettings');
  const [form, setForm] = useState(() => jwtForm(name, spec));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(form);
  const keys = useJwtKeys(true);
  const disabled = !canWrite;
  const set = <K extends keyof JwtForm>(k: K, v: JwtForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest);
  };
  const setRow = (i: number, patch: Partial<MappingRow>) =>
    set(
      'mappings',
      form.mappings.map((m, j) => (j === i ? { ...m, ...patch } : m)),
    );
  const hasSecret = Boolean(spec?.hmac_secret);

  async function submit() {
    const found = jwtErrors(form, name === null, taken, hasSecret);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      const next = jwtSpec(form);
      const body = spec ? mergePatch(spec, next, ['hmac_secret', 'jwks']) : next;
      await saveAuth({ jwt: { [form.name]: body } });
      notify('success', name ? 'Issuer saved' : 'Issuer added', form.name);
      onClose();
    } catch (e) {
      setError(e);
      const base = `auth.jwt.${form.name}`;
      setErrors(
        detailErrors(e, {
          [`${base}.issuer`]: 'issuer',
          [`${base}.audiences`]: 'audiences',
          [`${base}.jwks_uri`]: 'jwksUri',
          [`${base}.hmac_secret`]: 'secret',
          [`${base}.algorithms`]: 'algorithms',
          [`${base}.mappings`]: 'mappings',
          [`${base}.max_token_lifetime`]: 'maxLifetime',
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  const keyOptions = [...new Set([...(keys ?? []), ...form.mappings.map((m) => m.key).filter(Boolean)])].map(
    (k) => ({ value: k, label: k }),
  );

  return (
    <Drawer
      dirty={edited}
      open
      onClose={onClose}
      width="lg"
      title={name ? `Issuer ${name}` : 'Add JWT issuer'}
      subtitle="Apps send a token your identity provider signed instead of an API key. Each rule maps the token's claims to the key it acts as."
      footer={
        <>
          <CancelButton />
          <Button
            variant="primary"
            busy={busy}
            disabled={!canWrite}
            disabledReason={canWrite ? undefined : "You don't have permission to change security settings."}
            onClick={() => void submit()}
          >
            {name ? 'Save changes' : 'Add issuer'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <InlineError error={error} />
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          {name ? null : (
            <Field label="Name" required error={errors.name}>
              <Input
                mono
                data-autofocus
                value={form.name}
                disabled={disabled}
                placeholder="workforce"
                onChange={(e) => set('name', e.target.value)}
              />
            </Field>
          )}
          <Field label="Issuer" required error={errors.issuer} hint='As tokens name it in "iss".'>
            <Input
              mono
              value={form.issuer}
              disabled={disabled}
              placeholder="https://login.example.com"
              onChange={(e) => set('issuer', e.target.value)}
            />
          </Field>
          <Field
            label="Audiences"
            required
            error={errors.audiences}
            hint='A token must name one of them in "aud".'
            className={name ? undefined : 'sm:col-span-2'}
          >
            <MultiSelect
              creatable
              noun="audience"
              placeholder="antirion"
              disabled={disabled}
              value={form.audiences}
              options={form.audiences.map((a) => ({ value: a, label: a }))}
              onChange={(v) => set('audiences', v.map((a) => a.trim()).filter(Boolean))}
            />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-ui font-semibold text-fg">How tokens are checked</legend>
          {form.source === 'inline' ? (
            <Hint>
              This issuer&apos;s public keys are written in the configuration; change them in Configuration.
            </Hint>
          ) : (
            <Segmented<Exclude<Source, 'inline'>>
              label="Key material"
              value={form.source}
              onChange={(v) => {
                set('source', v);
                set('algorithms', v === 'hmac' ? HMAC : ASYMMETRIC);
              }}
              options={[
                { value: 'jwks_uri', label: 'Public keys address' },
                { value: 'hmac', label: 'Shared secret' },
              ]}
            />
          )}
          {form.source === 'jwks_uri' ? (
            <Field label="Public keys address (JWKS)" required error={errors.jwksUri}>
              <Input
                mono
                value={form.jwksUri}
                disabled={disabled}
                placeholder="https://login.example.com/.well-known/jwks.json"
                onChange={(e) => set('jwksUri', e.target.value)}
              />
            </Field>
          ) : null}
          {form.source === 'hmac' ? (
            <Field
              label="Shared secret"
              required={!hasSecret}
              error={errors.secret}
              hint={
                hasSecret
                  ? 'Leave blank to keep the current secret.'
                  : 'Stored encrypted and never shown again. A reference such as ${env:NAME} also works.'
              }
            >
              <Input
                mono
                type="password"
                autoComplete="off"
                value={form.secret}
                disabled={disabled}
                onChange={(e) => set('secret', e.target.value)}
              />
            </Field>
          ) : null}
          <Field label="Algorithms accepted" error={errors.algorithms}>
            <MultiSelect
              noun="algorithm"
              disabled={disabled}
              value={form.algorithms}
              options={ALGORITHMS.map((a) => ({ value: a, label: a }))}
              onChange={(v) => set('algorithms', v as Algorithm[])}
            />
          </Field>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-ui font-semibold text-fg">Which key a token acts as</legend>
          <Hint>
            The first rule whose claim matches wins. Only keys of the JWT kind can be named; a token no rule
            matches is refused.
          </Hint>
          {errors.mappings ? (
            <p role="alert" className="text-caption text-error">
              {errors.mappings}
            </p>
          ) : null}
          {form.mappings.map((m, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-start gap-2 max-md:grid-cols-1">
              <Field label={`Claim ${i + 1}`} error={errors[`mappings.${i}.claim`]}>
                <Input
                  mono
                  value={m.claim}
                  disabled={disabled}
                  placeholder="sub"
                  onChange={(e) => setRow(i, { claim: e.target.value })}
                />
              </Field>
              <Field
                label="Is one of"
                error={errors[`mappings.${i}.values`]}
                hint={
                  Object.keys(m.rest).length
                    ? `And ${plural(Object.keys(m.rest).length, 'more claim')}`
                    : undefined
                }
              >
                <Input
                  mono
                  value={m.values}
                  disabled={disabled}
                  placeholder="svc-reporting, svc-batch"
                  onChange={(e) => setRow(i, { values: e.target.value })}
                />
              </Field>
              <Field label="Acts as key" error={errors[`mappings.${i}.key`]}>
                <Select
                  value={m.key}
                  disabled={disabled}
                  placeholder={keys?.length === 0 ? 'No JWT keys yet' : 'Choose a key'}
                  onChange={(key) => setRow(i, { key })}
                  options={keyOptions}
                />
              </Field>
              <IconButton
                icon="trash"
                className="mt-7"
                label={`Remove rule ${i + 1}`}
                disabled={disabled}
                onClick={() =>
                  set(
                    'mappings',
                    form.mappings.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
          ))}
          <div>
            <Button
              size="sm"
              icon="plus"
              disabled={disabled}
              onClick={() =>
                set('mappings', [...form.mappings, { claim: 'sub', values: '', key: '', rest: {} }])
              }
            >
              Add rule
            </Button>
          </div>
        </fieldset>

        <Field
          label="End user from claim"
          optional
          hint="Records and limits per end user use this claim's value, such as email."
        >
          <Input
            mono
            value={form.endUserClaim}
            disabled={disabled}
            placeholder="email"
            onChange={(e) => set('endUserClaim', e.target.value)}
          />
        </Field>

        <Advanced>
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Field label="Allowed clock difference">
              <Select
                value={form.clockSkew}
                disabled={disabled}
                onChange={(v) => set('clockSkew', v)}
                options={durationOptions(['0s', '30s', '60s', '2m', '5m'], form.clockSkew)}
              />
            </Field>
            <Field
              label="Longest token lifetime"
              optional
              error={errors.maxLifetime}
              hint="Tokens valid for longer are refused. Empty: any."
            >
              <Input
                mono
                value={form.maxLifetime}
                disabled={disabled}
                placeholder="1h"
                onChange={(e) => set('maxLifetime', e.target.value)}
              />
            </Field>
            <Field label="Fetch the public keys again every">
              <Select
                value={form.refresh}
                disabled={disabled || form.source !== 'jwks_uri'}
                onChange={(v) => set('refresh', v)}
                options={durationOptions(['1m', '5m', '15m', '1h', '24h'], form.refresh)}
              />
            </Field>
            <Field label="Keep using the last keys for" hint="While the issuer can't be reached.">
              <Select
                value={form.maxStale}
                disabled={disabled || form.source !== 'jwks_uri'}
                onChange={(v) => set('maxStale', v)}
                options={durationOptions(['0s', '1h', '24h', '7d'], form.maxStale)}
              />
            </Field>
          </div>
          <Checkbox
            label="Allow fetching the public keys without verified HTTPS"
            description="Only for a test issuer: anyone on the path could then sign tokens the gateway accepts."
            checked={form.insecure}
            disabled={disabled || form.source !== 'jwks_uri'}
            onChange={(v) => set('insecure', v)}
          />
        </Advanced>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Drawer>
  );
}

function sourceWords(spec: JwtSpec): string {
  if (spec.jwks) return 'Keys in the configuration';
  if (spec.jwks_uri) {
    try {
      return `Public keys from ${new URL(spec.jwks_uri).host}`;
    } catch {
      return 'Public keys address';
    }
  }
  return 'Shared secret';
}

/** JWT issuers of the data plane: apps send a signed token instead of an API key. */
export function JwtIssuersCard() {
  const auth = useOrgSettings((s) => s.auth);
  const loadSettings = useOrgSettings((s) => s.loadSettings);
  const saveAuth = useOrgSettings((s) => s.saveAuth);
  const canRead = useCan('getAuthSettings');
  const canEdit = useCan('patchAuthSettings');
  const [open, setOpen] = useState<{ name: string | null } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => {
    if (canRead && auth.status === 'idle') void loadSettings();
  }, [canRead, auth.status, loadSettings]);
  if (!canRead) return null;
  const issuers = auth.data?.spec.jwt ?? {};
  const names = Object.keys(issuers).sort();
  return (
    <Card
      title="JWT issuers"
      description="Let apps sign in with a token from your identity provider instead of an API key. For the whole gateway."
      actions={
        canEdit ? (
          <Button size="sm" icon="plus" onClick={() => setOpen({ name: null })}>
            Add issuer
          </Button>
        ) : null
      }
    >
      {auth.status === 'loading' && !auth.data ? <LoadingRows rows={2} /> : null}
      {auth.data && names.length === 0 ? (
        <EmptyState size="sm" title="No JWT issuers" description="Apps use API keys only." />
      ) : null}
      {names.length > 0 ? (
        <Table label="JWT issuers">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Issuer</Th>
              <Th>Checked with</Th>
              <Th>Rules</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {names.map((n) => {
              const spec = issuers[n];
              if (!spec) return null;
              return (
                <Tr key={n}>
                  <Td>
                    <span className="mono text-fg">{n}</span>
                  </Td>
                  <Td muted>
                    <span className="mono">{spec.issuer}</span>
                  </Td>
                  <Td muted>{sourceWords(spec)}</Td>
                  <Td muted>{plural(spec.mappings.length, 'rule')}</Td>
                  <Td className="text-right">
                    <MenuButton
                      iconOnly
                      variant="ghost"
                      size="sm"
                      label={`Actions for ${n}`}
                      items={[
                        {
                          label: canEdit ? 'Edit' : 'View',
                          icon: 'edit',
                          onSelect: () => setOpen({ name: n }),
                        },
                        ...(canEdit
                          ? [
                              {
                                label: 'Remove issuer',
                                icon: 'trash' as const,
                                danger: true,
                                onSelect: () => setRemoving(n),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      ) : null}
      {open ? (
        <JwtDrawer
          name={open.name}
          spec={open.name ? issuers[open.name] : undefined}
          taken={names}
          onClose={() => setOpen(null)}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove JWT issuer ${removing ?? ''}?`}
        objectName={removing ?? undefined}
        confirmLabel="Remove issuer"
        effect="Apps signing in with its tokens are refused from the next request."
        onConfirm={async (reason) => {
          if (!removing) return;
          await saveAuth({ jwt: { [removing]: null } }, reason);
          notify('success', 'Issuer removed', removing);
        }}
      />
    </Card>
  );
}
