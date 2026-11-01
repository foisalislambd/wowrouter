import { z } from 'zod';

import type { KeySpec } from '@/lib/api/types';
import { resourceName } from '@/lib/validation';

import {
  accessFrom,
  accessShape,
  accessSpec,
  type AccessValues,
  EMPTY_ACCESS,
  EMPTY_LABELS,
  labelsFrom,
  labelsShape,
  labelsSpec,
  type LabelValues,
} from './access';
import { KEY_PERMISSIONS } from './types';

export type ExpiryChoice = 'never' | '7d' | '30d' | '90d' | '365d' | 'custom';

/** How a key is bound to a client certificate: not at all, by the certificate's SHA-256, or by a name in it. */
export type CertBinding = 'none' | 'fingerprint' | 'san';

/** How requests prove they hold the key: a secret the gateway issues, or a signed token (JWT). */
export type KeyKind = 'secret' | 'jwt';

export interface KeyFormValues extends AccessValues, LabelValues {
  name: string;
  /** Chosen when the key is created; it can't change afterwards. */
  kind: KeyKind;
  description: string;
  project: string;
  owner: string;
  expiry: ExpiryChoice;
  expiresOn: string;
  permissions: string[];
  /** `allowed_request_tags`: the tags a request may add (patterns); empty for any. */
  requestTags: string[];
  /** `end_user`: `required` refuses a request that names no end user; empty is the default. */
  endUser: '' | 'optional' | 'required';
  /** The class a limit's priority shares give this key's requests. */
  priorityClass: string;
  /** The client certificate a request with this key must present over mutual TLS. */
  certBinding: CertBinding;
  /** The fingerprint or the subject alternative name the binding matches. */
  certValue: string;
  rpm: string;
  tpm: string;
}

export const EMPTY_KEY_FORM: KeyFormValues = {
  name: '',
  kind: 'secret',
  description: '',
  project: 'default',
  owner: '',
  expiry: '90d',
  expiresOn: '',
  ...EMPTY_ACCESS,
  ...EMPTY_LABELS,
  permissions: [],
  requestTags: [],
  endUser: '',
  priorityClass: '',
  certBinding: 'none',
  certValue: '',
  rpm: '',
  tpm: '',
};

const FINGERPRINT = /^([0-9A-Fa-f]{64}|([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2})$/;

const optionalCount = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d+$/.test(v), 'Enter a whole number, or leave it blank for no limit');

export const keyFormSchema = z
  .object({
    name: resourceName,
    kind: z.enum(['secret', 'jwt']),
    description: z.string().max(500, 'At most 500 characters'),
    project: resourceName,
    owner: z.string(),
    expiry: z.enum(['never', '7d', '30d', '90d', '365d', 'custom']),
    expiresOn: z.string(),
    ...accessShape,
    ...labelsShape,
    permissions: z.array(z.enum(KEY_PERMISSIONS.map((p) => p.id) as [string, ...string[]])),
    requestTags: z
      .array(z.string())
      .refine(
        (l) => l.every((t) => /^[A-Za-z0-9:_.-]*\*?[A-Za-z0-9:_.-]*$/.test(t) && t !== ''),
        'Tags with at most one *, e.g. env:*',
      ),
    endUser: z.enum(['', 'optional', 'required']),
    priorityClass: z
      .string()
      .trim()
      .refine((v) => v === '' || /^[a-z0-9_]{1,64}$/.test(v), 'Lowercase letters, digits and _, up to 64'),
    certBinding: z.enum(['none', 'fingerprint', 'san']),
    certValue: z.string(),
    rpm: optionalCount,
    tpm: optionalCount,
  })
  .refine((v) => v.certBinding !== 'fingerprint' || FINGERPRINT.test(v.certValue.trim()), {
    message: 'Enter the SHA-256 fingerprint: 64 hexadecimal digits, with or without colons',
    path: ['certValue'],
  })
  .refine(
    (v) => v.certBinding !== 'san' || (v.certValue.trim() !== '' && v.certValue.trim().length <= 1024),
    {
      message: 'Enter the name the certificate carries, e.g. spiffe://acme.test/billing',
      path: ['certValue'],
    },
  )
  .refine(
    (v) => v.expiry !== 'custom' || (v.expiresOn !== '' && new Date(v.expiresOn).getTime() > Date.now()),
    {
      message: 'Choose a date in the future',
      path: ['expiresOn'],
    },
  );

const DAYS: Record<Exclude<ExpiryChoice, 'never' | 'custom'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '365d': 365,
};

