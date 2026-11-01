'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useSettingsHref } from '@/components/layout/url-sync';
import { Button } from '@/components/ui/button';
import { Field, Input, MultiSelect, Switch } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { Icon } from '@/components/ui/icon';
import { CancelButton, Drawer } from '@/components/ui/overlay';
import { InlineError } from '@/components/ui/states';
import { useEdited } from '@/lib/hooks';
import type { FieldErrors } from '@/lib/validation';
import { notify } from '@/stores/ui';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';

import { detailErrors, mergePatch } from '../form-errors';
import { useOrgSettings } from '../store';
import {
  checkSeries,
  SERIES_PATHS,
  SeriesFields,
  seriesSpec,
  type SeriesValues,
  seriesValues,
} from './metric-series';
import { Hint } from './settings-form';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {});

type TenantLabel = 'organization' | 'team' | 'project';

export interface PrometheusValues {
  enabled: boolean;
  path: string;
  token: boolean;
  tenantLabels: TenantLabel[];
}

export function prometheusValues(metrics: unknown): PrometheusValues {
  const defaults = SETTINGS_DEFAULTS.observability.metrics;
  const m = obj(metrics);
  return {
    enabled: typeof m.enabled === 'boolean' ? m.enabled : defaults.enabled,
    path: typeof m.path === 'string' ? m.path : defaults.path,
    token: (typeof m.auth === 'string' ? m.auth : defaults.auth) === 'required',
    tenantLabels: Array.isArray(m.tenant_labels) ? (m.tenant_labels as TenantLabel[]) : [],
  };
}

export const prometheusSpec = (v: PrometheusValues) => ({
  enabled: v.enabled,
  path: v.path.trim(),
  auth: v.token ? 'required' : 'none',
  tenant_labels: v.tenantLabels,
});

/**
 * The Prometheus endpoint on the admin listener: whether it is served, its path, whether a scrape
 * needs a token, and the tenant labels its series carry.
 */
export function PrometheusDrawer({ onClose }: { onClose: () => void }) {
  const spec = useOrgSettings((s) => s.observability.data?.spec);
  const save = useOrgSettings((s) => s.saveObservability);
  const canWrite = useCan('patchObservabilitySettings');
  const metrics = obj(obj(spec).metrics);
  const [start] = useState(() => prometheusValues(metrics));
  const [form, setForm] = useState(start);
  const [seriesStart] = useState(() => seriesValues(metrics));
  const [series, setSeries] = useState(seriesStart);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited({ form, series });
  const disabled = !canWrite;
  const statusHref = useSettingsHref('status');
  const set = <K extends keyof PrometheusValues>(k: K, v: PrometheusValues[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest);
  };
  const setSeriesValue = <K extends keyof SeriesValues>(k: K, v: SeriesValues[K]) => {
    setSeries((f) => ({ ...f, [k]: v }));
    if (Object.keys(errors).length) setErrors((e): FieldErrors => (e.path ? { path: e.path } : {}));
  };

  async function submit() {
    const e: FieldErrors = checkSeries(series);
    if (!/^\/[A-Za-z0-9._~\-/]*$/.test(form.path.trim())) e.path = 'Enter a path such as /metrics';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      await save({
        metrics: {
          ...mergePatch(prometheusSpec(start), prometheusSpec(form)),
          ...mergePatch(seriesSpec(seriesStart), seriesSpec(series)),
        },
      });
      notify('success', 'Prometheus endpoint saved');
      onClose();
    } catch (err) {
      setError(err);
      setErrors(detailErrors(err, { 'observability.metrics.path': 'path', ...SERIES_PATHS }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      dirty={edited}
      open
      onClose={onClose}
      title="Prometheus endpoint"
      subtitle="The gateway's metrics, for Prometheus or any scraper that reads its text format. Served on the admin listener."
      footer={
        <>
          <CancelButton />
          <Button
            variant="primary"
            busy={busy}
            disabled={!canWrite}
            disabledReason={canWrite ? undefined : "You don't have permission to change telemetry."}
            onClick={() => void submit()}
          >
            Save endpoint
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
        <Switch
          label="Serve metrics"
          checked={form.enabled}
          disabled={disabled}
          onChange={(v) => set('enabled', v)}
        />
        <Field label="Path" error={errors.path}>
          <Input
            mono
            value={form.path}
            disabled={disabled || !form.enabled}
            placeholder="/metrics"
            onChange={(e) => set('path', e.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-1">
          <Switch
            label="Require a token to scrape"
            checked={form.token}
            disabled={disabled || !form.enabled}
            onChange={(v) => set('token', v)}
          />
          {form.token ? (
            <Hint>The scraper sends an admin token whose role can read metrics.</Hint>
          ) : (
            <p className="flex items-start gap-2 text-ui text-warn" role="status">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
              Anyone who can reach the admin listener can read the metrics, including Model, provider and
              organization names.
            </p>
          )}
        </div>
        <Field
          label="Break series down by"
          hint="Each label multiplies the number of series. Empty: gateway totals only."
        >
          <MultiSelect
            noun="label"
            disabled={disabled || !form.enabled}
            value={form.tenantLabels}
            options={[
              { value: 'organization', label: 'Organization' },
              { value: 'team', label: 'Team' },
              { value: 'project', label: 'Project' },
            ]}
            onChange={(v) => set('tenantLabels', v as TenantLabel[])}
          />
        </Field>
        <SeriesFields
          values={series}
          set={setSeriesValue}
          errors={errors}
          disabled={disabled || !form.enabled}
        />
        <p className="text-caption text-muted">
          The scrape address and what the series carry also show on{' '}
          <Link href={statusHref} className="text-accent hover:underline">
            Status
          </Link>
          .
        </p>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Drawer>
  );
}
