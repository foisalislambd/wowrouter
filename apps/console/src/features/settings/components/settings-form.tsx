'use client';

import { type ReactNode, useId, useState } from 'react';

import { RadioGroup, type RadioGroupProps, type RadioOption } from '@/components/ui/choice';
import { Icon } from '@/components/ui/icon';
import { InlineError } from '@/components/ui/states';
import type { FieldErrors } from '@/lib/validation';
import { notify } from '@/stores/ui';

import { detailErrors, mergePatch, same } from '../form-errors';
import { SaveBar } from './parts';

type Spec = Record<string, unknown>;

export interface FormApi<V> {
  values: V;
  set: <K extends keyof V>(key: K, value: V[K]) => void;
  errors: FieldErrors;
  disabled: boolean;
}

/**
 * A settings form: its values start from the stored settings (with the defaults where nothing is
 * stored), and Save writes only the members that changed, as a merge patch, so a default left
 * alone stays a default. Change control and the two-person rule show through the inline error.
 */
export function SettingsForm<V>({
  initial,
  toSpec,
  save,
  canEdit,
  check,
  paths,
  saved,
  children,
}: {
  initial: V;
  /** The values as the configuration takes them. */
  toSpec: (values: V) => Spec;
  save: (patch: Spec) => Promise<void>;
  canEdit: boolean;
  check?: (values: V) => FieldErrors;
  /** Configuration paths of the gateway's validation details, to the field they belong to. */
  paths?: Record<string, string>;
  /** The toast once saved ("Budget settings saved"). */
  saved: string;
  children: (form: FormApi<V>) => ReactNode;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const before = toSpec(initial);
  const after = toSpec(values);
  const dirty = !same(before, after);
  const set = <K extends keyof V>(key: K, value: V[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    const name = String(key);
    if (errors[name]) setErrors(({ [name]: _, ...rest }) => rest);
  };

  async function submit() {
    const found = check ? check(values) : {};
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      await save(mergePatch(before, after));
      notify('success', saved);
    } catch (e) {
      setError(e);
      if (paths) setErrors(detailErrors(e, paths));
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
      {children({ values, set, errors, disabled: !canEdit })}
      <SaveBar dirty={dirty} busy={busy} canEdit={canEdit} onDiscard={() => setValues(initial)} />
    </form>
  );
}

/** A switch's one-line explanation under it. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-caption text-muted">{children}</p>;
}

/** A labelled group of fields inside a form. */
export function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-ui font-semibold text-fg">{title}</legend>
      {description ? <p className="-mt-2 text-caption text-muted">{description}</p> : null}
      {children}
    </fieldset>
  );
}

/** Advanced fields behind a disclosure, closed until asked for. */
export function Advanced({ children, label = 'Advanced' }: { children: ReactNode; label?: string }) {
  return (
    <details className="group flex flex-col gap-3 [&[open]>summary]:mb-3">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-ui font-medium text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
        <Icon name="chevronRight" size={12} className="transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <div className="flex flex-col gap-4">{children}</div>
    </details>
  );
}

/** Radio options that can't be picked while the form is read-only. */
export const lock = <V extends string>(disabled: boolean, options: RadioOption<V>[]): RadioOption<V>[] =>
  options.map((o) => ({ ...o, disabled }));

/** Radio buttons under a visible label, which also names the group. */
export function Choice<T extends string>({
  label,
  ...props
}: Omit<RadioGroupProps<T>, 'label' | 'aria-labelledby'> & { label: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <p id={id} className="text-ui font-medium text-fg">
        {label}
      </p>
      <RadioGroup<T> aria-labelledby={id} {...props} />
    </div>
  );
}