function expiresAt(values: KeyFormValues, now: number): string | undefined {
  if (values.expiry === 'never') return undefined;
  if (values.expiry === 'custom')
    return new Date(`${values.expiresOn}T23:59:59Z`).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return new Date(now + DAYS[values.expiry] * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The key spec the form describes, written over `base` so fields the form does not show (tags,
 * metadata, regions, other limits) survive an edit unchanged.
 */
export function toKeySpec(
  values: KeyFormValues,
  base: KeySpec = {},
  now = Date.now(),
  keepExpiry = false,
): KeySpec {
  const declared = (base.policies?.limits ?? {}) as Record<string, unknown>;
  const limits: Record<string, unknown> = { ...declared };
  limits.rpm = values.rpm.trim() ? withLimit(declared.rpm, 'requests', values.rpm) : undefined;
  limits.tpm = values.tpm.trim() ? withLimit(declared.tpm, 'tokens', values.tpm) : undefined;
  const policies: Record<string, unknown> = { ...(base.policies ?? {}), limits: compact(limits) };
  const spec: Record<string, unknown> = {
    ...base,
    project: values.project,
    // The kind is fixed at creation; a secret key states none (its default).
    kind: values.kind === 'jwt' ? 'jwt' : base.kind,
    description: values.description.trim() || undefined,
    owner: values.owner || undefined,
    expires_at: keepExpiry ? base.expires_at : expiresAt(values, now),
    ...accessSpec(values, base),
    ...labelsSpec(values),
    permissions: values.permissions,
    allowed_request_tags: values.requestTags.length > 0 ? values.requestTags : undefined,
    end_user: values.endUser || undefined,
    priority_class: values.priorityClass.trim() || undefined,
    require_client_cert: clientCert(values),
    policies: compact(policies),
  };
  return compact(spec) as KeySpec;
}

/**
 * A limit with the form's number: the declared limit with only `limit` changed (its window, burst,
 * match and the rest stay as written), or a new one per minute.
 */
function withLimit(declared: unknown, unit: 'requests' | 'tokens', limit: string): Record<string, unknown> {
  if (declared && typeof declared === 'object')
    return { ...(declared as Record<string, unknown>), limit: Number(limit) };
  return { unit, limit: Number(limit), per: '1m' };
}

/** "per minute" for a limit counted per minute (or not yet declared), else its window ("per 1h"). */
export function limitWindow(declared: { per?: string } | undefined): string {
  const per = declared?.per;
  if (per === undefined || per === '1m' || per === '60s') return 'per minute';
  return `per ${per}`;
}

function clientCert(values: KeyFormValues): KeySpec['require_client_cert'] {
  const value = values.certValue.trim();
  if (values.certBinding === 'fingerprint') return { sha256_fingerprint: value };
  if (values.certBinding === 'san') return { san: value };
  return undefined;
}

/** Drops undefined values, empty arrays and empty objects, so the spec states only what is set. */
function compact<T extends Record<string, unknown>>(record: T): T | undefined {
  const entries = Object.entries(record).filter(([, v]) => {
    if (v === undefined) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (v !== null && typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  });
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

/** The form values for an existing key. */
export function fromKeySpec(name: string, spec: KeySpec): KeyFormValues {
  const limits = (spec.policies?.limits ?? {}) as Record<string, { limit?: number } | undefined>;
  return {
    name,
    kind: spec.kind === 'jwt' ? 'jwt' : 'secret',
    description: spec.description ?? '',
    project: spec.project ?? 'default',
    owner: spec.owner ?? '',
    expiry: spec.expires_at ? 'custom' : 'never',
    expiresOn: spec.expires_at ? spec.expires_at.slice(0, 10) : '',
    ...accessFrom(spec),
    ...labelsFrom(spec),
    permissions: spec.permissions ?? [],
    requestTags: spec.allowed_request_tags ?? [],
    endUser: spec.end_user ?? '',
    priorityClass: spec.priority_class ?? '',
    certBinding: spec.require_client_cert?.sha256_fingerprint
      ? 'fingerprint'
      : spec.require_client_cert?.san
        ? 'san'
        : 'none',
    certValue: spec.require_client_cert?.sha256_fingerprint ?? spec.require_client_cert?.san ?? '',
    rpm: limits.rpm?.limit !== undefined ? String(limits.rpm.limit) : '',
    tpm: limits.tpm?.limit !== undefined ? String(limits.tpm.limit) : '',
  };
}
