'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';

import { useSettingsHref } from '@/components/layout/url-sync';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, useSwitchChanges } from '@/components/ui/confirm';
import { Field, FileButton, Input, Select, Switch } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { Gate, useCan } from '@/components/ui/gate';
import { CopyButton } from '@/components/ui/misc';
import { RevealOnceDialog } from '@/components/ui/reveal-once';
import { ErrorState, InlineError, LoadError, LoadingRows } from '@/components/ui/states';
import { formatBytes, formatCount } from '@/lib/format';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';
import { formatDate, formatRelative } from '@/lib/time';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/validation';
import { usePreferences } from '@/stores/preferences';
import { scopeOrganization, useScope } from '@/stores/scope';
import { useShell } from '@/stores/shell';
import { notify } from '@/stores/ui';

import { settingsApi } from '../api';
import { dataUrlBytes, LogoError, logoDataUrl } from '../logo';
import { useOrgSettings } from '../store';
import { ClientAddressCard, CorsCard, NetworkCard, RateLimitCard, RequestLimitsCard } from './gateway-forms';
import { Card, Facts, GatewayWide, SaveBar } from './parts';

function useSettingsLoad() {
  const loadSettings = useOrgSettings((s) => s.loadSettings);
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);
}

const generalSchema = z.object({
  displayName: z.string().trim().max(200, 'Use at most 200 characters'),
  timezone: z
    .string()
    .regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/, 'Enter a time zone such as Europe/Berlin or UTC'),
  logo: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || v.startsWith('https://') || v.startsWith('data:image/'),
      'Enter an address that starts with https://',
    ),
});

interface GeneralValues {
  displayName: string;
  timezone: string;
  logo: string;
}

