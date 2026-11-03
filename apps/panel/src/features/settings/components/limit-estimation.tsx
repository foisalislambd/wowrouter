'use client';

import { Field, Input, NumberInput, Select } from '@/components/ui/form';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';
import type { FieldErrors } from '@/lib/validation';

import { durationOptions, rangeError } from '../choices';
import { Advanced } from './settings-form';

const ED = SETTINGS_DEFAULTS.limits.estimation;

type InputMode = 'auto' | 'bytes' | 'upper_bound';
type OutputMode = 'strict' | 'clamp' | 'optimistic';

/** How tokens are estimated before a request runs, and the limit store's lease and timeout. */
export interface EstimationValues {
  input: InputMode;
  bytesPerToken: string;
  imageTokens: string;
  audioTokens: string;
  videoTokens: string;
  output: OutputMode;
  defaultMaxOutput: string;
  /** Empty: none (only `strict` allows it). */
  outputCap: string;
  ceiling: string;
  leaseTtl: string;
  storeTimeout: string;
}

export interface LimitsShape {
  estimation?: {
    input?: InputMode;
    bytes_per_token?: string;
    image_tokens_default?: number;
    audio_tokens_default?: number;
    video_tokens_default?: number;
    output?: OutputMode;
    default_max_output_tokens?: number;
    output_cap?: number | null;
    max_output_tokens_ceiling?: number;
  };
  lease_ttl?: string;
  store?: { timeout?: string };
}

export function estimationValues(spec: LimitsShape): EstimationValues {
  const e = spec.estimation;
  return {
    input: e?.input ?? ED.input,
    bytesPerToken: e?.bytes_per_token ?? ED.bytes_per_token,
    imageTokens: String(e?.image_tokens_default ?? ED.image_tokens_default),
    audioTokens: String(e?.audio_tokens_default ?? ED.audio_tokens_default),
    videoTokens: String(e?.video_tokens_default ?? ED.video_tokens_default),
    output: e?.output ?? ED.output,
    defaultMaxOutput: String(e?.default_max_output_tokens ?? ED.default_max_output_tokens),
    outputCap: e?.output_cap ? String(e.output_cap) : '',
    ceiling: String(e?.max_output_tokens_ceiling ?? ED.max_output_tokens_ceiling),
    leaseTtl: spec.lease_ttl ?? SETTINGS_DEFAULTS.limits.lease_ttl,
    storeTimeout: spec.store?.timeout ?? SETTINGS_DEFAULTS.limits.store.timeout,
  };
}

export const estimationSpec = (v: EstimationValues) => ({
  estimation: {
    input: v.input,
    bytes_per_token: v.bytesPerToken.trim(),
    image_tokens_default: Number(v.imageTokens),
    audio_tokens_default: Number(v.audioTokens),
    video_tokens_default: Number(v.videoTokens),
    output: v.output,
    default_max_output_tokens: Number(v.defaultMaxOutput),
    output_cap: v.outputCap.trim() ? Number(v.outputCap) : null,
    max_output_tokens_ceiling: Number(v.ceiling),
  },
  lease_ttl: v.leaseTtl,
  store: { timeout: v.storeTimeout },
});

export function checkEstimation(v: EstimationValues): FieldErrors {
  const e: FieldErrors = {};
  if (!/^[0-9]+(\.[0-9]{1,12})?$/.test(v.bytesPerToken.trim()) || Number(v.bytesPerToken) <= 0)
    e.bytesPerToken = 'A number above 0, such as 3.0';
  for (const k of ['imageTokens', 'audioTokens', 'videoTokens'] as const) {
    const r = rangeError(v[k], 0);
    if (r) e[k] = r;
  }
  const max = rangeError(v.defaultMaxOutput, 1);
  if (max) e.defaultMaxOutput = max;
  const ceiling = rangeError(v.ceiling, 1);
  if (ceiling) e.ceiling = ceiling;
  if (v.output !== 'strict' && !v.outputCap.trim()) e.outputCap = 'Set a cap: this way of counting needs one';
  else if (v.outputCap.trim()) {
    const cap = rangeError(v.outputCap, 1);
    if (cap) e.outputCap = cap;
  }
  return e;
}

/** Server paths of these fields, for the gateway's validation details. */
export const ESTIMATION_PATHS: Record<string, string> = {
  'limits.estimation.bytes_per_token': 'bytesPerToken',
  'limits.estimation.output_cap': 'outputCap',
  'limits.estimation.default_max_output_tokens': 'defaultMaxOutput',
  'limits.estimation.max_output_tokens_ceiling': 'ceiling',
  'limits.lease_ttl': 'leaseTtl',
  'limits.store.timeout': 'storeTimeout',
};

