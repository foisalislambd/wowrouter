'use client';

import { useState, type ReactNode } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm';
import {
  Checkbox,
  Field,
  Input,
  MultiSelect,
  NumberInput,
  Segmented,
  Select,
  Switch,
} from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { InlineError, LoadError, LoadingRows } from '@/components/ui/states';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';
import type { FieldErrors } from '@/lib/validation';
import { notify } from '@/stores/ui';

import { detailErrors, DURATION_RE, mergePatch, same, URL_RE } from '../form-errors';
import { useOrgSettings } from '../store';
import {
  checkEstimation,
  ESTIMATION_PATHS,
  EstimationFields,
  estimationSpec,
  type EstimationValues,
  estimationValues,
  type LimitsShape,
} from './limit-estimation';
import { Card, SaveBar } from './parts';

/** A size with an IEC unit, as the configuration takes it ("32MiB"). */
export const SIZE_RE = /^[0-9]+(B|KiB|MiB|GiB)$/;
/** An IPv4 or IPv6 address, or a CIDR range. */
export const CIDR_RE =
  /^([0-9]{1,3}(\.[0-9]{1,3}){3}(\/[0-9]{1,2})?|[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*(\/[0-9]{1,3})?)$/;
/** An exact host, or `*.suffix`. */
export const HOST_RE = /^(\*\.)?[A-Za-z0-9._-]+$/;
const HEADER_RE = /^[a-z0-9!#$%&'*+.^_`|~-]+$/;

/**
 * One settings form: values, field errors (local checks first, then the gateway's validation
 * details by configuration path), and a save that sends only what changed as a merge patch.
 */
export function useSettingsForm<V extends object>({
  initial,
  toSpec,
  save,
  paths,
  check,
  saved,
}: {
  initial: V;
  /** The settings member's spec for these values; the patch is its difference from `initial`'s. */
  toSpec: (values: V) => Record<string, unknown>;
  save: (patch: Record<string, unknown>, reason?: string) => Promise<void>;
  /** Configuration paths of the fields, for the gateway's validation details. */
  paths: Record<string, string>;
  check?: (values: V) => FieldErrors;
  saved: string;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dirty = !same(values, initial);
  const set = <K extends keyof V>(key: K, value: V[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    const name = key as string;
    if (errors[name]) setErrors(({ [name]: _, ...rest }) => rest);
  };
  const validate = () => {
    const found = check?.(values) ?? {};
    setErrors(found);
    return Object.keys(found).length === 0;
  };
  /** Saves; a confirmation dialog passes its reason and gets the error back to show. */
  async function submit(reason?: string, rethrow = false) {
    setBusy(true);
    setError(null);
    try {
      await save(mergePatch(toSpec(initial), toSpec(values)), reason);
      notify('success', saved);
    } catch (e) {
      setError(e);
      setErrors(detailErrors(e, paths));
      if (rethrow) throw e;
    } finally {
      setBusy(false);
    }
  }
  return {
    values,
    set,
    errors,
    error,
    busy,
    dirty,
    validate,
    submit,
    reset: () => {
      setValues(initial);
      setErrors({});
      setError(null);
    },
  };
}

/** A form inside a settings card, with Save and Discard at its foot. */
export function SettingsForm({
  form,
  canEdit,
  onSubmit,
  children,
}: {
  form: Pick<ReturnType<typeof useSettingsForm<object>>, 'validate' | 'error' | 'dirty' | 'busy' | 'reset'>;
  canEdit: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (form.validate()) onSubmit();
      }}
    >
      <InlineError error={form.error} />
      {children}
      <SaveBar dirty={form.dirty} busy={form.busy} canEdit={canEdit} onDiscard={form.reset} />
    </form>
  );
}

/** A group of fields under a small heading. */
export function Group({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-ui font-semibold text-fg">{title}</legend>
      {note ? <p className="-mt-2 text-caption text-muted">{note}</p> : null}
      {children}
    </fieldset>
  );
}

const listError = (values: string[], re: RegExp, what: string) => {
  const bad = values.find((v) => !re.test(v));
  return bad ? `"${bad}" isn't ${what}` : undefined;
};

// Rate limiting ---------------------------------------------------------------------------------

type LimitsSpec = LimitsShape & {
  enabled?: boolean;
  algorithm?: string;
  on_store_unavailable?: string;
  headers?: { ietf?: boolean; dialect?: boolean; max_policies?: number; expose_reservation?: boolean };
  forward_upstream_headers?: boolean;
};

interface LimitValues {
  enabled: boolean;
  algorithm: string;
  onStoreDown: string;
  ietf: boolean;
  dialect: boolean;
  maxPolicies: string;
  exposeReservation: boolean;
  forwardUpstream: boolean;
  estimation: EstimationValues;
}

const LD = SETTINGS_DEFAULTS.limits;

export function limitValues(spec: LimitsSpec): LimitValues {
  return {
    enabled: spec.enabled ?? LD.enabled,
    algorithm: spec.algorithm ?? LD.algorithm,
    onStoreDown: spec.on_store_unavailable ?? LD.on_store_unavailable,
    ietf: spec.headers?.ietf ?? LD.headers.ietf,
    dialect: spec.headers?.dialect ?? LD.headers.dialect,
    maxPolicies: String(spec.headers?.max_policies ?? LD.headers.max_policies),
    exposeReservation: spec.headers?.expose_reservation ?? LD.headers.expose_reservation,
    forwardUpstream: spec.forward_upstream_headers ?? LD.forward_upstream_headers,
    estimation: estimationValues(spec),
  };
}

const limitsSpec = (v: LimitValues) => ({
  enabled: v.enabled,
  algorithm: v.algorithm,
  on_store_unavailable: v.onStoreDown,
  headers: {
    ietf: v.ietf,
    dialect: v.dialect,
    max_policies: Number(v.maxPolicies),
    expose_reservation: v.exposeReservation,
  },
  forward_upstream_headers: v.forwardUpstream,
  ...estimationSpec(v.estimation),
});

const ALGORITHMS = [
  {
    value: 'gcra',
    label: 'Smooth rate (GCRA)',
    description: 'Spreads requests evenly; a burst uses up the allowance early.',
  },
  {
    value: 'sliding_window',
    label: 'Sliding window',
    description: 'Counts requests over the last window; allows bursts up to the limit.',
  },
];

const STORE_DOWN = [
  {
    value: 'local_share',
    label: 'Each node enforces its share',
    description: 'Every node allows its part of each limit until the store is back.',
  },
  { value: 'fail_closed', label: 'Refuse requests', description: 'Requests that need a limit get 503.' },
  { value: 'fail_open', label: 'Let requests through', description: 'Limits are not enforced.' },
];

function RateLimitForm({ initial }: { initial: LimitValues }) {
  const saveLimits = useOrgSettings((s) => s.saveLimits);
  const canEdit = useCan('patchLimitsSettings');
  const [confirmOff, setConfirmOff] = useState(false);
  const form = useSettingsForm({
    initial,
    toSpec: limitsSpec,
    save: saveLimits,
    saved: 'Rate limiting saved',
    paths: {
      'limits.enabled': 'enabled',
      'limits.algorithm': 'algorithm',
      'limits.on_store_unavailable': 'onStoreDown',
      'limits.headers.max_policies': 'maxPolicies',
      ...ESTIMATION_PATHS,
    },
    check: (v): FieldErrors => {
      const n = Number(v.maxPolicies);
      return {
        ...(/^\d+$/.test(v.maxPolicies) && n >= 1 && n <= 32 ? {} : { maxPolicies: 'Enter 1 to 32' }),
        ...checkEstimation(v.estimation),
      };
    },
  });
  const { values: v, set, errors } = form;
  const disabled = !canEdit;
  return (
    <SettingsForm
      form={form}
      canEdit={canEdit}
      onSubmit={() => {
        if (initial.enabled && !v.enabled) setConfirmOff(true);
        else void form.submit();
      }}
    >
      <div className="flex flex-col gap-1">
        <Switch
          checked={v.enabled}
          disabled={disabled}
          onChange={(on) => set('enabled', on)}
          label="Enforce rate limits"
        />
        <p className="text-caption text-muted">
          Off, no limit set on keys, projects, teams or models is enforced. Budgets still apply.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Field label="Counting method" error={errors.algorithm}>
          <Select
            value={v.algorithm}
            disabled={disabled}
            onChange={(x) => set('algorithm', x)}
            options={ALGORITHMS}
          />
        </Field>
        <Field label="If the limit store is down" error={errors.onStoreDown}>
          <Select
            value={v.onStoreDown}
            disabled={disabled}
            onChange={(x) => set('onStoreDown', x)}
            options={STORE_DOWN}
          />
        </Field>
      </div>
      <Group title="Rate-limit headers" note="What responses tell apps about their remaining allowance.">
        <Checkbox
          checked={v.ietf}
          disabled={disabled}
          onChange={(on) => set('ietf', on)}
          label="Standard RateLimit headers"
          description="RateLimit and RateLimit-Policy, as the IETF draft names them."
        />
        <Checkbox
          checked={v.dialect}
          disabled={disabled}
          onChange={(on) => set('dialect', on)}
          label="Each API's own headers"
          description="Such as x-ratelimit-remaining-requests for OpenAI and anthropic-ratelimit-* for Anthropic."
        />
        <Checkbox
          checked={v.exposeReservation}
          disabled={disabled}
          onChange={(on) => set('exposeReservation', on)}
          label="Show the tokens held for a request in progress"
        />
        <Checkbox
          checked={v.forwardUpstream}
          disabled={disabled}
          onChange={(on) => set('forwardUpstream', on)}
          label="Pass on the provider's own rate-limit headers"
        />
        <Field
          label="Limits listed at most"
          error={errors.maxPolicies}
          hint="In RateLimit-Policy, 1 to 32."
          className="max-w-56"
        >
          <NumberInput
            value={v.maxPolicies}
            min={1}
            max={32}
            disabled={disabled}
            onChange={(x) => set('maxPolicies', x)}
          />
        </Field>
      </Group>
      <EstimationFields
        values={v.estimation}
        set={(patch) => set('estimation', { ...v.estimation, ...patch })}
        errors={errors}
        disabled={disabled}
      />
      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title="Turn off rate limiting?"
        confirmLabel="Turn off and save"
        effect="No rate limit is enforced on any key, project, team or model until you turn it back on. Budgets still apply."
        onConfirm={(reason) => form.submit(reason, true)}
      />
    </SettingsForm>
  );
}

/** Rate limiting: on or off, how limits are counted, what happens when the store is down, and headers. */
export function RateLimitCard() {
  const limits = useOrgSettings((s) => s.limits);
  const data = limits.data;
  return (
    <Card title="Rate limiting" description="How the gateway counts and enforces limits.">
      {limits.status === 'loading' && !data ? <LoadingRows rows={3} /> : null}
      <LoadError of={limits} subject="Rate limiting" size="sm" />
      {data ? <RateLimitForm key={data.metadata.etag} initial={limitValues(data.spec)} /> : null}
    </Card>
  );
}

// Security: client address, network, request sizes ---------------------------------------------

export type SecuritySpec = {
  egress?: {
    operator?: { deny_private?: boolean; allow_cidrs?: string[]; allow_hosts?: string[] };
    client_influenced?: { allowed_ports?: number[]; allow_cidrs?: string[]; allow_hosts?: string[] };
    metadata_hosts_extra?: string[];
    proxy?: { url: string; no_proxy?: string[] } | null;
    tls?: { ca_file?: string | null };
  };
  limits?: Partial<Record<keyof typeof SETTINGS_DEFAULTS.security.limits, string | number>>;
  client_ip?: { trusted_proxies?: string[]; header?: string };
  cors?: Partial<Record<'data' | 'admin', CorsSpec>>;
};

type CorsSpec = {
  allowed_origins?: string[];
  allowed_methods?: string[];
  max_age?: string;
  allow_credentials?: boolean;
};

function useSecurityForm() {
  const security = useOrgSettings((s) => s.security);
  return { security, spec: (security.data?.spec ?? {}) as SecuritySpec };
}

function SecurityCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: (spec: SecuritySpec, etag: string) => ReactNode;
}) {
  const { security, spec } = useSecurityForm();
  const data = security.data;
  return (
    <Card title={title} description={description}>
      {security.status === 'loading' && !data ? <LoadingRows rows={3} /> : null}
      <LoadError of={security} subject="Security settings" size="sm" />
      {data ? children(spec, data.metadata.etag) : null}
    </Card>
  );
}

