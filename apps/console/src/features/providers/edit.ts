import { mergePatch, NAME_RE } from '@/features/settings/form-errors';
import type { ProviderResource } from '@/lib/api/types';
import type { FieldErrors } from '@/lib/validation';

import type { ProviderSpec } from './api';
import { specWithKey } from './form';
import { SINGLE_KEY } from './keys';

/** A key as the drawer edits it: a saved one (its secret stays on the gateway) or a new one. */
export interface KeyDraft {
  /** A stable id for the list, since the name can change. */
  id: string;
  name: string;
  /** Its name when the drawer opened; null for a key added here. */
  saved: string | null;
  weight: string;
  /** The new key's secret; saved keys keep theirs. */
  secret: string;
}

export interface HeaderDraft {
  name: string;
  value: string;
}

export interface SettingsDraft {
  accountTier: string;
  rotationMaxAge: string;
  baseUrl: string;
  headers: HeaderDraft[];
  /** `params` as JSON text. */
  params: string;
  openaiOrganization: string;
  openaiProject: string;
  azureApiStyle: 'v1' | 'deployments';
  azureApiVersion: string;
  anthropicVersion: string;
  awsRegion: string;
  gcpProject: string;
  gcpLocation: string;
  geminiApiVersion: '' | 'v1beta' | 'v1';
}

export interface ProviderDraft {
  /** The API keys, or null when the provider signs in another way. */
  keys: KeyDraft[] | null;
  /** Whether the provider had one `auth.api_key` when the drawer opened. */
  single: boolean;
  settings: SettingsDraft;
}

/** Which type-specific blocks a type accepts. */
export const TYPE_BLOCKS = {
  openai: (t: string) => t === 'openai',
  azure: (t: string) => t === 'azure_openai',
  anthropic: (t: string) => t === 'anthropic' || t === 'bedrock' || t === 'vertex',
  aws: (t: string) => t === 'bedrock',
  gcp: (t: string) => t === 'vertex',
  gemini: (t: string) => t === 'gemini',
};

/** Types whose API has no default address. */
export const NEEDS_BASE_URL = ['azure_openai', 'openai_compatible', 'anthropic_compatible'];

/** "Warn when a key is older than …": the choices, with any other stored value kept. */
export const ROTATION_CHOICES = [
  { value: '', label: 'Never warn' },
  { value: '30d', label: '30 days' },
  { value: '60d', label: '60 days' },
  { value: '90d', label: '90 days' },
  { value: '180d', label: '180 days' },
  { value: '365d', label: '1 year' },
];

let nextId = 0;
const newId = () => {
  nextId += 1;
  return `k${String(nextId)}`;
};

/** The keys a provider signs in with: its named keys, or its one key as `default`. */
function keysOf(spec: ProviderSpec): { keys: KeyDraft[] | null; single: boolean } {
  const auth = spec.auth;
  if (auth?.api_keys && auth.api_keys.length > 0)
    return {
      single: false,
      keys: auth.api_keys.map((k) => ({
        id: newId(),
        name: k.name,
        saved: k.name,
        weight: String(k.weight ?? 1),
        secret: '',
      })),
    };
  if (auth?.api_key)
    return {
      single: true,
      keys: [{ id: newId(), name: SINGLE_KEY, saved: SINGLE_KEY, weight: '1', secret: '' }],
    };
  return { single: false, keys: null };
}

export function fromProvider(p: ProviderResource): ProviderDraft {
  const s = p.spec;
  return {
    ...keysOf(s),
    settings: {
      accountTier: s.account_tier ?? '',
      rotationMaxAge: s.credential_rotation_max_age ?? '',
      baseUrl: s.base_url ?? '',
      headers: Object.entries(s.headers ?? {}).map(([name, value]) => ({ name, value })),
      params: s.params && Object.keys(s.params).length > 0 ? JSON.stringify(s.params, null, 2) : '',
      openaiOrganization: s.openai?.organization ?? '',
      openaiProject: s.openai?.project ?? '',
      azureApiStyle: s.azure?.api_style ?? 'v1',
      azureApiVersion: s.azure?.api_version ?? '',
      anthropicVersion: s.anthropic?.version ?? '',
      awsRegion: s.aws?.region ?? '',
      gcpProject: s.gcp?.project ?? '',
      gcpLocation: s.gcp?.location ?? '',
      geminiApiVersion: s.gemini?.api_version ?? '',
    },
  };
}

/** A new key's draft, with a free name ("key-2", "key-3"…). */
export function newKey(keys: KeyDraft[]): KeyDraft {
  const taken = new Set(keys.map((k) => k.name));
  let i = keys.length + 1;
  while (taken.has(`key-${String(i)}`)) i += 1;
  return { id: newId(), name: `key-${String(i)}`, saved: null, weight: '1', secret: '' };
}

