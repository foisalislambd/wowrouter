'use client';

import { useState } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { joinValues, splitValues } from '@/components/ui/select';
import { useTeamOptions } from '@/lib/team-options';
import { useEdited } from '@/lib/hooks';
import { Combobox, Field, Input, MultiSelect, Segmented, Select, Textarea } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { CancelButton, Drawer } from '@/components/ui/overlay';
import { InlineError } from '@/components/ui/states';
import { modelOption } from '@/components/ui/marks';
import type { ModelResource } from '@/lib/api/types';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/validation';
import { notify } from '@/stores/ui';

import { applyModelEdit, editModelSchema, type EditModelValues, fromModelSpec } from '../form';
import { useRouteMap } from '../hooks';
import { useCatalog, useModels } from '../store';
import { describeNode, stepsOf } from '../tree';
import { BUILTIN_TIERS, tierLabel } from '../types';

/** Free key and value notes on a Model (`annotations`): who to ask, a ticket, a cost centre. */
function AnnotationRows({
  rows,
  error,
  onChange,
}: {
  rows: EditModelValues['annotations'];
  error: string | undefined;
  onChange: (rows: EditModelValues['annotations']) => void;
}) {
  const update = (i: number, patch: Partial<EditModelValues['annotations'][number]>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div role="group" aria-label="Annotations" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ui font-medium text-fg">
          Annotations <span className="font-normal text-dim">(optional)</span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          onClick={() => onChange([...rows, { key: '', value: '' }])}
        >
          Add annotation
        </Button>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2">
          <Input
            mono
            aria-label={`Annotation ${String(i + 1)} name`}
            placeholder="runbook"
            value={row.key}
            onChange={(e) => update(i, { key: e.target.value })}
          />
          <Input
            aria-label={`Annotation ${String(i + 1)} value`}
            value={row.value}
            onChange={(e) => update(i, { value: e.target.value })}
          />
          <IconButton
            icon="trash"
            label={`Remove annotation ${row.key || String(i + 1)}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-caption text-error">
          {error}
        </p>
      ) : (
        <p className="text-caption text-muted">
          {rows.length === 0
            ? 'None. Notes for people, shown on the model’s page.'
            : 'Shown on the model’s page.'}
        </p>
      )}
    </div>
  );
}

/**
 * Edits a Model's display name, what it serves from (its own deployments or a shared route), tier,
 * lifecycle (with end of life and replacement), labels, access, listing, catalog facts and annotations.
 */
export function EditModelDrawer({
  model,
  onClose,
  focus,
}: {
  model: ModelResource;
  onClose: () => void;
  focus?: 'lifecycle';
}) {
  const [values, setValues] = useState<EditModelValues>(() => {
    const v = fromModelSpec(model.spec);
    if (focus === 'lifecycle' && v.lifecycle !== 'deprecated') {
      const eol = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      return { ...v, lifecycle: 'deprecated', eolAt: eol };
    }
    return v;
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(values);
  const teamOptions = useTeamOptions(values.lifecycle === 'preview' || values.lifecycle === 'restricted');
  const update = useModels((s) => s.update);
  const models = useModels((s) => s.items);
  const tiers = useCatalog((s) => s.tiers.data);
  const routes = useRouteMap();
  const deployments = useCatalog((s) => s.deployments.data ?? []);
  const ownSteps = stepsOf({ target: model.spec.target });
  const tierOptions = (tiers?.map((t) => t.name) ?? [...BUILTIN_TIERS]).map((t) => ({
    value: t,
    label: tierLabel(t),
  }));
  const set = <K extends keyof EditModelValues>(key: K, value: EditModelValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const [catalogOpen] = useState(() => values.annotations.length > 0 || Boolean(model.spec.catalog));
  const catalogErrors = ['family', 'version', 'revision', 'releasedAt', 'ownedBy', 'annotations'].some(
    (k) => errors[k],
  );

  async function submit() {
    const result = validate(editModelSchema, values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      await update(model.name, applyModelEdit(model.spec, result.data));
      notify('success', 'Model saved', model.name);
      onClose();
    } catch (e) {
      setError(e);
      setErrors(serverFieldErrors(e, `models.${model.name}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      dirty={edited}
      open
      onClose={onClose}
      title={focus === 'lifecycle' ? `Deprecate ${model.name}` : `Edit ${model.name}`}
      subtitle="Changes apply right away and are recorded in the audit log."
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {focus === 'lifecycle' ? 'Deprecate model' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <InlineError error={error} />
        <Field label="Display name" optional error={errors.displayName}>
          <Input
            value={values.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            data-autofocus
          />
        </Field>
        {focus !== 'lifecycle' ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-ui font-medium text-fg">Serves from</legend>
            <Segmented<'own' | 'route'>
              label="Serves from"
              value={values.serves}
              onChange={(v) => set('serves', v)}
              options={[
                { value: 'own', label: 'Its own deployments' },
                // No count when there are none: "A shared route 0" reads as a route named 0.
                { value: 'route', label: 'A shared route', count: routes.size || undefined },
              ]}
            />
            {values.serves === 'route' ? (
              <Field
                label="Shared route"
                error={errors.route}
                hint={
                  routes.size === 0
                    ? 'There are no shared routes yet. Create one in Routing policy first.'
                    : "It follows the route's rules and fallbacks; changes to the route apply to it too."
                }
              >
                <Combobox
                  value={values.route}
                  onChange={(v) => set('route', v)}
                  emptyOption="Select a route"
                  options={[...routes.values()].map((r) => ({
                    value: r.name,
                    label: r.name,
                    description: describeNode(r.spec.tree, routes),
                  }))}
                />
              </Field>
            ) : values.hadTarget ? (
              <p className="text-ui text-muted">
                {ownSteps.length > 1 ? 'Tries ' : 'Sends to '}
                <span className="mono text-fg">
                  {ownSteps.map((s) => describeNode(s.node, routes)).join(', then ')}
                </span>
                . Change the order from the model’s fallback chain.
              </p>
            ) : (
              <Field
                label="Deployment"
                error={errors.deployment}
                hint="Add fallbacks afterwards from the model’s page."
              >
                <Combobox
                  value={values.deployment}
                  onChange={(v) => set('deployment', v)}
                  emptyOption="Select a deployment"
                  options={deployments.map((d) => ({
                    value: d.name,
                    label: d.name,
                    description: `${d.spec.provider} · ${d.spec.model}`,
                  }))}
                />
              </Field>
            )}
          </fieldset>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tier" error={errors.tier}>
            <Select value={values.tier} onChange={(v) => set('tier', v)} options={tierOptions} />
          </Field>
          <Field label="Status">
            <Select
              value={values.lifecycle}
              onChange={(v) => set('lifecycle', v as EditModelValues['lifecycle'])}
              options={[
                { value: 'ga', label: 'Available' },
                { value: 'preview', label: 'Preview' },
                { value: 'restricted', label: 'Restricted' },
                { value: 'deprecated', label: 'Deprecated' },
              ]}
            />
          </Field>
        </div>
        {values.lifecycle === 'deprecated' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Stops working on"
              error={errors.eolAt}
              hint="The model stops working after this date."
            >
              <DatePicker value={values.eolAt} onChange={(v) => set('eolAt', v)} />
            </Field>
            <Field label="Replacement" optional hint="Shown to apps that still use this model.">
              <Combobox
                value={values.replacement}
                onChange={(v) => set('replacement', v)}
                emptyOption="None"
                options={models.filter((m) => m.name !== model.name).map((m) => modelOption(m))}
              />
            </Field>
          </div>
        ) : null}
        {values.lifecycle === 'preview' || values.lifecycle === 'restricted' ? (
          <Field
            label="Teams that can use it"
            optional
            error={errors.accessTeams}
            hint="Pick teams, or type a team's name."
          >
            <MultiSelect
              mono
              creatable
              noun="team"
              placeholder="Choose teams"
              options={teamOptions}
              value={splitValues(values.accessTeams)}
              onChange={(v) => set('accessTeams', joinValues(v))}
            />
          </Field>
        ) : null}
        <Field label="Labels" optional error={errors.labels} hint="e.g. chat, vision">
          <MultiSelect
            mono
            creatable
            noun="label"
            placeholder="Add labels"
            options={[]}
            value={splitValues(values.labels)}
            onChange={(v) => set('labels', joinValues(v))}
          />
        </Field>
        <Field label="Description" optional error={errors.description}>
          <Textarea
            rows={3}
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
        {focus !== 'lifecycle' ? (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-ui font-medium text-fg">Listed to apps</legend>
              <Segmented<'public' | 'internal'>
                label="Listed to apps"
                value={values.visibility}
                onChange={(v) => set('visibility', v)}
                options={[
                  { value: 'public', label: 'Listed in /v1/models' },
                  { value: 'internal', label: 'Hidden' },
                ]}
              />
              <p className="text-caption text-muted">
                {values.visibility === 'internal'
                  ? 'Apps don’t see it in the model list, but requests that name it still work.'
                  : 'Apps see it when they list models.'}
              </p>
            </fieldset>
            <details className="group" open={catalogOpen || catalogErrors ? true : undefined}>
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-ui text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
                <Icon name="chevronRight" size={12} className="transition-transform group-open:rotate-90" />
                Catalog and annotations
              </summary>
              <div className="mt-3 flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Family" optional error={errors.family} hint="e.g. claude-sonnet, gpt-4o">
                    <Input mono value={values.family} onChange={(e) => set('family', e.target.value)} />
                  </Field>
                  <Field label="Version" optional error={errors.version}>
                    <Input mono value={values.version} onChange={(e) => set('version', e.target.value)} />
                  </Field>
                  <Field label="Revision" optional error={errors.revision}>
                    <Input mono value={values.revision} onChange={(e) => set('revision', e.target.value)} />
                  </Field>
                  <Field label="Released" optional error={errors.releasedAt}>
                    <DatePicker clearable value={values.releasedAt} onChange={(v) => set('releasedAt', v)} />
                  </Field>
                </div>
                <Field
                  label="Managed by"
                  optional
                  error={errors.ownedBy}
                  hint="Shown to apps as the model’s owner. wowrouter when empty."
                >
                  <Input mono value={values.ownedBy} onChange={(e) => set('ownedBy', e.target.value)} />
                </Field>
                <AnnotationRows
                  rows={values.annotations}
                  error={errors.annotations}
                  onChange={(v) => set('annotations', v)}
                />
              </div>
            </details>
          </>
        ) : null}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Drawer>
  );
}
