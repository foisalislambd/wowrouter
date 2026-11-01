'use client';

import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Field, Input, NumberInput, Select } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { Section } from '@/components/ui/layout';
import { MenuButton } from '@/components/ui/menu';
import { CancelButton, Drawer } from '@/components/ui/overlay';
import { EmptyState, InlineError, LoadError, LoadingRows } from '@/components/ui/states';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useEdited } from '@/lib/hooks';
import { emptySlot, failSlot, type Slot } from '@/lib/slot';
import type { FieldErrors } from '@/lib/validation';
import { notify } from '@/stores/ui';

import { settingsApi, type SloStatus } from '../api';
import { durationOptions, durationWords } from '../choices';
import { detailErrors, mergePatch, NAME_RE } from '../form-errors';
import { useOrgSettings } from '../store';
import { Choice, lock } from './settings-form';

type Kind = 'availability' | 'latency';

/** What an objective can be narrowed to, in the order the editor offers them. */
export const SLO_SCOPES = [
  { value: 'provider', label: 'Provider' },
  { value: 'deployment', label: 'Deployment' },
  { value: 'model', label: 'Model' },
  { value: 'route', label: 'Route' },
  { value: 'organization', label: 'Organization' },
  { value: 'team', label: 'Team' },
  { value: 'project', label: 'Project' },
  { value: 'key', label: 'Key' },
] as const;
type ScopeKey = (typeof SLO_SCOPES)[number]['value'];

/** One objective as `observability.slos.<name>` stores it. */
export interface SloSpec {
  kind?: Kind;
  objective: number;
  latency_threshold_ms?: number;
  window?: string;
  scope?: Partial<Record<ScopeKey, string>>;
}

export interface SloForm {
  name: string;
  kind: Kind;
  /** The objective as a percentage ("99.9"). */
  percent: string;
  thresholdMs: string;
  window: string;
  scope: { key: ScopeKey; value: string }[];
}

const WINDOWS = ['1d', '7d', '14d', '28d', '30d', '90d'];
/** `observability.slos.<name>.window` when unset. */
// A per-entry default, which the generated defaults leave out: they hold fixed paths only.
const WINDOW_DEFAULT = '30d';

/** 0.999 → "99.9", without the float noise. */
export function toPercent(ratio: number): string {
  return String(Number((ratio * 100).toFixed(4)));
}

export function sloForm(name: string | null, spec: SloSpec | undefined): SloForm {
  return {
    name: name ?? '',
    kind: spec?.kind ?? 'availability',
    percent: spec ? toPercent(spec.objective) : '99.9',
    thresholdMs: spec?.latency_threshold_ms !== undefined ? String(spec.latency_threshold_ms) : '',
    window: spec?.window ?? WINDOW_DEFAULT,
    scope: Object.entries(spec?.scope ?? {}).flatMap(([key, value]) =>
      typeof value === 'string' ? [{ key: key as ScopeKey, value }] : [],
    ),
  };
}

/** The objective as the configuration takes it. */
export function sloSpec(f: SloForm): SloSpec {
  const scope = Object.fromEntries(
    f.scope.filter((s) => s.value.trim()).map((s) => [s.key, s.value.trim()]),
  ) as SloSpec['scope'];
  return {
    kind: f.kind,
    objective: Number((Number(f.percent) / 100).toFixed(6)),
    ...(f.kind === 'latency' ? { latency_threshold_ms: Number(f.thresholdMs) } : {}),
    window: f.window,
    ...(scope && Object.keys(scope).length > 0 ? { scope } : {}),
  };
}

export function checkSlo(f: SloForm, taken: string[], isNew: boolean): FieldErrors {
  const e: FieldErrors = {};
  if (isNew) {
    if (!NAME_RE.test(f.name.trim())) e.name = 'Use letters, digits, dots, dashes or underscores';
    else if (taken.includes(f.name.trim())) e.name = 'An objective with this name exists';
  }
  const p = Number(f.percent);
  if (!f.percent.trim() || !Number.isFinite(p) || p <= 0 || p >= 100)
    e.percent = 'Enter a percentage above 0 and below 100, such as 99.9';
  if (f.kind === 'latency') {
    const ms = Number(f.thresholdMs);
    if (!f.thresholdMs.trim() || !Number.isFinite(ms) || ms <= 0)
      e.thresholdMs = 'Enter a time in milliseconds, such as 2000';
  }
  const keys = f.scope.filter((s) => s.value.trim()).map((s) => s.key);
  if (new Set(keys).size !== keys.length) e.scope = 'Name each of provider, Model, team… once';
  return e;
}

