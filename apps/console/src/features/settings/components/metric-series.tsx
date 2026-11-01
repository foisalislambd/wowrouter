'use client';

import { Button, IconButton } from '@/components/ui/button';
import { Field, Input, MultiSelect, NumberInput } from '@/components/ui/form';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';
import type { FieldErrors } from '@/lib/validation';

import { rangeError } from '../choices';
import { Advanced } from './settings-form';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const D = SETTINGS_DEFAULTS.observability.metrics;
/** `custom_labels.<name>.other_value` when unset. */
// A per-entry default, which the generated defaults leave out: they hold fixed paths only.
export const OTHER_VALUE = '_other';

/** A label read from request metadata, with the values it may take. */
export interface CustomLabel {
  name: string;
  from: string;
  allowed: string[];
  other: string;
  /** Empty: every metric that can carry it. */
  families: string[];
}

export interface BucketRow {
  family: string;
  /** Upper bounds, comma separated. */
  bounds: string;
}

export interface SeriesValues {
  customLabels: CustomLabel[];
  buckets: BucketRow[];
  exclude: string[];
  maxSeries: string;
  maxLabelBytes: string;
}

export function seriesValues(metrics: unknown): SeriesValues {
  const m = obj(metrics);
  return {
    customLabels: Object.entries(obj(m.custom_labels)).map(([name, raw]) => {
      const l = obj(raw);
      return {
        name,
        from: typeof l.from_metadata === 'string' ? l.from_metadata : '',
        allowed: strings(l.allowed_values),
        other: typeof l.other_value === 'string' ? l.other_value : OTHER_VALUE,
        families: strings(l.families),
      };
    }),
    buckets: Object.entries(obj(m.buckets)).map(([family, bounds]) => ({
      family,
      bounds: Array.isArray(bounds) ? bounds.join(', ') : '',
    })),
    exclude: strings(m.exclude_families),
    maxSeries: String(
      typeof m.max_series_per_family === 'number' ? m.max_series_per_family : D.max_series_per_family,
    ),
    maxLabelBytes: String(
      typeof m.max_label_value_bytes === 'number' ? m.max_label_value_bytes : D.max_label_value_bytes,
    ),
  };
}

const parseBounds = (text: string): number[] =>
  text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);

/** The series settings as `observability.metrics` takes them. */
export function seriesSpec(v: SeriesValues): Obj {
  return {
    custom_labels: Object.fromEntries(
      v.customLabels.map((l) => [
        l.name.trim(),
        {
          from_metadata: l.from.trim(),
          allowed_values: l.allowed,
          ...(l.other.trim() && l.other.trim() !== OTHER_VALUE ? { other_value: l.other.trim() } : {}),
          ...(l.families.length ? { families: l.families } : {}),
        },
      ]),
    ),
    buckets: Object.fromEntries(v.buckets.map((b) => [b.family.trim(), parseBounds(b.bounds)])),
    exclude_families: v.exclude,
    max_series_per_family: Number(v.maxSeries),
    max_label_value_bytes: Number(v.maxLabelBytes),
  };
}

const LABEL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const FAMILY_RE = /^antirion_[a-z0-9_]+$/;
const EXCLUDE_RE = /^[a-z_][a-z0-9_]*$/;

export function checkSeries(v: SeriesValues): FieldErrors {
  const e: FieldErrors = {};
  const names = new Set<string>();
  v.customLabels.forEach((l, i) => {
    const name = l.name.trim();
    if (!LABEL_RE.test(name)) e[`labels.${i}.name`] = 'Letters, digits and _, not starting with a digit';
    else if (names.has(name)) e[`labels.${i}.name`] = 'Each label once';
    names.add(name);
    if (!l.from.trim()) e[`labels.${i}.from`] = 'Name the metadata key it is read from';
    if (l.allowed.length < 1 || l.allowed.length > 50) e[`labels.${i}.allowed`] = 'List 1 to 50 values';
    const bad = l.families.find((f) => !FAMILY_RE.test(f));
    if (bad) e[`labels.${i}.families`] = `"${bad}" isn't a metric name such as antirion_requests_total`;
  });
  const families = new Set<string>();
  v.buckets.forEach((b, i) => {
    const family = b.family.trim();
    if (!FAMILY_RE.test(family))
      e[`buckets.${i}.family`] = 'A metric name such as antirion_request_duration_seconds';
    else if (families.has(family)) e[`buckets.${i}.family`] = 'Each metric once';
    families.add(family);
    const bounds = parseBounds(b.bounds);
    const increasing = bounds.every((n, j) => j === 0 || n > (bounds[j - 1] ?? 0));
    if (bounds.length === 0 || bounds.some((n) => !Number.isFinite(n) || n <= 0) || !increasing)
      e[`buckets.${i}.bounds`] = 'Positive numbers, each larger than the one before';
  });
  const badExclude = v.exclude.find((f) => !EXCLUDE_RE.test(f));
  if (badExclude) e.exclude = `"${badExclude}" isn't a metric name`;
  const series = rangeError(v.maxSeries, 100, 1_000_000);
  if (series) e.maxSeries = series;
  const bytes = rangeError(v.maxLabelBytes, 16, 1024);
  if (bytes) e.maxLabelBytes = bytes;
  return e;
}

/** Server paths of the series settings, onto their fields. */
export const SERIES_PATHS: Record<string, string> = {
  'observability.metrics.exclude_families': 'exclude',
  'observability.metrics.max_series_per_family': 'maxSeries',
  'observability.metrics.max_label_value_bytes': 'maxLabelBytes',
};

/**
 * Labels from request metadata, histogram buckets, metrics left out and the caps on series, in
 * an Advanced section of the Prometheus drawer.
 */
