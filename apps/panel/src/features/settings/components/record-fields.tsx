'use client';

import { Field, MultiSelect, NumberInput, Select, Switch } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/choice';
import { useCan } from '@/components/ui/gate';
import { Icon } from '@/components/ui/icon';
import { LoadError, LoadingRows } from '@/components/ui/states';
import type { components } from '@/lib/api/schema';
import type { FieldErrors } from '@/lib/validation';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';

import { durationOptions, rangeError } from '../choices';
import { useOrgSettings } from '../store';
import { Card } from './parts';
import { Choice, Advanced, Hint, lock, SettingsForm } from './settings-form';

type ClientIp = 'full' | 'truncated' | 'none';

type RequestLogs = NonNullable<components['schemas']['ObservabilitySettings']['spec']['request_logs']>;

export interface RecordValues {
  enabled: boolean;
  unauthenticated: boolean;
  clientIp: ClientIp;
  userAgent: boolean;
  requestHeaders: string[];
  responseHeaders: string[];
  maxBody: string;
  errorBodies: boolean;
  errorBodyMax: string;
  stdout: boolean;
  stdoutContent: boolean;
  queueCapacity: string;
  exportMax: string;
  flushTimeout: string;
}

export function recordValues(logs: RequestLogs | undefined): RecordValues {
  const defaults = SETTINGS_DEFAULTS.observability.request_logs;
  return {
    enabled: logs?.enabled ?? defaults.enabled,
    unauthenticated: logs?.include_unauthenticated ?? defaults.include_unauthenticated,
    clientIp: logs?.client_ip ?? defaults.client_ip,
    userAgent: logs?.user_agent ?? defaults.user_agent,
    requestHeaders: logs?.headers?.request ?? [],
    responseHeaders: logs?.headers?.response ?? [],
    maxBody: logs?.content?.max_body_bytes ?? defaults.content.max_body_bytes,
    errorBodies: logs?.content?.log_upstream_error_bodies ?? defaults.content.log_upstream_error_bodies,
    errorBodyMax: logs?.content?.upstream_error_body_max ?? defaults.content.upstream_error_body_max,
    stdout: logs?.sinks?.stdout?.enabled ?? defaults.sinks.stdout.enabled,
    stdoutContent: logs?.sinks?.stdout?.include_content ?? defaults.sinks.stdout.include_content,
    queueCapacity: String(logs?.sinks?.store?.queue_capacity ?? defaults.sinks.store.queue_capacity),
    exportMax: String(logs?.export_max_rows ?? defaults.export_max_rows),
    flushTimeout: logs?.shutdown_flush_timeout ?? defaults.shutdown_flush_timeout,
  };
}

export const recordSpec = (v: RecordValues) => ({
  request_logs: {
    enabled: v.enabled,
    include_unauthenticated: v.unauthenticated,
    client_ip: v.clientIp,
    user_agent: v.userAgent,
    headers: { request: v.requestHeaders, response: v.responseHeaders },
    content: {
      max_body_bytes: v.maxBody,
      log_upstream_error_bodies: v.errorBodies,
      upstream_error_body_max: v.errorBodyMax,
    },
    sinks: {
      stdout: { enabled: v.stdout, include_content: v.stdoutContent },
      store: { queue_capacity: Number(v.queueCapacity) },
    },
    export_max_rows: Number(v.exportMax),
    shutdown_flush_timeout: v.flushTimeout,
  },
});

/** An HTTP header name (an RFC 9110 token). */
const HEADER_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function check(v: RecordValues): FieldErrors {
  const e: FieldErrors = {};
  const bad = (list: string[]) => list.find((h) => !HEADER_RE.test(h));
  const req = bad(v.requestHeaders);
  if (req) e.requestHeaders = `"${req}" isn't a header name`;
  const res = bad(v.responseHeaders);
  if (res) e.responseHeaders = `"${res}" isn't a header name`;
  const queue = rangeError(v.queueCapacity, 100);
  if (queue) e.queueCapacity = queue;
  const rows = rangeError(v.exportMax, 1, 10_000_000);
  if (rows) e.exportMax = rows;
  return e;
}

