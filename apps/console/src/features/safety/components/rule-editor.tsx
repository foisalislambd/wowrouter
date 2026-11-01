'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Checkbox, Combobox, Field, Input, Segmented, Select, Switch, Textarea } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { Icon } from '@/components/ui/icon';
import { CancelButton, Drawer } from '@/components/ui/overlay';
import { Banner, InlineError } from '@/components/ui/states';
import { modelOption } from '@/components/ui/marks';
import type { GuardrailResource } from '@/lib/api/types';
import { useEdited } from '@/lib/hooks';
import { notify } from '@/stores/ui';

import { HeaderRowsEditor } from '@/features/mcp/components/parts';
import { ENTITY_CHECKS, entityCheck } from '@/features/settings/custom-entities';

import { noSpecTest, type RuleTestResult, safetyApi, type TestStage } from '../api';
import {
  actionsFor,
  allKinds,
  blankRun,
  CATEGORIES,
  type CustomKind,
  customKindErrors,
  type CustomKindErrors,
  customMethod,
  type DraftErrors,
  draftOf,
  emptyDraft,
  ENTITY_NAME,
  type GuardrailSpec,
  impliedCategory,
  kindEntity,
  kindLabel,
  kindName,
  LABELLED,
  LENGTH_BOUNDS,
  type LengthBound,
  matchWord,
  type Method,
  METHODS,
  PII_ENTITIES,
  PII_PRESERVE,
  patternPlaceholder,
  placeholder,
  PRESERVE_NAME,
  REPLACEABLE,
  type RuleDraft,
  type RunDraft,
  SCOPE_KINDS,
  type ScopeKind,
  SECRET_DETECTORS,
  type SecretDraft,
  specOf,
  stagesFor,
  TRANSFORMS,
  TYPE_LABEL,
} from '../rules';
import { CATEGORY_LABEL, useSafety } from '../store';
import { NamedBy } from './named-by';

/** What the editor opens on: a new rule (of a method), or a guardrail, maybe with a prepared change. */
export type EditorTarget =
  | { kind: 'new'; method?: Method }
  | { kind: 'edit'; name: string; prepared?: { draft: RuleDraft; change: string } };

const ACTION_LABEL: Record<string, string> = {
  block: 'Block',
  redact: 'Redact',
  flag: 'Flag only',
  divert: 'Divert',
};

const ACTION_HINT: Record<string, string> = {
  block: 'The request is refused; nothing reaches the provider.',
  redact: 'Matches are replaced before the provider sees them.',
  flag: 'The request goes through as is and is recorded for review.',
  divert: 'Another Model answers instead, such as a safe template Model.',
};

/** Where a guardrail runs at the gateway level, from the gateway's policies. */
export function useAttachment(name: string | null): { input: boolean; output: boolean } {
  const lists = useSafety((s) => s.policies.data?.spec.guardrails);
  return {
    input: name !== null && (lists?.input ?? []).includes(name),
    output: name !== null && (lists?.output ?? []).includes(name),
  };
}