export function SeriesFields({
  values,
  set,
  errors,
  disabled,
}: {
  values: SeriesValues;
  set: <K extends keyof SeriesValues>(key: K, value: SeriesValues[K]) => void;
  errors: FieldErrors;
  disabled: boolean;
}) {
  const label = (i: number, patch: Partial<CustomLabel>) =>
    set(
      'customLabels',
      values.customLabels.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    );
  const bucket = (i: number, patch: Partial<BucketRow>) =>
    set(
      'buckets',
      values.buckets.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    );
  return (
    <Advanced label="Series, labels and buckets">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-ui font-semibold text-fg">Labels from request metadata</legend>
        <p className="-mt-2 text-caption text-muted">
          A label read from a metadata key apps send. Only the values listed are kept; any other is counted
          under one value, so series stay bounded.
        </p>
        {values.customLabels.map((l, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-control border border-line p-3">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 max-sm:grid-cols-1">
              <Field label="Label" error={errors[`labels.${i}.name`]} controlId={`label-name-${i}`}>
                <Input
                  id={`label-name-${i}`}
                  mono
                  value={l.name}
                  disabled={disabled}
                  placeholder="tier"
                  onChange={(e) => label(i, { name: e.target.value })}
                />
              </Field>
              <Field
                label="From metadata key"
                error={errors[`labels.${i}.from`]}
                controlId={`label-from-${i}`}
              >
                <Input
                  id={`label-from-${i}`}
                  mono
                  value={l.from}
                  disabled={disabled}
                  placeholder="customer_tier"
                  onChange={(e) => label(i, { from: e.target.value })}
                />
              </Field>
              <IconButton
                icon="trash"
                label={`Remove label ${l.name || i + 1}`}
                disabled={disabled}
                onClick={() =>
                  set(
                    'customLabels',
                    values.customLabels.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
            <Field label="Values kept" error={errors[`labels.${i}.allowed`]}>
              <MultiSelect
                creatable
                noun="value"
                value={l.allowed}
                disabled={disabled}
                options={l.allowed.map((a) => ({ value: a, label: a }))}
                onChange={(v) => label(i, { allowed: v })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
              <Field label="Other values count as" controlId={`label-other-${i}`}>
                <Input
                  id={`label-other-${i}`}
                  mono
                  value={l.other}
                  disabled={disabled}
                  onChange={(e) => label(i, { other: e.target.value })}
                />
              </Field>
              <Field
                label="Only on metrics"
                optional
                error={errors[`labels.${i}.families`]}
                hint="Empty: every metric that can carry it."
              >
                <MultiSelect
                  creatable
                  noun="metric"
                  value={l.families}
                  disabled={disabled}
                  placeholder="antirion_requests_total"
                  options={l.families.map((f) => ({ value: f, label: f }))}
                  onChange={(v) => label(i, { families: v })}
                />
              </Field>
            </div>
          </div>
        ))}
        <div>
          <Button
            size="sm"
            icon="plus"
            disabled={disabled}
            onClick={() =>
              set('customLabels', [
                ...values.customLabels,
                { name: '', from: '', allowed: [], other: OTHER_VALUE, families: [] },
              ])
            }
          >
            Add label
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-ui font-semibold text-fg">Histogram buckets</legend>
        <p className="-mt-2 text-caption text-muted">Upper bounds for a histogram metric, in its own unit.</p>
        {values.buckets.map((b, i) => (
          <div
            key={i}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 max-sm:grid-cols-1"
          >
            <Field label="Metric" error={errors[`buckets.${i}.family`]} controlId={`bucket-family-${i}`}>
              <Input
                id={`bucket-family-${i}`}
                mono
                value={b.family}
                disabled={disabled}
                placeholder="antirion_request_duration_seconds"
                onChange={(e) => bucket(i, { family: e.target.value })}
              />
            </Field>
            <Field label="Bounds" error={errors[`buckets.${i}.bounds`]} controlId={`bucket-bounds-${i}`}>
              <Input
                id={`bucket-bounds-${i}`}
                mono
                value={b.bounds}
                disabled={disabled}
                placeholder="0.1, 0.5, 1, 5, 30"
                onChange={(e) => bucket(i, { bounds: e.target.value })}
              />
            </Field>
            <IconButton
              icon="trash"
              label={`Remove buckets ${b.family || i + 1}`}
              disabled={disabled}
              onClick={() =>
                set(
                  'buckets',
                  values.buckets.filter((_, j) => j !== i),
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
            onClick={() => set('buckets', [...values.buckets, { family: '', bounds: '' }])}
          >
            Add buckets
          </Button>
        </div>
      </fieldset>

      <Field label="Leave out metrics" error={errors.exclude} hint="They are not served at all.">
        <MultiSelect
          creatable
          noun="metric"
          value={values.exclude}
          disabled={disabled}
          placeholder="antirion_cache_lookups_total"
          options={values.exclude.map((f) => ({ value: f, label: f }))}
          onChange={(v) => set('exclude', v)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field
          label="Most series per metric"
          error={errors.maxSeries}
          hint="Past it, new label values count under one overflow series."
        >
          <NumberInput
            value={values.maxSeries}
            min={100}
            max={1_000_000}
            step={1000}
            disabled={disabled}
            onChange={(v) => set('maxSeries', v)}
          />
        </Field>
        <Field label="Longest label value (bytes)" error={errors.maxLabelBytes} hint="Longer values are cut.">
          <NumberInput
            value={values.maxLabelBytes}
            min={16}
            max={1024}
            disabled={disabled}
            onChange={(v) => set('maxLabelBytes', v)}
          />
        </Field>
      </div>
    </Advanced>
  );
}
