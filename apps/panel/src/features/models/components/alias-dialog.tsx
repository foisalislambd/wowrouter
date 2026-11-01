'use client';

import { useState } from 'react';

import { Button, IconButton } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Combobox, Field, Input, MultiSelect } from '@/components/ui/form';
import { CancelButton, Dialog } from '@/components/ui/overlay';
import { InlineError } from '@/components/ui/states';
import { modelOption } from '@/components/ui/marks';
import type { ModelSpec } from '@/lib/api/types';
import { useTeamOptions } from '@/lib/team-options';
import { useEdited } from '@/lib/hooks';
import { serverFieldErrors } from '@/lib/validation';
import { notify } from '@/stores/ui';

import { saveModelSpec, useModels } from '../store';

type Aliases = NonNullable<ModelSpec['aliases']>;

/** Why an alias name can't be used, or null: the gateway's rules, checked before the call. */
export function aliasNameError(
  name: string,
  taken: { models: string[]; aliases: string[] },
  previous?: string,
): string | null {
  const n = name.trim();
  if (!n) return 'Enter the name apps will send, e.g. chat-default';
  if (n.length > 128) return 'Use at most 128 characters';
  if (n.includes('*')) return 'An alias can’t contain *';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(n))
    return 'Use letters, digits and . _ : / - only, starting with a letter or digit';
  if (taken.models.includes(n)) return 'A model already has this name';
  if (n !== previous && taken.aliases.includes(n)) return 'Another alias already has this name';
  return null;
}

type AliasParams = NonNullable<Aliases[string]['params']>;

/** One parameter an alias sets: its name and its value as typed (JSON, or plain text). */
export interface ParamRow {
  key: string;
  value: string;
}

/** The parameters an alias sets, as rows: text stays text, anything else is shown as JSON. */
export function paramRows(params: AliasParams | undefined): ParamRow[] {
  return Object.entries(params?.set ?? {}).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }));
}