const STANDARD_HEADERS = ['x-forwarded-for', 'forwarded'];

interface ClientValues {
  proxies: string[];
  header: string;
  customHeader: string;
}

export function clientValues(spec: SecuritySpec): ClientValues {
  const header = spec.client_ip?.header ?? SETTINGS_DEFAULTS.security.client_ip.header;
  const standard = STANDARD_HEADERS.includes(header);
  return {
    proxies: spec.client_ip?.trusted_proxies ?? [],
    header: standard ? header : 'custom',
    customHeader: standard ? '' : header,
  };
}

const clientSpec = (v: ClientValues) => ({
  client_ip: {
    trusted_proxies: v.proxies,
    header: v.header === 'custom' ? v.customHeader.trim().toLowerCase() : v.header,
  },
});

function ClientAddressForm({ initial }: { initial: ClientValues }) {
  const saveSecurity = useOrgSettings((s) => s.saveSecurity);
  const canEdit = useCan('patchSecuritySettings');
  const form = useSettingsForm({
    initial,
    toSpec: clientSpec,
    save: saveSecurity,
    saved: 'Client address settings saved',
    paths: {
      'security.client_ip.trusted_proxies': 'proxies',
      'security.client_ip.header': 'header',
    },
    check: (v) => {
      const e: FieldErrors = {};
      const proxies = listError(v.proxies, CIDR_RE, 'an IP address or range such as 10.0.0.0/8');
      if (proxies) e.proxies = proxies;
      if (v.header === 'custom' && !HEADER_RE.test(v.customHeader.trim().toLowerCase()))
        e.customHeader = 'Enter a header name such as x-real-ip';
      return e;
    },
  });
  const { values: v, set, errors } = form;
  const disabled = !canEdit;
  return (
    <SettingsForm form={form} canEdit={canEdit} onSubmit={() => void form.submit()}>
      <Field
        label="Trusted proxies"
        error={errors.proxies}
        hint={
          v.proxies.length
            ? 'The client address is read from the header only on connections from these addresses.'
            : 'None: the gateway uses the connecting address. Add your load balancer’s range if there is one.'
        }
      >
        <MultiSelect
          creatable
          mono
          noun="range"
          value={v.proxies}
          disabled={disabled}
          onChange={(x) => set('proxies', x)}
          options={v.proxies.map((p) => ({ value: p, label: p }))}
          placeholder="Add an address or range, such as 10.0.0.0/8"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Field label="Client address header" error={errors.header}>
          <Select
            value={v.header}
            disabled={disabled}
            onChange={(x) => set('header', x)}
            options={[
              { value: 'x-forwarded-for', label: 'X-Forwarded-For' },
              { value: 'forwarded', label: 'Forwarded' },
              { value: 'custom', label: 'Another header' },
            ]}
          />
        </Field>
        {v.header === 'custom' ? (
          <Field label="Header name" error={errors.customHeader} hint="One that carries a single address.">
            <Input
              mono
              value={v.customHeader}
              disabled={disabled}
              placeholder="x-real-ip"
              onChange={(e) => set('customHeader', e.target.value)}
            />
          </Field>
        ) : null}
      </div>
    </SettingsForm>
  );
}

