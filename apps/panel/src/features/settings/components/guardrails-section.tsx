'use client';

import { useEffect, useState } from 'react';

import { Field, MultiSelect, NumberInput, Select, Switch } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { LoadError, LoadingRows } from '@/components/ui/states';
import type { components } from '@/lib/api/schema';
import type { FieldErrors } from '@/lib/validation';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';

import { settingsApi } from '../api';
import { rangeError } from '../choices';
import { useTraffic } from '../traffic-store';
import { Card, Facts } from './parts';
import { Choice, Advanced, Hint, lock, SettingsForm } from './settings-form';

type S = components['schemas'];
type GuardPolicy = NonNullable<S['PoliciesSettings']['spec']['guardrails']>;

/* ---------------------------------------------------------------- Behaviour */

type Uninspectable = 'skip' | 'block';

export interface GuardBehaviourValues {
  expose: boolean;
  uninspectable: Uninspectable;
}

export function guardBehaviourValues(
  spec: S['GuardrailsSettings']['spec'] | undefined,
): GuardBehaviourValues {
  return {
    expose: spec?.expose_results ?? SETTINGS_DEFAULTS.guardrails.expose_results,
    uninspectable: spec?.on_uninspectable ?? SETTINGS_DEFAULTS.guardrails.on_uninspectable,
  };
}