/** "Model gpt-4.1 · Team search"; "Every request" without a scope. */
export function scopeWords(scope: SloSpec['scope']): string {
  const parts = SLO_SCOPES.flatMap((s) => (scope?.[s.value] ? [`${s.label} ${scope[s.value]}`] : []));
  return parts.length ? parts.join(' · ') : 'Every request';
}

const pct = (ratio: number | null | undefined, digits = 2) =>
  ratio === null || ratio === undefined ? '—' : `${(ratio * 100).toFixed(digits)}%`;

/** A burn rate: 1× spends the error budget exactly over the window. */
function Burn({ rate }: { rate: number | null | undefined }) {
  if (rate === null || rate === undefined) return <span className="text-dim">—</span>;
  const tone = rate >= 6 ? 'text-error' : rate >= 1 ? 'text-warn' : 'text-fg';
  return <span className={`mono ${tone}`}>{rate.toFixed(1)}×</span>;
}

function SloDrawer({
  name,
  spec,
  taken,
  onClose,
}: {
  name: string | null;
  spec: SloSpec | undefined;
  taken: string[];
  onClose: () => void;
}) {
  const save = useOrgSettings((s) => s.saveObservability);
  const canEdit = useCan('patchObservabilitySettings');
  const [start] = useState(() => sloForm(name, spec));
  const [form, setForm] = useState(start);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(form);
  const disabled = !canEdit;
  const isNew = name === null;
  const set = <K extends keyof SloForm>(k: K, v: SloForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest);
  };

  async function submit() {
    const found = checkSlo(form, taken, isNew);
    setErrors(found);
    if (Object.keys(found).length) return;
    const key = isNew ? form.name.trim() : name;
    const after = sloSpec(form) as unknown as Record<string, unknown>;
    const entry = isNew ? after : mergePatch(sloSpec(start) as unknown as Record<string, unknown>, after);
    setBusy(true);
    setError(null);
    try {
      await save({ slos: { [key]: entry } });
      notify('success', isNew ? 'Objective added' : 'Objective saved', key);
      onClose();
    } catch (e) {
      setError(e);
      setErrors(
        detailErrors(e, {
          [`observability.slos.${key}.objective`]: 'percent',
          [`observability.slos.${key}.latency_threshold_ms`]: 'thresholdMs',
          [`observability.slos.${key}.window`]: 'window',
          [`observability.slos.${key}.scope`]: 'scope',
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  const used = new Set(form.scope.map((s) => s.key));
  const nextKey = SLO_SCOPES.find((s) => !used.has(s.value))?.value;
  return (
    <Drawer
      dirty={edited}
      open
      onClose={onClose}
      title={isNew ? 'Add objective' : `Objective ${name}`}
      subtitle="A target for the share of requests that succeed, or that answer in time, over a rolling window."
      footer={
        <>
          <CancelButton />
          <Button
            variant="primary"
            busy={busy}
            disabled={!canEdit}
            disabledReason={canEdit ? undefined : "Your role can't change objectives"}
            onClick={() => void submit()}
          >
            {isNew ? 'Add objective' : 'Save objective'}
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
        {isNew ? (
          <Field label="Name" error={errors.name} hint="Alert rules and reports refer to it by this name.">
            <Input
              mono
              value={form.name}
              disabled={disabled}
              placeholder="chat-availability"
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
        ) : null}
        <Choice<Kind>
          label="What to measure"
          value={form.kind}
          onChange={(v) => set('kind', v)}
          options={lock(disabled, [
            { value: 'availability', label: 'Requests that succeed' },
            { value: 'latency', label: 'Requests answered in time' },
          ])}
        />
        {form.kind === 'latency' ? (
          <Field
            label="In time means within (ms)"
            error={errors.thresholdMs}
            hint="The time to the whole answer, or to the first token of a streamed one."
          >
            <NumberInput
              value={form.thresholdMs}
              min={1}
              step={100}
              disabled={disabled}
              placeholder="2000"
              onChange={(v) => set('thresholdMs', v)}
            />
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Field label="Target (%)" error={errors.percent} hint="99.9 leaves 0.1% of requests to fail.">
            <NumberInput
              value={form.percent}
              min={0}
              max={100}
              step={0.1}
              disabled={disabled}
              onChange={(v) => set('percent', v)}
            />
          </Field>
          <Field label="Over the last" error={errors.window}>
            <Select
              value={form.window}
              disabled={disabled}
              onChange={(v) => set('window', v)}
              options={durationOptions(WINDOWS, form.window)}
            />
          </Field>
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-ui font-semibold text-fg">Count only requests for</legend>
          <p className="-mt-2 text-caption text-muted">Empty: every request through the gateway.</p>
          {errors.scope ? (
            <p role="alert" className="text-caption text-error">
              {errors.scope}
            </p>
          ) : null}
          {form.scope.map((row, i) => (
            <div key={i} className="grid grid-cols-[10rem_minmax(0,1fr)_auto] items-end gap-2">
              <Field label="Of" controlId={`slo-scope-key-${i}`}>
                <Select
                  id={`slo-scope-key-${i}`}
                  value={row.key}
                  disabled={disabled}
                  onChange={(v) =>
                    set(
                      'scope',
                      form.scope.map((s, j) => (j === i ? { ...s, key: v as ScopeKey } : s)),
                    )
                  }
                  options={SLO_SCOPES.map((s) => ({ value: s.value, label: s.label }))}
                />
              </Field>
              <Field label="Name" controlId={`slo-scope-value-${i}`}>
                <Input
                  id={`slo-scope-value-${i}`}
                  mono
                  value={row.value}
                  disabled={disabled}
                  onChange={(e) =>
                    set(
                      'scope',
                      form.scope.map((s, j) => (j === i ? { ...s, value: e.target.value } : s)),
                    )
                  }
                />
              </Field>
              <IconButton
                icon="trash"
                label={`Remove condition ${i + 1}`}
                disabled={disabled}
                onClick={() =>
                  set(
                    'scope',
                    form.scope.filter((_, j) => j !== i),
                  )
                }
              />
            </div>
          ))}
          <div>
            <Button
              size="sm"
              icon="plus"
              disabled={disabled || !nextKey}
              onClick={() => nextKey && set('scope', [...form.scope, { key: nextKey, value: '' }])}
            >
              Add condition
            </Button>
          </div>
        </fieldset>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Drawer>
  );
}

/**
 * Objectives (SLOs): each one's target, how it is doing over its window, the error budget left and
 * how fast it burns, with an editor for `observability.slos`.
 */
export function ObjectivesSection() {
  const canSettings = useCan('getObservabilitySettings');
  const canStatus = useCan('listSloStatus');
  const canEdit = useCan('patchObservabilitySettings');
  const observability = useOrgSettings((s) => s.observability);
  const save = useOrgSettings((s) => s.saveObservability);
  const [status, setStatus] = useState<Slot<SloStatus[]>>(() => ({ ...emptySlot(), status: 'loading' }));
  const [open, setOpen] = useState<{ name: string | null } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    if (canSettings && observability.status === 'idle') void useOrgSettings.getState().loadObservability();
  }, [canSettings, observability.status]);
  const generation = observability.data?.metadata.generation;
  useEffect(() => {
    if (!canStatus) return;
    let live = true;
    settingsApi.slos().then(
      (data) => live && setStatus({ data, status: 'ready', error: null, at: Date.now() }),
      (e: unknown) => live && setStatus((s) => failSlot(s, e)),
    );
    return () => {
      live = false;
    };
  }, [canStatus, generation]);

  if (!canSettings && !canStatus) return null;
  const defined = (observability.data?.spec.slos ?? {}) as Record<string, SloSpec>;
  const byName = new Map((status.data ?? []).map((s) => [s.name, s]));
  const names = [...new Set([...Object.keys(defined), ...byName.keys()])].sort();
  const loading =
    (canSettings && observability.status === 'loading' && !observability.data) ||
    (canStatus && status.status === 'loading' && !status.data);
  return (
    <Section
      title="Objectives"
      subtitle="Targets for the share of requests that succeed or answer in time. Alert rules can watch their burn rate."
      actions={
        canEdit && canSettings ? (
          <Button size="sm" icon="plus" onClick={() => setOpen({ name: null })}>
            Add objective
          </Button>
        ) : null
      }
    >
      {loading ? <LoadingRows rows={2} /> : null}
      <LoadError of={status} subject="Objective status" size="sm" />
      {!loading && names.length === 0 ? (
        <EmptyState
          size="sm"
          title="No objectives yet"
          description="Add one to track availability or latency against a target."
        />
      ) : null}
      {names.length > 0 ? (
        <Table label="Objectives">
          <thead>
            <tr>
              <Th>Objective</Th>
              <Th>Measures</Th>
              <Th numeric>Target</Th>
              <Th numeric>Attained</Th>
              <Th numeric>Budget left</Th>
              <Th numeric className="max-md:hidden">
                Burn 1 h / 6 h
              </Th>
              <Th className="max-lg:hidden">Counts</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {names.map((n) => {
              const spec = defined[n];
              const live = byName.get(n);
              const kind = spec?.kind ?? live?.kind ?? 'availability';
              const window = spec?.window ?? live?.window ?? WINDOW_DEFAULT;
              const objective = spec?.objective ?? live?.objective;
              const missed =
                live?.attained !== null && live?.attained !== undefined && objective !== undefined
                  ? live.attained < objective
                  : false;
              return (
                <Tr key={n}>
                  <Td>
                    <span className="mono text-fg">{n}</span>
                  </Td>
                  <Td muted>
                    {kind === 'latency'
                      ? `Answered within ${spec?.latency_threshold_ms ?? '…'} ms`
                      : 'Succeeded'}
                    <span className="text-dim"> · {durationWords(window)}</span>
                  </Td>
                  <Td numeric>{objective !== undefined ? `${toPercent(objective)}%` : '—'}</Td>
                  <Td numeric>
                    {live ? (
                      live.attained === null ? (
                        <span className="text-dim">No requests yet</span>
                      ) : (
                        <span className={missed ? 'text-error' : 'text-fg'}>{pct(live.attained, 3)}</span>
                      )
                    ) : (
                      <span className="text-dim">—</span>
                    )}
                  </Td>
                  <Td numeric>
                    {live?.error_budget_remaining !== null && live?.error_budget_remaining !== undefined ? (
                      live.error_budget_remaining <= 0 ? (
                        <Badge tone="error">Spent</Badge>
                      ) : (
                        pct(live.error_budget_remaining, 0)
                      )
                    ) : (
                      <span className="text-dim">—</span>
                    )}
                  </Td>
                  <Td numeric className="max-md:hidden">
                    <Burn rate={live?.burn_rate_1h} /> <span className="text-dim">/</span>{' '}
                    <Burn rate={live?.burn_rate_6h} />
                  </Td>
                  <Td muted className="max-lg:hidden">
                    {spec ? scopeWords(spec.scope) : '—'}
                  </Td>
                  <Td className="text-right">
                    {spec && canSettings ? (
                      <MenuButton
                        iconOnly
                        variant="ghost"
                        size="sm"
                        label={`Actions for ${n}`}
                        items={[
                          {
                            label: canEdit ? 'Edit' : 'View',
                            icon: 'edit',
                            onSelect: () => setOpen({ name: n }),
                          },
                          ...(canEdit
                            ? [
                                {
                                  label: 'Remove objective',
                                  icon: 'trash' as const,
                                  danger: true,
                                  onSelect: () => setRemoving(n),
                                },
                              ]
                            : []),
                        ]}
                      />
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      ) : null}
      {open ? (
        <SloDrawer
          name={open.name}
          spec={open.name ? defined[open.name] : undefined}
          taken={names}
          onClose={() => setOpen(null)}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove objective ${removing ?? ''}?`}
        objectName={removing ?? undefined}
        confirmLabel="Remove objective"
        effect="Its status stops being tracked, and alert rules that watch it stop firing."
        onConfirm={async (reason) => {
          if (!removing) return;
          await save({ slos: { [removing]: null } }, reason);
          notify('success', 'Objective removed', removing);
        }}
      />
    </Section>
  );
}
