'use client';

import { useEffect, useState } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { Checkbox, Field, Input, NumberInput, Select } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { InlineError, LoadError, LoadingRows } from '@/components/ui/states';
import { plural } from '@/lib/format';
import type { FieldErrors } from '@/lib/validation';
import { notify } from '@/stores/ui';

import type { GovernanceSettings } from '../api';
import { useDanger } from '../danger-store';
import { DURATION_RE, detailErrors, mergePatch, same } from '../form-errors';
import { Card, SaveBar } from './parts';

/** The anchor of the Change control card, which Change requests links to while it is off. */
export const CHANGE_CONTROL_ANCHOR = 'change-control';

type ChangeControl = NonNullable<GovernanceSettings['spec']['change_control']>;
export type ControlledKind = NonNullable<ChangeControl['resources']>[number];

/** What change control can hold, in the order the configuration lists them. */
export const CONTROLLED_KINDS: { value: ControlledKind; label: string }[] = [
  { value: 'providers', label: 'Providers' },
  { value: 'deployments', label: 'Deployments' },
  { value: 'models', label: 'Models' },
  { value: 'routes', label: 'Routes' },
  { value: 'guardrails', label: 'Guardrails' },
  { value: 'plugins', label: 'Plugins' },
  { value: 'pricing', label: 'Prices' },
  { value: 'policies', label: 'Policies' },
  { value: 'organizations', label: 'Organizations' },
  { value: 'teams', label: 'Teams' },
  { value: 'projects', label: 'Projects' },
  { value: 'keys', label: 'API keys' },
  { value: 'users', label: 'People' },
  { value: 'settings', label: 'Gateway settings' },
];

/** The configuration's defaults, shown while nothing is stored. */
export const CHANGE_CONTROL_DEFAULTS = { approvals: '1', ttl: '7d' };

const TTLS = ['1h', '1d', '3d', '7d', '14d', '30d', '90d'];

function ttlWords(v: string): string {
  const m = /^(\d+)(h|d)$/.exec(v);
  if (!m) return v;
  return plural(Number(m[1]), m[2] === 'h' ? 'hour' : 'day');
}

interface PathRow {
  path: string;
  above: string;
}

export interface ChangeControlValues {
  kinds: ControlledKind[];
  approvals: string;
  ttl: string;
  paths: PathRow[];
}

/** The form's values from the stored settings, with the defaults where nothing is stored. */
export function changeControlValues(
  cc: ChangeControl | undefined,
  defaults = CHANGE_CONTROL_DEFAULTS,
): ChangeControlValues {
  return {
    kinds: cc?.resources ?? [],
    approvals: String(cc?.approvals_required ?? defaults.approvals),
    ttl: cc?.request_ttl ?? defaults.ttl,
    paths: (cc?.protected_paths ?? []).map((p) => ({ path: p.path, above: p.above ?? '' })),
  };
}

/** The values as the configuration takes them. */
export function changeControlSpec(v: ChangeControlValues): Record<string, unknown> {
  return {
    resources: CONTROLLED_KINDS.map((k) => k.value).filter((k) => v.kinds.includes(k)),
    approvals_required: Number(v.approvals),
    request_ttl: v.ttl,
    protected_paths: v.paths.map((p) => ({
      path: p.path.trim(),
      ...(p.above.trim() ? { above: p.above.trim() } : {}),
    })),
  };
}

const PATH_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_*-]+)*$/;
/** A number, a duration (90d) or a size (10MiB), as `above` takes them. */
const ABOVE_RE = /^(\d+(\.\d+)?|\d+(\.\d+)?(ms|s|m|h|d)|\d+(B|KiB|MiB|GiB))$/;

function check(v: ChangeControlValues): FieldErrors {
  const e: FieldErrors = {};
  const n = Number(v.approvals);
  if (!/^\d+$/.test(v.approvals) || n < 1 || n > 5) e.approvals = 'Enter a number from 1 to 5';
  if (!DURATION_RE.test(v.ttl)) e.ttl = 'Choose how long a request stays open';
  v.paths.forEach((p, i) => {
    if (!PATH_RE.test(p.path.trim()))
      e[`paths.${i}.path`] = 'Enter a setting such as observability.request_logs.sinks.store.retention';
    if (p.above.trim() && !ABOVE_RE.test(p.above.trim()))
      e[`paths.${i}.above`] = 'Enter a number, a duration such as 90d or a size such as 10MiB';
  });
  return e;
}

