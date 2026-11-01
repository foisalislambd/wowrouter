'use client';

import { Button, IconButton } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Switch } from '@/components/ui/form';
import type { FieldErrors } from '@/lib/validation';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';

import { durationOptions } from '../choices';
import { URL_RE } from '../form-errors';
import { Advanced, Hint } from './settings-form';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

export interface Pair {
  key: string;
  value: string;
}

const pairs = (v: unknown): Pair[] =>
  Object.entries(obj(v)).map(([key, value]) => ({ key, value: text(value) }));
const pairMap = (rows: Pair[]): Record<string, string> =>
  Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));

type Sampler = 'parent_based_ratio' | 'ratio' | 'always_on' | 'always_off';

/** The trace export's own settings, besides where it goes and its share of requests. */
export interface TraceOptions {
  serviceName: string;
  attributes: Pair[];
  sampler: Sampler;
  propagate: boolean;
  endUser: boolean;
  headerAttributes: Pair[];
  viewerUrl: string;
  timeout: string;
  compression: string;
  tlsVerify: boolean;
  caFile: string;
  serverName: string;
  minVersion: string;
  certFile: string;
  keyFile: string;
}

export function traceOptions(traces: unknown): TraceOptions {
  const defaults = SETTINGS_DEFAULTS.observability.traces;
  const t = obj(traces);
  const exporter = obj(t.exporter);
  const tls = obj(exporter.tls);
  return {
    serviceName: text(t.service_name, defaults.service_name),
    attributes: pairs(t.resource_attributes),
    sampler: text(obj(t.sampler).type, defaults.sampler.type) as Sampler,
    propagate:
      typeof t.propagate_to_upstream === 'boolean' ? t.propagate_to_upstream : defaults.propagate_to_upstream,
    endUser: typeof t.include_end_user === 'boolean' ? t.include_end_user : defaults.include_end_user,
    headerAttributes: pairs(t.header_attributes),
    viewerUrl: text(t.viewer_url),
    timeout: text(exporter.timeout, defaults.exporter.timeout),
    compression: text(exporter.compression, defaults.exporter.compression),
    tlsVerify: tls.verify !== false,
    caFile: text(tls.ca_file),
    serverName: text(tls.server_name),
    minVersion: text(tls.min_version, '1.2'),
    certFile: text(tls.client_cert_file),
    keyFile: text(tls.client_key_file),
  };
}

/** The options as the `traces` block takes them; empty text is null, so saving removes it. */
export function traceOptionsSpec(v: TraceOptions): Obj {
  const orNull = (s: string) => (s.trim() ? s.trim() : null);
  return {
    service_name: v.serviceName.trim(),
    resource_attributes: pairMap(v.attributes),
    sampler: { type: v.sampler },
    propagate_to_upstream: v.propagate,
    include_end_user: v.endUser,
    header_attributes: pairMap(v.headerAttributes),
    viewer_url: orNull(v.viewerUrl),
    exporter: {
      timeout: v.timeout,
      compression: v.compression,
      tls: {
        verify: v.tlsVerify,
        ca_file: orNull(v.caFile),
        server_name: orNull(v.serverName),
        min_version: v.minVersion,
        client_cert_file: orNull(v.certFile),
        client_key_file: orNull(v.keyFile),
      },
    },
  };
}

export function traceOptionsErrors(v: TraceOptions): FieldErrors {
  const e: FieldErrors = {};
  if (!v.serviceName.trim()) e.serviceName = 'Enter the name traces are reported under';
  if (v.viewerUrl.trim() && (!URL_RE.test(v.viewerUrl.trim()) || !v.viewerUrl.includes('{trace_id}')))
    e.viewerUrl =
      'Enter an address with {trace_id} in it, such as https://traces.example.com/trace/{trace_id}';
  if (v.certFile.trim() && !v.keyFile.trim()) e.keyFile = 'Enter the key file of the client certificate';
  return e;
}

function PairRows({
  label,
  hint,
  rows,
  onChange,
  disabled,
  keyPlaceholder,
  valuePlaceholder,
  noun,
}: {
  label: string;
  hint: string;
  rows: Pair[];
  onChange: (rows: Pair[]) => void;
  disabled: boolean;
  keyPlaceholder: string;
  valuePlaceholder: string;
  noun: string;
}) {
  const set = (i: number, patch: Partial<Pair>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-ui font-medium text-fg">
        {label} <span className="font-normal text-dim">(optional)</span>
      </legend>
      <Hint>{hint}</Hint>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 max-sm:grid-cols-1">
          <Input
            mono
            aria-label={`${noun} ${i + 1} name`}
            value={r.key}
            disabled={disabled}
            placeholder={keyPlaceholder}
            onChange={(e) => set(i, { key: e.target.value })}
          />
          <Input
            mono
            aria-label={`${noun} ${i + 1} value`}
            value={r.value}
            disabled={disabled}
            placeholder={valuePlaceholder}
            onChange={(e) => set(i, { value: e.target.value })}
          />
          <IconButton
            icon="trash"
            label={`Remove ${noun.toLowerCase()} ${i + 1}`}
            disabled={disabled}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <div>
        <Button
          size="sm"
          icon="plus"
          disabled={disabled}
          onClick={() => onChange([...rows, { key: '', value: '' }])}
        >
          Add {noun.toLowerCase()}
        </Button>
      </div>
    </fieldset>
  );
}