/** Each key's share of requests from the weights, as a fraction (0 when every weight is 0). */
export function shares(keys: KeyDraft[]): Map<string, number> {
  const weights = keys.map((k) => Math.max(0, Number(k.weight) || 0));
  const total = weights.reduce((a, b) => a + b, 0);
  return new Map(keys.map((k, i) => [k.id, total > 0 ? (weights[i] ?? 0) / total : 0]));
}

const trimmed = (v: string) => v.trim();

/** The settings members of a spec the drawer edits, as the draft says they should be. */
function settingsSpec(type: string, before: ProviderSpec, d: SettingsDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== '' && value !== undefined) out[key] = value;
  };
  put('account_tier', trimmed(d.accountTier));
  put('credential_rotation_max_age', trimmed(d.rotationMaxAge));
  put('base_url', trimmed(d.baseUrl));
  const headers = Object.fromEntries(
    d.headers.filter((h) => h.name.trim() !== '').map((h) => [h.name.trim(), h.value]),
  );
  if (Object.keys(headers).length > 0) out.headers = headers;
  if (d.params.trim() !== '') out.params = JSON.parse(d.params) as unknown;
  const block = (key: string, value: Record<string, unknown>) => {
    const kept = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== '' && v !== undefined));
    if (Object.keys(kept).length > 0) out[key] = kept;
  };
  if (TYPE_BLOCKS.openai(type))
    block('openai', { organization: trimmed(d.openaiOrganization), project: trimmed(d.openaiProject) });
  if (TYPE_BLOCKS.azure(type))
    block('azure', {
      api_style: d.azureApiStyle === 'v1' && !before.azure?.api_style ? '' : d.azureApiStyle,
      api_version: d.azureApiStyle === 'deployments' ? trimmed(d.azureApiVersion) : '',
    });
  if (TYPE_BLOCKS.anthropic(type))
    block('anthropic', { ...before.anthropic, version: trimmed(d.anthropicVersion) });
  if (TYPE_BLOCKS.aws(type)) block('aws', { region: trimmed(d.awsRegion) });
  if (TYPE_BLOCKS.gcp(type))
    block('gcp', { ...before.gcp, project: trimmed(d.gcpProject), location: trimmed(d.gcpLocation) });
  if (TYPE_BLOCKS.gemini(type)) block('gemini', { api_version: d.geminiApiVersion });
  return out;
}

const SETTINGS_KEYS = [
  'account_tier',
  'credential_rotation_max_age',
  'base_url',
  'headers',
  'params',
  'openai',
  'azure',
  'anthropic',
  'aws',
  'gcp',
  'gemini',
] as const;

/** Whether the keys differ from what was saved (added, removed, renamed or reweighted). */
export function keysChanged(p: ProviderResource, draft: ProviderDraft): boolean {
  const saved = keysOf(p.spec).keys;
  if (!saved || !draft.keys) return false;
  if (saved.length !== draft.keys.length) return true;
  return draft.keys.some((k, i) => {
    const s = saved[i];
    return k.saved !== s?.saved || k.name.trim() !== s.name || Number(k.weight) !== Number(s.weight);
  });
}

/**
 * The merge patch of the provider's spec for the draft: the settings that changed, and the keys
 * as a whole list when they changed (saved keys written back as `[REDACTED]`, which keeps each
 * key's stored secret; new keys with theirs, after the saved ones). One key becomes a list when a
 * second is added.
 */
export function toPatch(p: ProviderResource, draft: ProviderDraft): Record<string, unknown> {
  const before = Object.fromEntries(
    SETTINGS_KEYS.filter((k) => p.spec[k] !== undefined).map((k) => [k, p.spec[k]]),
  );
  const patch = mergePatch(before, settingsSpec(p.spec.type, p.spec, draft.settings));
  if (draft.keys && keysChanged(p, draft)) {
    const list = draft.keys.map((k) => ({
      name: k.name.trim(),
      key: k.saved === null ? k.secret.trim() : '[REDACTED]',
      weight: Number(k.weight),
    }));
    patch.auth = { ...(draft.single ? { api_key: null } : {}), api_keys: list };
  }
  return patch;
}

/** The provider as edited, with its saved sign-in (secrets as the gateway shows them, `[REDACTED]`). */
export function editedSpec(p: ProviderResource, draft: ProviderDraft): ProviderSpec {
  const settings = (() => {
    try {
      return settingsSpec(p.spec.type, p.spec, draft.settings);
    } catch {
      return {};
    }
  })();
  const base = Object.fromEntries(
    Object.entries(p.spec).filter(([k]) => !(SETTINGS_KEYS as readonly string[]).includes(k)),
  );
  return { ...(base as ProviderSpec), ...(settings as Partial<ProviderSpec>) };
}

/** What a key's test sends: the provider as edited, with that key alone. */
export function keyTestSpec(p: ProviderResource, draft: ProviderDraft, secret: string): ProviderSpec {
  return specWithKey(editedSpec(p, draft), secret);
}

