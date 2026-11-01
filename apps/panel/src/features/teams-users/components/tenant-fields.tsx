'use client';

import type { ReactNode } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { Field, Input, NumberInput, Select } from '@/components/ui/form';
import type { FieldErrors } from '@/lib/validation';

import { AccessFields, LabelFields } from '../../keys/components/access-fields';
import type { Inherited, LimitRow, TenantValues } from '../form';

/** A titled part of a long drawer, as in the key form. */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-5">
      <div>
        <h3 className="text-body font-semibold text-fg">{title}</h3>
        {description ? <p className="mt-0.5 text-caption text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

const UNITS = [
  { value: 'requests', label: 'Requests' },
  { value: 'tokens', label: 'Tokens' },
  { value: 'concurrency', label: 'Requests at once' },
];

const PER = [
  { value: '1s', label: 'per second' },
  { value: '1m', label: 'per minute' },
  { value: '1h', label: 'per hour' },
  { value: '1d', label: 'per day' },
];

/** The rate limits a team or project declares, one row each. */
export function LimitsEditor({
  rows,
  onChange,
  error,
  level,
}: {
  rows: LimitRow[];
  onChange: (rows: LimitRow[]) => void;
  error?: string | undefined;
  level: 'team' | 'project';
}) {
  const update = (i: number, patch: Partial<LimitRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const splits = [
    { value: '', label: `Whole ${level}` },
    { value: 'key', label: 'Each key' },
    { value: 'user', label: 'Each person' },
    ...(level === 'team' ? [{ value: 'project', label: 'Each project' }] : []),
    { value: 'model', label: 'Each Model' },
    { value: 'end_user', label: 'Each end user' },
  ];
  return (
    <div role="group" aria-label="Rate limits" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-caption text-muted">
          {rows.length === 0
            ? `None. Limits of the organization and the keys still apply.`
            : 'Each limit is checked on its own, with the ones above and below it.'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          onClick={() =>
            onChange([...rows, { id: '', name: '', unit: 'requests', limit: '', per: '1m', split: '' }])
          }
        >
          Add limit
        </Button>
      </div>
      {rows.map((row, i) => (
        <div
          key={row.id || `new-${i}`}
          className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-2 max-md:grid-cols-2"
        >
          <Input
            mono
            aria-label={`Limit ${i + 1} name`}
            placeholder="rpm"
            value={row.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <NumberInput
            aria-label={`Limit ${i + 1} amount`}
            min={0}
            placeholder="e.g. 600"
            value={row.limit}
            onChange={(v) => update(i, { limit: v })}
          />
          <Select
            aria-label={`Limit ${i + 1} counts`}
            value={row.unit}
            onChange={(v) => update(i, { unit: v as LimitRow['unit'] })}
            options={UNITS}
          />
          {row.unit === 'concurrency' ? (
            <span className="text-caption text-muted">at once</span>
          ) : (
            <Select
              aria-label={`Limit ${i + 1} window`}
              value={row.per}
              onChange={(v) => update(i, { per: v })}
              options={[
                ...PER,
                ...(PER.some((p) => p.value === row.per)
                  ? []
                  : [{ value: row.per, label: `per ${row.per}` }]),
              ]}
            />
          )}
          <Select
            aria-label={`Limit ${i + 1} applies to`}
            value={row.split}
            onChange={(v) => update(i, { split: v })}
            options={[...splits, ...(row.split === 'kept' ? [{ value: 'kept', label: 'As declared' }] : [])]}
          />
          <IconButton
            icon="x"
            label={`Remove limit ${row.name || i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-caption text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** "Inherited: 90d from organization acme", or the gateway's default. */
function inheritedHint(inherited: Inherited | null | undefined, none: string): string {
  return inherited ? `Blank inherits ${inherited.value} from ${inherited.from}.` : `Blank: ${none}.`;
}

/**
 * The sections every tenancy level shares: who may call through it, its labels and, for teams and
 * projects, the lifetime of keys made in it and its own rate limits.
 */
export function TenantSections({
  values,
  change,
  errors,
  level,
  inherited,
}: {
  values: TenantValues;
  change: (patch: Partial<TenantValues>) => void;
  errors: FieldErrors;
  level: 'organization' | 'team' | 'project';
  inherited?: Partial<Record<'maxKeyLifetime' | 'defaultLifetime' | 'rotationMaxAge', Inherited | null>>;
}) {
  return (
    <>
      <FormSection
        title="Access"
        description={`What the keys of this ${level} may call. A key can narrow it further, never widen it.`}
      >
        <AccessFields id={level} values={values} set={change} errors={errors} />
      </FormSection>
      <FormSection
        title="Tags and metadata"
        description="Labels that budgets, limits, routing and analytics can match and group by."
      >
        <LabelFields values={values} set={change} errors={errors} />
      </FormSection>
      {level === 'organization' ? null : (
        <>
          <FormSection title="Keys made here" description="The narrowest level that sets a value wins.">
            <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-1">
              <Field
                label="Longest lifetime"
                optional
                error={errors.maxKeyLifetime}
                hint={inheritedHint(inherited?.maxKeyLifetime, 'no limit')}
              >
                <Input
                  mono
                  value={values.maxKeyLifetime}
                  onChange={(e) => change({ maxKeyLifetime: e.target.value })}
                  placeholder={inherited?.maxKeyLifetime?.value ?? 'e.g. 365d'}
                />
              </Field>
              <Field
                label="Default lifetime"
                optional
                error={errors.defaultLifetime}
                hint={inheritedHint(inherited?.defaultLifetime, 'none')}
              >
                <Input
                  mono
                  value={values.defaultLifetime}
                  onChange={(e) => change({ defaultLifetime: e.target.value })}
                  placeholder={inherited?.defaultLifetime?.value ?? 'e.g. 90d'}
                />
              </Field>
              <Field
                label="Rotate when older than"
                optional
                error={errors.rotationMaxAge}
                hint={inheritedHint(inherited?.rotationMaxAge, 'no rotation due')}
              >
                <Input
                  mono
                  value={values.rotationMaxAge}
                  onChange={(e) => change({ rotationMaxAge: e.target.value })}
                  placeholder={inherited?.rotationMaxAge?.value ?? 'e.g. 180d'}
                />
              </Field>
            </div>
          </FormSection>
          <FormSection title="Rate limits" description={`Limits on every request through this ${level}.`}>
            <LimitsEditor
              rows={values.limits}
              onChange={(limits) => change({ limits })}
              error={errors.limits}
              level={level}
            />
          </FormSection>
        </>
      )}
    </>
  );
}
