'use client';

import Link from 'next/link';
import { useSettingsHref } from '@/components/layout/url-sync';
import { Button, IconButton } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { Field, Input, NumberInput, Select } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { LoadError, LoadingRows } from '@/components/ui/states';
import type { components } from '@/lib/api/schema';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';
import type { FieldErrors } from '@/lib/validation';

import { durationOptions, rangeError } from '../choices';
import { useTraffic } from '../traffic-store';
import { Card, Facts } from './parts';
import { Advanced, SettingsForm } from './settings-form';

type S = components['schemas'];
type Retry = NonNullable<S['PolicyResilience']['retry']>;
type Timeouts = NonNullable<S['PolicyResilience']['timeouts']>;
type ResilienceSpec = S['ResilienceSettings']['spec'];

/** Failure classes, in plain words. */
export const FAILURE_WORDS: Record<string, string> = {
  dns_error: 'Address lookup failed',
  connect_error: "Couldn't connect",
  connect_timeout: 'Connecting timed out',
  tls_error: 'Secure connection failed',
  refused_stream: 'Stream refused',
  upstream_reset: 'Connection reset',
  timeout: 'Timed out',
  rate_limited: 'Rate limited',
  quota_exhausted: 'Quota used up',
  credential_rejected: 'Key refused',
  overloaded: 'Provider overloaded',
  server_error: 'Provider error',
  not_implemented: 'Not supported',
  model_unavailable: 'Model unavailable',
  malformed_response: 'Unreadable answer',
  conflict: 'Conflict',
  context_length: 'Prompt too long',
  content_policy: 'Refused by content policy',
  reasoning_replay_rejected: 'Reasoning replay refused',
  caller_error: "The app's mistake",
  guardrail_blocked: 'Blocked by a guardrail',
  client_cancelled: 'Cancelled by the app',
};

/** Classes whose retry actions can be overridden (the fixed ones accept none). */
export const RETRY_CLASSES = [
  'dns_error',
  'connect_error',
  'connect_timeout',
  'tls_error',
  'refused_stream',
  'upstream_reset',
  'timeout',
  'rate_limited',
  'quota_exhausted',
  'credential_rejected',
  'overloaded',
  'server_error',
  'not_implemented',
  'model_unavailable',
  'malformed_response',
  'conflict',
  'reasoning_replay_rejected',
] as const;
type RetryClass = (typeof RETRY_CLASSES)[number];
type Action = 'rotate_key' | 'next_deployment' | 'retry_same';

const ACTIONS: { value: Action; label: string }[] = [
  { value: 'rotate_key', label: 'Try another key' },
  { value: 'next_deployment', label: 'Try the next deployment' },
  { value: 'retry_same', label: 'Try the same one again' },
];

const label = (c: string) => FAILURE_WORDS[c] ?? c;

/* ---------------------------------------------------------------- Retries and timeouts (policies) */

interface ClassRow {
  cls: RetryClass;
  actions: Action[];
  anyKey: boolean;
}

export interface RetryValues {
  responseHeaders: string;
  streamTotal: string;
  minAttempt: string;
  retryAfterMax: string;
  contextFallback: string;
  contentFallback: string;
  classes: ClassRow[];
}

const PD = SETTINGS_DEFAULTS.policies.resilience;

export function retryValues(r: { retry?: Retry; timeouts?: Timeouts } | undefined): RetryValues {
  return {
    responseHeaders: r?.timeouts?.response_headers ?? PD.timeouts.response_headers,
    streamTotal: r?.timeouts?.stream_total ?? PD.timeouts.stream_total,
    minAttempt: r?.retry?.min_attempt_time ?? PD.retry.min_attempt_time,
    retryAfterMax: r?.retry?.retry_after_max_wait ?? PD.retry.retry_after_max_wait,
    contextFallback: r?.retry?.class_fallbacks?.context_length ?? '',
    contentFallback: r?.retry?.class_fallbacks?.content_policy ?? '',
    classes: Object.entries(r?.retry?.classes ?? {}).map(([cls, c]) => ({
      cls: cls as RetryClass,
      actions: c.actions ?? [],
      anyKey: c.retry_same_any_key ?? false,
    })),
  };
}

