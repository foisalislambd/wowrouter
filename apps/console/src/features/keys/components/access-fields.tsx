'use client';

import { useEffect, useState } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { Checkbox, Field, Input, MultiSelect, Segmented, Textarea } from '@/components/ui/form';
import { joinValues, splitValues } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { plural } from '@/lib/format';
import type { FieldErrors } from '@/lib/validation';

import type { AccessValues, LabelValues, MetadataRow } from '../access';
import { useKeysContext } from '../store';
import { ENDPOINT_GROUPS } from '../types';

/** Merges changed members into the form's values (and clears their errors). */
export type AccessChange = (patch: Partial<AccessValues>) => void;
export type LabelChange = (patch: Partial<LabelValues>) => void;

/** Loads what the access lists offer (regions, providers, deployments and IP sets) once mounted. */
export function useAccessOptions() {
  const targets = useKeysContext((s) => s.targets.data);
  const loadTargets = useKeysContext((s) => s.loadTargets);
  const ipSets = useKeysContext((s) => s.auth.data?.spec.ip_sets);
  const authStatus = useKeysContext((s) => s.auth.status);
  const loadAuth = useKeysContext((s) => s.loadAuth);
  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);
  useEffect(() => {
    if (authStatus === 'idle') void loadAuth();
  }, [authStatus, loadAuth]);
  return {
    regions: targets?.regions ?? [],
    providers: targets?.providers ?? [],
    deployments: targets?.deployments ?? [],
    ipSets: ipSets ?? {},
  };
}

const options = (names: string[]) => names.map((n) => ({ value: n, label: n }));

