'use client';

import { useEffect } from 'react';

import { Field, Input, NumberInput, Select, Switch } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { LoadError, LoadingRows } from '@/components/ui/states';
import type { components } from '@/lib/api/schema';
import type { FieldErrors } from '@/lib/validation';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';

import { durationOptions, rangeError } from '../choices';
import { useTraffic } from '../traffic-store';
import { Card } from './parts';
import { Choice, Advanced, Hint, lock, SettingsForm } from './settings-form';

type S = components['schemas'];
type CacheSpec = S['CacheSettings']['spec'];
type CachePolicy = NonNullable<S['PoliciesSettings']['spec']['cache']>;

const sizeOptions = (list: string[], current: string) =>
  (list.includes(current) ? list : [...list, current]).map((v) => ({
    value: v,
    label: v.replace(/(\d)([KMG]?i?B)$/, '$1 $2'),
  }));

/* ---------------------------------------------------------------- Storage */

type Backend = 'auto' | 'memory' | 'redis';

export interface StorageValues {
  backend: Backend;
  maxSize: string;
  /** Blank keeps a stored address. */
  redisUrl: string;
  prefix: string;
  lookup: string;
  write: string;
  vectors: string;
  vectorLookup: string;
}

const CD = SETTINGS_DEFAULTS.cache;

export function storageValues(spec: CacheSpec | undefined): StorageValues {
  const b = spec?.backend;
  const sem = spec?.semantic_store;
  return {
    backend: b?.type ?? 'auto',
    maxSize: b?.memory?.max_size ?? CD.backend.memory.max_size,
    redisUrl: '',
    prefix: b?.redis?.key_prefix ?? CD.backend.redis.key_prefix,
    lookup: b?.lookup_timeout ?? CD.backend.lookup_timeout,
    write: b?.write_timeout ?? CD.backend.write_timeout,
    vectors: String(sem?.memory?.max_entries ?? CD.semantic_store.memory.max_entries),
    vectorLookup: sem?.lookup_timeout ?? CD.semantic_store.lookup_timeout,
  };
}

/** The storage settings as the configuration takes them; a Redis address only when one was typed. */
export function storageSpec(v: StorageValues): Record<string, unknown> {
  return {
    backend: {
      type: v.backend === 'auto' ? null : v.backend,
      memory: { max_size: v.maxSize },
      redis: { key_prefix: v.prefix, ...(v.redisUrl ? { url: v.redisUrl } : {}) },
      lookup_timeout: v.lookup,
      write_timeout: v.write,
    },
    semantic_store: { memory: { max_entries: Number(v.vectors) }, lookup_timeout: v.vectorLookup },
  };
}

