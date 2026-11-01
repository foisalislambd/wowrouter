'use client';

import { useEffect } from 'react';

import { Switch } from '@/components/ui/choice';
import { Field, Input, NumberInput, Select } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { LoadError, LoadingRows } from '@/components/ui/states';
import type { components } from '@/lib/api/schema';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';
import type { FieldErrors } from '@/lib/validation';

import { durationOptions, rangeError } from '../choices';
import { useOrgSettings } from '../store';
import { Card, Facts } from './parts';
import { Advanced, Hint, SettingsForm } from './settings-form';

type Obs = components['schemas']['ObservabilitySettings']['spec'];
const D = SETTINGS_DEFAULTS.observability;

/** Loads the observability settings once, for a card that reads nothing else. */
function useObservability() {
  const canRead = useCan('getObservabilitySettings');
  const observability = useOrgSettings((s) => s.observability);
  useEffect(() => {
    if (canRead && observability.status === 'idle') void useOrgSettings.getState().loadObservability();
  }, [canRead, observability.status]);
  return { canRead, observability };
}

/* ---------------------------------------------------------------- Alert evaluation */

export interface AlertTimingValues {
  interval: string;
  retention: string;
}

export const alertTimingValues = (spec: Obs | undefined): AlertTimingValues => ({
  interval: spec?.alerts?.evaluation_interval ?? D.alerts.evaluation_interval,
  retention: spec?.alerts?.instance_retention ?? D.alerts.instance_retention,
});

const alertTimingSpec = (v: AlertTimingValues) => ({
  alerts: { evaluation_interval: v.interval, instance_retention: v.retention },
});