/** A typed value: JSON when it reads as JSON (0.2, true, {"a":1}), else the text itself. */
function typedValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** The alias parameters to write from the rows and the paths to remove; undefined when there are none. */
export function paramsOf(rows: ParamRow[], remove: string[]): AliasParams | undefined {
  const set = Object.fromEntries(
    rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), typedValue(r.value)]),
  );
  const out: AliasParams = {
    ...(Object.keys(set).length > 0 ? { set } : {}),
    ...(remove.length > 0 ? { remove } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Why the parameters can't be saved, or null. */
export function paramsError(rows: ParamRow[], remove: string[]): string | null {
  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.key.trim();
    if (!key && !r.value.trim()) continue;
    if (!key) return 'Name every parameter, e.g. temperature';
    if (seen.has(key)) return `${key} is set twice`;
    seen.add(key);
  }
  const bad = remove.find((p) => !/^[^.\s][^\s]*$/.test(p));
  return bad ? `${bad}: a field path such as metadata.user, with no spaces` : null;
}

/** The number of parameters an alias sets or removes. */
export function paramCount(params: AliasParams | undefined): number {
  return Object.keys(params?.set ?? {}).length + (params?.remove?.length ?? 0);
}

/**
 * The spec with one alias added, renamed or changed. Its parameters are kept unless `params` is
 * given (undefined there removes them).
 */
export function withAlias(
  spec: ModelSpec,
  previous: string | null,
  name: string,
  fields: { description: string; owner: string; params?: { value: AliasParams | undefined } },
): ModelSpec {
  const aliases: Aliases = Object.fromEntries(
    Object.entries(spec.aliases ?? {}).filter(([k]) => k !== previous),
  );
  const kept = previous ? spec.aliases?.[previous] : undefined;
  const { description: _d, owner: _o, ...rest } = kept ?? {};
  if (fields.params) {
    delete rest.params;
    if (fields.params.value) rest.params = fields.params.value;
  }
  aliases[name.trim()] = {
    ...rest,
    ...(fields.description.trim() ? { description: fields.description.trim() } : {}),
    ...(fields.owner ? { owner: fields.owner } : {}),
  };
  return { ...spec, aliases };
}

/** The spec without one alias. */
export function withoutAlias(spec: ModelSpec, name: string): ModelSpec {
  const aliases: Aliases = Object.fromEntries(Object.entries(spec.aliases ?? {}).filter(([k]) => k !== name));
  const { aliases: _a, ...rest } = spec;
  return Object.keys(aliases).length > 0 ? { ...rest, aliases } : rest;
}

/** The request parameters an alias sets (name = value) and the fields it removes. */
function ParamsEditor({
  rows,
  remove,
  error,
  onRows,
  onRemove,
}: {
  rows: ParamRow[];
  remove: string[];
  error: string | undefined;
  onRows: (rows: ParamRow[]) => void;
  onRemove: (remove: string[]) => void;
}) {
  const update = (i: number, patch: Partial<ParamRow>) =>
    onRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div role="group" aria-label="Parameters" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ui font-medium text-fg">
          Parameters <span className="font-normal text-dim">(optional)</span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          onClick={() => onRows([...rows, { key: '', value: '' }])}
        >
          Add parameter
        </Button>
      </div>
      <p className="-mt-1 text-caption text-muted">
        Set on every request that names the alias, over what the app sends. Values are JSON (0.2, true,
        {' {"type": "json_object"}'}) or plain text.
      </p>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,2fr)_auto_minmax(0,3fr)_auto] items-center gap-2">
          <Input
            mono
            aria-label={`Parameter ${String(i + 1)} name`}
            placeholder="temperature"
            value={row.key}
            onChange={(e) => update(i, { key: e.target.value })}
          />
          <span className="text-dim">=</span>
          <Input
            mono
            aria-label={`Parameter ${String(i + 1)} value`}
            placeholder="0.2"
            value={row.value}
            onChange={(e) => update(i, { value: e.target.value })}
          />
          <IconButton
            icon="trash"
            label={`Remove parameter ${row.key || String(i + 1)}`}
            onClick={() => onRows(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Field
        label="Fields removed"
        optional
        hint="Dropped from requests sent under this alias, e.g. metadata.user."
      >
        <MultiSelect
          mono
          creatable
          noun="field"
          placeholder="Type a field and press Enter"
          options={remove.map((p) => ({ value: p, label: p }))}
          value={remove}
          onChange={onRemove}
        />
      </Field>
      {error ? (
        <p role="alert" className="text-caption text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Adds or edits an alias: another name apps can send for a Model, with a description, the team
 * that owns it and the request parameters it sets.
 */
export function AliasDialog({
  model,
  alias,
  onClose,
}: {
  /** The Model the alias belongs to; null to choose one (adding from the aliases list). */
  model: string | null;
  /** The alias being edited, or null for a new one. */
  alias: string | null;
  onClose: () => void;
}) {
  const models = useModels((s) => s.items);
  const teams = useTeamOptions();
  const [target, setTarget] = useState(model ?? '');
  const current = models.find((m) => m.name === target);
  const existing = alias ? current?.spec.aliases?.[alias] : undefined;
  const [name, setName] = useState(alias ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [owner, setOwner] = useState(existing?.owner ?? '');
  const [initialParams] = useState(() => ({
    rows: paramRows(existing?.params),
    remove: existing?.params?.remove ?? [],
  }));
  const [rows, setRows] = useState<ParamRow[]>(initialParams.rows);
  const [remove, setRemove] = useState<string[]>(initialParams.remove);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited({ target, name, description, owner, rows, remove });
  const taken = {
    models: models.map((m) => m.name),
    aliases: models.flatMap((m) => Object.keys(m.spec.aliases ?? {})),
  };

  async function save() {
    const nameError = aliasNameError(name, taken, alias ?? undefined);
    const next: Record<string, string> = {};
    if (nameError) next.name = nameError;
    if (!current) next.model = 'Select the model the alias names';
    const badParams = paramsError(rows, remove);
    if (badParams) next.params = badParams;
    setErrors(next);
    if (Object.keys(next).length > 0 || !current) return;
    setBusy(true);
    setError(null);
    try {
      const paramsChanged = JSON.stringify({ rows, remove }) !== JSON.stringify(initialParams);
      await saveModelSpec(
        current.name,
        withAlias(current.spec, alias, name, {
          description,
          owner,
          ...(paramsChanged ? { params: { value: paramsOf(rows, remove) } } : {}),
        }),
      );
      notify('success', alias ? 'Alias saved' : 'Alias added', `@${name.trim()} → ${current.name}`);
      onClose();
    } catch (e) {
      setError(e);
      const fields = serverFieldErrors(e, `models.${current.name}.aliases`);
      if (Object.keys(fields).length > 0) setErrors({ name: Object.values(fields)[0] ?? '' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      dirty={edited}
      open
      onClose={onClose}
      title={alias ? `Edit @${alias}` : 'Add alias'}
      description="Another name apps can send for a model. Requests to it go to the model, with the parameters it sets."
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {alias ? 'Save alias' : 'Add alias'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <InlineError error={error} />
        <Field label="Alias" error={errors.name} hint="Apps send this name in the model field.">
          <Input mono value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
        </Field>
        {model === null ? (
          <Field label="Model" error={errors.model}>
            <Combobox
              value={target}
              onChange={setTarget}
              emptyOption="Select a model"
              options={models.map((m) => modelOption(m))}
            />
          </Field>
        ) : (
          <p className="text-ui text-muted">
            Model <span className="mono text-fg">{model}</span>
          </p>
        )}
        <Field label="Description" optional>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Owner" optional hint="The team that answers for this alias.">
          <Combobox value={owner} onChange={setOwner} emptyOption="No owner" options={teams} />
        </Field>
        <ParamsEditor
          rows={rows}
          remove={remove}
          error={errors.params}
          onRows={setRows}
          onRemove={setRemove}
        />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}

/** Removes an alias after a confirmation that says what apps sending it will get. */
export function RemoveAliasDialog({
  model,
  alias,
  onClose,
}: {
  model: string;
  alias: string;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={`Remove @${alias}?`}
      objectName={`@${alias}`}
      confirmLabel="Remove alias"
      effect={`Apps sending @${alias} get an error from then on. ${model} keeps working under its own name.`}
      onConfirm={async (reason) => {
        const current = useModels.getState().byName(model);
        if (!current) return;
        await saveModelSpec(model, withoutAlias(current.spec, alias), reason);
        notify('success', 'Alias removed', `@${alias}`);
      }}
    />
  );
}