function Lines({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder,
  mono,
  rows = 4,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  rows?: number;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      <Textarea
        mono={mono}
        rows={rows}
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function CheckGrid<T extends string>({
  legend,
  all,
  value,
  onChange,
  name,
  error,
}: {
  legend: string;
  all: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
  name: (v: T) => string;
  error?: string | undefined;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-ui font-medium text-fg">{legend}</legend>
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {all.map((v) => (
          <Checkbox
            key={v}
            label={name(v)}
            checked={value.includes(v)}
            onChange={(on) => onChange(on ? [...value, v] : value.filter((x) => x !== v))}
          />
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-caption text-error">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function ModelPicker({
  label,
  hint,
  value,
  onChange,
  error,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
}) {
  const models = useSafety((s) => s.models.data);
  const options = (models ?? []).map((m) => modelOption(m));
  if (value && !options.some((o) => o.value === value)) options.unshift(modelOption(value));
  return (
    <Field label={label} hint={hint} error={error}>
      {models ? (
        <Combobox value={value} onChange={onChange} placeholder="Choose a Model" options={options} />
      ) : (
        <Input mono value={value} onChange={(e) => onChange(e.target.value)} placeholder="Model name" />
      )}
    </Field>
  );
}

/** A provider of one type, by name; free text when providers can't be read. */
function ProviderPicker({
  type,
  value,
  onChange,
  error,
  hint,
}: {
  type: 'bedrock' | 'vertex';
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  hint: string;
}) {
  const canList = useCan('listProviders');
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!canList) return;
    let live = true;
    safetyApi
      .providers()
      .then((all) => {
        if (live) setNames(all.filter((p) => p.type === type).map((p) => p.name));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [canList, type]);
  const options = [...new Set([...(names ?? []), ...(value ? [value] : [])])].map((n) => ({
    value: n,
    label: n,
  }));
  return (
    <Field label="Provider" hint={hint} error={error}>
      {names ? (
        <Combobox value={value} onChange={onChange} placeholder="Choose a provider" options={options} />
      ) : (
        <Input mono value={value} onChange={(e) => onChange(e.target.value)} placeholder="Provider name" />
      )}
    </Field>
  );
}

/**
 * A secret written, never read back: a stored one shows as "Stored, hidden" and is kept unless a
 * new value is typed; an optional one can be removed.
 */
function SecretField({
  label,
  value,
  onChange,
  error,
  hint,
  optional,
}: {
  label: string;
  value: SecretDraft;
  onChange: (v: SecretDraft) => void;
  error?: string | undefined;
  hint?: ReactNode;
  optional?: boolean;
}) {
  return (
    <Field
      label={label}
      optional={optional}
      error={error}
      hint={hint}
      aside={
        optional && value.stored ? (
          <Button size="sm" variant="ghost" onClick={() => onChange({ value: '', stored: false })}>
            Remove
          </Button>
        ) : undefined
      }
    >
      <Input
        mono
        type="password"
        autoComplete="off"
        value={value.value}
        placeholder={value.stored ? 'Stored, hidden. Type to replace' : 'Value or ${env:NAME}'}
        onChange={(e) => onChange({ ...value, value: e.target.value })}
      />
    </Field>
  );
}

const BOUND_LABEL: Record<LengthBound, string> = {
  min_chars: 'Characters, at least',
  max_chars: 'Characters, at most',
  min_words: 'Words, at least',
  max_words: 'Words, at most',
  min_tokens: 'Tokens, at least',
  max_tokens: 'Tokens, at most',
};

const KIND_LABEL: Record<ScopeKind, string> = {
  system: 'System messages',
  user: 'User messages',
  assistant: 'Earlier answers',
  tool: 'Tool results',
  tool_definition: 'Tool definitions',
};

/** "How it runs": in the request's path or beside it, its bounds, its order and what it reads. */
function RunFields({
  draft,
  set,
  error,
  transform,
}: {
  draft: RuleDraft;
  set: (patch: Partial<RuleDraft>) => void;
  error?: string | undefined;
  transform: boolean;
}) {
  const run = draft.run ?? blankRun();
  const put = (patch: Partial<RunDraft>) => set({ run: { ...run, ...patch } });
  const fixed = draft.type === 'llm_rewrite' || draft.action === 'divert';
  return (
    <details className="group rounded-control border border-line px-3.5 py-2.5" open={Boolean(error)}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-ui font-medium text-fg [&::-webkit-details-marker]:hidden">
        <Icon
          name="chevronRight"
          size={14}
          className="text-muted transition-transform group-open:rotate-90"
        />
        How it runs
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        {transform ? null : (
          <Field
            label="Runs"
            hint={
              fixed
                ? 'A rewrite or a divert always runs in the request’s path.'
                : run.execution === 'async'
                  ? 'The request doesn’t wait; findings are only flagged.'
                  : run.execution === 'parallel_with_call'
                    ? 'The provider is called at the same time; a finding stops the answer. Prompts only.'
                    : 'The request waits for the check.'
            }
          >
            <Select
              value={fixed ? 'blocking' : run.execution || 'blocking'}
              disabled={fixed}
              onChange={(v) => put({ execution: v === 'blocking' ? '' : (v as RunDraft['execution']) })}
              options={[
                { value: 'blocking', label: 'Before the call' },
                { value: 'parallel_with_call', label: 'Beside the call' },
                { value: 'async', label: 'In the background' },
              ]}
            />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Time limit" optional hint="10ms to 60s; 2s unless set.">
            <Input
              mono
              value={run.timeout}
              placeholder="2s"
              onChange={(e) => put({ timeout: e.target.value })}
            />
          </Field>
          <Field label="Checks at once" optional hint="Calls in flight to its service.">
            <Input
              mono
              inputMode="numeric"
              value={run.maxConcurrency}
              onChange={(e) => put({ maxConcurrency: e.target.value })}
            />
          </Field>
          <Field label="Order" optional hint="Lower runs first; 0 unless set.">
            <Input mono value={run.order} onChange={(e) => put({ order: e.target.value })} />
          </Field>
        </div>
        {transform ? null : (
          <Field label="When the check itself fails">
            <Select
              value={draft.action === 'flag' ? 'allow' : run.onError}
              disabled={draft.action === 'flag'}
              onChange={(v) => put({ onError: v as RunDraft['onError'] })}
              emptyOption="The gateway’s default"
              options={[
                { value: 'block', label: 'Refuse the request' },
                { value: 'allow', label: 'Let the request through' },
              ]}
            />
          </Field>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-ui font-medium text-fg">What of a prompt it reads</legend>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {SCOPE_KINDS.map((k) => (
              <Checkbox
                key={k}
                label={KIND_LABEL[k]}
                checked={run.scopeKinds.length === 0 || run.scopeKinds.includes(k)}
                onChange={(on) => {
                  const current = run.scopeKinds.length === 0 ? SCOPE_KINDS : run.scopeKinds;
                  const next = on ? [...current, k] : current.filter((x) => x !== k);
                  put({ scopeKinds: next.length === SCOPE_KINDS.length ? [] : next });
                }}
              />
            ))}
          </div>
          <Segmented<'all' | 'last_user'>
            label="Messages read"
            value={run.scopeMessages || 'all'}
            onChange={(v) => put({ scopeMessages: v === 'all' ? '' : v })}
            options={[
              { value: 'all', label: 'Every message' },
              { value: 'last_user', label: 'The last user message' },
            ]}
          />
          <Checkbox
            label="Also read text the gateway adds"
            description="System prompts, templates and prefixes added by other rules."
            checked={run.includeOperatorContent}
            onChange={(includeOperatorContent) => put({ includeOperatorContent })}
          />
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-ui font-medium text-fg">When a request asks for it by name</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {(['input', 'output'] as const).map((st) => (
              <Checkbox
                key={st}
                label={st === 'input' ? 'Check the prompt' : 'Check the answer'}
                checked={run.requestStages.includes(st)}
                onChange={(on) =>
                  put({
                    requestStages: on
                      ? [...run.requestStages, st]
                      : run.requestStages.filter((x) => x !== st),
                  })
                }
              />
            ))}
          </div>
        </fieldset>
        {transform ? null : (
          <Field label="Message on a block" optional hint="What the app gets back; at most 500 characters.">
            <Textarea rows={2} value={run.message} onChange={(e) => put({ message: e.target.value })} />
          </Field>
        )}
        {error ? (
          <p role="alert" className="text-caption text-error">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}

export function blankKind(): CustomKind {
  return { name: '', pattern: '', validate: 'none', label: '' };
}

/**
 * The fields of a kind of personal data a rule defines itself: its name, its pattern, an optional
 * check and the label its placeholder shows, which appears as it is typed.
 */
export function CustomKindFields({
  value,
  onChange,
  errors,
  numbered,
}: {
  value: CustomKind;
  onChange: (v: CustomKind) => void;
  errors: CustomKindErrors;
  /** Values are put back in the answer, so placeholders are numbered. */
  numbered: boolean;
}) {
  const shown = value.name.trim() || value.label.trim();
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Kind name"
          error={errors.name}
          hint="Lowercase letters, digits and _; events and reports use it."
        >
          <Input
            mono
            data-autofocus
            value={value.name}
            placeholder="cpf"
            onChange={(e) => onChange({ ...value, name: e.target.value.toLowerCase() })}
          />
        </Field>
        <Field
          label="Placeholder label"
          optional
          error={errors.label}
          hint={
            shown ? (
              <>
                A value becomes{' '}
                <span className="mono text-fg">{placeholder(kindLabel(value), numbered)}</span>
                {numbered ? ', numbered per value' : ''}.
              </>
            ) : (
              'The name in capitals unless set.'
            )
          }
        >
          <Input
            mono
            value={value.label}
            placeholder={value.name.trim() ? value.name.trim().toUpperCase() : 'CPF'}
            onChange={(e) => onChange({ ...value, label: e.target.value })}
          />
        </Field>
      </div>
      <Field
        label="Pattern"
        error={errors.pattern}
        hint="A regular expression a value matches. Like the built-in kinds, a match never runs into letters or digits around it."
      >
        <Input
          mono
          spellCheck={false}
          value={value.pattern}
          placeholder={'\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}'}
          onChange={(e) => onChange({ ...value, pattern: e.target.value })}
        />
      </Field>
      <Field label="Extra check" hint="Only count a match that passes this check.">
        <Select
          value={value.validate}
          onChange={(v) => onChange({ ...value, validate: entityCheck(v) })}
          options={ENTITY_CHECKS}
        />
      </Field>
    </>
  );
}

/**
 * "Look for": the built-in kinds of personal data and the rule's own, each a checkbox; the rule's
 * own can be changed or removed, and a new one added in place. A kind of its own left unticked is
 * dropped when the rule is saved.
 */
function KindsField({
  draft,
  set,
  errors,
}: {
  draft: RuleDraft;
  set: (patch: Partial<RuleDraft>) => void;
  errors: DraftErrors;
}) {
  // The kind being written: a new one (index -1) or one of the rule's own, by index.
  const [editing, setEditing] = useState<{ at: number; kind: CustomKind } | null>(null);
  const [kindErrors, setKindErrors] = useState<CustomKindErrors>({});
  const numbered = draft.reversible;
  const own = draft.customKinds;
  const toggle = (id: string, on: boolean) =>
    set({
      entities: on
        ? allKinds(own).filter((k) => k === id || draft.entities.includes(k))
        : draft.entities.filter((k) => k !== id),
    });
  const save = () => {
    if (!editing) return;
    const kind = { ...editing.kind, name: editing.kind.name.trim(), label: editing.kind.label.trim() };
    const others = own.filter((_, i) => i !== editing.at);
    const found = customKindErrors(kind, others);
    if (Object.keys(found).length > 0) {
      setKindErrors(found);
      return;
    }
    const before = editing.at >= 0 ? own[editing.at] : undefined;
    const kinds = editing.at >= 0 ? own.map((k, i) => (i === editing.at ? kind : k)) : [...own, kind];
    // A kind added is looked for at once; one renamed keeps whether it was.
    const wasOn = before ? draft.entities.includes(before.name) : true;
    const entities = draft.entities.filter((k) => k !== before?.name);
    set({
      customKinds: kinds,
      entities: allKinds(kinds).filter((k) => entities.includes(k) || (wasOn && k === kind.name)),
    });
    setEditing(null);
    setKindErrors({});
  };
  const remove = (at: number) => {
    const kind = own[at];
    if (!kind) return;
    set({
      customKinds: own.filter((_, i) => i !== at),
      entities: draft.entities.filter((k) => k !== kind.name),
    });
  };
  const checked = [
    ...PII_ENTITIES.filter((e) => draft.entities.includes(e)).map((e) => e.toUpperCase()),
    ...own.filter((k) => draft.entities.includes(k.name)).map(kindLabel),
  ];
  const labels = draft.action === 'redact' && draft.replacement === 'label';
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-ui font-medium text-fg">Look for</legend>
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {PII_ENTITIES.map((id) => (
          <Checkbox
            key={id}
            label={ENTITY_NAME[id] ?? id}
            checked={draft.entities.includes(id)}
            onChange={(on) => toggle(id, on)}
          />
        ))}
        {own.map((k) => (
          <Checkbox
            key={k.name}
            label={<span className="mono">{k.name}</span>}
            description={
              <>
                <span className="mono">{placeholder(kindLabel(k), numbered)}</span>
                {' · '}
                {customMethod(k)}
              </>
            }
            checked={draft.entities.includes(k.name)}
            onChange={(on) => toggle(k.name, on)}
          />
        ))}
      </div>
      {own.length > 0 ? (
        <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Kinds of your own">
          {own.map((k, i) => (
            <li key={k.name} className="flex items-center gap-1 text-caption text-muted">
              <span className="mono text-fg">{k.name}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Change ${k.name}`}
                onClick={() => {
                  setEditing({ at: i, kind: k });
                  setKindErrors({});
                }}
              >
                Change
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Remove ${k.name}`} onClick={() => remove(i)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {errors.entities || errors.customKinds ? (
        <p role="alert" className="text-caption text-error">
          {errors.entities ?? errors.customKinds}
        </p>
      ) : null}
      {labels && checked.length > 0 ? (
        <p className="text-caption text-muted">
          Values become{' '}
          <span className="mono text-fg">
            {checked
              .slice(0, 4)
              .map((k) => placeholder(k, numbered))
              .join(', ')}
            {checked.length > 4 ? '…' : ''}
          </span>
          {numbered ? ', numbered per value, so the same value always gets the same placeholder.' : '.'}
        </p>
      ) : null}
      {editing ? (
        <div
          role="group"
          aria-label={editing.at >= 0 ? 'Change the kind' : 'A kind of personal data'}
          className="flex flex-col gap-4 rounded-sm border border-line bg-sunken p-4"
          onKeyDown={(e) => {
            // Enter adds the kind instead of saving the whole rule.
            if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
              e.preventDefault();
              save();
            }
          }}
        >
          <p className="text-ui font-medium text-fg">
            {editing.at >= 0 ? 'Change the kind' : 'A kind of personal data'}
          </p>
          <CustomKindFields
            value={editing.kind}
            onChange={(kind) => {
              setEditing({ ...editing, kind });
              setKindErrors({});
            }}
            errors={kindErrors}
            numbered={numbered}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setKindErrors({});
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={save}>
              {editing.at >= 0 ? 'Save kind' : 'Add kind'}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          className="self-start"
          onClick={() => {
            setEditing({ at: -1, kind: blankKind() });
            setKindErrors({});
          }}
        >
          Add a kind of personal data
        </Button>
      )}
    </fieldset>
  );
}

/** The settings of the chosen method. */
function MethodFields({
  draft,
  set,
  errors,
}: {
  draft: RuleDraft;
  set: (patch: Partial<RuleDraft>) => void;
  errors: DraftErrors;
}) {
  const replacement =
    draft.action === 'redact' && draft.method && REPLACEABLE.includes(draft.method) ? (
      <Field
        label="Replace matches with"
        hint="Labels read like [EMAIL]; masks hide the characters; hashes stay comparable."
      >
        <Segmented<RuleDraft['replacement']>
          label="Replace matches with"
          value={draft.replacement}
          onChange={(replacement) => set({ replacement })}
          options={[
            { value: 'label', label: 'Label' },
            { value: 'mask', label: 'Mask' },
            { value: 'hash', label: 'Hash' },
          ]}
        />
      </Field>
    ) : null;
  const labels =
    draft.method && LABELLED.includes(draft.method) ? (
      <Lines
        label="Report labels as"
        hint={`One label = category per line. Categories: ${CATEGORIES.filter((c) => c !== 'uninspectable').join(', ')}. Anything else is reported as custom.`}
        mono
        rows={3}
        error={errors.categories}
        value={draft.categories}
        onChange={(categories) => set({ categories })}
        placeholder={'jailbreak = prompt_injection\nmedical = pii'}
      />
    ) : null;
  switch (draft.method) {
    case 'regex':
    case 'allowlist':
      return (
        <>
          <Lines
            label={draft.method === 'allowlist' ? 'Allowed patterns' : 'Patterns'}
            hint={
              draft.method === 'allowlist'
                ? 'One regular expression per line. Text that matches none of them is a finding.'
                : 'One regular expression per line. Any match is a finding.'
            }
            mono
            error={errors.patterns}
            value={draft.patterns}
            onChange={(patterns) => set({ patterns })}
            placeholder={'\\b[A-Z]{2}\\d{2}[A-Z0-9]{11,30}\\b'}
          />
          {draft.method === 'regex' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Checksum" hint="Only matches whose digits pass the check count.">
                <Select
                  value={draft.validate}
                  onChange={(v) => set({ validate: entityCheck(v) })}
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'luhn', label: 'Luhn (card numbers)' },
                    { value: 'iban_mod97', label: 'IBAN mod-97' },
                    { value: 'cpf', label: 'CPF check digits' },
                    { value: 'cnpj', label: 'CNPJ check digits' },
                  ]}
                />
              </Field>
              <Field
                label="Placeholder label"
                optional
                hint={
                  <>
                    A redacted match becomes{' '}
                    <span className="mono text-fg">
                      {patternPlaceholder(draft.label, draft.name || 'redacted', draft.reversible)}
                    </span>
                    {draft.reversible ? ', numbered per value.' : '.'}
                  </>
                }
              >
                <Input
                  mono
                  value={draft.label}
                  onChange={(e) => set({ label: e.target.value })}
                  placeholder={draft.reversible && draft.name ? draft.name.toUpperCase() : 'REDACTED'}
                />
              </Field>
            </div>
          ) : null}
          {replacement}
          {draft.method === 'regex' && draft.action === 'redact' ? (
            <Checkbox
              label="Put the values back in the answer"
              description="The provider sees numbered placeholders such as [ACCOUNT_1]; the answer gets the real values back. Needs labels."
              checked={draft.reversible}
              disabled={draft.replacement !== 'label'}
              onChange={(reversible) => set({ reversible })}
            />
          ) : null}
          {errors.reversible ? (
            <p role="alert" className="text-caption text-error">
              {errors.reversible}
            </p>
          ) : null}
        </>
      );
    case 'keywords':
      return (
        <>
          <Lines
            label="Words and phrases"
            hint="One per line."
            error={errors.words}
            value={draft.words}
            onChange={(words) => set({ words })}
            placeholder={'ignore previous instructions\ndeveloper mode'}
          />
          <Field label="Match">
            <Segmented<RuleDraft['match']>
              label="Match"
              value={draft.match}
              onChange={(match) => set({ match })}
              options={[
                { value: 'word', label: 'Whole words' },
                { value: 'substring', label: 'Anywhere in the text' },
              ]}
            />
          </Field>
          {replacement}
        </>
      );
    case 'pii':
      return (
        <>
          <KindsField draft={draft} set={set} errors={errors} />
          <CheckGrid
            legend="Keep readable"
            all={PII_PRESERVE}
            value={draft.preserve}
            onChange={(preserve) => set({ preserve, ...(preserve.length > 0 ? { reversible: false } : {}) })}
            name={(p) => PRESERVE_NAME[p]}
          />
          {replacement}
          {draft.action === 'redact' ? (
            <Checkbox
              label="Put the values back in the answer"
              description="The provider sees numbered labels such as [EMAIL_1]; the answer gets the real values back. Needs labels and nothing kept readable."
              checked={draft.reversible}
              disabled={draft.replacement !== 'label' || draft.preserve.length > 0}
              onChange={(reversible) => set({ reversible })}
            />
          ) : null}
          {errors.reversible ? (
            <p role="alert" className="text-caption text-error">
              {errors.reversible}
            </p>
          ) : null}
        </>
      );
    case 'secrets':
      return (
        <>
          <CheckGrid
            legend="Look for"
            all={SECRET_DETECTORS}
            value={draft.detectors}
            onChange={(detectors) => set({ detectors })}
            name={(d) => ENTITY_NAME[d] ?? d}
            error={errors.detectors}
          />
          <Field
            label="Minimum entropy"
            optional
            error={errors.minEntropy}
            hint="Bits per character, 0 to 8. Matches that look less random than this are ignored."
          >
            <Input
              inputMode="decimal"
              value={draft.minEntropy}
              onChange={(e) => set({ minEntropy: e.target.value })}
              placeholder="3.5"
            />
          </Field>
          {replacement}
        </>
      );
    case 'classifier':
    case 'webhook':
      return (
        <>
          <Field
            label={draft.method === 'classifier' ? 'Endpoint' : 'Service address'}
            error={errors.url}
            hint={
              draft.method === 'classifier'
                ? 'It receives the text and answers a score per label.'
                : 'It receives the text and answers a verdict, with a category when it found something.'
            }
          >
            <Input
              mono
              value={draft.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://"
            />
          </Field>
          {draft.method === 'classifier' ? (
            <Lines
              label="Thresholds"
              hint="One label = score per line; a score at or above it is a finding."
              mono
              rows={3}
              error={errors.thresholds}
              value={draft.thresholds}
              onChange={(thresholds) => set({ thresholds })}
              placeholder={'jailbreak = 0.9\nmedical = 0.8'}
            />
          ) : (
            <>
              <Field label="Send">
                <Segmented<RuleDraft['webhookMode']>
                  label="Send"
                  value={draft.webhookMode}
                  onChange={(webhookMode) => set({ webhookMode })}
                  options={[
                    { value: 'segments', label: 'The text only' },
                    { value: 'body', label: 'The whole request' },
                  ]}
                />
              </Field>
              <HeaderRowsEditor
                label="Headers"
                rows={draft.headers}
                onChange={(headers) => set({ headers })}
                error={errors.headers}
                hint="Sent with every call, such as authorization. Values are stored hidden."
              />
              <SecretField
                label="Signing secret"
                optional
                value={draft.signingSecret}
                onChange={(signingSecret) => set({ signingSecret })}
                hint="Signs each call so your service can check it came from the gateway."
              />
            </>
          )}
          {labels}
          {replacement}
        </>
      );
    case 'topic':
      return (
        <>
          <ModelPicker
            label="Embeddings Model"
            hint="Compares each request with the topics."
            value={draft.model}
            onChange={(model) => set({ model })}
            error={errors.model}
          />
          <Lines
            label="Allowed topics"
            hint="One description per line. A request close to none of them is off topic."
            error={errors.allowedTopics}
            value={draft.allowedTopics}
            onChange={(allowedTopics) => set({ allowedTopics })}
            placeholder="Questions about our product and billing"
          />
          <Lines
            label="Denied topics"
            hint="One description per line. A request close to one of them is off topic."
            value={draft.deniedTopics}
            onChange={(deniedTopics) => set({ deniedTopics })}
            placeholder="Medical or legal advice"
          />
          <Field
            label="Similarity threshold"
            error={errors.threshold}
            hint="From 0 to 1; higher needs a closer match."
          >
            <Input
              inputMode="decimal"
              value={draft.threshold}
              onChange={(e) => set({ threshold: e.target.value })}
            />
          </Field>
        </>
      );
    case 'llm_rewrite':
      return (
        <>
          <ModelPicker
            label="Model"
            value={draft.model}
            onChange={(model) => set({ model })}
            error={errors.model}
          />
          <Lines
            label="Instructions"
            hint="What the Model should change, such as removing names or softening the tone."
            error={errors.prompt}
            value={draft.prompt}
            onChange={(prompt) => set({ prompt })}
          />
        </>
      );
    case 'json_schema':
      return (
        <>
          <Checkbox
            label="Use the schema the request asks for"
            description="Answers are checked against the response format each request names."
            checked={draft.useRequestSchema}
            onChange={(useRequestSchema) => set({ useRequestSchema })}
          />
          {draft.useRequestSchema ? null : (
            <Lines
              label="Schema"
              mono
              rows={6}
              error={errors.schema}
              value={draft.schema}
              onChange={(schema) => set({ schema })}
              placeholder={'{\n  "type": "object",\n  "required": ["answer"]\n}'}
            />
          )}
          <Field
            label="Ask again"
            error={errors.reask}
            hint="Times an answer that fails is asked for again, 0 to 5."
          >
            <Input inputMode="numeric" value={draft.reask} onChange={(e) => set({ reask: e.target.value })} />
          </Field>
        </>
      );
    case 'json_repair':
      return (
        <p className="text-ui text-muted">
          Answers that are almost valid JSON (a trailing comma, a missing quote or bracket) are fixed before
          they reach your app. There is nothing to set.
        </p>
      );
    case 'template':
      return (
        <>
          <Lines
            label="Templates"
            hint="A JSON object: each name maps to its messages, with {{variable}} placeholders the request fills."
            mono
            rows={8}
            error={errors.templates}
            value={draft.templates}
            onChange={(templates) => set({ templates })}
            placeholder={
              '{\n  "support_reply": {\n    "messages": [\n      { "role": "system", "content": "You help {{customer}}." }\n    ]\n  }\n}'
            }
          />
          <Checkbox
            label="Only templated requests"
            description="Requests that don't name a template are refused."
            checked={draft.templateRequired}
            onChange={(templateRequired) => set({ templateRequired })}
          />
        </>
      );
    case 'decorator':
      return (
        <>
          <Lines
            label="Prefix"
            hint="Added before the last user message."
            error={errors.userPrefix}
            rows={2}
            value={draft.userPrefix}
            onChange={(userPrefix) => set({ userPrefix })}
          />
          <Lines
            label="Suffix"
            hint="Added after it."
            rows={2}
            value={draft.userSuffix}
            onChange={(userSuffix) => set({ userSuffix })}
          />
        </>
      );
    case 'moderation':
      return (
        <>
          <ModelPicker
            label="Moderation Model"
            hint="A Model that answers moderation calls, such as omni-moderation-latest."
            value={draft.model}
            onChange={(model) => set({ model })}
            error={errors.model}
          />
          <Lines
            label="Thresholds"
            hint="One category = score per line; a score at or above it is a finding. Empty: whatever the Model flags."
            mono
            rows={3}
            error={errors.thresholds}
            value={draft.thresholds}
            onChange={(thresholds) => set({ thresholds })}
            placeholder={'hate = 0.5\nviolence = 0.7'}
          />
          {labels}
        </>
      );
    case 'llm_judge':
      return (
        <>
          <ModelPicker
            label="Model"
            hint="It reads the text and answers whether it breaks your rule."
            value={draft.model}
            onChange={(model) => set({ model })}
            error={errors.model}
          />
          <Lines
            label="Instructions"
            hint="What the Model looks for. {{content}} is replaced by the text checked."
            error={errors.prompt}
            rows={5}
            value={draft.prompt}
            onChange={(prompt) => set({ prompt })}
            placeholder="Does this text give medical advice? {{content}}"
          />
          <Field
            label="Longest answer"
            optional
            error={errors.judgeMaxTokens}
            hint="Tokens, 1 to 4096; 256 unless set."
          >
            <Input
              mono
              inputMode="numeric"
              className="w-28"
              value={draft.judgeMaxTokens}
              onChange={(e) => set({ judgeMaxTokens: e.target.value })}
            />
          </Field>
          {labels}
        </>
      );
    case 'length':
      return (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-ui font-medium text-fg">Bounds</legend>
          <p className="-mt-1 text-caption text-muted">
            Prompts are counted together; each answer on its own. Tokens are estimated. Leave a bound empty to
            not check it.
          </p>
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {LENGTH_BOUNDS.map((k) => (
              <Field key={k} label={BOUND_LABEL[k]}>
                <Input
                  mono
                  inputMode="numeric"
                  value={draft.bounds[k]}
                  onChange={(e) => set({ bounds: { ...draft.bounds, [k]: e.target.value } })}
                />
              </Field>
            ))}
          </div>
          {errors.bounds ? (
            <p role="alert" className="text-caption text-error">
              {errors.bounds}
            </p>
          ) : null}
        </fieldset>
      );
    case 'tool_permission':
      return (
        <>
          <Lines
            label="Allowed tools"
            hint="One name per line; * matches any run of characters. Empty: every tool not denied."
            mono
            rows={3}
            error={errors.toolsAllow}
            value={draft.toolsAllow}
            onChange={(toolsAllow) => set({ toolsAllow })}
            placeholder={'search_*\nget_weather'}
          />
          <Lines
            label="Denied tools"
            hint="One name per line; a denied tool is refused even when it is allowed."
            mono
            rows={3}
            value={draft.toolsDeny}
            onChange={(toolsDeny) => set({ toolsDeny })}
            placeholder={'delete_*'}
          />
          <p className="text-caption text-muted">
            On prompts, a refused tool definition is a finding (redact removes it); on answers, a call to a
            refused tool is.
          </p>
          {replacement}
        </>
      );
    case 'system_prompt':
      return (
        <>
          <Lines
            label="System message"
            error={errors.systemText}
            rows={5}
            value={draft.systemText}
            onChange={(systemText) => set({ systemText })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="With the request’s own">
              <Select
                value={draft.systemMode || 'prepend'}
                onChange={(v) =>
                  set({
                    systemMode: v === 'prepend' && !draft.systemMode ? '' : (v as RuleDraft['systemMode']),
                  })
                }
                options={[
                  { value: 'prepend', label: 'Put it first' },
                  { value: 'append', label: 'Put it after' },
                  { value: 'replace', label: 'Replace it' },
                  { value: 'insert_if_absent', label: 'Only when there is none' },
                ]}
              />
            </Field>
            <Field label="Role">
              <Segmented<RuleDraft['systemRole']>
                label="Role"
                value={draft.systemRole}
                onChange={(systemRole) => set({ systemRole })}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'developer', label: 'Developer' },
                ]}
              />
            </Field>
          </div>
        </>
      );
    case 'bedrock_guardrails':
      return (
        <>
          <ProviderPicker
            type="bedrock"
            value={draft.provider}
            onChange={(provider) => set({ provider })}
            error={errors.provider}
            hint="A Bedrock provider: its AWS credentials sign the call."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Guardrail id" error={errors.guardrailId} hint="Its id or ARN.">
              <Input mono value={draft.guardrailId} onChange={(e) => set({ guardrailId: e.target.value })} />
            </Field>
            <Field label="Version" optional hint="DRAFT unless set.">
              <Input
                mono
                value={draft.guardrailVersion}
                placeholder="DRAFT"
                onChange={(e) => set({ guardrailVersion: e.target.value })}
              />
            </Field>
            <Field label="Region" optional hint="The provider’s region unless set.">
              <Input mono value={draft.region} onChange={(e) => set({ region: e.target.value })} />
            </Field>
            <Field label="Address" optional error={errors.baseUrl} hint="The region’s endpoint unless set.">
              <Input
                mono
                value={draft.baseUrl}
                placeholder="https://"
                onChange={(e) => set({ baseUrl: e.target.value })}
              />
            </Field>
          </div>
          {labels}
          {replacement}
        </>
      );
    case 'azure_content_safety':
      return (
        <>
          <Field label="Endpoint" error={errors.endpoint} hint="Your Content Safety resource’s address.">
            <Input
              mono
              value={draft.endpoint}
              placeholder="https://"
              onChange={(e) => set({ endpoint: e.target.value })}
            />
          </Field>
          <SecretField
            label="API key"
            value={draft.apiKey}
            onChange={(apiKey) => set({ apiKey })}
            error={errors.apiKey}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Severity at or above"
              optional
              error={errors.severityThreshold}
              hint="0 to 7; 4 unless set."
            >
              <Input
                mono
                inputMode="numeric"
                value={draft.severityThreshold}
                onChange={(e) => set({ severityThreshold: e.target.value })}
              />
            </Field>
            <Field label="API version" optional hint="2024-09-01 unless set.">
              <Input mono value={draft.apiVersion} onChange={(e) => set({ apiVersion: e.target.value })} />
            </Field>
          </div>
          {labels}
          {replacement}
        </>
      );
    case 'model_armor':
      return (
        <>
          <ProviderPicker
            type="vertex"
            value={draft.provider}
            onChange={(provider) => set({ provider })}
            error={errors.provider}
            hint="A Vertex provider: its Google Cloud credentials sign the call."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Template" error={errors.armorTemplate}>
              <Input
                mono
                value={draft.armorTemplate}
                onChange={(e) => set({ armorTemplate: e.target.value })}
              />
            </Field>
            <Field label="Project" optional hint="The provider’s project unless set.">
              <Input mono value={draft.gcpProject} onChange={(e) => set({ gcpProject: e.target.value })} />
            </Field>
            <Field label="Location" optional hint="The provider’s location unless set.">
              <Input mono value={draft.gcpLocation} onChange={(e) => set({ gcpLocation: e.target.value })} />
            </Field>
            <Field label="Address" optional error={errors.baseUrl} hint="The location’s endpoint unless set.">
              <Input
                mono
                value={draft.baseUrl}
                placeholder="https://"
                onChange={(e) => set({ baseUrl: e.target.value })}
              />
            </Field>
          </div>
          {labels}
          {replacement}
        </>
      );
    case 'lakera':
      return (
        <>
          <SecretField
            label="API key"
            value={draft.apiKey}
            onChange={(apiKey) => set({ apiKey })}
            error={errors.apiKey}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project" optional hint="The project whose policy applies.">
              <Input
                mono
                value={draft.lakeraProject}
                onChange={(e) => set({ lakeraProject: e.target.value })}
              />
            </Field>
            <Field label="Address" optional error={errors.baseUrl} hint="https://api.lakera.ai unless set.">
              <Input
                mono
                value={draft.baseUrl}
                placeholder="https://api.lakera.ai"
                onChange={(e) => set({ baseUrl: e.target.value })}
              />
            </Field>
          </div>
          {labels}
          {replacement}
        </>
      );
    case null:
      return (
        <p className="text-ui text-muted">
          This method ({TYPE_LABEL[draft.type]}) is set in the configuration. Here you can turn it on or off
          and change its action, severity, description and where it runs.
        </p>
      );
  }
}

const VERDICT_TONE: Record<string, Tone> = { block: 'error', redact: 'warn', flag: 'info', pass: 'success' };

/** The text with the matched spans marked (code-point offsets), each span named by its kind. */
function Marked({
  text,
  spans,
  kinds,
}: {
  text: string;
  spans: RuleTestResult['spans'];
  kinds: CustomKind[];
}) {
  const chars = Array.from(text);
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [i, s] of [...spans].sort((a, b) => a.start - b.start).entries()) {
    if (s.start < at) continue;
    parts.push(chars.slice(at, s.start).join(''));
    parts.push(
      <mark
        key={i}
        className="rounded-xs bg-[color-mix(in_oklab,var(--ant-warn)_30%,transparent)] px-0.5 text-fg"
      >
        {chars.slice(s.start, s.end).join('')}
        <span className="sr-only">
          {' '}
          ({kinds.some((k) => kindEntity(k) === s.entity) ? kindName(s.entity, kinds) : matchWord(s.entity)})
        </span>
      </mark>,
    );
    at = s.end;
  }
  parts.push(chars.slice(at).join(''));
  return <p className="text-ui leading-relaxed break-words whitespace-pre-wrap text-fg">{parts}</p>;
}

/** What each match became ("123.456.789-09 → [CPF_1]"), where the rule replaced it. */
function Replacements({ text, spans }: { text: string; spans: RuleTestResult['spans'] }) {
  const chars = Array.from(text);
  const rows = [
    ...new Map(
      spans
        .filter((s) => s.replacement)
        .map((s) => {
          const value = chars.slice(s.start, s.end).join('');
          return [`${value}\u0000${s.replacement ?? ''}`, { value, replacement: s.replacement ?? '' }];
        }),
    ).values(),
  ];
  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5" aria-label="What each match became">
      {rows.map((row) => (
        <li key={`${row.value}-${row.replacement}`} className="mono text-caption text-muted">
          <span className="text-fg">{row.value}</span> → <span className="text-fg">{row.replacement}</span>
        </li>
      ))}
    </ul>
  );
}

/** A labelled block of text the test produced: what goes on, what comes back. */
function Produced({ title, hint, text }: { title: string; hint?: string; text: string }) {
  return (
    <div>
      <p className="text-caption text-muted">{title}</p>
      <p className="mono text-ui break-words whitespace-pre-wrap text-fg">{text}</p>
      {hint ? <p className="mt-0.5 text-caption text-dim">{hint}</p> : null}
    </div>
  );
}

/**
 * Runs the form's settings, saved or not, on sample text without sending anything to a provider.
 */
function TestPanel({
  draft,
  base,
  saved,
  edited,
  onInvalid,
}: {
  draft: RuleDraft;
  base: GuardrailSpec | null;
  /** The saved rule's name, when it is one. */
  saved: string | null;
  edited: boolean;
  /** The form has something to fix before it can run. */
  onInvalid: (errors: DraftErrors) => void;
}) {
  const [stage, setStage] = useState<TestStage>('input');
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ text: string; r: RuleTestResult } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const canTest = useCan('testGuardrail');
  const canTestUnsaved = useCan('testUnsavedGuardrail');
  // An unchanged saved rule is the form as it is: the gateway runs it by name, stored secrets
  // included, even where the form can't rebuild it (settings written elsewhere).
  const byName = saved !== null && !edited;
  if (!canTest && !canTestUnsaved) return null;
  const allowed = byName ? canTest || canTestUnsaved : canTestUnsaved;

  async function run() {
    setError(null);
    // The name doesn't change what the rule does; a new rule may not have one yet.
    const built = specOf({ ...draft, name: 'rule_under_test' }, base);
    if (!byName && !built.ok) {
      onInvalid(built.errors);
      setError(new Error('Fix the form first: the test runs what it says.'));
      return;
    }
    setBusy(true);
    try {
      const r =
        byName && canTest
          ? await safetyApi.test(saved, stage, text)
          : built.ok
            ? await safetyApi.testSpec(built.spec, stage, text, saved ?? undefined)
            : null;
      if (!r) return;
      setResult({ text, r });
    } catch (e) {
      setError(
        noSpecTest(e)
          ? new Error(
              saved
                ? 'This gateway tests saved rules only. Save your changes, then test them.'
                : 'This gateway tests saved rules only. Create the rule, then test it.',
            )
          : e,
      );
    } finally {
      setBusy(false);
    }
  }

  const r = result?.r;
  const redacted = r && typeof r.redacted === 'string' && r.redacted !== result.text ? r.redacted : null;
  return (
    <section
      aria-label="Test this rule"
      className="flex flex-col gap-3 rounded-sm border border-line bg-sunken p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-ui font-semibold text-fg">Test this rule</h3>
        <Segmented<TestStage>
          label="Test as"
          value={stage}
          onChange={setStage}
          options={[
            { value: 'input', label: 'A prompt' },
            { value: 'output', label: 'An answer' },
          ]}
        />
      </div>
      <Field
        label="Sample text"
        hint="Runs the form as it is now, saved or not. Nothing is sent to a provider or logged."
      >
        <Textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={draft.type === 'pii' ? 'Contact me at jane@example.com' : 'Sample prompt or answer'}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          icon="play"
          busy={busy}
          disabled={!text.trim() || !allowed}
          disabledReason={
            allowed
              ? 'Enter some text to test'
              : 'Your role can test saved rules only: save your changes, then test them'
          }
          onClick={() => void run()}
        >
          Run test
        </Button>
        <InlineError error={error} />
      </div>
      {result && r ? (
        <div className="flex flex-col gap-2.5" role="status">
          <p className="flex flex-wrap items-center gap-2 text-ui text-muted">
            <Badge tone={VERDICT_TONE[r.verdict] ?? 'neutral'} dot>
              {r.verdict === 'pass' ? 'Passes' : (ACTION_LABEL[r.verdict] ?? r.verdict)}
            </Badge>
            {r.category ? <span>{CATEGORY_LABEL[r.category] ?? r.category}</span> : null}
            <span>· {r.spans.length === 1 ? '1 match' : `${r.spans.length} matches`}</span>
          </p>
          {r.spans.length > 0 ? (
            <>
              <Marked text={result.text} spans={r.spans} kinds={draft.customKinds} />
              <Replacements text={result.text} spans={r.spans} />
            </>
          ) : null}
          {redacted !== null ? (
            <Produced
              title={stage === 'input' ? 'What the provider gets' : 'What your app gets'}
              text={redacted}
            />
          ) : null}
          {r.restored !== null ? (
            <Produced
              title="What restore gives back"
              hint="When the answer repeats the placeholders, your app gets the real values in their place."
              text={typeof r.restored === 'string' ? r.restored : JSON.stringify(r.restored, null, 2)}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Editor({
  target,
  onClose,
  onEdited,
}: {
  target: EditorTarget;
  onClose: () => void;
  onEdited: (edited: boolean) => void;
}) {
  const guardrails = useSafety((s) => s.guardrails.data);
  const policies = useSafety((s) => s.policies);
  const saveRule = useSafety((s) => s.saveRule);
  const deleteRule = useSafety((s) => s.deleteRule);
  const canWrite = useCan('replaceGuardrail');
  const canAttach = useCan('patchPoliciesSettings') && policies.data !== null;
  const original: GuardrailResource | null =
    target.kind === 'edit' ? (guardrails?.find((g) => g.name === target.name) ?? null) : null;
  const attached = useAttachment(original?.name ?? null);
  const initial = useMemo(
    () =>
      target.kind === 'edit'
        ? (target.prepared?.draft ?? (original ? draftOf(original.name, original.spec, attached) : null))
        : emptyDraft(target.method ?? 'regex'),
    // The form starts from what was open when the drawer opened; later reads don't reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [draft, setDraft] = useState<RuleDraft | null>(initial);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const edited = useEdited(draft);
  useEffect(() => onEdited(edited), [edited, onEdited]);
  if (!draft) return <p className="text-ui text-muted">This rule no longer exists.</p>;
  const set = (patch: Partial<RuleDraft>) => {
    setDraft({ ...draft, ...patch });
    setErrors({});
  };
  const transform = TRANSFORMS.includes(draft.type);
  const actions = actionsFor(draft.method, draft.type);
  const stages = stagesFor(
    draft.type,
    draft.action,
    draft.run ? draft.run.execution || undefined : original?.spec.execution,
  );
  const category = impliedCategory({
    type: draft.type,
    regex: draft.method === 'allowlist' ? { allow: ['x'] } : {},
  });

  async function save() {
    if (!draft) return;
    const result = specOf(draft, original?.spec ?? null);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveRule({
        name: draft.name,
        spec: result.spec,
        original,
        attach: canAttach
          ? { input: draft.onInput && stages.input, output: draft.onOutput && stages.output }
          : null,
      });
      notify('success', original ? 'Rule saved' : 'Rule created', draft.name);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form
        id="rule-editor"
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {target.kind === 'edit' && target.prepared ? (
          <Banner tone="info" title="A change is prepared">
            {target.prepared.change} Review it, then save. Past events stay as they were.
          </Banner>
        ) : null}
        {target.kind === 'new' ? (
          <Field label="Method" hint={METHODS.find((m) => m.value === draft.method)?.description}>
            <Select
              value={draft.method ?? 'regex'}
              onChange={(v) => {
                const method = METHODS.find((m) => m.value === v)?.value ?? 'regex';
                setDraft({
                  ...emptyDraft(method),
                  name: draft.name,
                  description: draft.description,
                  severity: draft.severity,
                });
                setErrors({});
              }}
              options={METHODS.map((m) => ({ value: m.value, label: m.label }))}
            />
          </Field>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Name"
            error={errors.name}
            hint={
              target.kind === 'new'
                ? 'Lowercase letters, digits and underscores; it can’t be changed later.'
                : undefined
            }
          >
            <Input
              mono
              value={draft.name}
              readOnly={target.kind === 'edit'}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="iban_numbers"
              data-autofocus={target.kind === 'new' ? true : undefined}
            />
          </Field>
          <Field label="Reported as" hint="The category events of this rule are filed under.">
            <Input
              readOnly
              value={
                category
                  ? (CATEGORY_LABEL[category] ?? category)
                  : transform
                    ? 'Changes requests; reports nothing'
                    : 'The category each label maps to'
              }
            />
          </Field>
        </div>
        <MethodFields draft={draft} set={set} errors={errors} />
        {transform ? null : (
          <div className="flex flex-col gap-4">
            {actions.length > 1 ? (
              <Field label="Action" hint={draft.action ? ACTION_HINT[draft.action] : undefined}>
                <Segmented<string>
                  label="Action"
                  value={draft.action}
                  onChange={(v) => set({ action: actions.find((a) => a === v) ?? draft.action })}
                  options={actions.map((a) => ({ value: a, label: ACTION_LABEL[a] ?? a }))}
                />
              </Field>
            ) : null}
            {draft.action === 'divert' ? (
              <ModelPicker
                label="Answer with"
                hint="The Model whose route serves a request this rule catches."
                value={draft.divertTo}
                onChange={(divertTo) => set({ divertTo })}
                error={errors.divertTo}
              />
            ) : null}
            <Field
              label="Severity"
              hint="Without one, it follows the action: block is high, redact medium, flag and divert low."
            >
              <Select
                value={draft.severity}
                onChange={(v) =>
                  set({
                    severity: v === 'critical' || v === 'high' || v === 'medium' || v === 'low' ? v : '',
                  })
                }
                emptyOption="By action"
                options={[
                  { value: 'critical', label: 'Critical' },
                  { value: 'high', label: 'High' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'low', label: 'Low' },
                ]}
              />
            </Field>
          </div>
        )}
        <Field label="Description" optional hint="A note for other admins: why this rule exists.">
          <Textarea
            rows={2}
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-ui font-medium text-fg">Where it runs</legend>
          {canAttach ? (
            <>
              <Checkbox
                label="Every prompt"
                description={
                  stages.input
                    ? 'At the gateway level, for all organizations.'
                    : 'This method reads answers only.'
                }
                checked={draft.onInput && stages.input}
                disabled={!stages.input}
                onChange={(onInput) => set({ onInput })}
              />
              <Checkbox
                label="Every answer"
                description={
                  stages.output
                    ? 'Answers are checked before they reach your apps.'
                    : draft.action === 'divert'
                      ? 'A diverted request is decided on its prompt only.'
                      : 'This method reads prompts only.'
                }
                checked={draft.onOutput && stages.output}
                disabled={!stages.output}
                onChange={(onOutput) => set({ onOutput })}
              />
            </>
          ) : (
            <p className="text-caption text-muted">
              Your role can&apos;t change where guardrails run; an organization, team or Model policy can name
              this rule.
            </p>
          )}
          {original ? <NamedBy name={original.name} /> : null}
          {canAttach && !(draft.onInput && stages.input) && !(draft.onOutput && stages.output) ? (
            <p className="text-caption text-warn">
              It checks nothing until a policy names it: here, or in an organization, team or Model.
            </p>
          ) : null}
        </fieldset>
        <RunFields draft={draft} set={set} error={errors.run} transform={transform} />
        <Switch label="On" checked={draft.enabled} onChange={(enabled) => set({ enabled })} />
        <InlineError error={error} />
      </form>
      <div className="mt-6">
        <TestPanel
          draft={draft}
          base={original?.spec ?? null}
          saved={original?.name ?? null}
          edited={edited}
          onInvalid={setErrors}
        />
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {original && canWrite ? (
          <Button variant="danger" icon="trash" className="mr-auto" onClick={() => setDeleting(true)}>
            Delete rule
          </Button>
        ) : null}
        <CancelButton />
        <Button
          type="submit"
          form="rule-editor"
          variant="primary"
          busy={busy}
          disabled={!canWrite}
          disabledReason="Your role can't change guardrails"
        >
          {original ? 'Save rule' : 'Create rule'}
        </Button>
      </div>
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete rule ${original?.name ?? ''}?`}
        objectName={original?.name}
        effect="Requests stop being checked by it, here and in every policy that names it; its past events stay."
        typeToConfirm={original?.name}
        confirmLabel="Delete rule"
        onConfirm={async () => {
          if (!original) return;
          await deleteRule(original.name);
          notify('success', 'Rule deleted', original.name);
          onClose();
        }}
      />
    </>
  );
}

/** The rule drawer: create, edit, test and delete a guardrail. */
export function RuleEditor({ target, onClose }: { target: EditorTarget | null; onClose: () => void }) {
  const [edited, setEdited] = useState(false);
  return (
    <Drawer
      open={target !== null}
      dirty={edited}
      onClose={() => {
        setEdited(false);
        onClose();
      }}
      width="lg"
      title={target === null ? '' : target.kind === 'new' ? 'New rule' : target.name}
      subtitle={
        target?.kind === 'new'
          ? 'A guardrail that checks or changes requests and answers'
          : 'Edit, test or delete this rule'
      }
    >
      {target ? (
        <Editor
          key={JSON.stringify(target)}
          target={target}
          onClose={() => {
            setEdited(false);
            onClose();
          }}
          onEdited={setEdited}
        />
      ) : null}
    </Drawer>
  );
}
