'use client';

import { useEffect } from 'react';

import { Checkbox, Field, Input, MultiSelect, NumberInput, Select, Switch } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { LoadError, LoadingRows } from '@/components/ui/states';
import type { components } from '@/lib/api/schema';
import type { FieldErrors } from '@/lib/validation';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';

import { durationOptions, rangeError } from '../choices';
import { useTraffic } from '../traffic-store';
import { Card } from './parts';
import { FailureHandlingCard, RetryPolicyCard } from './retry-policy-cards';
import { Choice, Advanced, Hint, lock, SettingsForm } from './settings-form';

type S = components['schemas'];
type Health = NonNullable<S['ResilienceSettings']['spec']['health']>;

/* ---------------------------------------------------------------- Unhealthy deployments */

type AllUnhealthy = 'fail' | 'ignore_health';
type ProbeScope = 'node' | 'cluster';
type CheckRequest = 'models_list' | 'minimal_generation';
type CheckWhen = 'open_only' | 'always';

export interface HealthValues {
  breaker: boolean;
  allUnhealthy: AllUnhealthy;
  checks: boolean;
  checkInterval: string;
  checkTimeout: string;
  checkRequest: CheckRequest;
  checkWhen: CheckWhen;
  buckets: string;
  probes: string;
  successes: string;
  probeScope: ProbeScope;
  maxCooldown: string;
  rateLimitCooldown: string;
  cooldownBuffer: string;
  deadKey: string;
  maxDeadKey: string;
}

export function healthValues(h: Health | undefined): HealthValues {
  const defaults = {
    breaker: SETTINGS_DEFAULTS.resilience.health.breaker,
    health: SETTINGS_DEFAULTS.resilience.health,
    checks: SETTINGS_DEFAULTS.resilience.health.active_checks,
  };
  const b = h?.breaker;
  const a = h?.active_checks;
  return {
    breaker: b?.enabled ?? defaults.breaker.enabled,
    allUnhealthy: h?.all_unhealthy ?? defaults.health.all_unhealthy,
    checks: a?.enabled ?? defaults.checks.enabled,
    checkInterval: a?.interval ?? defaults.checks.interval,
    checkTimeout: a?.timeout ?? defaults.checks.timeout,
    checkRequest: a?.request ?? defaults.checks.request,
    checkWhen: a?.when ?? defaults.checks.when,
    buckets: String(b?.buckets ?? defaults.breaker.buckets),
    probes: String(b?.half_open_probes ?? defaults.breaker.half_open_probes),
    successes: String(b?.success_threshold ?? defaults.breaker.success_threshold),
    probeScope: b?.probe_scope ?? defaults.breaker.probe_scope,
    maxCooldown: h?.max_cooldown ?? defaults.health.max_cooldown,
    rateLimitCooldown: h?.rate_limit_cooldown ?? defaults.health.rate_limit_cooldown,
    cooldownBuffer: h?.cooldown_buffer ?? defaults.health.cooldown_buffer,
    deadKey: h?.dead_key_recheck ?? defaults.health.dead_key_recheck,
    maxDeadKey: h?.max_dead_key_recheck ?? defaults.health.max_dead_key_recheck,
  };
}

const healthSpec = (v: HealthValues) => ({
  health: {
    breaker: {
      enabled: v.breaker,
      buckets: Number(v.buckets),
      half_open_probes: Number(v.probes),
      success_threshold: Number(v.successes),
      probe_scope: v.probeScope,
    },
    all_unhealthy: v.allUnhealthy,
    active_checks: {
      enabled: v.checks,
      interval: v.checkInterval,
      timeout: v.checkTimeout,
      request: v.checkRequest,
      when: v.checkWhen,
    },
    max_cooldown: v.maxCooldown,
    rate_limit_cooldown: v.rateLimitCooldown,
    cooldown_buffer: v.cooldownBuffer,
    dead_key_recheck: v.deadKey,
    max_dead_key_recheck: v.maxDeadKey,
  },
});