/** Where the client's address comes from: IP allow-lists, per-address limits and the request log use it. */
export function ClientAddressCard() {
  return (
    <SecurityCard
      title="Client address"
      description="Which proxies may tell the gateway the client's real address. IP allow-lists, limits per address and the request log use it."
    >
      {(spec, etag) => <ClientAddressForm key={etag} initial={clientValues(spec)} />}
    </SecurityCard>
  );
}

interface NetworkValues {
  proxyUrl: string;
  noProxy: string[];
  denyPrivate: boolean;
  operatorCidrs: string[];
  operatorHosts: string[];
  ports: string[];
  clientCidrs: string[];
  clientHosts: string[];
  metadataHosts: string[];
}

const ED = SETTINGS_DEFAULTS.security.egress;

export function networkValues(spec: SecuritySpec): NetworkValues {
  const e = spec.egress ?? {};
  return {
    proxyUrl: e.proxy?.url ?? '',
    noProxy: e.proxy?.no_proxy ?? [],
    denyPrivate: e.operator?.deny_private ?? ED.operator.deny_private,
    operatorCidrs: e.operator?.allow_cidrs ?? [],
    operatorHosts: e.operator?.allow_hosts ?? [],
    ports: (e.client_influenced?.allowed_ports ?? ED.client_influenced.allowed_ports).map(String),
    clientCidrs: e.client_influenced?.allow_cidrs ?? [],
    clientHosts: e.client_influenced?.allow_hosts ?? [],
    metadataHosts: e.metadata_hosts_extra ?? [],
  };
}

