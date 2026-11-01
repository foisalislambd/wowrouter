'use client';

import { useEffect } from 'react';

import { Badge } from '@/components/ui/badge';
import { Checkbox, Field, NumberInput, Select, Switch } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { LoadError, LoadingRows } from '@/components/ui/states';
import type { components } from '@/lib/api/schema';
import type { FieldErrors } from '@/lib/validation';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';

import { durationOptions, rangeError } from '../choices';
import { useOrgSettings } from '../store';
import { Card, Facts } from './parts';
import { Advanced, Hint, SettingsForm } from './settings-form';

type AuthSpec = components['schemas']['AuthSettings']['spec'];

export interface KeyProtectionValues {
  enabled: boolean;
  network: boolean;
  agent: boolean;
  country: boolean;
  baseline: string;
  spike: string;
  minRequests: string;
  maxFailures: string;
  window: string;
}

export function keyProtectionValues(spec: AuthSpec | undefined): KeyProtectionValues {
  const a = spec?.anomaly_detection;
  const t = spec?.failed_auth_throttle;
  const d = SETTINGS_DEFAULTS.auth.anomaly_detection;
  return {
    enabled: a?.enabled ?? d.enabled,
    network: a?.new_network ?? d.new_network,
    agent: a?.new_user_agent ?? d.new_user_agent,
    country: a?.new_country ?? d.new_country,
    baseline: a?.baseline ?? d.baseline,
    spike: String(a?.spike_factor ?? d.spike_factor),
    minRequests: String(a?.min_requests ?? d.min_requests),
    maxFailures: String(t?.max_failures ?? SETTINGS_DEFAULTS.auth.failed_auth_throttle.max_failures),
    window: t?.window ?? SETTINGS_DEFAULTS.auth.failed_auth_throttle.window,
  };
}

const keyProtectionSpec = (v: KeyProtectionValues) => ({
  anomaly_detection: {
    enabled: v.enabled,
    new_network: v.network,
    new_user_agent: v.agent,
    new_country: v.country,
    baseline: v.baseline,
    spike_factor: Number(v.spike),
    min_requests: Number(v.minRequests),
  },
  failed_auth_throttle: { max_failures: Number(v.maxFailures), window: v.window },
});

function check(v: KeyProtectionValues): FieldErrors {
  const e: FieldErrors = {};
  const spike = Number(v.spike);
  if (!(spike >= 1.5 && spike <= 1000)) e.spike = 'Enter a number from 1.5 to 1000';
  const min = rangeError(v.minRequests, 1);
  if (min) e.minRequests = min;
  const failures = rangeError(v.maxFailures, 1);
  if (failures) e.maxFailures = failures;
  return e;
}

const BASELINES = ['1d', '3d', '7d', '14d', '30d'];
const WINDOWS = ['30s', '1m', '5m', '15m', '1h'];

/**
 * Unusual key activity (flags a key that shows up from a new network, client or country, or with a
 * sudden jump in traffic) and the throttle on failed key attempts, gateway-wide.
 */