function StorageCard() {
  const cache = useTraffic((s) => s.cache);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchCacheSettings');
  const spec = cache.data?.spec;
  const storedUrl = spec?.backend?.redis?.url;
  return (
    <Card
      title="Storage"
      description="Where cached answers are kept. The Cache page shows what each Model caches."
    >
      <LoadError of={cache} subject="Cache storage" size="sm" />
      {cache.status === 'loading' && !cache.data ? <LoadingRows rows={3} /> : null}
      {cache.data ? (
        <SettingsForm
          key={cache.data.metadata.etag}
          initial={storageValues(spec)}
          toSpec={storageSpec}
          save={(patch) => save('cache', patch)}
          canEdit={canEdit}
          saved="Cache storage saved"
          check={(v): FieldErrors => {
            const e: FieldErrors = {};
            if (v.backend === 'redis' && !v.redisUrl && !storedUrl) e.redisUrl = 'Enter the Redis address';
            const vectors = rangeError(v.vectors, 1, 10_000_000);
            if (vectors) e.vectors = vectors;
            return e;
          }}
          paths={{
            'cache.backend.redis.url': 'redisUrl',
            'cache.backend.memory.max_size': 'maxSize',
            'cache.semantic_store.memory.max_entries': 'vectors',
          }}
        >
          {({ values, set, errors, disabled }) => (
            <>
              <Choice<Backend>
                label="Keep cached answers in"
                value={values.backend}
                onChange={(v) => set('backend', v)}
                options={lock(disabled, [
                  {
                    value: 'auto',
                    label: 'Automatic',
                    description:
                      "Each node's memory, or the cluster's shared counter store when the gateway runs as a cluster.",
                  },
                  {
                    value: 'memory',
                    label: "Each node's memory",
                    description: 'Nodes do not share entries.',
                  },
                  {
                    value: 'redis',
                    label: 'Redis',
                    description: 'Every node reads and writes the same entries.',
                  },
                ])}
              />
              {values.backend === 'memory' ? (
                <Field
                  label="Memory for cached answers, per node"
                  error={errors.maxSize}
                  className="w-64 max-sm:w-full"
                >
                  <Select
                    value={values.maxSize}
                    disabled={disabled}
                    onChange={(v) => set('maxSize', v)}
                    options={sizeOptions(
                      ['64MiB', '128MiB', '256MiB', '512MiB', '1GiB', '4GiB'],
                      values.maxSize,
                    )}
                  />
                </Field>
              ) : null}
              {values.backend === 'redis' ? (
                <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                  <Field
                    label="Redis address"
                    required={!storedUrl}
                    error={errors.redisUrl}
                    hint={
                      storedUrl
                        ? 'Leave blank to keep the current address.'
                        : 'Stored encrypted. A reference such as ${env:NAME} also works.'
                    }
                  >
                    <Input
                      mono
                      type="password"
                      autoComplete="off"
                      value={values.redisUrl}
                      disabled={disabled}
                      placeholder={storedUrl ? 'Hidden; leave blank to keep' : 'redis://cache.internal:6379'}
                      onChange={(e) => set('redisUrl', e.target.value)}
                    />
                  </Field>
                  <Field label="Key prefix">
                    <Input
                      mono
                      value={values.prefix}
                      disabled={disabled}
                      onChange={(e) => set('prefix', e.target.value)}
                    />
                  </Field>
                </div>
              ) : null}
              <Advanced>
                <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                  <Field label="Give up a lookup after" hint="Then the request goes to the provider.">
                    <Select
                      value={values.lookup}
                      disabled={disabled}
                      onChange={(v) => set('lookup', v)}
                      options={durationOptions(
                        ['10ms', '25ms', '50ms', '100ms', '250ms', '1s'],
                        values.lookup,
                      )}
                    />
                  </Field>
                  <Field label="Give up a write after">
                    <Select
                      value={values.write}
                      disabled={disabled}
                      onChange={(v) => set('write', v)}
                      options={durationOptions(['100ms', '500ms', '1s', '5s', '30s'], values.write)}
                    />
                  </Field>
                  <Field
                    label="Similar-prompt matches kept, per node"
                    error={errors.vectors}
                    hint="For Models that also answer similar prompts from the cache."
                  >
                    <NumberInput
                      value={values.vectors}
                      min={1}
                      max={10_000_000}
                      disabled={disabled}
                      onChange={(v) => set('vectors', v)}
                    />
                  </Field>
                  <Field label="Give up a similar-prompt lookup after">
                    <Select
                      value={values.vectorLookup}
                      disabled={disabled}
                      onChange={(v) => set('vectorLookup', v)}
                      options={durationOptions(
                        ['50ms', '100ms', '250ms', '500ms', '1s'],
                        values.vectorLookup,
                      )}
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

/* ---------------------------------------------------------------- Gateway default */

type Activation = 'always' | 'opt_in';
type Scope = 'organization' | 'team' | 'project' | 'key' | 'end_user' | 'shared';

export interface DefaultCacheValues {
  enabled: boolean;
  activation: Activation;
  scope: Scope;
  ttl: string;
  maxTtl: string;
  maxEntry: string;
  failClosed: boolean;
  afterFallback: boolean;
  coalesce: boolean;
}

export function defaultCacheValues(c: CachePolicy | undefined): DefaultCacheValues {
  const defaults = SETTINGS_DEFAULTS.policies.cache;
  return {
    enabled: c?.enabled ?? defaults.enabled,
    activation: c?.activation ?? defaults.activation,
    scope: c?.scope ?? defaults.scope,
    ttl: c?.ttl ?? defaults.ttl,
    maxTtl: c?.max_ttl ?? defaults.max_ttl,
    maxEntry: c?.max_entry_size ?? defaults.max_entry_size,
    failClosed: (c?.fail_mode ?? defaults.fail_mode) === 'closed',
    afterFallback: c?.store_after_fallback ?? defaults.store_after_fallback,
    coalesce: c?.coalesce?.enabled ?? defaults.coalesce.enabled,
  };
}

const defaultCacheSpec = (v: DefaultCacheValues) => ({
  enabled: v.enabled,
  activation: v.activation,
  scope: v.scope,
  ttl: v.ttl,
  max_ttl: v.maxTtl,
  max_entry_size: v.maxEntry,
  fail_mode: v.failClosed ? 'closed' : 'open',
  store_after_fallback: v.afterFallback,
  coalesce: { enabled: v.coalesce },
});

const TTLS = ['5m', '15m', '1h', '6h', '1d', '7d'];
const MAX_TTLS = ['1h', '1d', '7d', '30d'];

function DefaultCacheCard() {
  const policies = useTraffic((s) => s.policies);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchPoliciesSettings');
  const zdr = policies.data?.spec.observability?.zero_data_retention === true;
  return (
    <Card
      title="Default for every Model"
      description="Applies unless a Model, organization, team, project or key sets its own. Per-Model settings are on the Cache page."
    >
      <LoadError of={policies} subject="The gateway's cache policy" size="sm" />
      {policies.status === 'loading' && !policies.data ? <LoadingRows rows={3} /> : null}
      {policies.data ? (
        <SettingsForm
          key={policies.data.metadata.etag}
          initial={defaultCacheValues(policies.data.spec.cache)}
          toSpec={defaultCacheSpec}
          save={(patch) => save('policies', { cache: patch })}
          canEdit={canEdit}
          saved="Cache default saved"
          paths={{ 'policies.cache.enabled': 'enabled', 'policies.cache.max_ttl': 'maxTtl' }}
        >
          {({ values, set, errors, disabled }) => {
            const off = disabled || !values.enabled;
            return (
              <>
                <div className="flex flex-col gap-1">
                  <Switch
                    label="Cache answers"
                    checked={values.enabled}
                    disabled={disabled || (zdr && !values.enabled)}
                    disabledReason={zdr ? 'Zero data retention is on for the gateway' : undefined}
                    onChange={(v) => set('enabled', v)}
                  />
                  {errors.enabled ? (
                    <p role="alert" className="text-caption text-error">
                      {errors.enabled}
                    </p>
                  ) : (
                    <Hint>
                      A repeated request gets the stored answer, at no cost, without calling the provider.
                    </Hint>
                  )}
                </div>
                <Choice<Activation>
                  label="When"
                  value={values.activation}
                  onChange={(v) => set('activation', v)}
                  options={lock(off, [
                    { value: 'always', label: 'For every request that can be cached' },
                    {
                      value: 'opt_in',
                      label: 'Only when the request asks for it',
                      description: 'With the cache header or directive.',
                    },
                  ])}
                />
                <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
                  <Field label="Shared within">
                    <Select
                      value={values.scope}
                      disabled={off}
                      onChange={(v) => set('scope', v as Scope)}
                      options={[
                        { value: 'organization', label: 'An organization' },
                        { value: 'team', label: 'A team' },
                        { value: 'project', label: 'A project' },
                        { value: 'key', label: 'One API key' },
                        { value: 'end_user', label: 'One end user' },
                        { value: 'shared', label: 'The whole gateway' },
                      ]}
                    />
                  </Field>
                  <Field label="Keep answers for">
                    <Select
                      value={values.ttl}
                      disabled={off}
                      onChange={(v) => set('ttl', v)}
                      options={durationOptions(TTLS, values.ttl)}
                    />
                  </Field>
                  <Field label="Longest a request may ask for" error={errors.maxTtl}>
                    <Select
                      value={values.maxTtl}
                      disabled={off}
                      onChange={(v) => set('maxTtl', v)}
                      options={durationOptions(MAX_TTLS, values.maxTtl)}
                    />
                  </Field>
                </div>
                <Advanced>
                  <Field label="Largest answer cached" className="w-64 max-sm:w-full">
                    <Select
                      value={values.maxEntry}
                      disabled={off}
                      onChange={(v) => set('maxEntry', v)}
                      options={sizeOptions(
                        ['64KiB', '256KiB', '1MiB', '4MiB', '16MiB', '64MiB'],
                        values.maxEntry,
                      )}
                    />
                  </Field>
                  <Switch
                    label="Refuse requests while the cache can't be read"
                    checked={values.failClosed}
                    disabled={off}
                    onChange={(v) => set('failClosed', v)}
                  />
                  <Switch
                    label="Also cache answers from a fallback Model"
                    checked={values.afterFallback}
                    disabled={off}
                    onChange={(v) => set('afterFallback', v)}
                  />
                  <div className="flex flex-col gap-1">
                    <Switch
                      label="Wait for an identical request in flight"
                      checked={values.coalesce}
                      disabled={off}
                      onChange={(v) => set('coalesce', v)}
                    />
                    <Hint>Identical requests arriving together make one provider call, per node.</Hint>
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

/** Cache: where answers are kept, and the gateway's default caching. */
export function CacheSection() {
  const load = useTraffic((s) => s.load);
  useEffect(() => {
    void load(['cache', 'policies']);
  }, [load]);
  return (
    <>
      <DefaultCacheCard />
      <StorageCard />
    </>
  );
}
