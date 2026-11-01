import type { DeploymentSpec } from '@/lib/api/types';
import type { TokenUnit } from '@/lib/format';
import type { FieldErrors } from '@/lib/validation';

import { headerErrors, headerMap, type HeaderRow, headerRows } from '@/features/mcp/fields';

import { fromPerMillion, toPerMillion } from './catalog';

/**
 * The deployment editor's form: every field of a deployment a person sets, read from its spec and
 * written back over it. A group of fields left as it was keeps the spec's members exactly as
 * written (values, types and members the form doesn't show), so saving an untouched form sends the
 * same spec back.
 */

export type TriState = 'inherit' | 'yes' | 'no';
export type LimitUnit = 'requests' | 'tokens' | 'concurrency';
export type Byok = '' | 'disabled' | 'allowed' | 'required';
export type BedrockApi = '' | 'auto' | 'converse' | 'invoke' | 'openai';
export type VertexPublisher = '' | 'google' | 'anthropic';

/** The capability switches the editor shows; any other capability is kept as written. */
export const CAPABILITY_FLAGS = [
  { name: 'streaming', label: 'Streaming' },
  { name: 'tools', label: 'Tools' },
  { name: 'vision', label: 'Images in prompts' },
  { name: 'json_schema', label: 'Structured output' },
  { name: 'reasoning', label: 'Reasoning' },
  { name: 'pdf_input', label: 'PDF input' },
  { name: 'audio_input', label: 'Audio input' },
] as const;
export type CapabilityFlag = (typeof CAPABILITY_FLAGS)[number]['name'];

export const CAPABILITY_NUMBERS = [
  { name: 'context_window', label: 'Context window' },
  { name: 'max_output_tokens', label: 'Most output tokens' },
] as const;
export type CapabilityNumber = (typeof CAPABILITY_NUMBERS)[number]['name'];

/** Price fields: per-token rates in the reader's unit, flat charges in US dollars. */
export const PRICE_FIELDS = [
  { field: 'input', label: 'Input', perToken: true, main: true },
  { field: 'output', label: 'Output', perToken: true, main: true },
  { field: 'cache_read', label: 'Cached input', perToken: true, main: true },
  { field: 'cache_write_5m', label: 'Cache write, 5 min', perToken: true, main: false },
  { field: 'cache_write_1h', label: 'Cache write, 1 h', perToken: true, main: false },
  { field: 'reasoning', label: 'Reasoning output', perToken: true, main: false },
  { field: 'input_audio', label: 'Audio input', perToken: true, main: false },
  { field: 'input_image', label: 'Image input', perToken: true, main: false },
  { field: 'input_video', label: 'Video input', perToken: true, main: false },
  { field: 'output_audio', label: 'Audio output', perToken: true, main: false },
  { field: 'output_image', label: 'Image output', perToken: true, main: false },
  { field: 'per_request', label: 'Per request', perToken: false, main: false },
  { field: 'per_page', label: 'Per page', perToken: false, main: false },
  { field: 'per_audio_second_in', label: 'Per second of audio in', perToken: false, main: false },
  { field: 'per_1k_characters_in', label: 'Per 1K characters in', perToken: false, main: false },
  { field: 'per_web_search', label: 'Per web search', perToken: false, main: false },
] as const;
export type PriceField = (typeof PRICE_FIELDS)[number]['field'];

export interface LimitRow {
  /** The name the limit had when the form opened; empty for a row added here. */
  original: string;
  name: string;
  unit: LimitUnit;
  limit: string;
  per: string;
  burst: string;
}