/** The settings that change how the gateway reaches the provider (not the tier or the age warning). */
const CONNECTION_KEYS = SETTINGS_KEYS.filter(
  (k) => k !== 'account_tier' && k !== 'credential_rotation_max_age',
);

/** Whether the draft changes how the gateway reaches the provider: address, headers, parameters, type blocks. */
export function connectionChanged(p: ProviderResource, draft: ProviderDraft): boolean {
  const after = editedSpec(p, draft) as Record<string, unknown>;
  const before = p.spec as Record<string, unknown>;
  return CONNECTION_KEYS.some((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
}

/** Whether the base URL changed: the gateway then won't send a saved secret to the new address. */
export function baseUrlChanged(p: ProviderResource, draft: ProviderDraft): boolean {
  return draft.settings.baseUrl.trim() !== (p.spec.base_url ?? '');
}

/** The draft's errors, by field: `keys.<id>.name`, `keys.<id>.weight`, `keys.<id>.secret`, settings by name. */
export function draftErrors(type: string, draft: ProviderDraft): FieldErrors {
  const errors: FieldErrors = {};
  const keys = draft.keys ?? [];
  const names = keys.map((k) => k.name.trim());
  for (const k of keys) {
    const name = k.name.trim();
    if (!NAME_RE.test(name)) errors[`keys.${k.id}.name`] = 'Use letters, digits, . _ and - only';
    else if (names.filter((n) => n === name).length > 1)
      errors[`keys.${k.id}.name`] = 'Another key has this name';
    if (!/^\d+$/.test(k.weight.trim())) errors[`keys.${k.id}.weight`] = 'Enter a whole number, 0 or more';
    if (k.saved === null && k.secret.trim() === '') errors[`keys.${k.id}.secret`] = 'Paste the API key';
  }
  if (keys.length > 0 && keys.every((k) => (Number(k.weight) || 0) === 0))
    errors.keys = 'Give at least one key a weight above 0, or no request can use them.';
  const s = draft.settings;
  if (NEEDS_BASE_URL.includes(type) && s.baseUrl.trim() === '')
    errors.baseUrl = 'Enter the address of the provider’s API';
  else if (s.baseUrl.trim() !== '' && !/^https?:\/\/[^\s/?#]+/i.test(s.baseUrl.trim()))
    errors.baseUrl = 'Enter a URL that starts with https:// or http://';
  if (s.rotationMaxAge.trim() !== '' && !/^[0-9]+(\.[0-9]+)?(ms|s|m|h|d)$/.test(s.rotationMaxAge.trim()))
    errors.rotationMaxAge = 'Enter a duration such as 90d';
  if (s.accountTier.length > 64) errors.accountTier = 'Use at most 64 characters';
  if (s.params.trim() !== '') {
    try {
      const v = JSON.parse(s.params) as unknown;
      if (typeof v !== 'object' || v === null || Array.isArray(v)) errors.params = 'Enter a JSON object';
    } catch {
      errors.params = 'Enter valid JSON';
    }
  }
  s.headers.forEach((h, i) => {
    if (h.name.trim() === '' && h.value !== '') errors[`headers.${String(i)}`] = 'Name the header';
  });
  if (TYPE_BLOCKS.azure(type) && s.azureApiStyle === 'deployments' && s.azureApiVersion.trim() === '')
    errors.azureApiVersion = 'Enter the API version, e.g. 2024-10-21';
  if (TYPE_BLOCKS.aws(type) && s.awsRegion.trim() === '')
    errors.awsRegion = 'Enter the AWS region, e.g. us-east-1';
  if (TYPE_BLOCKS.gcp(type) && s.gcpProject.trim() === '')
    errors.gcpProject = 'Enter the Google Cloud project ID';
  return errors;
}

/** The last characters of each saved key, by name, as the gateway shows them. */
export function keyHints(p: ProviderResource): Map<string, string> {
  const hints = (p.metadata.secret_hints ?? {}) as Record<string, string>;
  const out = new Map<string, string>();
  const keys = p.spec.auth?.api_keys;
  if (keys)
    keys.forEach((k, i) => {
      const h = hints[`auth.api_keys[${String(i)}].key`];
      if (h) out.set(k.name, h);
    });
  else if (hints['auth.api_key']) out.set(SINGLE_KEY, hints['auth.api_key']);
  return out;
}

/**
 * Saved keys whose secret looks different after a save that only renamed, reweighted, added or
 * removed keys: the gateway kept another key's secret for them.
 */
export function mixedUpKeys(
  before: ProviderResource,
  after: ProviderResource,
  draft: ProviderDraft,
): string[] {
  const was = keyHints(before);
  const now = keyHints(after);
  return (draft.keys ?? [])
    .filter((k) => k.saved !== null)
    .filter((k) => {
      const a = was.get(k.saved ?? '');
      const b = now.get(k.name.trim());
      return a !== undefined && b !== undefined && a !== b;
    })
    .map((k) => k.name.trim());
}