const BODY_SIZES = ['64KiB', '256KiB', '1MiB', '4MiB', '16MiB', '64MiB'];
const ERROR_SIZES = ['1KiB', '4KiB', '16KiB', '64KiB', '256KiB', '1MiB'];

const sizeOptions = (list: string[], current: string) =>
  (list.includes(current) ? list : [...list, current]).map((v) => ({
    value: v,
    label: v.replace(/(\d)([KMG]?i?B)$/, '$1 $2'),
  }));

const headerList = (v: string[]) => v.map((h) => h.trim().toLowerCase()).filter(Boolean);

/**
 * What each request record keeps besides the content: whether requests are recorded at all, the
 * caller's address and user agent, chosen headers and the size of what is stored. Gateway-wide.
 */
export function RecordFieldsCard() {
  const observability = useOrgSettings((s) => s.observability);
  const saveObservability = useOrgSettings((s) => s.saveObservability);
  const canEdit = useCan('patchObservabilitySettings');
  const logs = observability.data?.spec.request_logs;
  return (
    <Card
      title="What each record keeps"
      description="Besides prompts and responses: who called and from where. Set once for the whole gateway."
    >
      <LoadError of={observability} subject="Request log settings" size="sm" />
      {observability.status === 'loading' && !observability.data ? <LoadingRows rows={4} /> : null}
      {observability.data ? (
        <SettingsForm
          key={observability.data.metadata.etag}
          initial={recordValues(logs)}
          toSpec={recordSpec}
          save={(patch) => saveObservability(patch)}
          canEdit={canEdit}
          check={check}
          saved="Request log settings saved"
          paths={{
            'observability.request_logs.headers.request': 'requestHeaders',
            'observability.request_logs.headers.response': 'responseHeaders',
            'observability.request_logs.content.max_body_bytes': 'maxBody',
            'observability.request_logs.content.upstream_error_body_max': 'errorBodyMax',
            'observability.request_logs.sinks.store.queue_capacity': 'queueCapacity',
            'observability.request_logs.export_max_rows': 'exportMax',
            'observability.request_logs.shutdown_flush_timeout': 'flushTimeout',
          }}
        >
          {({ values, set, errors, disabled }) => {
            const off = disabled || !values.enabled;
            return (
              <>
                <div className="flex flex-col gap-2">
                  <Switch
                    label="Keep a request log"
                    checked={values.enabled}
                    disabled={disabled}
                    onChange={(v) => set('enabled', v)}
                  />
                  {!values.enabled && logs?.enabled !== false ? (
                    <p className="flex items-start gap-2 text-ui text-warn" role="status">
                      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                      Saving stops recording requests: the Request log and everything read from it get no new
                      records. Usage and spend are still counted.
                    </p>
                  ) : (
                    <Hint>A record for each request, with its Model, tokens, cost and timing.</Hint>
                  )}
                  <Checkbox
                    label="Also record requests without a valid key"
                    description="Refused before a key was verified (missing, unknown or revoked), so they belong to no organization. Refusals of a verified key are always recorded under it."
                    checked={values.unauthenticated}
                    disabled={off}
                    onChange={(v) => set('unauthenticated', v)}
                  />
                </div>
                <Choice<ClientIp>
                  label="The caller's address"
                  value={values.clientIp}
                  onChange={(v) => set('clientIp', v)}
                  options={lock(off, [
                    { value: 'full', label: 'Keep it whole' },
                    {
                      value: 'truncated',
                      label: 'Keep only its network',
                      description: 'The last part is dropped: an IPv4 address to its /24, IPv6 to its /48.',
                    },
                    { value: 'none', label: "Don't keep it" },
                  ])}
                />
                <div className="flex flex-col gap-1">
                  <Switch
                    label="Keep the caller's user agent"
                    checked={values.userAgent}
                    disabled={off}
                    onChange={(v) => set('userAgent', v)}
                  />
                  <Hint>The app or library that sent the request, as it names itself.</Hint>
                </div>
                <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                  <Field
                    label="Request headers to keep"
                    error={errors.requestHeaders}
                    hint="Only the headers named here, such as your own tracing headers."
                  >
                    <MultiSelect
                      creatable
                      noun="header"
                      placeholder="x-request-source"
                      disabled={off}
                      value={values.requestHeaders}
                      options={values.requestHeaders.map((h) => ({ value: h, label: h }))}
                      onChange={(v) => set('requestHeaders', headerList(v))}
                    />
                  </Field>
                  <Field
                    label="Response headers to keep"
                    error={errors.responseHeaders}
                    hint="From the provider's answer."
                  >
                    <MultiSelect
                      creatable
                      noun="header"
                      placeholder="x-ratelimit-remaining"
                      disabled={off}
                      value={values.responseHeaders}
                      options={values.responseHeaders.map((h) => ({ value: h, label: h }))}
                      onChange={(v) => set('responseHeaders', headerList(v))}
                    />
                  </Field>
                </div>
                <Advanced label="Sizes and provider errors">
                  <Field
                    label="Largest prompt or response kept"
                    error={errors.maxBody}
                    hint="Longer ones are cut, and the record says so."
                    className="w-64 max-sm:w-full"
                  >
                    <Select
                      value={values.maxBody}
                      disabled={off}
                      onChange={(v) => set('maxBody', v)}
                      options={sizeOptions(BODY_SIZES, values.maxBody)}
                    />
                  </Field>
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
                      <Switch
                        label="Keep the text of provider errors"
                        checked={values.errorBodies}
                        disabled={off}
                        onChange={(v) => set('errorBodies', v)}
                      />
                      <Hint>
                        What the provider answered when a call failed. Not under zero data retention.
                      </Hint>
                    </div>
                    <Field label="Up to" error={errors.errorBodyMax} className="w-40">
                      <Select
                        value={values.errorBodyMax}
                        disabled={off || !values.errorBodies}
                        onChange={(v) => set('errorBodyMax', v)}
                        options={sizeOptions(ERROR_SIZES, values.errorBodyMax)}
                      />
                    </Field>
                  </div>
                </Advanced>
                <Advanced label="Writing and exporting records">
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
                      <Switch
                        label="Also print each record to the gateway's output"
                        checked={values.stdout}
                        disabled={off}
                        onChange={(v) => set('stdout', v)}
                      />
                      <Hint>
                        One JSON line per request, for a log collector reading the node&apos;s output.
                      </Hint>
                    </div>
                    <Checkbox
                      label="With prompts and responses"
                      description="When the content policy keeps them."
                      checked={values.stdoutContent}
                      disabled={off || !values.stdout}
                      onChange={(v) => set('stdoutContent', v)}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
                    <Field
                      label="Records waiting to be stored, at most"
                      error={errors.queueCapacity}
                      hint="How many records can wait while the store is slow."
                    >
                      <NumberInput
                        value={values.queueCapacity}
                        min={100}
                        step={1000}
                        disabled={off}
                        onChange={(v) => set('queueCapacity', v)}
                      />
                    </Field>
                    <Field
                      label="Most rows in one export"
                      error={errors.exportMax}
                      hint="CSV and JSON exports."
                    >
                      <NumberInput
                        value={values.exportMax}
                        min={1}
                        max={10_000_000}
                        step={10000}
                        disabled={off}
                        onChange={(v) => set('exportMax', v)}
                      />
                    </Field>
                    <Field
                      label="When stopping, wait for records up to"
                      error={errors.flushTimeout}
                      hint="Records still waiting after that are lost."
                    >
                      <Select
                        value={values.flushTimeout}
                        disabled={off}
                        onChange={(v) => set('flushTimeout', v)}
                        options={durationOptions(['0s', '5s', '10s', '30s', '1m', '5m'], values.flushTimeout)}
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