function BehaviourCard() {
  const guardrails = useTraffic((s) => s.guardrails);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchGuardrailsSettings');
  const spec = guardrails.data?.spec;
  return (
    <Card
      title="Guardrail behaviour"
      description="How every guardrail treats what it can't read, and what apps are told."
    >
      <LoadError of={guardrails} subject="Guardrail settings" size="sm" />
      {guardrails.status === 'loading' && !guardrails.data ? <LoadingRows rows={2} /> : null}
      {guardrails.data ? (
        <SettingsForm
          key={guardrails.data.metadata.etag}
          initial={guardBehaviourValues(spec)}
          toSpec={(v) => ({ expose_results: v.expose, on_uninspectable: v.uninspectable })}
          save={(patch) => save('guardrails', patch)}
          canEdit={canEdit}
          saved="Guardrail settings saved"
        >
          {({ values, set, disabled }) => (
            <>
              <Choice<Uninspectable>
                label="A request a guardrail can't read"
                value={values.uninspectable}
                onChange={(v) => set('uninspectable', v)}
                options={lock(disabled, [
                  {
                    value: 'skip',
                    label: 'Let it through',
                    description:
                      'Such as an image or a file the checks have no text for. It is flagged as not inspected.',
                  },
                  {
                    value: 'block',
                    label: 'Refuse it',
                    description: 'Safer when guardrails must see everything.',
                  },
                ])}
              />
              <div className="flex flex-col gap-1">
                <Switch
                  label="Tell apps which guardrails ran"
                  checked={values.expose}
                  disabled={disabled}
                  onChange={(v) => set('expose', v)}
                />
                <Hint>Answers carry each guardrail&apos;s name and result in a response header.</Hint>
              </div>
              <Facts
                items={[
                  {
                    label: 'Hashing key',
                    value: spec?.hash_key ? 'Set in the configuration' : 'Not set',
                    hint: 'Used when a guardrail replaces a value with its hash. Change it in Configuration.',
                  },
                ]}
              />
            </>
          )}
        </SettingsForm>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------------- Gateway policy */

type Order = 'parallel' | 'sequential';
type StreamMode = 'auto' | 'buffer' | 'window' | 'observe' | 'reject';
type OnBlock = 'error' | 'finish';

export interface GuardPolicyValues {
  mcpInput: string[];
  mcpOutput: string[];
  selectable: string[];
  order: Order;
  streamMode: StreamMode;
  holdback: string;
  onBlock: OnBlock;
}

const GD = SETTINGS_DEFAULTS.policies.guardrails;

export function guardPolicyValues(g: GuardPolicy | undefined): GuardPolicyValues {
  return {
    mcpInput: g?.mcp_input ?? [],
    mcpOutput: g?.mcp_output ?? [],
    selectable: g?.request_selectable ?? [],
    order: g?.execution_order ?? GD.execution_order,
    streamMode: g?.streaming?.mode ?? GD.streaming.mode,
    holdback: String(g?.streaming?.holdback_chars ?? GD.streaming.holdback_chars),
    onBlock: g?.streaming?.on_block ?? GD.streaming.on_block,
  };
}

const guardPolicySpec = (v: GuardPolicyValues) => ({
  mcp_input: v.mcpInput,
  mcp_output: v.mcpOutput,
  request_selectable: v.selectable,
  execution_order: v.order,
  streaming: { mode: v.streamMode, holdback_chars: Number(v.holdback), on_block: v.onBlock },
});

/** Every guardrail's name, for the pickers; null until read (or when it can't be). */
function useGuardrailNames(): string[] | null {
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    settingsApi.guardrails().then(
      (list) => setNames(list.map((g) => g.name).sort()),
      () => setNames(null),
    );
  }, []);
  return names;
}

const STREAM_MODES: { value: StreamMode; label: string; description: string }[] = [
  { value: 'auto', label: 'Automatic', description: 'The way each output guardrail supports best.' },
  {
    value: 'buffer',
    label: 'Hold the answer until checked',
    description: 'Nothing is sent until the whole answer passed. Safest, slowest to the first word.',
  },
  {
    value: 'window',
    label: 'Check as it streams',
    description: 'A few characters are held back so a match can still be stopped.',
  },
  {
    value: 'observe',
    label: 'Stream at once, check after',
    description: 'A finding is recorded but can no longer be stopped.',
  },
  {
    value: 'reject',
    label: 'Refuse streaming',
    description: 'Streamed requests are refused while output guardrails apply.',
  },
];

function PolicyCard() {
  const policies = useTraffic((s) => s.policies);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchPoliciesSettings');
  const names = useGuardrailNames();
  return (
    <Card
      title="Default for every request"
      description="Applies unless an organization, team, project or key sets its own. Which guardrails check prompts and answers is set in Safety."
    >
      <LoadError of={policies} subject="The gateway's guardrail policy" size="sm" />
      {policies.status === 'loading' && !policies.data ? <LoadingRows rows={3} /> : null}
      {policies.data ? (
        <SettingsForm
          key={policies.data.metadata.etag}
          initial={guardPolicyValues(policies.data.spec.guardrails)}
          toSpec={guardPolicySpec}
          save={(patch) => save('policies', { guardrails: patch })}
          canEdit={canEdit}
          saved="Guardrail default saved"
          check={(v): FieldErrors => {
            const holdback = rangeError(v.holdback, 16, 65536);
            return holdback ? { holdback } : {};
          }}
          paths={{
            'policies.guardrails.mcp_input': 'mcpInput',
            'policies.guardrails.mcp_output': 'mcpOutput',
            'policies.guardrails.request_selectable': 'selectable',
            'policies.guardrails.streaming.holdback_chars': 'holdback',
          }}
        >
          {({ values, set, errors, disabled }) => {
            const options = [
              ...new Set([...(names ?? []), ...values.mcpInput, ...values.mcpOutput, ...values.selectable]),
            ].map((n) => ({ value: n, label: n }));
            return (
              <>
                <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                  <Field
                    label="Check tool calls to MCP servers"
                    error={errors.mcpInput}
                    hint="What a Model sends to a tool."
                  >
                    <MultiSelect
                      noun="guardrail"
                      disabled={disabled}
                      value={values.mcpInput}
                      options={options}
                      onChange={(v) => set('mcpInput', v)}
                    />
                  </Field>
                  <Field
                    label="Check what MCP tools return"
                    error={errors.mcpOutput}
                    hint="Before the Model reads it."
                  >
                    <MultiSelect
                      noun="guardrail"
                      disabled={disabled}
                      value={values.mcpOutput}
                      options={options}
                      onChange={(v) => set('mcpOutput', v)}
                    />
                  </Field>
                </div>
                <Field
                  label="Apps may also ask for"
                  error={errors.selectable}
                  hint="Guardrails a request can turn on for itself by name."
                >
                  <MultiSelect
                    noun="guardrail"
                    disabled={disabled}
                    value={values.selectable}
                    options={options}
                    onChange={(v) => set('selectable', v)}
                  />
                </Field>
                <Choice<Order>
                  label="Run guardrails"
                  value={values.order}
                  onChange={(v) => set('order', v)}
                  options={lock(disabled, [
                    {
                      value: 'parallel',
                      label: 'All at once',
                      description: 'Faster: each one checks the original text.',
                    },
                    {
                      value: 'sequential',
                      label: 'One after another',
                      description: 'Each one sees what the last replaced, such as removed personal data.',
                    },
                  ])}
                />
                <Advanced label="Streamed answers">
                  <Choice<StreamMode>
                    label="Output guardrails on a streamed answer"
                    value={values.streamMode}
                    onChange={(v) => set('streamMode', v)}
                    options={lock(disabled, STREAM_MODES)}
                  />
                  <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                    <Field
                      label="Characters held back"
                      error={errors.holdback}
                      hint="While checking as it streams, 16 to 65,536."
                    >
                      <NumberInput
                        value={values.holdback}
                        min={16}
                        max={65536}
                        disabled={disabled || values.streamMode !== 'window'}
                        onChange={(v) => set('holdback', v)}
                      />
                    </Field>
                    <Field label="When a streamed answer is stopped">
                      <Select
                        value={values.onBlock}
                        disabled={disabled}
                        onChange={(v) => set('onBlock', v as OnBlock)}
                        options={[
                          { value: 'error', label: 'End it with an error' },
                          { value: 'finish', label: 'End it as if finished' },
                        ]}
                      />
                    </Field>
                  </div>
                </Advanced>
              </>
            );
          }}
        </SettingsForm>
      ) : null}
    </Card>
  );
}

/** Guardrails: their gateway-wide behaviour and the gateway's default guardrail policy. */
export function GuardrailsSection() {
  const load = useTraffic((s) => s.load);
  useEffect(() => {
    void load(['guardrails', 'policies']);
  }, [load]);
  return (
    <>
      <BehaviourCard />
      <PolicyCard />
    </>
  );
}
