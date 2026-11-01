'use client';

import { useId, useState, type ReactNode } from 'react';

import { Swatch } from '@/components/ui/badge';
import { ModelMark, ProviderMark } from '@/components/ui/marks';
import { useProviderType } from '@/stores/provider-types';
import { Checkbox, Input, NumberInput } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { Select } from '@/components/ui/select';
import type { LogRecord } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { formatCount, formatLatency } from '@/lib/format';

import type { LatencyHistogram } from '../api';
import { useLogs } from '../store';
import {
  activeFilterCount,
  CACHE_OUTCOMES,
  EMPTY_LOG_FILTERS,
  environmentOf,
  ERROR_CODES,
  guardrailFacts,
  latencyMs,
  metadataPair,
  RESPONSE_PATHS,
  responsePathLabel,
  STATUS_CLASSES,
  statusCodeOf,
  withMetadata,
  type LogFilters,
  type StatusClass,
} from '../types';
import { EraseEndUserDialog } from './erase-end-user';
import { LogViews } from './log-views';

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Group({
  title,
  selected = 0,
  onClear,
  children,
}: {
  title: string;
  selected?: number;
  onClear?: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="border-b border-line px-4 py-3">
      <div className="mb-2 flex h-5 items-center justify-between gap-2">
        <span id={id} className="text-caption font-medium text-muted">
          {title}
          {selected > 0 ? <span className="ml-1.5 text-accent tabular-nums">· {selected}</span> : null}
        </span>
        {selected > 0 && onClear ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${title.toLowerCase()}`}
            className="h-5 rounded-xs px-1 text-caption text-muted hover:text-fg"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function Option({
  label,
  count,
  checked,
  onChange,
  swatch,
  icon,
}: {
  label: ReactNode;
  count?: number | undefined;
  checked: boolean;
  onChange: () => void;
  swatch?: string | undefined;
  icon?: ReactNode;
}) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-2">
      <Checkbox
        className="min-w-0"
        checked={checked}
        onChange={onChange}
        label={
          <span className="flex min-w-0 items-center gap-2">
            {swatch ? <Swatch className={swatch} /> : null}
            {icon}
            <span className="truncate">{label}</span>
          </span>
        }
      />
      {count !== undefined ? (
        <span className="mono shrink-0 text-caption text-dim tabular-nums">
          {formatCount(count, { compact: true })}
        </span>
      ) : null}
    </div>
  );
}

const SHOWN = 8;

function Facet({
  title,
  values,
  selected,
  onToggle,
  onClear,
  swatchOf,
  iconOf,
  labelOf,
  always,
  footer,
}: {
  title: string;
  values: { value: string; count: number }[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  swatchOf?: (value: string) => string | undefined;
  iconOf?: (value: string) => ReactNode;
  labelOf?: (value: string) => ReactNode;
  /** Shown even with nothing to list (for its footer). */
  always?: boolean;
  footer?: ReactNode;
}) {
  const [all, setAll] = useState(false);
  if (values.length === 0 && selected.length === 0 && !always) return null;
  const listed = [
    ...values,
    ...selected.filter((s) => !values.some((v) => v.value === s)).map((value) => ({ value, count: 0 })),
  ];
  const shown = all ? listed : listed.slice(0, SHOWN);
  return (
    <Group title={title} selected={selected.length} onClear={onClear}>
      {shown.map((v) => (
        <Option
          key={v.value}
          label={labelOf?.(v.value) ?? v.value}
          count={v.count}
          checked={selected.includes(v.value)}
          onChange={() => onToggle(v.value)}
          swatch={swatchOf?.(v.value)}
          icon={iconOf?.(v.value)}
        />
      ))}
      {listed.length > SHOWN ? (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="mt-1 self-start rounded-xs text-caption text-muted hover:text-fg"
        >
          {all ? 'Show fewer' : `Show ${listed.length - SHOWN} more`}
        </button>
      ) : null}
      {footer}
    </Group>
  );
}

const STATUS_TONE: Record<StatusClass, string> = {
  '2xx': 'bg-success',
  '4xx': 'bg-warn',
  '5xx': 'bg-error',
};

/** Bars of a histogram, with the part outside the chosen range dimmed. */
function Bars({
  counts,
  inRange,
  label,
}: {
  counts: number[];
  inRange: (i: number) => boolean;
  label: string;
}) {
  const peak = Math.max(...counts, 1);
  const w = 240 / Math.max(1, counts.length);
  return (
    <svg viewBox="0 0 240 36" className="block h-9 w-full" role="img" aria-label={label}>
      {counts.map((b, i) => {
        const h = Math.max(1.5, (b / peak) * 34);
        const on = inRange(i);
        return (
          <rect
            key={i}
            x={i * w + 1}
            y={36 - h}
            width={Math.max(1, w - 2)}
            height={h}
            rx={1}
            className={on ? 'fill-accent' : 'fill-dim'}
            fillOpacity={on ? 0.7 : 0.35}
          />
        );
      })}
    </svg>
  );
}

/**
 * How the filtered requests spread over latency: the gateway's histogram (log-spaced buckets over
 * the whole filtered range), else the loaded requests'.
 */
function LatencyHistogramView({
  server,
  records,
  min,
  max,
}: {
  server: LatencyHistogram | null;
  records: LogRecord[];
  min: number | null;
  max: number | null;
}) {
  const within = (lo: number, hi: number) => (min === null || hi > min) && (max === null || lo < max);
  if (server && server.counts.length > 0 && server.counts.some((c) => c > 0)) {
    const bounds = server.bounds;
    return (
      <figure className="m-0 mb-2">
        <Bars
          counts={server.counts}
          label="Latency of the filtered requests"
          inRange={(i) => within(bounds[i] ?? 0, bounds[i + 1] ?? Infinity)}
        />
        <figcaption className="mono mt-1 flex justify-between text-caption text-dim tabular-nums">
          <span>{formatLatency(bounds[0] ?? 0)}</span>
          {server.p50 != null ? <span>p50 {formatLatency(server.p50)}</span> : null}
          <span>{formatLatency(bounds.at(-1) ?? 0)}</span>
        </figcaption>
      </figure>
    );
  }
  const values = records.map(latencyMs).filter((v): v is number => v !== null);
  if (values.length < 5) return null;
  const top = Math.max(...values, 1);
  const bins = new Array<number>(24).fill(0);
  for (const v of values) {
    const i = Math.min(bins.length - 1, Math.floor((v / top) * bins.length));
    bins[i] = (bins[i] ?? 0) + 1;
  }
  return (
    <figure className="m-0 mb-2">
      <Bars
        counts={bins}
        label="Latency of the loaded requests"
        inRange={(i) => within((i / bins.length) * top, ((i + 1) / bins.length) * top)}
      />
      <figcaption className="mono mt-1 flex justify-between text-caption text-dim tabular-nums">
        <span>0</span>
        <span>{formatLatency(top)}</span>
      </figcaption>
    </figure>
  );
}

/** A minimum and maximum, side by side. */
function Range({
  label,
  unit,
  min,
  max,
  step,
  onMin,
  onMax,
  placeholder,
  decimal,
}: {
  label: string;
  unit: string;
  min: string;
  max: string;
  step: number;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  placeholder: [string, string];
  decimal?: boolean;
}) {
  const clean = (v: string) =>
    decimal ? v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1') : v.replace(/\D/g, '');
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex min-w-0 flex-col gap-1 text-caption text-muted">
        Min ({unit})
        <NumberInput
          min={0}
          step={step}
          aria-label={`Minimum ${label} in ${unit}`}
          placeholder={placeholder[0]}
          value={min}
          onChange={(v) => onMin(clean(v))}
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-caption text-muted">
        Max ({unit})
        <NumberInput
          min={0}
          step={step}
          aria-label={`Maximum ${label} in ${unit}`}
          placeholder={placeholder[1]}
          value={max}
          onChange={(v) => onMax(clean(v))}
        />
      </label>
    </div>
  );
}

/** The values of the loaded requests, with how many requests have each, most first. */
function counted(values: Iterable<string>): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

/** A field under a group that adds a typed value; the value is cleaned, checked, then added. */
function AddValue({
  label,
  placeholder,
  clean = (v) => v.trim(),
  valid,
  onAdd,
}: {
  label: string;
  placeholder: string;
  clean?: (typed: string) => string;
  valid: (value: string) => boolean;
  onAdd: (value: string) => void;
}) {
  const [typed, setTyped] = useState('');
  return (
    <form
      className="mt-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const value = clean(typed);
        if (valid(value)) onAdd(value);
        setTyped('');
      }}
    >
      <Input
        aria-label={label}
        placeholder={placeholder}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="h-7 text-caption"
      />
    </form>
  );
}

/** A select under a group that adds one value of a closed set. */
function AddChoice({
  label,
  options,
  onAdd,
}: {
  label: string;
  options: { value: string; label: string }[];
  onAdd: (value: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="mt-1.5">
      <Select
        size="sm"
        aria-label={label}
        placeholder={label}
        options={options}
        value=""
        onChange={onAdd}
        searchable={options.length > 10}
        searchLabel="Find a value"
      />
    </div>
  );
}

/** An id as the gateway takes it: no spaces, at most 256 characters. */
const ID_TEXT = /^\S{1,256}$/;

/** Tags: the ones on the loaded requests with their counts, and any other typed in. */
function Tags({
  records,
  selected,
  onChange,
}: {
  records: LogRecord[];
  selected: string[];
  onChange: (tags: string[]) => void;
}) {
  return (
    <Facet
      title="Tags"
      values={counted(records.flatMap((r) => r.tags.filter((t) => !t.startsWith('env:'))))}
      selected={selected}
      onToggle={(v) => onChange(toggle(selected, v))}
      onClear={() => onChange([])}
      always
      footer={
        <AddValue
          label="Add a tag filter"
          placeholder="Add a tag, e.g. app:support"
          valid={(tag) => /^[A-Za-z0-9:_.-]{1,64}$/.test(tag) && !selected.includes(tag)}
          onAdd={(tag) => onChange([...selected, tag])}
        />
      }
    />
  );
}

/** A record's metadata members whose values are text, numbers or switches, as `name=value`. */
function metadataEntries(r: LogRecord): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries((r as { metadata?: Record<string, unknown> }).metadata ?? {}))
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      out.push(`${k}=${String(v)}`);
  return out;
}

/** Metadata: the members on the loaded requests, and any `name=value` typed in; all must match. */
function Metadata({
  records,
  selected,
  onChange,
}: {
  records: LogRecord[];
  selected: string[];
  onChange: (metadata: string[]) => void;
}) {
  const add = (entry: string) => {
    const pair = metadataPair(entry);
    if (pair) onChange(withMetadata(selected, pair[0], pair[1]));
  };
  return (
    <Facet
      title="Metadata"
      values={counted(records.flatMap(metadataEntries))}
      selected={selected}
      onToggle={(v) => (selected.includes(v) ? onChange(selected.filter((x) => x !== v)) : add(v))}
      onClear={() => onChange([])}
      always
      footer={
        <AddValue
          label="Add a metadata filter"
          placeholder="name=value, e.g. tier=gold"
          valid={(entry) => metadataPair(entry) !== null && !selected.includes(entry)}
          onAdd={add}
        />
      }
    />
  );
}

/**
 * End users: the busiest ones in the range, any id typed in, and erasing an end user's records
 * (the selected one, or an id typed in the dialog) for those who may.
 */
function EndUsers({
  values,
  selected,
  onChange,
}: {
  values: { value: string; count: number }[];
  selected: string[];
  onChange: (endUser: string[]) => void;
}) {
  const canErase = useCan('deleteEndUserLogs');
  const [erasing, setErasing] = useState(false);
  const one = selected.length === 1 ? (selected[0] ?? null) : null;
  return (
    <Facet
      title="End user"
      values={values}
      selected={selected}
      onToggle={(v) => onChange(toggle(selected, v))}
      onClear={() => onChange([])}
      always
      footer={
        <>
          <AddValue
            label="Add an end user filter"
            placeholder="End user ID"
            valid={(id) => ID_TEXT.test(id) && !selected.includes(id)}
            onAdd={(id) => onChange([...selected, id])}
          />
          {canErase ? (
            <>
              <button
                type="button"
                onClick={() => setErasing(true)}
                className="mt-1.5 self-start truncate rounded-xs text-caption text-muted hover:text-error"
              >
                {one ? `Erase the records of ${one}` : "Erase an end user's records"}
              </button>
              <EraseEndUserDialog
                open={erasing}
                endUser={one}
                onClose={() => setErasing(false)}
                onErased={(id) => onChange(selected.filter((v) => v !== id))}
              />
            </>
          ) : null}
        </>
      }
    />
  );
}

/**
 * The prototype's filter rail: saved views with stars, then one group per dimension with counts,
 * latency over the gateway's histogram, cost, the request's behaviour, and tags.
 */
export function FiltersRail({
  providerType,
  className,
}: {
  providerType?: (name: string) => string | undefined;
  className?: string;
}) {
  const filters = useLogs((s) => s.filters);
  const setFilters = useLogs((s) => s.setFilters);
  const typeOf = useProviderType();
  const facets = useLogs((s) => s.facets);
  const histogram = useLogs((s) => s.histogram.data);
  const records = useLogs((s) => s.records.data) ?? [];
  const fallback = (pick: (r: LogRecord) => string | null) => {
    const map = new Map<string, number>();
    for (const r of records) {
      const v = pick(r);
      if (v) map.set(v, (map.get(v) ?? 0) + 1);
    }
    return [...map.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  };
  const facet = (name: string, pick: (r: LogRecord) => string | null) =>
    facets[name]?.length ? (facets[name] ?? []) : fallback(pick);
  // A name apps asked for that no Model has is listed by that name and filtered as asked for.
  const modelValues = facet('model', (r) => r.model ?? r.requested_model);
  const models = new Set([
    ...(facets.model ?? []).filter((v) => !v.requested).map((v) => v.value),
    ...records.flatMap((r) => (r.model ? [r.model] : [])),
  ]);
  const asked = new Set(
    [
      ...(facets.model ?? []).filter((v) => v.requested).map((v) => v.value),
      ...filters.requestedModel,
      ...records.filter((r) => !r.model && r.requested_model).map((r) => r.requested_model ?? ''),
    ].filter((v) => !models.has(v)),
  );
  const active = activeFilterCount(filters);
  const set = (patch: Partial<LogFilters>) => setFilters({ ...filters, ...patch });
  const num = (v: string) => (v === '' ? null : Number(v));
  return (
    <div className={cn('flex flex-col bg-raised', className)}>
      <LogViews className="border-b border-line" />
      <Group title="Status" selected={filters.statusClass.length} onClear={() => set({ statusClass: [] })}>
        {STATUS_CLASSES.map((c) => (
          <Option
            key={c.value}
            label={c.label}
            swatch={STATUS_TONE[c.value]}
            count={
              facets.status_class?.find((x) => x.value === c.value)?.count ??
              records.filter((r) => `${String(r.status_code)[0] ?? ''}xx` === c.value).length
            }
            checked={filters.statusClass.includes(c.value)}
            onChange={() => set({ statusClass: toggle(filters.statusClass, c.value) })}
          />
        ))}
        {filters.statusCode.map((code) => (
          <Option
            key={code}
            label={`${code} exactly`}
            count={records.filter((r) => String(r.status_code) === code).length}
            checked
            onChange={() => set({ statusCode: filters.statusCode.filter((c) => c !== code) })}
          />
        ))}
        <AddValue
          label="Add an exact status code"
          placeholder="Exact code, e.g. 429"
          clean={(v) => v.replace(/\D/g, '')}
          valid={(code) => statusCodeOf(code) !== null && !filters.statusCode.includes(code)}
          onAdd={(code) => set({ statusCode: [...filters.statusCode, code] })}
        />
      </Group>
      <Facet
        title="Error code"
        values={counted(records.flatMap((r) => (r.code ? [r.code] : [])))}
        selected={filters.code}
        onToggle={(v) => set({ code: toggle(filters.code, v) })}
        onClear={() => set({ code: [] })}
        always
        footer={
          <AddChoice
            label="Add an error code"
            options={ERROR_CODES.filter((c) => !filters.code.includes(c)).map((c) => ({
              value: c,
              label: c,
            }))}
            onAdd={(c) => set({ code: [...filters.code, c] })}
          />
        }
      />
      <Facet
        title="Provider"
        values={facet('provider', (r) => r.provider)}
        selected={filters.provider}
        onToggle={(v) => set({ provider: toggle(filters.provider, v) })}
        onClear={() => set({ provider: [] })}
        iconOf={(v) => <ProviderMark type={providerType?.(v) ?? typeOf(v)} className="text-muted" />}
      />
      <Facet
        title="Deployment"
        values={facet('deployment', (r) => r.deployment)}
        selected={filters.deployment}
        onToggle={(v) => set({ deployment: toggle(filters.deployment, v) })}
        onClear={() => set({ deployment: [] })}
      />
      <Facet
        title="Model"
        values={modelValues}
        selected={[...filters.model, ...filters.requestedModel]}
        onToggle={(v) =>
          asked.has(v)
            ? set({ requestedModel: toggle(filters.requestedModel, v) })
            : set({ model: toggle(filters.model, v) })
        }
        onClear={() => set({ model: [], requestedModel: [] })}
        iconOf={(v) => (asked.has(v) ? null : <ModelMark model={v} className="text-muted" />)}
        labelOf={(v) => (asked.has(v) ? `${v} · not a Model` : v)}
      />
      <Facet
        title="Team"
        values={facet('team', (r) => r.team)}
        selected={filters.team}
        onToggle={(v) => set({ team: toggle(filters.team, v) })}
        onClear={() => set({ team: [] })}
      />
      <EndUsers
        values={facet('end_user', (r) => r.end_user)}
        selected={filters.endUser}
        onChange={(endUser) => set({ endUser })}
      />
      <Facet
        title="Session"
        values={counted(records.flatMap((r) => (r.session_id ? [r.session_id] : [])))}
        selected={filters.sessionId}
        onToggle={(v) => set({ sessionId: toggle(filters.sessionId, v) })}
        onClear={() => set({ sessionId: [] })}
        always
        footer={
          <AddValue
            label="Add a session filter"
            placeholder="Session ID"
            valid={(id) => ID_TEXT.test(id) && !filters.sessionId.includes(id)}
            onAdd={(id) => set({ sessionId: [...filters.sessionId, id] })}
          />
        }
      />
      <Facet
        title="Environment"
        values={facet('environment', environmentOf)}
        selected={filters.environment}
        onToggle={(v) => set({ environment: toggle(filters.environment, v) })}
        onClear={() => set({ environment: [] })}
      />
      <Group
        title="Latency"
        selected={filters.latencyMin || filters.latencyMax ? 1 : 0}
        onClear={() => set({ latencyMin: '', latencyMax: '' })}
      >
        <LatencyHistogramView
          server={histogram}
          records={records}
          min={num(filters.latencyMin)}
          max={num(filters.latencyMax)}
        />
        <Range
          label="latency"
          unit="ms"
          step={100}
          min={filters.latencyMin}
          max={filters.latencyMax}
          placeholder={['e.g. 2000', 'any']}
          onMin={(v) => set({ latencyMin: v })}
          onMax={(v) => set({ latencyMax: v })}
        />
      </Group>
      <Group
        title="Cost"
        selected={filters.costMin || filters.costMax ? 1 : 0}
        onClear={() => set({ costMin: '', costMax: '' })}
      >
        <Range
          label="cost"
          unit="$"
          step={0.01}
          decimal
          min={filters.costMin}
          max={filters.costMax}
          placeholder={['e.g. 0.05', 'any']}
          onMin={(v) => set({ costMin: v })}
          onMax={(v) => set({ costMax: v })}
        />
      </Group>
      <Group
        title="Behaviour"
        selected={filters.cache.length + (filters.streamed ? 1 : 0) + (filters.flagged ? 1 : 0)}
        onClear={() => set({ cache: [], streamed: false, flagged: false })}
      >
        {CACHE_OUTCOMES.map((c) => (
          <Option
            key={c.value}
            label={c.label}
            checked={filters.cache.includes(c.value)}
            onChange={() => set({ cache: toggle(filters.cache, c.value) })}
          />
        ))}
        <Option
          label="Streamed"
          checked={filters.streamed}
          onChange={() => set({ streamed: !filters.streamed })}
        />
        <Option
          label="Flagged by guardrails"
          checked={filters.flagged}
          onChange={() => set({ flagged: !filters.flagged })}
        />
      </Group>
      <Facet
        title="Guardrail"
        values={
          facets.guardrail?.length
            ? facets.guardrail
            : counted(records.flatMap((r) => guardrailFacts(r).name))
        }
        selected={filters.guardrail}
        onToggle={(v) => set({ guardrail: toggle(filters.guardrail, v) })}
        onClear={() => set({ guardrail: [] })}
      />
      <Facet
        title="Guardrail verdict"
        values={
          facets.guardrail_verdict?.length
            ? facets.guardrail_verdict
            : counted(records.flatMap((r) => guardrailFacts(r).verdict))
        }
        selected={filters.guardrailVerdict}
        onToggle={(v) => set({ guardrailVerdict: toggle(filters.guardrailVerdict, v) })}
        onClear={() => set({ guardrailVerdict: [] })}
      />
      <Facet
        title="Guardrail category"
        values={
          facets.guardrail_category?.length
            ? facets.guardrail_category
            : counted(records.flatMap((r) => guardrailFacts(r).category))
        }
        selected={filters.guardrailCategory}
        onToggle={(v) => set({ guardrailCategory: toggle(filters.guardrailCategory, v) })}
        onClear={() => set({ guardrailCategory: [] })}
      />
      <Facet
        title="Response path"
        values={counted(records.map((r) => r.response_path).filter(Boolean))}
        selected={filters.responsePath}
        onToggle={(v) => set({ responsePath: toggle(filters.responsePath, v) })}
        onClear={() => set({ responsePath: [] })}
        labelOf={responsePathLabel}
        always
        footer={
          <AddChoice
            label="Add a response path"
            options={RESPONSE_PATHS.filter((p) => !filters.responsePath.includes(p.value))}
            onAdd={(p) => set({ responsePath: [...filters.responsePath, p] })}
          />
        }
      />
      <Tags records={records} selected={filters.tag} onChange={(tag) => set({ tag })} />
      <Metadata records={records} selected={filters.metadata} onChange={(metadata) => set({ metadata })} />
      {active > 0 ? (
        <div className="px-4 py-3">
          <button
            type="button"
            className="rounded-xs text-caption text-muted hover:text-fg"
            onClick={() => setFilters(EMPTY_LOG_FILTERS)}
          >
            Clear all filters
          </button>
        </div>
      ) : null}
    </div>
  );
}