const networkSpec = (v: NetworkValues) => ({
  egress: {
    proxy: v.proxyUrl.trim()
      ? { url: v.proxyUrl.trim(), ...(v.noProxy.length ? { no_proxy: v.noProxy } : {}) }
      : null,
    operator: { deny_private: v.denyPrivate, allow_cidrs: v.operatorCidrs, allow_hosts: v.operatorHosts },
    client_influenced: {
      allowed_ports: v.ports.map(Number),
      allow_cidrs: v.clientCidrs,
      allow_hosts: v.clientHosts,
    },
    metadata_hosts_extra: v.metadataHosts,
  },
});

function ListField({
  label,
  hint,
  error,
  value,
  onChange,
  disabled,
  noun,
  placeholder,
}: {
  label: string;
  hint?: string;
  error: string | undefined;
  value: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
  noun: string;
  placeholder: string;
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      <MultiSelect
        creatable
        mono
        noun={noun}
        value={value}
        disabled={disabled}
        onChange={onChange}
        options={value.map((x) => ({ value: x, label: x }))}
        placeholder={placeholder}
      />
    </Field>
  );
}

function NetworkForm({ initial }: { initial: NetworkValues }) {
  const saveSecurity = useOrgSettings((s) => s.saveSecurity);
  const canEdit = useCan('patchSecuritySettings');
  const form = useSettingsForm({
    initial,
    toSpec: networkSpec,
    save: saveSecurity,
    saved: 'Network settings saved',
    paths: {
      'security.egress.proxy.url': 'proxyUrl',
      'security.egress.proxy.no_proxy': 'noProxy',
      'security.egress.proxy': 'proxyUrl',
      'security.egress.operator.deny_private': 'denyPrivate',
      'security.egress.operator.allow_cidrs': 'operatorCidrs',
      'security.egress.operator.allow_hosts': 'operatorHosts',
      'security.egress.client_influenced.allowed_ports': 'ports',
      'security.egress.client_influenced.allow_cidrs': 'clientCidrs',
      'security.egress.client_influenced.allow_hosts': 'clientHosts',
      'security.egress.metadata_hosts_extra': 'metadataHosts',
    },
    check: (v) => {
      const e: FieldErrors = {};
      if (v.proxyUrl.trim() && !URL_RE.test(v.proxyUrl.trim()))
        e.proxyUrl = 'Enter an address such as http://proxy.internal:3128';
      if (!v.proxyUrl.trim() && v.noProxy.length) e.noProxy = 'Set a proxy first';
      const cidr = 'an IP address or range such as 10.0.0.0/8';
      const host = 'a host such as api.example.com or *.example.com';
      const checks: [keyof NetworkValues, string[], RegExp, string][] = [
        ['operatorCidrs', v.operatorCidrs, CIDR_RE, cidr],
        ['operatorHosts', v.operatorHosts, HOST_RE, host],
        ['clientCidrs', v.clientCidrs, CIDR_RE, cidr],
        ['clientHosts', v.clientHosts, HOST_RE, host],
      ];
      for (const [key, list, re, what] of checks) {
        const bad = listError(list, re, what);
        if (bad) e[key] = bad;
      }
      const port = v.ports.find((p) => !/^\d+$/.test(p) || Number(p) < 1 || Number(p) > 65535);
      if (port) e.ports = `"${port}" isn't a port from 1 to 65535`;
      if (v.ports.length === 0) e.ports = 'Keep at least one port';
      return e;
    },
  });
  const { values: v, set, errors } = form;
  const disabled = !canEdit;
  return (
    <SettingsForm form={form} canEdit={canEdit} onSubmit={() => void form.submit()}>
      <Group title="Outbound proxy">
        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          <Field label="Proxy address" optional error={errors.proxyUrl} hint="Empty: connect directly.">
            <Input
              mono
              value={v.proxyUrl}
              disabled={disabled}
              placeholder="http://proxy.internal:3128"
              onChange={(e) => set('proxyUrl', e.target.value)}
            />
          </Field>
          <ListField
            label="Connect directly to"
            error={errors.noProxy}
            value={v.noProxy}
            onChange={(x) => set('noProxy', x)}
            disabled={disabled || !v.proxyUrl.trim()}
            noun="host"
            placeholder="Add a host that skips the proxy"
          />
        </div>
      </Group>
      <Group
        title="The gateway's own calls"
        note="Providers, webhooks, identity providers and other addresses set in the configuration."
      >
        <div className="flex flex-col gap-1">
          <Switch
            checked={v.denyPrivate}
            disabled={disabled}
            onChange={(on) => set('denyPrivate', on)}
            label="Block calls to private networks"
          />
          <p className="text-caption text-muted">
            Private, loopback and link-local addresses, unless allowed below. Cloud metadata addresses are
            always blocked.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          <ListField
            label="Allowed ranges"
            error={errors.operatorCidrs}
            value={v.operatorCidrs}
            onChange={(x) => set('operatorCidrs', x)}
            disabled={disabled}
            noun="range"
            placeholder="Add a range, such as 10.20.0.0/16"
          />
          <ListField
            label="Allowed hosts"
            error={errors.operatorHosts}
            value={v.operatorHosts}
            onChange={(x) => set('operatorHosts', x)}
            disabled={disabled}
            noun="host"
            placeholder="Add a host, such as *.internal"
          />
        </div>
      </Group>
      <Group
        title="Addresses that requests supply"
        note="Image and file URLs in requests, and addresses set for one organization, team or project. Private networks are blocked for these unless allowed below."
      >
        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          <ListField
            label="Allowed ports"
            error={errors.ports}
            value={v.ports}
            onChange={(x) => set('ports', x)}
            disabled={disabled}
            noun="port"
            placeholder="Add a port"
          />
          <ListField
            label="Allowed ranges"
            error={errors.clientCidrs}
            value={v.clientCidrs}
            onChange={(x) => set('clientCidrs', x)}
            disabled={disabled}
            noun="range"
            placeholder="Add a range, such as 10.20.0.0/16"
          />
          <ListField
            label="Allowed hosts"
            error={errors.clientHosts}
            value={v.clientHosts}
            onChange={(x) => set('clientHosts', x)}
            disabled={disabled}
            noun="host"
            placeholder="Add a host, such as files.internal"
          />
          <ListField
            label="Also block these metadata hosts"
            error={errors.metadataHosts}
            value={v.metadataHosts}
            onChange={(x) => set('metadataHosts', x)}
            disabled={disabled}
            noun="host"
            placeholder="Add a host"
          />
        </div>
      </Group>
    </SettingsForm>
  );
}