function ChangeControlForm({ initial }: { initial: ChangeControlValues }) {
  const saveGovernance = useDanger((s) => s.saveGovernance);
  const canEdit = useCan('patchGovernanceSettings');
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dirty = !same(changeControlSpec(values), changeControlSpec(initial));
  const disabled = !canEdit;
  const ttls = TTLS.includes(values.ttl) ? TTLS : [...TTLS, values.ttl];
  const setPath = (i: number, patch: Partial<PathRow>) =>
    setValues({ ...values, paths: values.paths.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  async function submit() {
    const found = check(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      // Only what changed is written, so a default left alone stays a default.
      await saveGovernance({
        change_control: mergePatch(changeControlSpec(initial), changeControlSpec(values)),
      });
      notify('success', 'Change control saved');
    } catch (e) {
      setError(e);
      setErrors(
        detailErrors(e, {
          'governance.change_control.approvals_required': 'approvals',
          'governance.change_control.request_ttl': 'ttl',
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <InlineError error={error} />
      <fieldset className="grid grid-cols-3 gap-x-6 gap-y-2.5 max-md:grid-cols-2 max-sm:grid-cols-1">
        <legend className="mb-2 text-ui font-medium text-fg">Changes to these need approval</legend>
        {CONTROLLED_KINDS.map((k) => (
          <Checkbox
            key={k.value}
            label={k.label}
            checked={values.kinds.includes(k.value)}
            disabled={disabled}
            onChange={(on) =>
              setValues({
                ...values,
                kinds: on ? [...values.kinds, k.value] : values.kinds.filter((x) => x !== k.value),
              })
            }
          />
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-ui font-medium text-fg">Single settings that need approval</legend>
        <p className="text-caption text-muted">
          A setting by its place in the configuration. With a limit, only a new value above it needs approval:
          a number, a duration such as 90d or a size such as 10MiB.
        </p>
        {values.paths.map((p, i) => (
          <div key={i} className="grid grid-cols-[1fr_9rem_auto] items-start gap-2 max-sm:grid-cols-1">
            <Field label={`Setting ${i + 1}`} error={errors[`paths.${i}.path`]}>
              <Input
                mono
                value={p.path}
                disabled={disabled}
                placeholder="observability.request_logs.sinks.store.retention"
                onChange={(e) => setPath(i, { path: e.target.value })}
              />
            </Field>
            <Field label="Above" optional error={errors[`paths.${i}.above`]}>
              <Input
                mono
                value={p.above}
                disabled={disabled}
                placeholder="90d"
                onChange={(e) => setPath(i, { above: e.target.value })}
              />
            </Field>
            <IconButton
              icon="trash"
              className="mt-7"
              label={`Remove setting ${i + 1}`}
              disabled={disabled}
              onClick={() => setValues({ ...values, paths: values.paths.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        <div>
          <Button
            size="sm"
            icon="plus"
            disabled={disabled}
            onClick={() => setValues({ ...values, paths: [...values.paths, { path: '', above: '' }] })}
          >
            Add setting
          </Button>
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field
          label="Approvals needed"
          error={errors.approvals}
          hint="From people other than the author, 1 to 5."
        >
          <NumberInput
            value={values.approvals}
            min={1}
            max={5}
            disabled={disabled}
            onChange={(approvals) => setValues({ ...values, approvals })}
          />
        </Field>
        <Field
          label="A request expires after"
          error={errors.ttl}
          hint="If it isn't approved by then, nothing changes."
        >
          <Select
            value={values.ttl}
            disabled={disabled}
            onChange={(ttl) => setValues({ ...values, ttl })}
            options={ttls.map((v) => ({ value: v, label: ttlWords(v) }))}
          />
        </Field>
      </div>
      <SaveBar dirty={dirty} busy={busy} canEdit={canEdit} onDiscard={() => setValues(initial)} />
    </form>
  );
}

/**
 * Change control: which kinds of change, and which single settings, open a change request for
 * someone else to approve instead of applying at once.
 */
export function ChangeControlCard() {
  const governance = useDanger((s) => s.governance);
  const cc = governance.data?.spec.change_control;
  const loaded = governance.data !== null;
  useEffect(() => {
    // Change requests links here (`#change-control`) while change control is off.
    if (loaded && window.location.hash === `#${CHANGE_CONTROL_ANCHOR}`)
      document.getElementById(CHANGE_CONTROL_ANCHOR)?.scrollIntoView({ block: 'start' });
  }, [loaded]);
  return (
    <Card
      id={CHANGE_CONTROL_ANCHOR}
      title="Change control"
      description="Changes to what you pick here are not applied at once: they open a change request that someone else approves. Requests show in Change requests."
    >
      <LoadError of={governance} subject="Change control" size="sm" />
      {governance.status === 'loading' && !governance.data ? <LoadingRows rows={4} /> : null}
      {governance.data ? (
        <ChangeControlForm key={governance.data.metadata.etag} initial={changeControlValues(cc)} />
      ) : null}
    </Card>
  );
}
