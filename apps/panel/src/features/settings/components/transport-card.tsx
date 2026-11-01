'use client';

import Link from 'next/link';
import { useSettingsHref } from '@/components/layout/url-sync';
import { Checkbox, Switch } from '@/components/ui/choice';
import { Field, MultiSelect, Select } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { LoadError, LoadingRows } from '@/components/ui/states';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';
import type { FieldErrors } from '@/lib/validation';

import { durationOptions } from '../choices';
import { useOrgSettings } from '../store';
import { Card, Facts } from './parts';
import { Advanced, Hint, SettingsForm } from './settings-form';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const text = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const list = (v: unknown, fallback: readonly string[]) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [...fallback];

const SD = SETTINGS_DEFAULTS.security;
type MediaKind = 'image' | 'document' | 'audio';
const MEDIA_KINDS: { key: MediaKind; label: string }[] = [
  { key: 'image', label: 'Images' },
  { key: 'document', label: 'Documents' },
  { key: 'audio', label: 'Audio' },
];

export interface TransportValues {
  hsts: boolean;
  hstsMaxAge: string;
  hstsSubdomains: boolean;
  mediaMax: string;
  mediaConnect: string;
  mediaTimeout: string;
  mediaTypes: Record<MediaKind, string[]>;
  tlsReload: string;
}

export function transportValues(spec: unknown): TransportValues {
  const s = obj(spec);
  const hsts = obj(s.hsts);
  const media = obj(s.media_fetch);
  const types = obj(media.allowed_types);
  const tls = obj(s.tls);
  return {
    hsts: typeof hsts.enabled === 'boolean' ? hsts.enabled : SD.hsts.enabled,
    hstsMaxAge: text(hsts.max_age, SD.hsts.max_age),
    hstsSubdomains:
      typeof hsts.include_subdomains === 'boolean' ? hsts.include_subdomains : SD.hsts.include_subdomains,
    mediaMax: text(media.max_bytes, SD.media_fetch.max_bytes),
    mediaConnect: text(media.connect_timeout, SD.media_fetch.connect_timeout),
    mediaTimeout: text(media.timeout, SD.media_fetch.timeout),
    mediaTypes: {
      image: list(types.image, SD.media_fetch.allowed_types.image),
      document: list(types.document, SD.media_fetch.allowed_types.document),
      audio: list(types.audio, SD.media_fetch.allowed_types.audio),
    },
    tlsReload: text(tls.reload_interval, SD.tls.reload_interval),
  };
}

export const transportSpec = (v: TransportValues) => ({
  hsts: { enabled: v.hsts, max_age: v.hstsMaxAge, include_subdomains: v.hstsSubdomains },
  media_fetch: {
    max_bytes: v.mediaMax,
    connect_timeout: v.mediaConnect,
    timeout: v.mediaTimeout,
    allowed_types: v.mediaTypes,
  },
  tls: { reload_interval: v.tlsReload },
});

const MIME_RE = /^[a-z]+\/([a-z0-9.+-]+|\*)$/;

function checkTransport(v: TransportValues): FieldErrors {
  const e: FieldErrors = {};
  for (const { key } of MEDIA_KINDS) {
    const bad = v.mediaTypes[key].find((t) => !MIME_RE.test(t));
    if (bad) e[`types.${key}`] = `"${bad}" isn't a media type such as image/png or audio/*`;
  }
  return e;
}

const sizeOptions = (values: string[], current: string) =>
  (values.includes(current) ? values : [...values, current]).map((v) => ({
    value: v,
    label: v.replace(/(\d)([KMG]?i?B)$/, '$1 $2'),
  }));

/** One TLS listener as configured, in words; null when it serves plain HTTP. */
export function listenerFacts(listener: unknown): { label: string; value: string }[] | null {
  const l = obj(listener);
  if (typeof l.cert_file !== 'string') return null;
  const auth = text(l.client_auth, 'none');
  return [
    { label: 'Certificate', value: l.cert_file },
    { label: 'Key', value: text(l.key_file, '—') },
    { label: 'Oldest TLS version', value: `TLS ${text(l.min_version, '1.2')}` },
    {
      label: 'Client certificates',
      value:
        auth === 'required'
          ? `Required, checked against ${text(l.client_ca_file, 'the system roots')}`
          : auth === 'optional'
            ? `Checked when sent, against ${text(l.client_ca_file, 'the system roots')}`
            : 'Not asked for',
    },
  ];
}

/**
 * HTTP strict transport security, the limits on media the gateway fetches for a request, how often
 * certificates are read again, and the TLS of each listener (shown, changed in Configuration).
 */