/** Where the gateway may connect: an outbound proxy and the egress allow-lists. */
export function NetworkCard() {
  return (
    <SecurityCard title="Network" description="Where the gateway may connect, and through which proxy.">
      {(spec, etag) => <NetworkForm key={etag} initial={networkValues(spec)} />}
    </SecurityCard>
  );
}

type SizeKey = keyof typeof SETTINGS_DEFAULTS.security.limits;
type SizeValues = Record<SizeKey, string>;

const SIZE_FIELDS: { key: SizeKey; label: string; kind: 'size' | 'count'; min?: number; max?: number }[] = [
  { key: 'max_body', label: 'Largest request', kind: 'size' },
  { key: 'max_upload_body', label: 'Largest file upload', kind: 'size' },
  { key: 'max_upstream_response', label: 'Largest provider response', kind: 'size' },
  { key: 'max_messages', label: 'Messages per request', kind: 'count', min: 1 },
  { key: 'max_json_depth', label: 'JSON nesting depth', kind: 'count', min: 16, max: 1024 },
  { key: 'max_header_bytes', label: 'Header size, all together', kind: 'size' },
  { key: 'max_header_count', label: 'Headers per request', kind: 'count', min: 1 },
  { key: 'max_uri_length', label: 'URL length, in characters', kind: 'count', min: 1 },
];