export const retrySpec = (v: RetryValues) => ({
  resilience: {
    timeouts: { response_headers: v.responseHeaders, stream_total: v.streamTotal },
    retry: {
      min_attempt_time: v.minAttempt,
      retry_after_max_wait: v.retryAfterMax,
      class_fallbacks: {
        context_length: v.contextFallback.trim() || null,
        content_policy: v.contentFallback.trim() || null,
      },
      classes: Object.fromEntries(
        v.classes.map((c) => [
          c.cls,
          { actions: c.actions, ...(c.cls === 'timeout' && c.anyKey ? { retry_same_any_key: true } : {}) },
        ]),
      ),
    },
  },
});

function checkRetry(v: RetryValues): FieldErrors {
  const e: FieldErrors = {};
  const seen = new Set<string>();
  v.classes.forEach((c, i) => {
    if (seen.has(c.cls)) e[`classes.${i}`] = 'Each failure once';
    seen.add(c.cls);
  });
  return e;
}

const withNone = (values: string[], current: string) => [
  { value: 'none', label: 'No limit' },
  ...durationOptions(values, current).filter((o) => o.value !== 'none'),
];

/** Gateway-wide retry and timeout policy beyond the Routing defaults: the rarer fields. */
export function RetryPolicyCard() {
  const policies = useTraffic((s) => s.policies);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchPoliciesSettings');
  const resilience = policies.data?.spec.resilience;
  return (
    <Card
      title="Retries and timeouts"
      description="The rarer parts of the gateway's retry policy. Attempts, backoff and the main timeouts are in Routing policy › Defaults."
    >
      <LoadError of={policies} subject="Retry policy" size="sm" />
      {policies.status === 'loading' && !policies.data ? <LoadingRows rows={3} /> : null}
      {policies.data ? (
        <SettingsForm
          key={policies.data.metadata.etag}
          initial={retryValues(resilience)}
          toSpec={retrySpec}
          save={(patch) => save('policies', patch)}
          canEdit={canEdit}
          check={checkRetry}
          saved="Retry policy saved"
          paths={{
            'policies.resilience.timeouts.response_headers': 'responseHeaders',
            'policies.resilience.timeouts.stream_total': 'streamTotal',
            'policies.resilience.retry.min_attempt_time': 'minAttempt',
            'policies.resilience.retry.retry_after_max_wait': 'retryAfterMax',
            'policies.resilience.retry.class_fallbacks.context_length': 'contextFallback',
            'policies.resilience.retry.class_fallbacks.content_policy': 'contentFallback',
          }}
        >
          {({ values, set, errors, disabled }) => {
            const used = new Set(values.classes.map((c) => c.cls));
            const next = RETRY_CLASSES.find((c) => !used.has(c));
            const row = (i: number, patch: Partial<ClassRow>) =>
              set(
                'classes',
                values.classes.map((c, j) => (j === i ? { ...c, ...patch } : c)),
              );
            return (
              <>
                <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                  <Field
                    label="Wait for the provider's first byte up to"
                    error={errors.responseHeaders}
                    hint="Until its response headers arrive."
                  >
                    <Select
                      value={values.responseHeaders}
                      disabled={disabled}
                      onChange={(v) => set('responseHeaders', v)}
                      options={withNone(['10s', '30s', '60s', '120s', '300s'], values.responseHeaders)}
                    />
                  </Field>
                  <Field
                    label="A streamed answer may last up to"
                    error={errors.streamTotal}
                    hint="From the first token to the last."
                  >
                    <Select
                      value={values.streamTotal}
                      disabled={disabled}
                      onChange={(v) => set('streamTotal', v)}
                      options={withNone(['5m', '15m', '30m', '1h'], values.streamTotal)}
                    />
                  </Field>
                  <Field
                    label="Don't retry with less time left than"
                    error={errors.minAttempt}
                    hint="Before the request's deadline."
                  >
                    <Select
                      value={values.minAttempt}
                      disabled={disabled}
                      onChange={(v) => set('minAttempt', v)}
                      options={durationOptions(['0s', '500ms', '1s', '2s', '5s'], values.minAttempt)}
                    />
                  </Field>
                  <Field
                    label="Honour a provider's “retry after” up to"
                    error={errors.retryAfterMax}
                    hint="A longer wait moves on instead of waiting."
                  >
                    <Select
                      value={values.retryAfterMax}
                      disabled={disabled}
                      onChange={(v) => set('retryAfterMax', v)}
                      options={durationOptions(['0s', '5s', '10s', '30s', '60s'], values.retryAfterMax)}
                    />
                  </Field>
                </div>
                <fieldset className="flex flex-col gap-3">
                  <legend className="mb-1 text-ui font-semibold text-fg">When a prompt is refused</legend>
                  <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                    <Field
                      label="Too long: send it to"
                      optional
                      error={errors.contextFallback}
                      hint="A Model with a longer context. Empty: the request fails."
                    >
                      <Input
                        mono
                        value={values.contextFallback}
                        disabled={disabled}
                        onChange={(e) => set('contextFallback', e.target.value)}
                      />
                    </Field>
                    <Field
                      label="By content policy: send it to"
                      optional
                      error={errors.contentFallback}
                      hint="Empty: the request fails."
                    >
                      <Input
                        mono
                        value={values.contentFallback}
                        disabled={disabled}
                        onChange={(e) => set('contentFallback', e.target.value)}
                      />
                    </Field>
                  </div>
                </fieldset>
                <Advanced label="What to try after each kind of failure">
                  <p className="text-caption text-muted">
                    Overrides of what the gateway tries next. Failures not listed keep the built-in behaviour.
                  </p>
                  {values.classes.map((c, i) => (
                    <div key={i} className="flex flex-col gap-2 rounded-control border border-line p-3">
                      <div className="flex items-end gap-2">
                        <Field
                          label="After"
                          error={errors[`classes.${i}`]}
                          className="min-w-0 flex-1"
                          controlId={`retry-class-${i}`}
                        >
                          <Select
                            id={`retry-class-${i}`}
                            value={c.cls}
                            disabled={disabled}
                            onChange={(v) => row(i, { cls: v as RetryClass })}
                            options={RETRY_CLASSES.map((x) => ({ value: x, label: label(x) }))}
                          />
                        </Field>
                        <IconButton
                          icon="trash"
                          label={`Remove ${label(c.cls)}`}
                          disabled={disabled}
                          onClick={() =>
                            set(
                              'classes',
                              values.classes.filter((_, j) => j !== i),
                            )
                          }
                        />
                      </div>
                      <div className="flex flex-wrap gap-x-5 gap-y-1">
                        {ACTIONS.map((a) => (
                          <Checkbox
                            key={a.value}
                            label={a.label}
                            checked={c.actions.includes(a.value)}
                            disabled={disabled}
                            onChange={(on) =>
                              row(i, {
                                actions: on
                                  ? [...c.actions, a.value]
                                  : c.actions.filter((x) => x !== a.value),
                              })
                            }
                          />
                        ))}
                      </div>
                      {c.cls === 'timeout' ? (
                        <Checkbox
                          label="Trying the same one again may use another key"
                          checked={c.anyKey}
                          disabled={disabled}
                          onChange={(on) => row(i, { anyKey: on })}
                        />
                      ) : null}
                      {c.actions.length === 0 ? (
                        <p className="text-caption text-muted">
                          Nothing checked: this failure is not retried.
                        </p>
                      ) : null}
                    </div>
                  ))}
                  <div>
                    <Button
                      size="sm"
                      icon="plus"
                      disabled={disabled || !next}
                      onClick={() =>
                        next && set('classes', [...values.classes, { cls: next, actions: [], anyKey: false }])
                      }
                    >
                      Add failure
                    </Button>
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

/* ---------------------------------------------------------------- Failure handling (resilience) */

const OVERRIDE_CLASSES = Object.keys(FAILURE_WORDS);
/** Statuses that may only be read as these (a 4xx the app caused, or the two prompt refusals). */
const RESTRICTED: Record<string, string[]> = {
  '400': ['caller_error', 'context_length', 'content_policy'],
  '404': ['caller_error', 'context_length', 'content_policy'],
  '413': ['caller_error', 'context_length', 'content_policy'],
  '422': ['caller_error', 'context_length', 'content_policy'],
};

type Trail = 'off' | 'on_request' | 'always';

interface StatusRow {
  status: string;
  cls: string;
}

export interface FailureValues {
  trail: Trail;
  budgetPercent: string;
  minPerSecond: string;
  statuses: StatusRow[];
}

const RD = SETTINGS_DEFAULTS.resilience;

export function failureValues(spec: ResilienceSpec | undefined): FailureValues {
  return {
    trail: spec?.exposure?.attempt_trail ?? RD.exposure.attempt_trail,
    budgetPercent: String(Math.round((spec?.retry_budget?.ratio ?? RD.retry_budget.ratio) * 1000) / 10),
    minPerSecond: String(spec?.retry_budget?.min_per_second ?? RD.retry_budget.min_per_second),
    statuses: Object.entries((spec?.classification?.status_overrides ?? {}) as Record<string, string>).map(
      ([status, cls]) => ({ status, cls }),
    ),
  };
}

export const failureSpec = (v: FailureValues) => ({
  exposure: { attempt_trail: v.trail },
  retry_budget: {
    ratio: Number((Number(v.budgetPercent) / 100).toFixed(4)),
    min_per_second: Number(v.minPerSecond),
  },
  classification: { status_overrides: Object.fromEntries(v.statuses.map((s) => [s.status.trim(), s.cls])) },
});

function checkFailures(v: FailureValues): FieldErrors {
  const e: FieldErrors = {};
  const p = Number(v.budgetPercent);
  if (!v.budgetPercent.trim() || !Number.isFinite(p) || p < 0 || p > 100) e.budgetPercent = 'Enter 0 to 100';
  const min = rangeError(v.minPerSecond, 0);
  if (min) e.minPerSecond = min;
  const seen = new Set<string>();
  v.statuses.forEach((s, i) => {
    const code = s.status.trim();
    if (!/^(1[0-9]{2}|[3-5][0-9]{2})$/.test(code)) e[`statuses.${i}`] = 'A status code such as 429 or 529';
    else if (seen.has(code)) e[`statuses.${i}`] = 'Each status once';
    else if (RESTRICTED[code] && !RESTRICTED[code].includes(s.cls))
      e[`statuses.${i}`] = `${code} can only be read as the app's mistake or a prompt refusal`;
    seen.add(code);
  });
  return e;
}

/** Gateway-wide failure handling: the attempt trail apps see, the retry budget, status readings. */
export function FailureHandlingCard() {
  const resilience = useTraffic((s) => s.resilience);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchResilienceSettings');
  const configHref = useSettingsHref('configuration');
  const overrides = Object.keys(resilience.data?.spec.health_overrides ?? {}).sort();
  return (
    <Card
      title="Failures and retry budget"
      description="What apps are told about attempts, how many retries a deployment may take, and how provider statuses are read."
    >
      <LoadError of={resilience} subject="Failure settings" size="sm" />
      {resilience.status === 'loading' && !resilience.data ? <LoadingRows rows={3} /> : null}
      {resilience.data ? (
        <SettingsForm
          key={resilience.data.metadata.etag}
          initial={failureValues(resilience.data.spec)}
          toSpec={failureSpec}
          save={(patch) => save('resilience', patch)}
          canEdit={canEdit}
          check={checkFailures}
          saved="Failure settings saved"
          paths={{
            'resilience.exposure.attempt_trail': 'trail',
            'resilience.retry_budget.ratio': 'budgetPercent',
            'resilience.retry_budget.min_per_second': 'minPerSecond',
          }}
        >
          {({ values, set, errors, disabled }) => (
            <>
              <Field
                label="Tell apps which attempts were made"
                error={errors.trail}
                hint="Deployments tried and why each failed, in a response header."
                className="w-80 max-sm:w-full"
              >
                <Select
                  value={values.trail}
                  disabled={disabled}
                  onChange={(v) => set('trail', v as Trail)}
                  options={[
                    { value: 'off', label: 'Never' },
                    { value: 'on_request', label: 'When the app asks' },
                    { value: 'always', label: 'Always' },
                  ]}
                />
              </Field>
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 text-ui font-semibold text-fg">Retry budget</legend>
                <p className="-mt-2 text-caption text-muted">
                  Retries onto a deployment are capped per node, over the last 10 seconds, at the larger of
                  the two.
                </p>
                <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                  <Field label="Share of first attempts (%)" error={errors.budgetPercent}>
                    <NumberInput
                      value={values.budgetPercent}
                      min={0}
                      max={100}
                      step={5}
                      disabled={disabled}
                      onChange={(v) => set('budgetPercent', v)}
                    />
                  </Field>
                  <Field label="Or retries per second" error={errors.minPerSecond}>
                    <NumberInput
                      value={values.minPerSecond}
                      min={0}
                      disabled={disabled}
                      onChange={(v) => set('minPerSecond', v)}
                    />
                  </Field>
                </div>
              </fieldset>
              <Advanced label="How provider statuses are read">
                <p className="text-caption text-muted">
                  Read a status code as another kind of failure, such as a provider&apos;s 529 as overloaded.
                </p>
                {values.statuses.map((s, i) => (
                  <div key={i} className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-end gap-2">
                    <Field label="Status" error={errors[`statuses.${i}`]} controlId={`status-code-${i}`}>
                      <Input
                        id={`status-code-${i}`}
                        mono
                        inputMode="numeric"
                        value={s.status}
                        disabled={disabled}
                        onChange={(e) =>
                          set(
                            'statuses',
                            values.statuses.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)),
                          )
                        }
                      />
                    </Field>
                    <Field label="Read as" controlId={`status-class-${i}`}>
                      <Select
                        id={`status-class-${i}`}
                        value={s.cls}
                        disabled={disabled}
                        onChange={(v) =>
                          set(
                            'statuses',
                            values.statuses.map((x, j) => (j === i ? { ...x, cls: v } : x)),
                          )
                        }
                        options={OVERRIDE_CLASSES.map((c) => ({ value: c, label: label(c) }))}
                      />
                    </Field>
                    <IconButton
                      icon="trash"
                      label={`Remove status ${s.status || i + 1}`}
                      disabled={disabled}
                      onClick={() =>
                        set(
                          'statuses',
                          values.statuses.filter((_, j) => j !== i),
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
                    onClick={() => set('statuses', [...values.statuses, { status: '', cls: 'overloaded' }])}
                  >
                    Add status
                  </Button>
                </div>
                <Facts
                  items={[
                    {
                      label: 'Health settings per deployment',
                      value: overrides.length ? overrides.join(', ') : 'None',
                      hint: (
                        <>
                          Deployments with their own breaker or cooldowns.{' '}
                          <Link href={configHref} className="text-accent hover:underline">
                            Edit them in Configuration
                          </Link>
                          .
                        </>
                      ),
                    },
                  ]}
                />
              </Advanced>
            </>
          )}
        </SettingsForm>
      ) : null}
    </Card>
  );
}