export interface DeploymentValues {
  name: string;
  provider: string;
  model: string;
  baseModel: string;
  enabled: boolean;
  region: string;
  location: string;
  vertexPublisher: VertexPublisher;
  bedrockApi: BedrockApi;
  defaultMaxTokens: string;
  byok: Byok;
  headers: HeaderRow[];
  paramsRemove: string[];
  paramsDefaults: string;
  paramsOverrides: string;
  flags: Record<CapabilityFlag, TriState>;
  numbers: Record<CapabilityNumber, string>;
  limits: LimitRow[];
  price: Record<PriceField, string>;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function jsonText(value: unknown): string {
  return isRecord(value) && Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : '';
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The form for a deployment's spec (or an empty one to create). */
export function fromDeploymentSpec(
  spec: DeploymentSpec | null,
  unit: TokenUnit,
  name = '',
): DeploymentValues {
  const s = (spec ?? {}) as DeploymentSpec & Json;
  const caps = (isRecord(s.capabilities) ? s.capabilities : {}) as Json;
  const params = (isRecord(s.params) ? s.params : {}) as Json;
  const price = (isRecord(s.price) ? s.price : {}) as Json;
  const limits = (isRecord(s.limits) ? s.limits : {}) as Record<string, Json>;
  const flag = (v: unknown): TriState => (v === true ? 'yes' : v === false ? 'no' : 'inherit');
  return {
    name,
    provider: text(s.provider),
    model: text(s.model),
    baseModel: s.base_model ?? '',
    enabled: s.enabled !== false,
    region: s.region ?? '',
    location: s.location ?? '',
    vertexPublisher: s.vertex?.publisher ?? '',
    bedrockApi: s.bedrock?.api ?? '',
    defaultMaxTokens: text(s.default_max_tokens),
    byok: s.byok ?? '',
    headers: headerRows(s.headers),
    paramsRemove: Array.isArray(params.remove) ? (params.remove as string[]) : [],
    paramsDefaults: jsonText(params.defaults),
    paramsOverrides: jsonText(params.overrides),
    flags: Object.fromEntries(CAPABILITY_FLAGS.map((f) => [f.name, flag(caps[f.name])])) as Record<
      CapabilityFlag,
      TriState
    >,
    numbers: Object.fromEntries(CAPABILITY_NUMBERS.map((n) => [n.name, text(caps[n.name])])) as Record<
      CapabilityNumber,
      string
    >,
    limits: Object.entries(limits).map(([key, l]) => ({
      original: key,
      name: key,
      unit: (l.unit as LimitUnit | undefined) ?? 'requests',
      limit: text(l.limit),
      per: text(l.per),
      burst: text(l.burst),
    })),
    price: Object.fromEntries(
      PRICE_FIELDS.map((p) => [
        p.field,
        p.perToken ? fromPerMillion(text(price[p.field]) || null, unit) : text(price[p.field]),
      ]),
    ) as Record<PriceField, string>,
  };
}

/** Sets a member when the value is set, removes it otherwise. */
function put(target: Json, key: string, value: unknown): void {
  if (value === undefined || value === '' || value === null) Reflect.deleteProperty(target, key);
  else target[key] = value;
}

function parseObject(value: string): Json | undefined {
  if (!value.trim()) return undefined;
  const parsed: unknown = JSON.parse(value);
  return isRecord(parsed) && Object.keys(parsed).length > 0 ? parsed : undefined;
}

/**
 * Writes the form over the deployment's spec, for `PUT /deployments/{name}` (or the new spec of a
 * deployment to create, with `base` null). Each group the form left unchanged keeps the spec's
 * members as written; a changed group is rewritten from the form, keeping the members the form
 * doesn't show (a limit's partition, the price's tiers, capabilities beyond the switches).
 */
export function toDeploymentSpec(
  base: DeploymentSpec | null,
  v: DeploymentValues,
  unit: TokenUnit,
): DeploymentSpec {
  const init = fromDeploymentSpec(base, unit);
  const out: Json = structuredClone((base ?? {}) as Json);
  const changed = (key: keyof DeploymentValues) => !same(v[key], init[key]);

  if (!base || changed('provider')) out.provider = v.provider.trim();
  if (!base || changed('model')) out.model = v.model.trim();
  if (changed('baseModel')) put(out, 'base_model', v.baseModel.trim());
  if (changed('enabled')) put(out, 'enabled', v.enabled ? undefined : false);
  if (changed('region')) put(out, 'region', v.region.trim());
  if (changed('location')) put(out, 'location', v.location.trim());
  if (changed('vertexPublisher')) {
    const vertex: Json = { ...(isRecord(out.vertex) ? out.vertex : {}) };
    put(vertex, 'publisher', v.vertexPublisher);
    put(out, 'vertex', Object.keys(vertex).length > 0 ? vertex : undefined);
  }
  if (changed('bedrockApi')) {
    const bedrock: Json = { ...(isRecord(out.bedrock) ? out.bedrock : {}) };
    put(bedrock, 'api', v.bedrockApi);
    put(out, 'bedrock', Object.keys(bedrock).length > 0 ? bedrock : undefined);
  }
  if (changed('defaultMaxTokens'))
    put(out, 'default_max_tokens', v.defaultMaxTokens.trim() ? Number(v.defaultMaxTokens) : undefined);
  if (changed('byok')) put(out, 'byok', v.byok);
  if (changed('headers')) put(out, 'headers', headerMap(v.headers));

  if (changed('paramsRemove') || changed('paramsDefaults') || changed('paramsOverrides')) {
    const params: Json = { ...(isRecord(out.params) ? out.params : {}) };
    if (changed('paramsRemove'))
      put(params, 'remove', v.paramsRemove.length > 0 ? v.paramsRemove : undefined);
    if (changed('paramsDefaults')) put(params, 'defaults', parseObject(v.paramsDefaults));
    if (changed('paramsOverrides')) put(params, 'overrides', parseObject(v.paramsOverrides));
    put(out, 'params', Object.keys(params).length > 0 ? params : undefined);
  }

  if (changed('flags') || changed('numbers')) {
    const caps: Json = { ...(isRecord(out.capabilities) ? out.capabilities : {}) };
    for (const f of CAPABILITY_FLAGS) {
      if (v.flags[f.name] === init.flags[f.name]) continue;
      put(caps, f.name, v.flags[f.name] === 'inherit' ? undefined : v.flags[f.name] === 'yes');
    }
    for (const n of CAPABILITY_NUMBERS) {
      if (v.numbers[n.name] === init.numbers[n.name]) continue;
      put(caps, n.name, v.numbers[n.name].trim() ? Number(v.numbers[n.name]) : undefined);
    }
    put(out, 'capabilities', Object.keys(caps).length > 0 ? caps : undefined);
  }

  if (changed('limits')) {
    const before = (isRecord(out.limits) ? out.limits : {}) as Record<string, Json>;
    const limits: Record<string, Json> = {};
    for (const row of v.limits) {
      const name = row.name.trim();
      if (!name) continue;
      const kept: Json = { ...(row.original ? (before[row.original] ?? {}) : {}) };
      const initRow = init.limits.find((r) => r.original === row.original && row.original !== '');
      if (initRow && same({ ...initRow, name: row.name }, row)) {
        limits[name] = kept;
        continue;
      }
      kept.unit = row.unit;
      kept.limit = Number(row.limit);
      put(kept, 'per', row.unit === 'concurrency' ? undefined : row.per.trim());
      put(kept, 'burst', row.burst.trim() ? Number(row.burst) : undefined);
      if (row.unit !== 'tokens') {
        Reflect.deleteProperty(kept, 'tokens');
        Reflect.deleteProperty(kept, 'weights');
      }
      if (row.unit !== 'requests') Reflect.deleteProperty(kept, 'count');
      limits[name] = kept;
    }
    put(out, 'limits', Object.keys(limits).length > 0 ? limits : undefined);
  }

  if (changed('price')) {
    const price: Json = { ...(isRecord(out.price) ? out.price : {}) };
    for (const p of PRICE_FIELDS) {
      if (v.price[p.field] === init.price[p.field]) continue;
      const typed = v.price[p.field].trim();
      put(price, p.field, p.perToken ? toPerMillion(typed, unit) : typed);
    }
    put(out, 'price', Object.keys(price).length > 0 ? price : undefined);
  }

  return out as DeploymentSpec;
}

const LIMIT_NAME = /^[a-z0-9_]{1,64}$/;
const DURATION = /^[0-9]+(ms|s|m|h|d)$/;
const AMOUNT = /^\d+(\.\d{1,9})?$/;
const POINTER = /^\/(?!(model|stream)(\/|$))/;

function pointerError(pointer: string): string | undefined {
  if (!POINTER.test(pointer)) return `${pointer || '(empty)'}: start with / and leave out /model and /stream`;
  if (/\/-(\/|$)/.test(pointer)) return `${pointer}: the - position can't be used`;
  return undefined;
}

function objectError(value: string): string | undefined {
  if (!value.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return 'Enter a JSON object, e.g. {"/temperature": 0.2}';
  }
  if (!isRecord(parsed)) return 'Enter a JSON object, e.g. {"/temperature": 0.2}';
  for (const key of Object.keys(parsed)) {
    const e = pointerError(key);
    if (e) return e;
  }
  return undefined;
}

function wholeNumber(value: string, min: number, max = Number.MAX_SAFE_INTEGER): boolean {
  return /^\d+$/.test(value.trim()) && Number(value) >= min && Number(value) <= max;
}

/** What is wrong with the form, by field (`limits.0.per`, `price.input`); empty when it can be saved. */
export function deploymentErrors(v: DeploymentValues, create: boolean, taken: string[] = []): FieldErrors {
  const e: FieldErrors = {};
  if (create) {
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(v.name.trim()))
      e.name = 'Lowercase letters, digits, - and _, up to 63 characters';
    else if (taken.includes(v.name.trim())) e.name = 'A deployment already has this name';
    if (!v.provider) e.provider = 'Select a provider';
  }
  if (!v.model.trim()) e.model = 'Enter the model ID the provider uses, e.g. gpt-4o-mini';
  if (v.defaultMaxTokens.trim() && !wholeNumber(v.defaultMaxTokens, 1, 10_000_000))
    e.defaultMaxTokens = 'A whole number from 1 to 10,000,000';
  const headers = headerErrors(v.headers);
  if (headers) e.headers = headers;
  for (const p of v.paramsRemove) {
    const err = pointerError(p);
    if (err) {
      e.paramsRemove = err;
      break;
    }
  }
  const defaults = objectError(v.paramsDefaults);
  if (defaults) e.paramsDefaults = defaults;
  const overrides = objectError(v.paramsOverrides);
  if (overrides) e.paramsOverrides = overrides;
  for (const n of CAPABILITY_NUMBERS)
    if (v.numbers[n.name].trim() && !wholeNumber(v.numbers[n.name], 1))
      e[`numbers.${n.name}`] = 'A whole number of tokens, or empty for the provider’s value';
  const names = new Set<string>();
  v.limits.forEach((row, i) => {
    const name = row.name.trim();
    if (!LIMIT_NAME.test(name) || name === 'locked' || name === 'request_overridable')
      e[`limits.${i}.name`] = 'Lowercase letters, digits and _';
    else if (names.has(name)) e[`limits.${i}.name`] = 'Two limits have this name';
    names.add(name);
    if (!wholeNumber(row.limit, 0)) e[`limits.${i}.limit`] = 'A whole number; 0 refuses every request';
    if (row.unit !== 'concurrency' && !DURATION.test(row.per.trim()))
      e[`limits.${i}.per`] = 'A duration such as 1s, 1m or 1h';
    if (row.burst.trim() && !wholeNumber(row.burst, 1)) e[`limits.${i}.burst`] = 'A whole number above 0';
  });
  for (const p of PRICE_FIELDS)
    if (v.price[p.field].trim() && !AMOUNT.test(v.price[p.field].trim()))
      e[`price.${p.field}`] = 'An amount in US dollars, e.g. 2.50';
  return e;
}

/** The number of capabilities set in the spec that the editor doesn't show (kept on save). */
export function otherCapabilities(spec: DeploymentSpec | null): number {
  const caps = spec?.capabilities;
  if (!isRecord(caps)) return 0;
  const shown = new Set<string>([
    ...CAPABILITY_FLAGS.map((f) => f.name),
    ...CAPABILITY_NUMBERS.map((n) => n.name),
  ]);
  return Object.keys(caps).filter((k) => !shown.has(k)).length;
}