export function sizeValues(spec: SecuritySpec): SizeValues {
  const d = SETTINGS_DEFAULTS.security.limits;
  const out = {} as SizeValues;
  for (const f of SIZE_FIELDS) out[f.key] = String(spec.limits?.[f.key] ?? d[f.key]);
  return out;
}

const sizeSpec = (v: SizeValues) => ({
  limits: Object.fromEntries(
    SIZE_FIELDS.map((f) => [f.key, f.kind === 'count' ? Number(v[f.key]) : v[f.key].trim()]),
  ),
});

function RequestLimitsForm({ initial }: { initial: SizeValues }) {
  const saveSecurity = useOrgSettings((s) => s.saveSecurity);
  const canEdit = useCan('patchSecuritySettings');
  const form = useSettingsForm({
    initial,
    toSpec: sizeSpec,
    save: saveSecurity,
    saved: 'Request size limits saved',
    paths: Object.fromEntries(SIZE_FIELDS.map((f) => [`security.limits.${f.key}`, f.key])),
    check: (v) => {
      const e: FieldErrors = {};
      for (const f of SIZE_FIELDS) {
        const x = v[f.key].trim();
        if (f.kind === 'size' && !SIZE_RE.test(x)) e[f.key] = 'Enter a size such as 32MiB';
        if (f.kind === 'count') {
          const n = Number(x);
          if (!/^\d+$/.test(x) || n < (f.min ?? 1) || n > (f.max ?? Number.MAX_SAFE_INTEGER))
            e[f.key] = f.max ? `Enter ${f.min} to ${f.max}` : `Enter at least ${f.min ?? 1}`;
        }
      }
      return e;
    },
  });
  const { values: v, set, errors } = form;
  const d = SETTINGS_DEFAULTS.security.limits;
  return (
    <SettingsForm form={form} canEdit={canEdit} onSubmit={() => void form.submit()}>
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        {SIZE_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} error={errors[f.key]} hint={`Default ${String(d[f.key])}`}>
            {f.kind === 'size' ? (
              <Input mono value={v[f.key]} disabled={!canEdit} onChange={(e) => set(f.key, e.target.value)} />
            ) : (
              <NumberInput
                value={v[f.key]}
                min={f.min}
                max={f.max}
                disabled={!canEdit}
                onChange={(x) => set(f.key, x)}
              />
            )}
          </Field>
        ))}
      </div>
    </SettingsForm>
  );
}

