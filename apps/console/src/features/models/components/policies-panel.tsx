'use client';

import { useEffect, useState } from 'react';

import { Icon } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Field, MultiSelect, NumberInput, Select } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { DetailSection } from '@/components/ui/list-detail';
import { CancelButton, Drawer } from '@/components/ui/overlay';
import { InlineError } from '@/components/ui/states';
import { formatCount } from '@/lib/format';
import { useEdited } from '@/lib/hooks';
import { notify } from '@/stores/ui';

import { modelsApi } from '../api';
import {
  applyModelPolicies,
  fromModelPolicies,
  otherPolicies,
  policyErrors,
  type PolicyValues,
} from '../policies';
import { saveModelSpec } from '../store';
import type { ModelView } from '../types';

/** The guardrail names, for the pickers; empty when the reader may not list them. */
function useGuardrailNames(): string[] {
  const can = useCan('listGuardrails');
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (!can) return;
    let live = true;
    modelsApi.guardrails().then(
      (items) => live && setNames(items.map((g) => g.name)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [can]);
  return names;
}

function PoliciesDrawer({ view, onClose }: { view: ModelView; onClose: () => void }) {
  const [values, setValues] = useState<PolicyValues>(() => fromModelPolicies(view.model.spec));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(values);
  const guardrails = useGuardrailNames();
  const options = [...new Set([...guardrails, ...values.input, ...values.output])].map((g) => ({
    value: g,
    label: g,
  }));
  const set = <K extends keyof PolicyValues>(key: K, value: PolicyValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function save() {
    const found = policyErrors(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await saveModelSpec(view.name, applyModelPolicies(view.model.spec, values));
      notify('success', 'Policies saved', view.name);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      dirty={edited}
      open
      onClose={onClose}
      title={`Policies of ${view.name}`}
      subtitle="They apply to every request to this model, on top of the gateway’s, team’s and key’s."
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Save policies
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Requests a minute"
            optional
            error={errors.rpm}
            hint="Across every app. Empty for no limit."
          >
            <NumberInput value={values.rpm} min={0} onChange={(v) => set('rpm', v)} data-autofocus />
          </Field>
          <Field label="Tokens a minute" optional error={errors.tpm} hint="Input and output together.">
            <NumberInput value={values.tpm} min={0} onChange={(v) => set('tpm', v)} />
          </Field>
        </div>
        <Field label="Guardrails on prompts" optional hint="Run on what apps send, besides the gateway’s.">
          <MultiSelect
            mono
            creatable
            noun="guardrail"
            placeholder="Choose guardrails"
            options={options}
            value={values.input}
            onChange={(v) => set('input', v)}
          />
        </Field>
        <Field label="Guardrails on answers" optional hint="Run on what the model returns.">
          <MultiSelect
            mono
            creatable
            noun="guardrail"
            placeholder="Choose guardrails"
            options={options}
            value={values.output}
            onChange={(v) => set('output', v)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Most attempts"
            optional
            error={errors.maxAttempts}
            hint="Tries per request, the first included. The gateway’s setting when empty."
          >
            <NumberInput
              value={values.maxAttempts}
              min={1}
              max={10}
              steppers
              onChange={(v) => set('maxAttempts', v)}
            />
          </Field>
          <Field label="After a failure" hint="Whether a retry may go to its next deployment.">
            <Select
              value={values.fallback}
              onChange={(v) => set('fallback', v as PolicyValues['fallback'])}
              options={[
                { value: 'inherit', label: 'As the gateway says' },
                { value: 'yes', label: 'Try its next deployment' },
                { value: 'no', label: 'Retry the same deployment' },
              ]}
            />
          </Field>
        </div>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Drawer>
  );
}

/**
 * The model's own policies on its page: limits, guardrails and retries in words, editable; any
 * other policy set in the configuration is listed read-only.
 */
export function PoliciesPanel({ view }: { view: ModelView }) {
  const canEdit = useCan('replaceModel');
  const [open, setOpen] = useState(false);
  const p = fromModelPolicies(view.model.spec);
  const other = otherPolicies(view.model.spec);
  const limits = [
    p.rpm ? `${formatCount(Number(p.rpm))} requests a minute` : null,
    p.tpm ? `${formatCount(Number(p.tpm))} tokens a minute` : null,
  ].filter(Boolean);
  const retries = [
    p.maxAttempts ? `up to ${p.maxAttempts} attempts` : null,
    p.fallback === 'yes'
      ? 'moves on to its next deployment'
      : p.fallback === 'no'
        ? 'retries the same deployment'
        : null,
  ].filter(Boolean);
  return (
    <DetailSection
      title="Policies"
      aside={
        canEdit ? (
          <Button size="sm" icon="edit" onClick={() => setOpen(true)}>
            Edit policies
          </Button>
        ) : null
      }
    >
      <dl className="grid gap-x-6 gap-y-1.5 text-ui sm:grid-cols-[160px_minmax(0,1fr)]">
        <dt className="text-muted">Limits</dt>
        <dd className={limits.length > 0 ? 'text-fg' : 'text-dim'}>
          {limits.length > 0 ? limits.join(' · ') : 'None of its own'}
        </dd>
        <dt className="text-muted">Guardrails on prompts</dt>
        <dd className={p.input.length > 0 ? 'mono text-fg' : 'text-dim'}>
          {p.input.length > 0 ? p.input.join(', ') : 'The gateway’s only'}
        </dd>
        <dt className="text-muted">Guardrails on answers</dt>
        <dd className={p.output.length > 0 ? 'mono text-fg' : 'text-dim'}>
          {p.output.length > 0 ? p.output.join(', ') : 'The gateway’s only'}
        </dd>
        <dt className="text-muted">Retries</dt>
        <dd className={retries.length > 0 ? 'text-fg' : 'text-dim'}>
          {retries.length > 0
            ? retries.join(', ').replace(/^./, (c) => c.toUpperCase())
            : 'As the gateway says'}
        </dd>
      </dl>
      {other ? (
        <details className="group mt-3">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-caption text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
            <Icon name="chevronRight" size={12} className="transition-transform group-open:rotate-90" />
            Also set in the configuration: {Object.keys(other).join(', ')}
          </summary>
          <pre className="mono mt-2 max-h-64 overflow-auto rounded-control border border-line bg-sunken p-3 text-caption text-fg">
            {JSON.stringify(other, null, 2)}
          </pre>
        </details>
      ) : null}
      {open ? <PoliciesDrawer view={view} onClose={() => setOpen(false)} /> : null}
    </DetailSection>
  );
}