export function KeyProtectionCard() {
  const auth = useOrgSettings((s) => s.auth);
  const loadSettings = useOrgSettings((s) => s.loadSettings);
  const saveAuth = useOrgSettings((s) => s.saveAuth);
  const canRead = useCan('getAuthSettings');
  const canEdit = useCan('patchAuthSettings');
  useEffect(() => {
    if (canRead && auth.status === 'idle') void loadSettings();
  }, [canRead, auth.status, loadSettings]);
  if (!canRead) return null;
  const spec = auth.data?.spec;
  return (
    <Card
      title="Unusual key activity"
      description="Flags API keys that start behaving differently, and slows down addresses that keep sending wrong keys. For the whole gateway."
    >
      <LoadError of={auth} subject="Key protection" size="sm" />
      {auth.status === 'loading' && !auth.data ? <LoadingRows rows={4} /> : null}
      {auth.data ? (
        <div className="flex flex-col gap-5">
          <Facts
            items={[
              {
                label: 'Apps must send a key',
                value:
                  (spec?.mode ?? SETTINGS_DEFAULTS.auth.mode) === 'required' ? (
                    'Yes'
                  ) : (
                    <Badge tone="error">No: every request is let in without one</Badge>
                  ),
                hint: 'Changed only from the Danger zone.',
              },
            ]}
          />
          <SettingsForm
            key={auth.data.metadata.etag}
            initial={keyProtectionValues(spec)}
            toSpec={keyProtectionSpec}
            save={(patch) => saveAuth(patch)}
            canEdit={canEdit}
            check={check}
            saved="Key protection saved"
            paths={{
              'auth.anomaly_detection.spike_factor': 'spike',
              'auth.anomaly_detection.min_requests': 'minRequests',
              'auth.anomaly_detection.baseline': 'baseline',
              'auth.failed_auth_throttle.max_failures': 'maxFailures',
              'auth.failed_auth_throttle.window': 'window',
            }}
          >
            {({ values, set, errors, disabled }) => (
              <>
                <div className="flex flex-col gap-1">
                  <Switch
                    label="Flag unusual key activity"
                    checked={values.enabled}
                    disabled={disabled}
                    onChange={(v) => set('enabled', v)}
                  />
                  <Hint>
                    Flags show on the Keys page and raise the key anomaly alert. Requests are never refused
                    because of a flag.
                  </Hint>
                </div>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-ui font-medium text-fg">Flag a key used from</legend>
                  <Checkbox
                    label="A new network"
                    description="An address range the key hasn't been used from lately."
                    checked={values.network}
                    disabled={disabled || !values.enabled}
                    onChange={(v) => set('network', v)}
                  />
                  <Checkbox
                    label="A new app or client"
                    description="A kind of client, by its user agent, the key hasn't sent lately."
                    checked={values.agent}
                    disabled={disabled || !values.enabled}
                    onChange={(v) => set('agent', v)}
                  />
                  <Checkbox
                    label="A new country"
                    description="Needs the location database in the gateway's configuration."
                    checked={values.country}
                    disabled={disabled || !values.enabled}
                    onChange={(v) => set('country', v)}
                  />
                </fieldset>
                <Advanced label="Sudden jumps and what counts as usual">
                  <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
                    <Field label="Usual means the last" error={errors.baseline}>
                      <Select
                        value={values.baseline}
                        disabled={disabled || !values.enabled}
                        onChange={(v) => set('baseline', v)}
                        options={durationOptions(BASELINES, values.baseline)}
                      />
                    </Field>
                    <Field
                      label="Jump, times the usual"
                      error={errors.spike}
                      hint="An hour with this many times the key's hourly average."
                    >
                      <NumberInput
                        value={values.spike}
                        min={1.5}
                        max={1000}
                        step={0.5}
                        disabled={disabled || !values.enabled}
                        onChange={(v) => set('spike', v)}
                      />
                    </Field>
                    <Field
                      label="Only above, requests an hour"
                      error={errors.minRequests}
                      hint="Quieter hours are never a jump."
                    >
                      <NumberInput
                        value={values.minRequests}
                        min={1}
                        disabled={disabled || !values.enabled}
                        onChange={(v) => set('minRequests', v)}
                      />
                    </Field>
                  </div>
                </Advanced>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-ui font-medium text-fg">Failed key attempts</legend>
                  <Hint>
                    An address that sends this many wrong or unknown keys is refused (429) until the window
                    passes. Addresses in IPv6 count by their /64.
                  </Hint>
                  <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                    <Field label="Attempts allowed" error={errors.maxFailures}>
                      <NumberInput
                        value={values.maxFailures}
                        min={1}
                        disabled={disabled}
                        onChange={(v) => set('maxFailures', v)}
                      />
                    </Field>
                    <Field label="Within" error={errors.window}>
                      <Select
                        value={values.window}
                        disabled={disabled}
                        onChange={(v) => set('window', v)}
                        options={durationOptions(WINDOWS, values.window)}
                      />
                    </Field>
                  </div>
                </fieldset>
              </>
            )}
          </SettingsForm>
        </div>
      ) : null}
    </Card>
  );
}