/** The largest request, upload, response and headers the gateway accepts; larger ones are refused. */
export function RequestLimitsCard() {
  return (
    <SecurityCard
      title="Request size limits"
      description="Requests over these limits are refused before they reach a provider."
    >
      {(spec, etag) => <RequestLimitsForm key={etag} initial={sizeValues(spec)} />}
    </SecurityCard>
  );
}

// Browser access (CORS) ----------------------------------------------------------------------------

type Listener = 'data' | 'admin';

const ORIGIN_RE = /^(\*|[A-Za-z][A-Za-z0-9+.-]*:\/\/(\*\.)?[^/\s*]+)$/;
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

interface CorsValues {
  origins: string[];
  methods: string[];
  maxAge: string;
  credentials: boolean;
}

export function corsValues(spec: SecuritySpec, listener: Listener): CorsValues {
  const c = spec.cors?.[listener] ?? {};
  const d = SETTINGS_DEFAULTS.security.cors[listener];
  return {
    origins: c.allowed_origins ?? [...d.allowed_origins],
    methods: c.allowed_methods ?? [...d.allowed_methods],
    maxAge: c.max_age ?? d.max_age,
    credentials: c.allow_credentials ?? d.allow_credentials,
  };
}

const corsSpec = (listener: Listener) => (v: CorsValues) => ({
  cors: {
    [listener]: {
      allowed_origins: v.origins,
      allowed_methods: METHODS.filter((m) => v.methods.includes(m)),
      max_age: v.maxAge.trim(),
      allow_credentials: v.credentials,
    },
  },
});