/** The logo: an uploaded image (kept inline, at most 64 KB) or an https address, with a preview. */
function LogoField({
  value,
  canEdit,
  error,
  onChange,
}: {
  value: string;
  canEdit: boolean;
  error: string | undefined;
  onChange: (v: string) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uploaded = value.startsWith('data:');
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <span className="text-ui font-medium text-fg">
        Logo <span className="font-normal text-dim">(optional)</span>
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-sunken">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element -- a small inline or remote image; nothing to optimise
            <img src={value} alt="Organization logo" className="h-full w-full object-contain" />
          ) : (
            <Icon name="building" size={18} className="text-dim" />
          )}
        </span>
        <FileButton
          size="sm"
          icon="plus"
          accept="image/png,image/jpeg,image/webp"
          disabled={!canEdit}
          busy={busy}
          onFile={(file) => {
            setBusy(true);
            setProblem(null);
            logoDataUrl(file)
              .then(onChange)
              .catch((e: unknown) =>
                setProblem(
                  e instanceof LogoError ? e.message : "That image couldn't be used. Try another one.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {value ? 'Replace image' : 'Upload image'}
        </FileButton>
        {value ? (
          <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => onChange('')}>
            Remove logo
          </Button>
        ) : null}
        <span className="text-caption text-muted">
          {uploaded
            ? `Uploaded image, ${formatBytes(dataUrlBytes(value))}`
            : 'PNG, JPEG or WebP. Larger images are shrunk to fit 64 KB.'}
        </span>
      </div>
      {uploaded ? null : (
        <Input
          mono
          aria-label="Logo URL"
          value={value}
          disabled={!canEdit}
          placeholder="Or an image address: https://"
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      )}
      {problem || error ? (
        <p role="alert" className="flex items-start gap-1.5 text-caption text-error">
          <Icon name="alertCircle" size={14} className="mt-px shrink-0" />
          {problem ?? error}
        </p>
      ) : null}
    </div>
  );
}

function GeneralForm({ org, initial }: { org: string; initial: GeneralValues }) {
  const save = useOrgSettings((s) => s.saveOrganization);
  const canEdit = useCan('patchOrganization');
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const set = (key: keyof GeneralValues, value: string) => {
    setValues({ ...values, [key]: value });
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };
  async function submit() {
    const result = validate(generalSchema, values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      // A removed logo is sent as null, which a merge patch reads as "remove".
      await save(org, {
        display_name: values.displayName || undefined,
        timezone: values.timezone,
        logo: (values.logo.trim() || null) as string | undefined,
      });
      notify('success', 'Organization saved', org);
    } catch (e) {
      setError(e);
      setErrors(serverFieldErrors(e, `organizations.${org}`));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <InlineError error={error} />
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field label="Display name" error={errors.displayName ?? errors.display_name}>
          <Input
            value={values.displayName}
            disabled={!canEdit}
            onChange={(e) => set('displayName', e.target.value)}
          />
        </Field>
        <Field
          label="Default time zone"
          error={errors.timezone}
          hint="People can choose their own in Preferences."
        >
          <Input
            mono
            value={values.timezone}
            disabled={!canEdit}
            onChange={(e) => set('timezone', e.target.value)}
          />
        </Field>
        <LogoField
          value={values.logo}
          canEdit={canEdit}
          error={errors.logo}
          onChange={(v) => set('logo', v)}
        />
      </div>
      <SaveBar dirty={dirty} busy={busy} canEdit={canEdit} onDiscard={() => setValues(initial)} />
    </form>
  );
}

/** The scope's organization: display name, ID, default time zone and logo, with its facts. */
export function GeneralSection() {
  const scope = useScope((s) => s.scope);
  const org = scopeOrganization(scope) ?? 'default';
  const organization = useOrgSettings((s) => s.organization);
  const load = useOrgSettings((s) => s.loadOrganization);
  const timeZone = usePreferences((s) => s.timeZone);
  useEffect(() => {
    void load(org);
  }, [org, load]);
  const data = organization.data;
  const meta = data?.metadata;
  return (
    <>
      <Card
        title={data?.spec.display_name ?? org}
        description={scope.kind === 'gateway' ? 'Switch organization at the top to edit another.' : undefined}
      >
        {organization.status === 'loading' && !data ? <LoadingRows rows={3} /> : null}
        <LoadError of={organization} subject="The organization" />
        {data ? (
          <GeneralForm
            key={data.metadata.etag}
            org={data.name}
            initial={{
              displayName: data.spec.display_name ?? '',
              timezone: data.spec.timezone ?? 'UTC',
              logo: data.spec.logo ?? '',
            }}
          />
        ) : null}
      </Card>
      {data && meta ? (
        <Card title="About this organization">
          <Facts
            items={[
              {
                label: 'Identifier',
                value: (
                  <span className="flex items-center gap-1">
                    <span className="mono">{data.name}</span>
                    <CopyButton value={data.name} label="Copy the identifier" />
                  </span>
                ),
                hint: "Scripts and the API name the organization by it. It can't be changed.",
              },
              {
                label: 'Created',
                value: meta.created_at ? (
                  formatDate(meta.created_at, timeZone)
                ) : (
                  <span className="text-muted">Not recorded</span>
                ),
                hint: meta.created_at ? undefined : 'It was set up before the gateway kept creation dates.',
              },
              {
                label: 'Last changed',
                value: meta.updated_at ? (
                  `${formatDate(meta.updated_at, timeZone)} · ${formatRelative(meta.updated_at)}`
                ) : (
                  <span className="text-muted">Not recorded</span>
                ),
              },
              { label: 'Configuration version', value: <span className="mono">{meta.generation}</span> },
              {
                label: 'Managed',
                value:
                  meta.managed_by === 'api'
                    ? 'In the console and API'
                    : 'By a configuration file; edits here last until the file is applied again',
              },
            ]}
          />
        </Card>
      ) : null}
    </>
  );
}

/** How the old SCIM token may keep working after a new one is made: the API takes at most 1h. */
export const SCIM_OVERLAPS = [
  { value: '0s', label: 'Stop it now' },
  { value: '15m', label: '15 minutes' },
  { value: '1h', label: '1 hour' },
];

type ScimStatus = Awaited<ReturnType<typeof settingsApi.scim>>;
type AuthSpec = { admin?: { scim?: { enabled?: boolean; token?: unknown } } };

/**
 * SCIM: on or off (the SCIM endpoints answer only while it is on), its URL, and its token,
 * generated or replaced with a short overlap and shown once. Whether a token exists comes from
 * when it was last made (or a token set by reference in the file), not from SCIM being on.
 */
export function ProvisioningSection() {
  useSettingsLoad();
  const auth = useOrgSettings((s) => s.auth);
  const saveAuth = useOrgSettings((s) => s.saveAuth);
  const canEdit = useCan('patchAuthSettings');
  const [status, setStatus] = useState<ScimStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [token, setToken] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [overlap, setOverlap] = useState('0s');
  const [busy, setBusy] = useState(false);
  const { change, dialog } = useSwitchChanges();
  const loadStatus = () => settingsApi.scim().then(setStatus, setError);
  useEffect(() => {
    settingsApi.scim().then(setStatus, setError);
  }, []);
  const base = typeof window === 'undefined' ? '' : `${window.location.origin}/scim/v2`;
  const spec = (auth.data?.spec ?? {}) as AuthSpec;
  const meta = (auth.data?.metadata ?? {}) as { scim_token_rotated_at?: string | null };
  const enabled = status?.enabled ?? spec.admin?.scim?.enabled ?? SETTINGS_DEFAULTS.auth.admin.scim.enabled;
  const byReference = spec.admin?.scim?.token !== undefined && spec.admin.scim.token !== null;
  const rotatedAt = meta.scim_token_rotated_at ?? null;
  const hasToken = byReference || rotatedAt !== null;

  async function setEnabled(next: boolean) {
    setBusy(true);
    try {
      await saveAuth({ admin: { scim: { enabled: next } } });
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="User provisioning (SCIM)"
      badge={<GatewayWide />}
      description="Sync users and groups from your identity provider automatically."
      actions={
        <>
          <Gate operation="rotateScimToken" mode="hide">
            <Button
              size="sm"
              disabled={byReference}
              disabledReason="The token is set by reference in the configuration file. Change it there."
              onClick={() => {
                setOverlap('0s');
                setConfirm(true);
              }}
            >
              {hasToken ? 'Replace token' : 'Generate token'}
            </Button>
          </Gate>
          {status || auth.data ? (
            <Switch
              label="User provisioning"
              hideLabel
              checked={enabled}
              disabled={!canEdit || busy}
              disabledReason="Your role can't change sign-in settings"
              onChange={(next) =>
                change({
                  name: 'user provisioning',
                  apply: () => setEnabled(next),
                  undo: () => setEnabled(!next),
                  done: next ? 'User provisioning turned on' : 'User provisioning turned off',
                  undone: next ? 'User provisioning turned off' : 'User provisioning turned on',
                  ask: next
                    ? undefined
                    : {
                        title: 'Turn off user provisioning?',
                        effect:
                          'Your identity provider can no longer create, update or deactivate people here. Its calls are refused until you turn this back on. People already synced keep their accounts.',
                        confirmLabel: 'Turn off',
                      },
                })
              }
            />
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <ErrorState error={error} subject="User provisioning" size="sm" /> : null}
        <Facts
          items={[
            {
              label: 'SCIM URL',
              value: (
                <span className="flex items-center gap-1">
                  <span className="mono break-all">{base}</span>
                  <CopyButton value={base} label="Copy the SCIM URL" />
                </span>
              ),
              hint: enabled ? undefined : 'It answers only while user provisioning is on.',
            },
            ...(status || auth.data ? [{ label: 'Status', value: enabled ? 'On' : 'Off' }] : []),
            ...(auth.data
              ? [
                  {
                    label: 'Token',
                    value: byReference
                      ? 'Set in the configuration file'
                      : rotatedAt
                        ? `Generated ${formatRelative(rotatedAt)}`
                        : 'None yet',
                    hint:
                      enabled && !hasToken
                        ? 'Generate a token so your identity provider can connect.'
                        : undefined,
                  },
                ]
              : []),
            ...(status
              ? [
                  { label: 'Synced users', value: formatCount(status.users) },
                  { label: 'Synced groups', value: formatCount(status.groups) },
                  {
                    label: 'Last sync',
                    value: status.last_request_at ? formatRelative(status.last_request_at) : 'Never',
                    hint: status.last_error ?? undefined,
                  },
                ]
              : []),
          ]}
        />
      </div>
      {dialog}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={hasToken ? 'Replace the SCIM token?' : 'Generate a SCIM token?'}
        tone="primary"
        confirmLabel={hasToken ? 'Replace token' : 'Generate token'}
        effect={
          hasToken
            ? "You'll see the new token once. The old one keeps working for the time you choose, then stops."
            : "You'll see the token once. Paste it into your identity provider's SCIM settings."
        }
        onConfirm={async () => {
          const r = await settingsApi.rotateScimToken(hasToken ? overlap : '0s');
          setToken(
            (r as { token?: string; secret?: string }).token ?? (r as { secret?: string }).secret ?? null,
          );
          await useOrgSettings.getState().loadSettings();
        }}
      >
        {hasToken ? (
          <Field
            label="Old token keeps working for"
            hint="At most an hour, while you update your identity provider."
          >
            <Select value={overlap} onChange={(v) => setOverlap(v)} options={SCIM_OVERLAPS} />
          </Field>
        ) : null}
      </ConfirmDialog>
      <RevealOnceDialog
        secret={token}
        onClose={() => setToken(null)}
        title="Your SCIM token"
        label="Token"
        description="Paste it into your identity provider's SCIM settings now."
      />
    </Card>
  );
}

/** Where apps connect, rate limiting, the client address, network rules and request sizes. */
export function ApiAccessSection() {
  useSettingsLoad();
  const dataPlane = useShell((s) => s.status?.data_plane_url ?? null);
  const nodeHref = useSettingsHref('node');
  const notSet = (hint: ReactNode) => ({ value: <span className="text-muted">Not set</span>, hint });
  return (
    <>
      <Card title="Gateway URL" description="Where your apps send requests.">
        <Facts
          items={[
            dataPlane
              ? {
                  label: 'Address',
                  value: (
                    <span className="flex items-center gap-1">
                      <span className="mono break-all">{dataPlane}</span>
                      <CopyButton value={dataPlane} label="Copy the gateway URL" />
                    </span>
                  ),
                }
              : {
                  label: 'Address',
                  ...notSet(
                    <>
                      Set <span className="mono">admin.ui.data_plane_url</span> in the gateway&apos;s
                      configuration file, then restart the gateway, so code snippets show the right address.
                    </>,
                  ),
                },
          ]}
        />
        {dataPlane ? null : (
          <Link href={nodeHref} className="mt-3 inline-block text-ui text-accent hover:underline">
            See the node&apos;s settings
          </Link>
        )}
      </Card>
      <RateLimitCard />
      <ClientAddressCard />
      <NetworkCard />
      <RequestLimitsCard />
      <CorsCard />
    </>
  );
}