export function TransportCard() {
  const security = useOrgSettings((s) => s.security);
  const save = useOrgSettings((s) => s.saveSecurity);
  const canEdit = useCan('patchSecuritySettings');
  const configHref = useSettingsHref('configuration');
  const listeners = obj(obj(obj(security.data?.spec).tls).listeners);
  return (
    <Card
      title="HTTPS and fetched media"
      description="Strict transport security, the media the gateway fetches from URLs in requests, and certificates."
    >
      <LoadError of={security} subject="Security settings" size="sm" />
      {security.status === 'loading' && !security.data ? <LoadingRows rows={3} /> : null}
      {security.data ? (
        <SettingsForm
          key={security.data.metadata.etag}
          initial={transportValues(security.data.spec)}
          toSpec={transportSpec}
          save={(patch) => save(patch)}
          canEdit={canEdit}
          check={checkTransport}
          saved="Security settings saved"
          paths={{
            'security.hsts.max_age': 'hstsMaxAge',
            'security.media_fetch.max_bytes': 'mediaMax',
            'security.media_fetch.connect_timeout': 'mediaConnect',
            'security.media_fetch.timeout': 'mediaTimeout',
            'security.tls.reload_interval': 'tlsReload',
          }}
        >
          {({ values, set, errors, disabled }) => (
            <>
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
                  <Switch
                    label="Tell browsers to use HTTPS only (HSTS)"
                    checked={values.hsts}
                    disabled={disabled}
                    onChange={(on) => set('hsts', on)}
                  />
                  <Hint>Only over HTTPS. A browser that saw it refuses plain HTTP until it expires.</Hint>
                </div>
                <Field label="For" error={errors.hstsMaxAge} className="w-44">
                  <Select
                    value={values.hstsMaxAge}
                    disabled={disabled || !values.hsts}
                    onChange={(v) => set('hstsMaxAge', v)}
                    options={durationOptions(['1d', '30d', '180d', '365d', '730d'], values.hstsMaxAge)}
                  />
                </Field>
              </div>
              <Checkbox
                label="Include subdomains"
                checked={values.hstsSubdomains}
                disabled={disabled || !values.hsts}
                onChange={(on) => set('hstsSubdomains', on)}
              />
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 text-ui font-semibold text-fg">Media fetched for a request</legend>
                <p className="-mt-2 text-caption text-muted">
                  Images, documents and audio a request names by URL, each one fetched by the gateway.
                </p>
                <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
                  <Field label="Largest file" error={errors.mediaMax}>
                    <Select
                      value={values.mediaMax}
                      disabled={disabled}
                      onChange={(v) => set('mediaMax', v)}
                      options={sizeOptions(['5MiB', '10MiB', '20MiB', '50MiB', '100MiB'], values.mediaMax)}
                    />
                  </Field>
                  <Field label="Connect within" error={errors.mediaConnect}>
                    <Select
                      value={values.mediaConnect}
                      disabled={disabled}
                      onChange={(v) => set('mediaConnect', v)}
                      options={durationOptions(['1s', '2s', '5s', '10s'], values.mediaConnect)}
                    />
                  </Field>
                  <Field label="Download within" error={errors.mediaTimeout}>
                    <Select
                      value={values.mediaTimeout}
                      disabled={disabled}
                      onChange={(v) => set('mediaTimeout', v)}
                      options={durationOptions(['10s', '30s', '60s', '120s'], values.mediaTimeout)}
                    />
                  </Field>
                </div>
                <Advanced label="Media types accepted">
                  {MEDIA_KINDS.map(({ key, label }) => (
                    <Field key={key} label={label} error={errors[`types.${key}`]}>
                      <MultiSelect
                        creatable
                        noun="type"
                        value={values.mediaTypes[key]}
                        disabled={disabled}
                        options={values.mediaTypes[key].map((t) => ({ value: t, label: t }))}
                        onChange={(next) => set('mediaTypes', { ...values.mediaTypes, [key]: next })}
                      />
                    </Field>
                  ))}
                </Advanced>
              </fieldset>
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 text-ui font-semibold text-fg">Certificates</legend>
                <Field
                  label="Read certificate files again every"
                  error={errors.tlsReload}
                  hint="A renewed certificate is picked up without a restart."
                  className="w-64 max-sm:w-full"
                >
                  <Select
                    value={values.tlsReload}
                    disabled={disabled}
                    onChange={(v) => set('tlsReload', v)}
                    options={durationOptions(['5s', '10s', '1m', '5m', '1h'], values.tlsReload)}
                  />
                </Field>
                {(['data', 'admin'] as const).map((which) => {
                  const facts = listenerFacts(listeners[which]);
                  return (
                    <div key={which} className="flex flex-col gap-1.5">
                      <p className="text-ui font-medium text-fg">
                        {which === 'data' ? 'Apps’ listener' : 'Console and Admin API listener'}
                      </p>
                      {facts ? (
                        <Facts
                          items={facts.map((f) => ({
                            label: f.label,
                            value: <span className="mono break-all">{f.value}</span>,
                          }))}
                        />
                      ) : (
                        <p className="text-caption text-muted">Plain HTTP: no certificate is set.</p>
                      )}
                    </div>
                  );
                })}
                <p className="text-caption text-muted">
                  Certificate and key files are paths on each node.{' '}
                  <Link href={configHref} className="text-accent hover:underline">
                    Change them in Configuration
                  </Link>
                  .
                </p>
              </fieldset>
            </>
          )}
        </SettingsForm>
      ) : null}
    </Card>
  );
}