/** How often alert rules are checked, and how long resolved alerts stay in the inbox's history. */
export function AlertTimingCard() {
  const { canRead, observability } = useObservability();
  const save = useOrgSettings((s) => s.saveObservability);
  const canEdit = useCan('patchObservabilitySettings');
  if (!canRead) return null;
  return (
    <Card
      title="Alert checks"
      description="How often alert rules are checked, and how long past alerts are kept."
    >
      <LoadError of={observability} subject="Alert settings" size="sm" />
      {observability.status === 'loading' && !observability.data ? <LoadingRows rows={2} /> : null}
      {observability.data ? (
        <SettingsForm
          key={observability.data.metadata.etag}
          initial={alertTimingValues(observability.data.spec)}
          toSpec={alertTimingSpec}
          save={(patch) => save(patch)}
          canEdit={canEdit}
          saved="Alert settings saved"
          paths={{
            'observability.alerts.evaluation_interval': 'interval',
            'observability.alerts.instance_retention': 'retention',
          }}
        >
          {({ values, set, errors, disabled }) => (
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <Field
                label="Check alert rules every"
                error={errors.interval}
                hint="Shorter finds problems sooner and costs more queries."
              >
                <Select
                  value={values.interval}
                  disabled={disabled}
                  onChange={(v) => set('interval', v)}
                  options={durationOptions(['10s', '30s', '1m', '5m', '15m'], values.interval)}
                />
              </Field>
              <Field
                label="Keep past alerts for"
                error={errors.retention}
                hint="Resolved alerts and their notes."
              >
                <Select
                  value={values.retention}
                  disabled={disabled}
                  onChange={(v) => set('retention', v)}
                  options={durationOptions(['7d', '30d', '90d', '180d', '365d'], values.retention)}
                />
              </Field>
            </div>
          )}
        </SettingsForm>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------------- Request details */

export interface RequestDetailValues {
  feedback: boolean;
  feedbackAge: string;
  environmentTag: string;
  metadataEntries: string;
  metadataBytes: string;
  requestIdHeader: boolean;
  versionHeader: boolean;
}

export const requestDetailValues = (spec: Obs | undefined): RequestDetailValues => ({
  feedback: spec?.feedback?.enabled ?? D.feedback.enabled,
  feedbackAge: spec?.feedback?.max_age ?? D.feedback.max_age,
  environmentTag: spec?.environment_tag ?? D.environment_tag,
  metadataEntries: String(spec?.metadata?.max_entries ?? D.metadata.max_entries),
  metadataBytes: String(spec?.metadata?.max_value_bytes ?? D.metadata.max_value_bytes),
  requestIdHeader: spec?.response_headers?.upstream_request_id ?? D.response_headers.upstream_request_id,
  versionHeader: spec?.response_headers?.version ?? D.response_headers.version,
});

const requestDetailSpec = (v: RequestDetailValues) => ({
  feedback: { enabled: v.feedback, max_age: v.feedbackAge },
  environment_tag: v.environmentTag.trim(),
  metadata: { max_entries: Number(v.metadataEntries), max_value_bytes: Number(v.metadataBytes) },
  response_headers: { upstream_request_id: v.requestIdHeader, version: v.versionHeader },
});

function checkDetails(v: RequestDetailValues): FieldErrors {
  const e: FieldErrors = {};
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(v.environmentTag.trim()))
    e.environmentTag = 'Lowercase letters, digits, dots, dashes or underscores, such as env';
  const entries = rangeError(v.metadataEntries, 0, 100);
  if (entries) e.metadataEntries = entries;
  const bytes = rangeError(v.metadataBytes, 1, 4096);
  if (bytes) e.metadataBytes = bytes;
  return e;
}

/**
 * The rest of what a request carries: feedback apps attach later, the environment read from key
 * tags, the metadata kept, and the headers answers carry. The GeoIP database is a file on the node.
 */
export function RequestDetailsCard() {
  const { canRead, observability } = useObservability();
  const save = useOrgSettings((s) => s.saveObservability);
  const canEdit = useCan('patchObservabilitySettings');
  if (!canRead) return null;
  const geoip = observability.data?.spec.geoip?.database ?? null;
  return (
    <Card
      title="Request details"
      description="Feedback, environment and metadata on each record, and the headers answers carry. Set once for the whole gateway."
    >
      <LoadError of={observability} subject="Request settings" size="sm" />
      {observability.status === 'loading' && !observability.data ? <LoadingRows rows={3} /> : null}
      {observability.data ? (
        <SettingsForm
          key={observability.data.metadata.etag}
          initial={requestDetailValues(observability.data.spec)}
          toSpec={requestDetailSpec}
          save={(patch) => save(patch)}
          canEdit={canEdit}
          check={checkDetails}
          saved="Request settings saved"
          paths={{
            'observability.feedback.max_age': 'feedbackAge',
            'observability.environment_tag': 'environmentTag',
            'observability.metadata.max_entries': 'metadataEntries',
            'observability.metadata.max_value_bytes': 'metadataBytes',
          }}
        >
          {({ values, set, errors, disabled }) => (
            <>
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
                  <Switch
                    label="Let apps attach feedback to a request"
                    checked={values.feedback}
                    disabled={disabled}
                    onChange={(v) => set('feedback', v)}
                  />
                  <Hint>A rating or a comment, sent after the answer; it shows with the record.</Hint>
                </div>
                <Field label="Up to" error={errors.feedbackAge} className="w-44">
                  <Select
                    value={values.feedbackAge}
                    disabled={disabled || !values.feedback}
                    onChange={(v) => set('feedbackAge', v)}
                    options={durationOptions(['1d', '7d', '30d', '90d'], values.feedbackAge)}
                  />
                </Field>
              </div>
              <div className="flex flex-col gap-1">
                <Switch
                  label="Send the provider's request ID with each answer"
                  checked={values.requestIdHeader}
                  disabled={disabled}
                  onChange={(v) => set('requestIdHeader', v)}
                />
                <Switch
                  label="Send the gateway's version with each answer"
                  checked={values.versionHeader}
                  disabled={disabled}
                  onChange={(v) => set('versionHeader', v)}
                />
              </div>
              <Advanced>
                <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
                  <Field
                    label="Environment from the key tag"
                    error={errors.environmentTag}
                    hint="A key tagged env:prod puts its requests in the prod environment."
                  >
                    <Input
                      mono
                      value={values.environmentTag}
                      disabled={disabled}
                      onChange={(e) => set('environmentTag', e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Metadata entries kept"
                    error={errors.metadataEntries}
                    hint="Per request, 0 to 100."
                  >
                    <NumberInput
                      value={values.metadataEntries}
                      min={0}
                      max={100}
                      disabled={disabled}
                      onChange={(v) => set('metadataEntries', v)}
                    />
                  </Field>
                  <Field
                    label="Longest metadata value (bytes)"
                    error={errors.metadataBytes}
                    hint="Longer values are cut."
                  >
                    <NumberInput
                      value={values.metadataBytes}
                      min={1}
                      max={4096}
                      disabled={disabled}
                      onChange={(v) => set('metadataBytes', v)}
                    />
                  </Field>
                </div>
                <Facts
                  items={[
                    {
                      label: 'Country lookup (GeoIP)',
                      value: geoip ? <span className="mono break-all">{geoip}</span> : 'Off',
                      hint: 'The path of a database file on each node. Change it in Configuration.',
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