function CorsForm({ listener, initial }: { listener: Listener; initial: CorsValues }) {
  const saveSecurity = useOrgSettings((s) => s.saveSecurity);
  const canEdit = useCan('patchSecuritySettings');
  const base = `security.cors.${listener}`;
  const form = useSettingsForm({
    initial,
    toSpec: corsSpec(listener),
    save: saveSecurity,
    saved: 'Browser access saved',
    paths: {
      [`${base}.allowed_origins`]: 'origins',
      [`${base}.allowed_methods`]: 'methods',
      [`${base}.max_age`]: 'maxAge',
      [`${base}.allow_credentials`]: 'credentials',
    },
    check: (v) => {
      const e: FieldErrors = {};
      const bad = listError(v.origins, ORIGIN_RE, 'an origin such as https://app.example.com, or *');
      if (bad) e.origins = bad;
      if (v.credentials && v.origins.includes('*'))
        e.credentials = 'Name each origin to send credentials; * is not allowed with them';
      if (v.methods.length === 0) e.methods = 'Keep at least one method';
      if (!DURATION_RE.test(v.maxAge.trim())) e.maxAge = 'Enter a duration such as 10m';
      return e;
    },
  });
  const { values: v, set, errors } = form;
  const disabled = !canEdit;
  return (
    <SettingsForm form={form} canEdit={canEdit} onSubmit={() => void form.submit()}>
      <Field
        label="Allowed origins"
        error={errors.origins}
        hint={
          v.origins.length
            ? 'Web pages on these origins may call from a browser. * allows any.'
            : 'None: browsers may not call from another origin.'
        }
      >
        <MultiSelect
          creatable
          mono
          noun="origin"
          value={v.origins}
          disabled={disabled}
          onChange={(x) => set('origins', x)}
          options={v.origins.map((o) => ({ value: o, label: o }))}
          placeholder="Add an origin, such as https://app.example.com"
        />
      </Field>
      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={errors.methods ? `${listener}-methods` : undefined}
      >
        <legend className="mb-1 text-ui font-medium text-fg">Allowed methods</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {METHODS.map((m) => (
            <Checkbox
              key={m}
              checked={v.methods.includes(m)}
              disabled={disabled}
              onChange={(on) => set('methods', on ? [...v.methods, m] : v.methods.filter((x) => x !== m))}
              label={<span className="mono">{m}</span>}
            />
          ))}
        </div>
        {errors.methods ? (
          <p id={`${listener}-methods`} role="alert" className="text-caption text-error">
            {errors.methods}
          </p>
        ) : null}
      </fieldset>
      <div className="flex flex-col gap-1">
        <Switch
          checked={v.credentials}
          disabled={disabled}
          onChange={(on) => set('credentials', on)}
          label="Allow cookies and credentials"
        />
        {errors.credentials ? (
          <p role="alert" className="text-caption text-error">
            {errors.credentials}
          </p>
        ) : (
          <p className="text-caption text-muted">Only with named origins, never with *.</p>
        )}
      </div>
      <Field
        label="Browsers remember the answer for"
        error={errors.maxAge}
        hint={`Default ${SETTINGS_DEFAULTS.security.cors[listener].max_age}`}
        className="max-w-56"
      >
        <Input mono value={v.maxAge} disabled={disabled} onChange={(e) => set('maxAge', e.target.value)} />
      </Field>
    </SettingsForm>
  );
}

/** Which web pages may call the gateway from a browser: apps (the data plane) and the console. */
export function CorsCard() {
  const [listener, setListener] = useState<Listener>('data');
  return (
    <SecurityCard
      title="Browser access (CORS)"
      description="Which web pages may call the gateway from a browser."
    >
      {(spec, etag) => (
        <div className="flex flex-col gap-4">
          <Segmented<Listener>
            label="Listener"
            className="self-start"
            value={listener}
            onChange={setListener}
            options={[
              { value: 'data', label: 'Apps' },
              { value: 'admin', label: 'Console and Admin API' },
            ]}
          />
          <CorsForm key={`${listener}-${etag}`} listener={listener} initial={corsValues(spec, listener)} />
        </div>
      )}
    </SecurityCard>
  );
}