/**
 * Token estimation and the limit store's timings, in the Rate limiting card's Advanced section:
 * a token limit is charged before the answer exists, from these estimates.
 */
export function EstimationFields({
  values,
  set,
  errors,
  disabled,
}: {
  values: EstimationValues;
  set: (patch: Partial<EstimationValues>) => void;
  errors: FieldErrors;
  disabled: boolean;
}) {
  return (
    <Advanced label="Token estimates and the limit store">
      <p className="text-caption text-muted">
        A token limit is charged when a request starts, from these estimates, and corrected when the answer is
        done.
      </p>
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field label="Count prompt tokens" error={errors.input}>
          <Select
            value={values.input}
            disabled={disabled}
            onChange={(v) => set({ input: v as InputMode })}
            options={[
              { value: 'auto', label: "With the Model's tokenizer when known" },
              { value: 'bytes', label: 'From the size of the prompt' },
              { value: 'upper_bound', label: 'One per byte, the most it could be' },
            ]}
          />
        </Field>
        <Field label="Bytes per token" error={errors.bytesPerToken} hint="When counting from the size.">
          <Input
            mono
            inputMode="decimal"
            value={values.bytesPerToken}
            disabled={disabled}
            onChange={(e) => set({ bytesPerToken: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
        <Field label="Tokens per image" error={errors.imageTokens}>
          <NumberInput
            value={values.imageTokens}
            min={0}
            disabled={disabled}
            onChange={(v) => set({ imageTokens: v })}
          />
        </Field>
        <Field label="Tokens per audio clip" error={errors.audioTokens}>
          <NumberInput
            value={values.audioTokens}
            min={0}
            disabled={disabled}
            onChange={(v) => set({ audioTokens: v })}
          />
        </Field>
        <Field label="Tokens per video" error={errors.videoTokens}>
          <NumberInput
            value={values.videoTokens}
            min={0}
            disabled={disabled}
            onChange={(v) => set({ videoTokens: v })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        <Field label="Count answer tokens" error={errors.output}>
          <Select
            value={values.output}
            disabled={disabled}
            onChange={(v) => set({ output: v as OutputMode })}
            options={[
              { value: 'strict', label: 'The most the answer may use' },
              { value: 'clamp', label: 'Up to the cap, and cap the answer too' },
              { value: 'optimistic', label: 'Up to the cap, without capping the answer' },
            ]}
          />
        </Field>
        <Field
          label="Cap"
          optional={values.output === 'strict'}
          error={errors.outputCap}
          hint="Answer tokens charged at most when a request starts."
        >
          <NumberInput
            value={values.outputCap}
            min={1}
            disabled={disabled}
            placeholder={values.output === 'strict' ? 'None' : ''}
            onChange={(v) => set({ outputCap: v })}
          />
        </Field>
        <Field
          label="When the app sets no maximum, assume"
          error={errors.defaultMaxOutput}
          hint="When neither the app nor the catalog gives a maximum."
        >
          <NumberInput
            value={values.defaultMaxOutput}
            min={1}
            disabled={disabled}
            onChange={(v) => set({ defaultMaxOutput: v })}
          />
        </Field>
        <Field
          label="Largest maximum an app may ask for"
          error={errors.ceiling}
          hint="Answer tokens; a request asking for more is refused."
        >
          <NumberInput
            value={values.ceiling}
            min={1}
            disabled={disabled}
            onChange={(v) => set({ ceiling: v })}
          />
        </Field>
        <Field
          label="Hold a request's charge for up to"
          error={errors.leaseTtl}
          hint="A node that stops mid-request releases it after this."
        >
          <Select
            value={values.leaseTtl}
            disabled={disabled}
            onChange={(v) => set({ leaseTtl: v })}
            options={durationOptions(['5s', '30s', '60s', '5m', '15m'], values.leaseTtl)}
          />
        </Field>
        <Field
          label="Wait for the limit store up to"
          error={errors.storeTimeout}
          hint="Then it counts as down."
        >
          <Select
            value={values.storeTimeout}
            disabled={disabled}
            onChange={(v) => set({ storeTimeout: v })}
            options={durationOptions(['50ms', '100ms', '250ms', '500ms', '1s'], values.storeTimeout)}
          />
        </Field>
      </div>
    </Advanced>
  );
}