/** The trace export's details, in the OpenTelemetry drawer while traces are on. */
export function TraceOptionsFields({
  value,
  onChange,
  errors,
  disabled,
}: {
  value: TraceOptions;
  onChange: (value: TraceOptions) => void;
  errors: FieldErrors;
  disabled: boolean;
}) {
  const set = <K extends keyof TraceOptions>(k: K, v: TraceOptions[K]) => onChange({ ...value, [k]: v });
  return (
    <Advanced label="Trace details">
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field
          label="Service name"
          error={errors.serviceName}
          hint="What your tracing tool lists the gateway as."
        >
          <Input
            mono
            value={value.serviceName}
            disabled={disabled}
            onChange={(e) => set('serviceName', e.target.value)}
          />
        </Field>
        <Field label="Which requests are traced">
          <Select
            value={value.sampler}
            disabled={disabled}
            onChange={(v) => set('sampler', v as Sampler)}
            options={[
              { value: 'parent_based_ratio', label: "The caller's choice, else the share" },
              { value: 'ratio', label: 'The share, whatever the caller asks' },
              { value: 'always_on', label: 'Every request' },
              { value: 'always_off', label: 'None' },
            ]}
          />
        </Field>
      </div>
      <PairRows
        label="Resource attributes"
        hint="Added to every span, such as the environment or region."
        noun="Attribute"
        rows={value.attributes}
        disabled={disabled}
        keyPlaceholder="deployment.environment"
        valuePlaceholder="production"
        onChange={(v) => set('attributes', v)}
      />
      <PairRows
        label="Request headers as attributes"
        hint="A request header's value, recorded on the request's span. Credentials are refused."
        noun="Header"
        rows={value.headerAttributes}
        disabled={disabled}
        keyPlaceholder="x-tenant"
        valuePlaceholder="app.tenant"
        onChange={(v) => set('headerAttributes', v)}
      />
      <div className="flex flex-col gap-2">
        <Switch
          label="Pass the trace on to providers"
          checked={value.propagate}
          disabled={disabled}
          onChange={(v) => set('propagate', v)}
        />
        <Switch
          label="Record the end user on spans"
          checked={value.endUser}
          disabled={disabled}
          onChange={(v) => set('endUser', v)}
        />
      </div>
      <Field
        label="Trace viewer address"
        optional
        error={errors.viewerUrl}
        hint="Request records link to it, with {trace_id} replaced by the request's trace."
      >
        <Input
          mono
          value={value.viewerUrl}
          disabled={disabled}
          placeholder="https://traces.example.com/trace/{trace_id}"
          onChange={(e) => set('viewerUrl', e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field label="Give up an export after">
          <Select
            value={value.timeout}
            disabled={disabled}
            onChange={(v) => set('timeout', v)}
            options={durationOptions(['1s', '5s', '10s', '30s', '60s'], value.timeout)}
          />
        </Field>
        <Field label="Compression">
          <Select
            value={value.compression}
            disabled={disabled}
            onChange={(v) => set('compression', v)}
            options={[
              { value: 'gzip', label: 'gzip' },
              { value: 'none', label: 'None' },
            ]}
          />
        </Field>
      </div>
      <Advanced label="TLS to the collector">
        <Checkbox
          label="Verify the collector's certificate"
          description="Off only for a test collector: anyone on the path could read the traces."
          checked={value.tlsVerify}
          disabled={disabled}
          onChange={(v) => set('tlsVerify', v)}
        />
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Field label="CA file" optional hint="A path on each node.">
            <Input
              mono
              value={value.caFile}
              disabled={disabled}
              onChange={(e) => set('caFile', e.target.value)}
            />
          </Field>
          <Field label="Server name" optional hint="When it differs from the address.">
            <Input
              mono
              value={value.serverName}
              disabled={disabled}
              onChange={(e) => set('serverName', e.target.value)}
            />
          </Field>
          <Field label="Client certificate file" optional>
            <Input
              mono
              value={value.certFile}
              disabled={disabled}
              onChange={(e) => set('certFile', e.target.value)}
            />
          </Field>
          <Field label="Client key file" optional error={errors.keyFile}>
            <Input
              mono
              value={value.keyFile}
              disabled={disabled}
              onChange={(e) => set('keyFile', e.target.value)}
            />
          </Field>
          <Field label="Oldest TLS version">
            <Select
              value={value.minVersion}
              disabled={disabled}
              onChange={(v) => set('minVersion', v)}
              options={[
                { value: '1.2', label: 'TLS 1.2' },
                { value: '1.3', label: 'TLS 1.3' },
              ]}
            />
          </Field>
        </div>
      </Advanced>
    </Advanced>
  );
}