function healthErrors(v: HealthValues): FieldErrors {
  const e: FieldErrors = {};
  const pairs: [keyof HealthValues, number, number][] = [
    ['buckets', 1, 60],
    ['probes', 1, 100],
    ['successes', 1, 100],
  ];
  for (const [k, min, max] of pairs) {
    const err = rangeError(v[k] as string, min, max);
    if (err) e[k] = err;
  }
  return e;
}

function HealthCard() {
  const resilience = useTraffic((s) => s.resilience);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchResilienceSettings');
  return (
    <Card
      title="Unhealthy deployments"
      description="How the gateway stops sending requests to a deployment that keeps failing, and checks it again. The failure thresholds are on the Routing page."
    >
      <LoadError of={resilience} subject="Resilience settings" size="sm" />
      {resilience.status === 'loading' && !resilience.data ? <LoadingRows rows={3} /> : null}
      {resilience.data ? (
        <SettingsForm
          key={resilience.data.metadata.etag}
          initial={healthValues(resilience.data.spec.health)}
          toSpec={healthSpec}
          save={(patch) => save('resilience', patch)}
          canEdit={canEdit}
          check={healthErrors}
          saved="Resilience settings saved"
          paths={{
            'resilience.health.breaker.buckets': 'buckets',
            'resilience.health.breaker.half_open_probes': 'probes',
            'resilience.health.breaker.success_threshold': 'successes',
            'resilience.health.max_dead_key_recheck': 'maxDeadKey',
          }}
        >
          {({ values, set, errors, disabled }) => (
            <>
              <div className="flex flex-col gap-1">
                <Switch
                  label="Take a failing deployment out of rotation"
                  checked={values.breaker}
                  disabled={disabled}
                  onChange={(v) => set('breaker', v)}
                />
                <Hint>Off, every deployment keeps getting requests however often it fails.</Hint>
              </div>
              <Choice<AllUnhealthy>
                label="When every deployment of a route is out of rotation"
                value={values.allUnhealthy}
                onChange={(v) => set('allUnhealthy', v)}
                options={lock(disabled, [
                  {
                    value: 'fail',
                    label: 'Refuse the request',
                    description: 'Apps get an error right away.',
                  },
                  {
                    value: 'ignore_health',
                    label: 'Try them anyway',
                    description:
                      'A deployment that has recovered answers; one that hasn’t fails as it would.',
                  },
                ])}
              />
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <Switch
                    label="Check deployments in the background"
                    checked={values.checks}
                    disabled={disabled}
                    onChange={(v) => set('checks', v)}
                  />
                  <Hint>
                    A small request on a timer, so a deployment comes back without waiting for traffic.
                  </Hint>
                </div>
                <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                  <Field label="Check with">
                    <Select
                      value={values.checkRequest}
                      disabled={disabled || !values.checks}
                      onChange={(v) => set('checkRequest', v as CheckRequest)}
                      options={[
                        { value: 'models_list', label: 'Its list of models (free)' },
                        { value: 'minimal_generation', label: 'A one-token answer (billed)' },
                      ]}
                    />
                  </Field>
                  <Field label="Check">
                    <Select
                      value={values.checkWhen}
                      disabled={disabled || !values.checks}
                      onChange={(v) => set('checkWhen', v as CheckWhen)}
                      options={[
                        { value: 'open_only', label: 'Only deployments out of rotation' },
                        { value: 'always', label: 'Every deployment' },
                      ]}
                    />
                  </Field>
                  <Field label="Every">
                    <Select
                      value={values.checkInterval}
                      disabled={disabled || !values.checks}
                      onChange={(v) => set('checkInterval', v)}
                      options={durationOptions(['5s', '10s', '30s', '1m', '5m'], values.checkInterval)}
                    />
                  </Field>
                  <Field label="Give up a check after">
                    <Select
                      value={values.checkTimeout}
                      disabled={disabled || !values.checks}
                      onChange={(v) => set('checkTimeout', v)}
                      options={durationOptions(['1s', '2s', '5s', '10s', '30s'], values.checkTimeout)}
                    />
                  </Field>
                </div>
              </div>
              <Advanced>
                <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
                  <Field label="Failure window buckets" error={errors.buckets} hint="1 to 60.">
                    <NumberInput
                      value={values.buckets}
                      min={1}
                      max={60}
                      disabled={disabled || !values.breaker}
                      onChange={(v) => set('buckets', v)}
                    />
                  </Field>
                  <Field label="Trial requests when coming back" error={errors.probes} hint="1 to 100.">
                    <NumberInput
                      value={values.probes}
                      min={1}
                      max={100}
                      disabled={disabled || !values.breaker}
                      onChange={(v) => set('probes', v)}
                    />
                  </Field>
                  <Field label="Successes to come back" error={errors.successes} hint="1 to 100.">
                    <NumberInput
                      value={values.successes}
                      min={1}
                      max={100}
                      disabled={disabled || !values.breaker}
                      onChange={(v) => set('successes', v)}
                    />
                  </Field>
                </div>
                <Choice<ProbeScope>
                  label="Count trial requests"
                  value={values.probeScope}
                  onChange={(v) => set('probeScope', v)}
                  options={lock(disabled || !values.breaker, [
                    { value: 'node', label: 'On each node' },
                    {
                      value: 'cluster',
                      label: 'Across the cluster',
                      description: 'Through the shared counter store.',
                    },
                  ])}
                />
                <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
                  <Field label="Longest pause after errors">
                    <Select
                      value={values.maxCooldown}
                      disabled={disabled}
                      onChange={(v) => set('maxCooldown', v)}
                      options={durationOptions(['60s', '300s', '15m', '1h'], values.maxCooldown)}
                    />
                  </Field>
                  <Field label="Pause after a rate limit" hint="When the provider gives no time.">
                    <Select
                      value={values.rateLimitCooldown}
                      disabled={disabled}
                      onChange={(v) => set('rateLimitCooldown', v)}
                      options={durationOptions(['0s', '1s', '5s', '15s', '60s'], values.rateLimitCooldown)}
                    />
                  </Field>
                  <Field label="Added to the provider's pause">
                    <Select
                      value={values.cooldownBuffer}
                      disabled={disabled}
                      onChange={(v) => set('cooldownBuffer', v)}
                      options={durationOptions(['0s', '1s', '5s', '15s'], values.cooldownBuffer)}
                    />
                  </Field>
                  <Field label="Recheck a refused key after" hint="A key the provider no longer accepts.">
                    <Select
                      value={values.deadKey}
                      disabled={disabled}
                      onChange={(v) => set('deadKey', v)}
                      options={durationOptions(['1m', '5m', '15m', '1h'], values.deadKey)}
                    />
                  </Field>
                  <Field label="And at most every" error={errors.maxDeadKey}>
                    <Select
                      value={values.maxDeadKey}
                      disabled={disabled}
                      onChange={(v) => set('maxDeadKey', v)}
                      options={durationOptions(['15m', '1h', '6h', '1d'], values.maxDeadKey)}
                    />
                  </Field>
                </div>
              </Advanced>
            </>
          )}
        </SettingsForm>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------------- Admission */

type Fairness = 'fifo' | 'project';
type Watermark = string | number | null | undefined;

const SIZE_RE = /^\d+(B|KiB|MiB|GiB)$/;

/** A memory watermark as form text: a size ("6GiB") or a share of memory ("80%"). */
export function watermarkText(v: Watermark): string {
  if (typeof v === 'number') return `${Math.round(v * 1000) / 10}%`;
  return v ?? '';
}

/** Form text as a watermark: a size, a share (0–1), or null when empty. */
export function watermarkValue(text: string): string | number | null {
  const t = text.trim();
  if (!t) return null;
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (pct) return Number(pct[1]) / 100;
  return t;
}

const watermarkError = (text: string): string | undefined => {
  const v = watermarkValue(text);
  if (v === null || (typeof v === 'number' && v >= 0 && v <= 1)) return undefined;
  if (typeof v === 'string' && SIZE_RE.test(v)) return undefined;
  return 'Enter a size such as 6GiB or a share such as 80%';
};

export interface AdmissionValues {
  fairness: Fairness;
  high: string;
  low: string;
}

function AdmissionCard() {
  const serverSettings = useTraffic((s) => s.server);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchServerSettings');
  const admission = serverSettings.data?.spec.admission;
  return (
    <Card
      title="Admission"
      description="How a busy node lets requests in. Queue sizes and the wait are on the Routing page."
    >
      <LoadError of={serverSettings} subject="Admission settings" size="sm" />
      {serverSettings.status === 'loading' && !serverSettings.data ? <LoadingRows rows={2} /> : null}
      {serverSettings.data ? (
        <SettingsForm<AdmissionValues>
          key={serverSettings.data.metadata.etag}
          initial={{
            fairness: admission?.fairness ?? SETTINGS_DEFAULTS.server.admission.fairness,
            high: watermarkText(admission?.memory_high_watermark),
            low: watermarkText(admission?.memory_low_watermark),
          }}
          toSpec={(v) => ({
            admission: {
              fairness: v.fairness,
              memory_high_watermark: watermarkValue(v.high),
              memory_low_watermark: watermarkValue(v.low),
            },
          })}
          save={(patch) => save('server', patch)}
          canEdit={canEdit}
          saved="Admission saved"
          check={(v): FieldErrors => {
            const e: FieldErrors = {};
            const high = watermarkError(v.high);
            if (high) e.high = high;
            const low = watermarkError(v.low);
            if (low) e.low = low;
            if (!e.low && v.low.trim() && !v.high.trim()) e.low = 'Set the upper limit too';
            return e;
          }}
          paths={{
            'server.admission.memory_high_watermark': 'high',
            'server.admission.memory_low_watermark': 'low',
          }}
        >
          {({ values, set, errors, disabled }) => (
            <>
              <Choice<Fairness>
                label="When requests queue"
                value={values.fairness}
                onChange={(v) => set('fairness', v)}
                options={lock(disabled, [
                  { value: 'fifo', label: 'First come, first served' },
                  {
                    value: 'project',
                    label: 'Take turns between projects',
                    description: 'One busy project can’t hold up the others.',
                  },
                ])}
              />
              <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                <Field
                  label="Stop letting requests in above"
                  optional
                  error={errors.high}
                  hint="Memory used by the node: a size such as 6GiB, or a share such as 80%."
                >
                  <Input
                    mono
                    value={values.high}
                    disabled={disabled}
                    placeholder="80%"
                    onChange={(e) => set('high', e.target.value)}
                  />
                </Field>
                <Field
                  label="Let them in again below"
                  optional
                  error={errors.low}
                  hint="Empty: just under the limit."
                >
                  <Input
                    mono
                    value={values.low}
                    disabled={disabled}
                    placeholder="70%"
                    onChange={(e) => set('low', e.target.value)}
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

/* ---------------------------------------------------------------- Routing behaviour */

type Routing = S['RoutingSettings']['spec'];

export interface RoutingValues {
  addressing: boolean;
  exposePath: boolean;
  affinityTtl: string;
  affinityEntries: string;
  outputEstimate: string;
  metadataSize: string;
}

export function routingValues(r: Routing | undefined): RoutingValues {
  const defaults = SETTINGS_DEFAULTS.routing;
  return {
    addressing: r?.provider_addressing?.enabled ?? defaults.provider_addressing.enabled,
    exposePath: r?.expose_route_path ?? defaults.expose_route_path,
    affinityTtl: r?.affinity?.ttl ?? defaults.affinity.ttl,
    affinityEntries: String(r?.affinity?.max_entries ?? defaults.affinity.max_entries),
    outputEstimate: String(r?.cost_output_estimate ?? defaults.cost_output_estimate),
    metadataSize: r?.metadata_max_size ?? defaults.metadata_max_size,
  };
}

const routingSpec = (v: RoutingValues) => ({
  provider_addressing: { enabled: v.addressing },
  expose_route_path: v.exposePath,
  affinity: { ttl: v.affinityTtl, max_entries: Number(v.affinityEntries) },
  cost_output_estimate: Number(v.outputEstimate),
  metadata_max_size: v.metadataSize,
});

function RoutingCard() {
  const routing = useTraffic((s) => s.routing);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchRoutingSettings');
  return (
    <Card title="Routing behaviour" description="What apps may ask of routing, and what they are told.">
      <LoadError of={routing} subject="Routing settings" size="sm" />
      {routing.status === 'loading' && !routing.data ? <LoadingRows rows={2} /> : null}
      {routing.data ? (
        <SettingsForm
          key={routing.data.metadata.etag}
          initial={routingValues(routing.data.spec)}
          toSpec={routingSpec}
          save={(patch) => save('routing', patch)}
          canEdit={canEdit}
          saved="Routing settings saved"
          check={(v): FieldErrors => {
            const e: FieldErrors = {};
            const entries = rangeError(v.affinityEntries, 1000, 100_000_000);
            if (entries) e.affinityEntries = entries;
            const estimate = rangeError(v.outputEstimate, 1, 1_000_000);
            if (estimate) e.outputEstimate = estimate;
            return e;
          }}
          paths={{
            'routing.affinity.max_entries': 'affinityEntries',
            'routing.cost_output_estimate': 'outputEstimate',
          }}
        >
          {({ values, set, errors, disabled }) => (
            <>
              <div className="flex flex-col gap-1">
                <Switch
                  label="Let apps name a provider in the model"
                  checked={values.addressing}
                  disabled={disabled}
                  onChange={(v) => set('addressing', v)}
                />
                <Hint>Such as openai/gpt-4o, which goes straight to that provider instead of the route.</Hint>
              </div>
              <div className="flex flex-col gap-1">
                <Switch
                  label="Tell apps the route their request took"
                  checked={values.exposePath}
                  disabled={disabled}
                  onChange={(v) => set('exposePath', v)}
                />
                <Hint>In a response header. Off hides your routing from apps.</Hint>
              </div>
              <Advanced>
                <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                  <Field
                    label="Keep a session on its deployment for"
                    hint="For routes that keep sessions together."
                  >
                    <Select
                      value={values.affinityTtl}
                      disabled={disabled}
                      onChange={(v) => set('affinityTtl', v)}
                      options={durationOptions(['15m', '1h', '6h', '1d', '7d'], values.affinityTtl)}
                    />
                  </Field>
                  <Field label="Sessions remembered, per node" error={errors.affinityEntries}>
                    <NumberInput
                      value={values.affinityEntries}
                      min={1000}
                      disabled={disabled}
                      onChange={(v) => set('affinityEntries', v)}
                    />
                  </Field>
                  <Field
                    label="Answer length assumed for cost"
                    error={errors.outputEstimate}
                    hint="Tokens, when a request sets no limit, for cost-based routing."
                  >
                    <NumberInput
                      value={values.outputEstimate}
                      min={1}
                      disabled={disabled}
                      onChange={(v) => set('outputEstimate', v)}
                    />
                  </Field>
                  <Field label="Largest request metadata">
                    <Select
                      value={values.metadataSize}
                      disabled={disabled}
                      onChange={(v) => set('metadataSize', v)}
                      options={['1KiB', '4KiB', '8KiB', '16KiB', '64KiB'].map((s) => ({
                        value: s,
                        label: s.replace('KiB', ' KiB'),
                      }))}
                    />
                  </Field>
                </div>
              </Advanced>
            </>
          )}
        </SettingsForm>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------------- Headers and translation */

type Policies = S['PoliciesSettings']['spec'];
type OnLossy = 'warn' | 'reject';

export interface PassValues {
  forward: string[];
  deny: string[];
  responseForward: string[];
  exposeIdentity: boolean;
  onLossy: OnLossy;
  unknownFields: boolean;
  completionsToChat: boolean;
  fanOut: boolean;
  fanOutMax: string;
}

export function passValues(p: Policies | undefined): PassValues {
  const defaults = SETTINGS_DEFAULTS.policies;
  const h = p?.headers;
  const t = p?.translation;
  return {
    forward: h?.forward ?? [],
    deny: h?.deny ?? [],
    responseForward: h?.response_forward ?? [],
    exposeIdentity: h?.expose_upstream_identity ?? defaults.headers.expose_upstream_identity,
    onLossy: t?.on_lossy ?? defaults.translation.on_lossy,
    unknownFields: t?.forward_unknown_fields ?? defaults.translation.forward_unknown_fields,
    completionsToChat: t?.completions_to_chat ?? defaults.translation.completions_to_chat,
    fanOut: t?.n_fan_out?.enabled ?? defaults.translation.n_fan_out.enabled,
    fanOutMax: String(t?.n_fan_out?.max ?? defaults.translation.n_fan_out.max),
  };
}

const passSpec = (v: PassValues) => ({
  headers: {
    forward: v.forward,
    deny: v.deny,
    response_forward: v.responseForward,
    expose_upstream_identity: v.exposeIdentity,
  },
  translation: {
    on_lossy: v.onLossy,
    forward_unknown_fields: v.unknownFields,
    completions_to_chat: v.completionsToChat,
    n_fan_out: { enabled: v.fanOut, max: Number(v.fanOutMax) },
  },
});

const HEADER_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const headerList = (v: string[]) => v.map((h) => h.trim().toLowerCase()).filter(Boolean);

function PassCard() {
  const policies = useTraffic((s) => s.policies);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchPoliciesSettings');
  return (
    <Card
      title="Headers and translation"
      description="What passes between apps and providers. Applies unless an organization, team, project or key sets its own."
    >
      <LoadError of={policies} subject="The gateway's policies" size="sm" />
      {policies.status === 'loading' && !policies.data ? <LoadingRows rows={3} /> : null}
      {policies.data ? (
        <SettingsForm
          key={policies.data.metadata.etag}
          initial={passValues(policies.data.spec)}
          toSpec={passSpec}
          save={(patch) => save('policies', patch)}
          canEdit={canEdit}
          saved="Headers and translation saved"
          check={(v): FieldErrors => {
            const e: FieldErrors = {};
            for (const k of ['forward', 'deny', 'responseForward'] as const) {
              const bad = v[k].find((h) => !HEADER_RE.test(h));
              if (bad) e[k] = `"${bad}" isn't a header name`;
            }
            const max = rangeError(v.fanOutMax, 2, 128);
            if (max) e.fanOutMax = max;
            return e;
          }}
          paths={{
            'policies.headers.forward': 'forward',
            'policies.headers.deny': 'deny',
            'policies.headers.response_forward': 'responseForward',
            'policies.translation.n_fan_out.max': 'fanOutMax',
          }}
        >
          {({ values, set, errors, disabled }) => (
            <>
              <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                <Field
                  label="Pass these app headers to providers"
                  error={errors.forward}
                  hint="Credentials and hop-by-hop headers are never passed."
                >
                  <MultiSelect
                    creatable
                    noun="header"
                    placeholder="x-request-id"
                    disabled={disabled}
                    value={values.forward}
                    options={values.forward.map((h) => ({ value: h, label: h }))}
                    onChange={(v) => set('forward', headerList(v))}
                  />
                </Field>
                <Field
                  label="Never pass these"
                  error={errors.deny}
                  hint="Even when a lower level passes them."
                >
                  <MultiSelect
                    creatable
                    noun="header"
                    placeholder="x-internal"
                    disabled={disabled}
                    value={values.deny}
                    options={values.deny.map((h) => ({ value: h, label: h }))}
                    onChange={(v) => set('deny', headerList(v))}
                  />
                </Field>
                <Field
                  label="Return these provider headers to apps"
                  error={errors.responseForward}
                  className="sm:col-span-2"
                >
                  <MultiSelect
                    creatable
                    noun="header"
                    placeholder="x-ratelimit-remaining-requests"
                    disabled={disabled}
                    value={values.responseForward}
                    options={values.responseForward.map((h) => ({ value: h, label: h }))}
                    onChange={(v) => set('responseForward', headerList(v))}
                  />
                </Field>
              </div>
              <div className="flex flex-col gap-1">
                <Switch
                  label="Tell apps which provider and deployment answered"
                  checked={values.exposeIdentity}
                  disabled={disabled}
                  onChange={(v) => set('exposeIdentity', v)}
                />
                <Hint>In response headers.</Hint>
              </div>
              <Choice<OnLossy>
                label="When a request can't be translated exactly for a provider"
                value={values.onLossy}
                onChange={(v) => set('onLossy', v)}
                options={lock(disabled, [
                  {
                    value: 'warn',
                    label: 'Send it, with a warning',
                    description:
                      'Such as a parameter the provider doesn’t have. The answer carries the warning.',
                  },
                  { value: 'reject', label: 'Refuse it' },
                ])}
              />
              <Advanced>
                <Checkbox
                  label="Pass unknown request fields to providers"
                  description="Fields the gateway doesn't know, as the app sent them."
                  checked={values.unknownFields}
                  disabled={disabled}
                  onChange={(v) => set('unknownFields', v)}
                />
                <Checkbox
                  label="Serve old-style completions with a chat Model"
                  description="When no deployment of the Model serves completions."
                  checked={values.completionsToChat}
                  disabled={disabled}
                  onChange={(v) => set('completionsToChat', v)}
                />
                <div className="flex flex-wrap items-end gap-4">
                  <div className="min-w-[16rem] flex-1">
                    <Checkbox
                      label="Answer several choices with separate calls"
                      description="A request for n answers to a deployment that gives one at a time."
                      checked={values.fanOut}
                      disabled={disabled}
                      onChange={(v) => set('fanOut', v)}
                    />
                  </div>
                  <Field label="At most" error={errors.fanOutMax} className="w-32">
                    <NumberInput
                      value={values.fanOutMax}
                      min={2}
                      max={128}
                      disabled={disabled || !values.fanOut}
                      onChange={(v) => set('fanOutMax', v)}
                    />
                  </Field>
                </div>
              </Advanced>
            </>
          )}
        </SettingsForm>
      ) : null}
    </Card>
  );
}

/** Routing & resilience: unhealthy deployments, admission, routing behaviour, headers and translation. */
export function RoutingResilienceSection() {
  const load = useTraffic((s) => s.load);
  const canResilience = useCan('getResilienceSettings');
  const canServer = useCan('getServerSettings');
  const canRouting = useCan('getRoutingSettings');
  const canPolicies = useCan('getPoliciesSettings');
  useEffect(() => {
    void load([
      ...(canResilience ? (['resilience'] as const) : []),
      ...(canServer ? (['server'] as const) : []),
      ...(canRouting ? (['routing'] as const) : []),
      ...(canPolicies ? (['policies'] as const) : []),
    ]);
  }, [load, canResilience, canServer, canRouting, canPolicies]);
  return (
    <>
      {canResilience ? <HealthCard /> : null}
      {canResilience ? <FailureHandlingCard /> : null}
      {canPolicies ? <RetryPolicyCard /> : null}
      {canRouting ? <RoutingCard /> : null}
      {canPolicies ? <PassCard /> : null}
      {canServer ? <AdmissionCard /> : null}
    </>
  );
}