/** Every endpoint, or only the ones checked in a grouped list that opens when needed. */
export function EndpointsField({
  value,
  onChange,
  id,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  /** Tells the label apart when two forms are on the page. */
  id: string;
}) {
  const [scoped, setScoped] = useState(() => value.length > 0);
  const [kept, setKept] = useState<string[]>(value);
  const toggle = (item: string) =>
    onChange(value.includes(item) ? value.filter((x) => x !== item) : [...value, item]);
  function chooseScope(only: boolean) {
    setScoped(only);
    if (only) onChange(kept);
    else {
      setKept(value);
      onChange([]);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-ui font-medium text-fg" id={`${id}-endpoints-label`}>
          Endpoints
        </span>
        <Segmented<'all' | 'only'>
          label="Endpoints"
          value={scoped ? 'only' : 'all'}
          onChange={(v) => chooseScope(v === 'only')}
          options={[
            { value: 'all', label: 'All endpoints' },
            { value: 'only', label: 'Only these…' },
          ]}
        />
        {scoped ? (
          <span className="text-caption text-muted">
            {value.length === 0
              ? 'None chosen yet: every endpoint stays open.'
              : `${plural(value.length, 'endpoint')} chosen`}
          </span>
        ) : null}
      </div>
      {scoped ? (
        <fieldset
          aria-labelledby={`${id}-endpoints-label`}
          className="grid grid-cols-3 gap-4 rounded-control border border-line bg-sunken p-4 max-sm:grid-cols-1"
        >
          {ENDPOINT_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-2">
              <span className="text-caption font-medium text-muted">{group.label}</span>
              {group.items.map((item) => (
                <Tooltip key={item.id} content={item.id} side="bottom">
                  <span>
                    <Checkbox
                      label={item.label}
                      checked={value.includes(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                  </span>
                </Tooltip>
              ))}
            </div>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}

/** The Models allowed (blank for all) and the ones never allowed. */
export function ModelFields({
  values,
  set,
  errors,
}: {
  values: Pick<AccessValues, 'models' | 'denyModels'>;
  set: AccessChange;
  errors: FieldErrors;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
      <Field
        label="Allowed models"
        optional
        error={errors.models}
        hint="Leave blank to allow all. Use * as a wildcard, e.g. claude-*."
      >
        <MultiSelect
          mono
          creatable
          noun="model"
          placeholder="All models"
          options={[]}
          value={splitValues(values.models)}
          onChange={(v) => set({ models: joinValues(v) })}
        />
      </Field>
      <Field
        label="Never these models"
        optional
        error={errors.denyModels}
        hint="Refused even when an allowed pattern matches."
      >
        <MultiSelect
          mono
          creatable
          noun="model"
          placeholder="None"
          options={[]}
          value={values.denyModels}
          onChange={(v) => set({ denyModels: v })}
        />
      </Field>
    </div>
  );
}

/** The providers and deployments requests may reach (names or patterns with one `*`). */
export function ProviderFields({
  values,
  set,
  errors,
}: {
  values: Pick<AccessValues, 'providers' | 'denyProviders' | 'deployments'>;
  set: AccessChange;
  errors: FieldErrors;
}) {
  const known = useAccessOptions();
  return (
    <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
      <Field
        label="Only these providers"
        optional
        error={errors.providers}
        hint="Requests go only to deployments of these providers. Leave blank for any."
      >
        <MultiSelect
          mono
          creatable
          noun="provider"
          placeholder="Any provider"
          options={options(known.providers)}
          value={values.providers}
          onChange={(v) => set({ providers: v })}
        />
      </Field>
      <Field label="Never these providers" optional error={errors.denyProviders}>
        <MultiSelect
          mono
          creatable
          noun="provider"
          placeholder="None"
          options={options(known.providers)}
          value={values.denyProviders}
          onChange={(v) => set({ denyProviders: v })}
        />
      </Field>
      <Field
        label="Only these deployments"
        optional
        error={errors.deployments}
        hint="Use * at the start or the end, e.g. azure-*."
      >
        <MultiSelect
          mono
          creatable
          noun="deployment"
          placeholder="Any deployment"
          options={options(known.deployments)}
          value={values.deployments}
          onChange={(v) => set({ deployments: v })}
        />
      </Field>
    </div>
  );
}

/** The addresses requests may come from and the regions they may be served in. */
export function NetworkFields({
  values,
  set,
  errors,
}: {
  values: Pick<AccessValues, 'allowedIps' | 'ipSets' | 'regions' | 'denyRegions'>;
  set: AccessChange;
  errors: FieldErrors;
}) {
  const known = useAccessOptions();
  const sets = Object.entries(known.ipSets);
  return (
    <>
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field
          label="Allowed IP addresses"
          optional
          error={errors.allowedIps}
          hint="One address or range per line, e.g. 10.0.0.0/8. Leave both blank to allow any."
        >
          <Textarea
            mono
            rows={3}
            value={values.allowedIps}
            onChange={(e) => set({ allowedIps: e.target.value })}
          />
        </Field>
        <Field
          label="Named IP sets"
          optional
          hint={
            sets.length > 0
              ? 'Sets defined in Settings; a change to a set applies everywhere it is used.'
              : 'No IP sets are defined in Settings yet.'
          }
        >
          <MultiSelect
            mono
            noun="IP set"
            placeholder="No sets"
            options={sets.map(([name, ranges]) => ({
              value: name,
              label: name,
              description: ranges.join(', '),
            }))}
            value={values.ipSets}
            onChange={(v) => set({ ipSets: v })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field
          label="Only these regions"
          optional
          hint="Requests go only to deployments in these regions. Leave blank for any."
        >
          <MultiSelect
            mono
            creatable
            noun="region"
            placeholder="Any region"
            options={options(known.regions)}
            value={values.regions}
            onChange={(v) => set({ regions: v })}
          />
        </Field>
        <Field label="Never these regions" optional hint="Deployments in these regions are skipped.">
          <MultiSelect
            mono
            creatable
            noun="region"
            placeholder="None"
            options={options(known.regions)}
            value={values.denyRegions}
            onChange={(v) => set({ denyRegions: v })}
          />
        </Field>
      </div>
    </>
  );
}

/** Every access control of a project, team or organization, in the key form's order. */
export function AccessFields({
  values,
  set,
  errors,
  id,
}: {
  values: AccessValues;
  set: AccessChange;
  errors: FieldErrors;
  id: string;
}) {
  return (
    <>
      <EndpointsField id={id} value={values.endpoints} onChange={(v) => set({ endpoints: v })} />
      <ModelFields values={values} set={set} errors={errors} />
      <ProviderFields values={values} set={set} errors={errors} />
      <NetworkFields values={values} set={set} errors={errors} />
    </>
  );
}

/** Tags, and free-form metadata as key and value rows. */
export function LabelFields({
  values,
  set,
  errors,
  tagsHint,
}: {
  values: LabelValues;
  set: LabelChange;
  errors: FieldErrors;
  tagsHint?: string;
}) {
  const rows = values.metadata;
  const update = (i: number, patch: Partial<MetadataRow>) =>
    set({ metadata: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <>
      <Field
        label="Tags"
        optional
        error={errors.tags}
        hint={tagsHint ?? 'Budgets, limits and analytics can group by them, e.g. env:prod.'}
      >
        <MultiSelect
          mono
          creatable
          noun="tag"
          placeholder="No tags"
          options={[]}
          value={values.tags}
          onChange={(v) => set({ tags: v })}
        />
      </Field>
      <div role="group" aria-label="Metadata" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-ui font-medium text-fg">
            Metadata <span className="font-normal text-muted">(optional)</span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon="plus"
            onClick={() => set({ metadata: [...rows, { key: '', value: '' }] })}
          >
            Add entry
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="text-caption text-muted">None. Free-form keys and values, such as cost_center.</p>
        ) : null}
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2">
            <Input
              mono
              aria-label={`Metadata ${i + 1} key`}
              placeholder="cost_center"
              value={row.key}
              onChange={(e) => update(i, { key: e.target.value })}
            />
            <Input
              aria-label={`Metadata ${i + 1} value`}
              placeholder="value"
              value={row.value}
              onChange={(e) => update(i, { value: e.target.value })}
            />
            <IconButton
              icon="x"
              label={`Remove metadata ${row.key || i + 1}`}
              onClick={() => set({ metadata: rows.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        {errors.metadata ? (
          <p role="alert" className="text-caption text-error">
            {errors.metadata}
          </p>
        ) : null}
      </div>
    </>
  );
}
