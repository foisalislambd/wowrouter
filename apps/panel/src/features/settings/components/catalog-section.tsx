'use client';

import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/choice';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { MenuButton } from '@/components/ui/menu';
import { CancelButton, Drawer } from '@/components/ui/overlay';
import { EmptyState, InlineError, LoadError, LoadingRows } from '@/components/ui/states';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { api } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';
import { useEdited } from '@/lib/hooks';
import { SETTINGS_DEFAULTS } from '@/lib/settings-defaults';
import { emptySlot, failSlot, type Slot } from '@/lib/slot';
import { formatDate, formatDateTime, formatRelative } from '@/lib/time';
import type { FieldErrors } from '@/lib/validation';
import { usePreferences } from '@/stores/preferences';
import { notify } from '@/stores/ui';

import { durationOptions } from '../choices';
import { DURATION_RE, detailErrors, mergePatch, URL_RE } from '../form-errors';
import { useTraffic } from '../traffic-store';
import { Card, Facts } from './parts';
import { Choice, Hint, lock, SettingsForm } from './settings-form';

type S = components['schemas'];
type CatalogSpec = S['CatalogSettings']['spec'];
type Entry = S['CatalogEntry'];
type Obj = Record<string, unknown>;

/**
 * The models.dev layer as `/catalog` reports it, when the gateway does: the date of the data in use,
 * where it came from and when it was last fetched. The contract does not list it yet.
 */
export interface ModelsDevStatus {
  date?: string | null;
  source?: 'bundled' | 'remote' | null;
  refreshed_at?: string | null;
  last_error?: string | null;
}

export type CatalogStatus = S['CatalogStatus'] & { models_dev?: ModelsDevStatus | null };

const D = SETTINGS_DEFAULTS.catalog;

/* ---------------------------------------------------------------- Catalog behaviour */

type Mode = 'extend' | 'replace';

export interface CatalogValues {
  mode: Mode;
  version: string;
  remote: boolean;
  url: string;
  refresh: string;
}

export function catalogValues(spec: CatalogSpec | undefined): CatalogValues {
  return {
    mode: spec?.mode ?? D.mode,
    version: spec?.version ?? '',
    remote: spec?.remote?.enabled ?? D.remote.enabled,
    url: spec?.remote?.url ?? D.remote.url,
    refresh: spec?.remote?.refresh ?? D.remote.refresh,
  };
}

export const catalogSpec = (v: CatalogValues): Obj => ({
  mode: v.mode,
  version: v.version.trim() || null,
  remote: { enabled: v.remote, url: v.url.trim(), refresh: v.refresh },
});

function checkCatalog(v: CatalogValues): FieldErrors {
  const e: FieldErrors = {};
  if (v.version.length > 100) e.version = 'At most 100 characters';
  if (v.remote && !URL_RE.test(v.url.trim())) e.url = 'Enter an address such as https://models.dev/api.json';
  return e;
}

/** Where the models.dev data in use comes from, in words. */
export function modelsDevWords(
  status: ModelsDevStatus | null | undefined,
  remote: boolean,
  timeZone: string,
): { data: string; refresh: string } {
  const date = status?.date ? formatDate(`${status.date}T00:00:00Z`, 'UTC') : null;
  const data = !status
    ? remote
      ? 'Fetched from models.dev; this gateway does not report the date of the data'
      : 'The snapshot bundled with the gateway; this gateway does not report its date'
    : status.source === 'remote'
      ? `Fetched data of ${date ?? 'an unknown date'}`
      : `The bundled snapshot of ${date ?? 'an unknown date'}`;
  const refresh = !remote
    ? 'Off'
    : status?.refreshed_at
      ? `Last fetched ${formatRelative(status.refreshed_at)} (${formatDateTime(status.refreshed_at, timeZone)})${
          status.last_error ? `; the last try failed: ${status.last_error}` : ''
        }`
      : status?.last_error
        ? `Not fetched yet; the last try failed: ${status.last_error}`
        : status
          ? 'Not fetched yet'
          : 'On; the last fetch is not reported by this gateway';
  return { data, refresh };
}

function CatalogCard({ status }: { status: Slot<CatalogStatus> }) {
  const catalog = useTraffic((s) => s.catalog);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchCatalogSettings');
  const timeZone = usePreferences((s) => s.timeZone);
  const st = status.data;
  const values = catalogValues(catalog.data?.spec);
  const dev = modelsDevWords(st?.models_dev, values.remote, timeZone);
  return (
    <Card
      title="Catalog layers"
      description="The built-in catalog, your entries and models.dev's data below both, and how they combine."
    >
      <LoadError of={catalog} subject="Catalog settings" size="sm" />
      <LoadError of={status} subject="The catalog" size="sm" />
      {catalog.status === 'loading' && !catalog.data ? <LoadingRows rows={4} /> : null}
      {catalog.data ? (
        <div className="flex flex-col gap-5">
          <Facts
            items={[
              {
                label: 'Built-in catalog',
                value: st
                  ? `${st.bundled.entries} entries · capabilities ${st.bundled.version} · prices ${st.bundled.price_version}`
                  : '—',
              },
              {
                label: 'Your entries',
                value: st?.runtime
                  ? `${st.runtime.entries} · ${st.runtime.mode === 'replace' ? 'used alone' : 'over the built-in ones'}${
                      st.runtime.updated_at ? ` · changed ${formatRelative(st.runtime.updated_at)}` : ''
                    }`
                  : 'None',
              },
              { label: 'models.dev data', value: dev.data },
              { label: 'Fetching models.dev', value: dev.refresh },
            ]}
          />
          <SettingsForm
            key={catalog.data.metadata.etag}
            initial={values}
            toSpec={catalogSpec}
            save={(patch) => save('catalog', patch)}
            canEdit={canEdit}
            check={checkCatalog}
            saved="Catalog settings saved"
            paths={{
              'catalog.version': 'version',
              'catalog.remote.url': 'url',
              'catalog.remote.refresh': 'refresh',
            }}
          >
            {({ values: v, set, errors, disabled }) => (
              <>
                <Choice<Mode>
                  label="How your entries are used"
                  value={v.mode}
                  onChange={(m) => set('mode', m)}
                  options={lock(disabled, [
                    {
                      value: 'extend',
                      label: 'Over the built-in catalog',
                      description:
                        'An entry replaces the built-in one of the same pattern; models.dev fills in the rest.',
                    },
                    {
                      value: 'replace',
                      label: 'Instead of it',
                      description:
                        'Only your entries count; neither the built-in catalog nor models.dev is used.',
                    },
                  ])}
                />
                <Field
                  label="Label"
                  optional
                  error={errors.version}
                  hint="Your name for this catalog, such as 2026-10."
                >
                  <Input
                    value={v.version}
                    disabled={disabled}
                    onChange={(e) => set('version', e.target.value)}
                  />
                </Field>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <Switch
                      label="Fetch models.dev's data regularly"
                      checked={v.remote}
                      disabled={disabled || v.mode === 'replace'}
                      onChange={(on) => set('remote', on)}
                    />
                    <Hint>
                      Off, the snapshot bundled with the gateway is used. A fetch that fails keeps the data in
                      use. Fetches follow the egress rules in Endpoints & security.
                    </Hint>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_12rem] gap-4 max-sm:grid-cols-1">
                    <Field label="From" error={errors.url}>
                      <Input
                        mono
                        value={v.url}
                        disabled={disabled || !v.remote}
                        onChange={(e) => set('url', e.target.value)}
                      />
                    </Field>
                    <Field label="Every" error={errors.refresh}>
                      <Select
                        value={v.refresh}
                        disabled={disabled || !v.remote}
                        onChange={(r) => set('refresh', r)}
                        options={durationOptions(['1h', '6h', '12h', '24h', '7d', '30d'], v.refresh)}
                      />
                    </Field>
                  </div>
                </div>
              </>
            )}
          </SettingsForm>
        </div>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------------- Entries */

const PRICE_FIELDS = [
  { key: 'input', label: 'Input' },
  { key: 'output', label: 'Output' },
  { key: 'cache_read', label: 'Cache read' },
  { key: 'cache_write_5m', label: 'Cache write' },
] as const;
type PriceKey = (typeof PRICE_FIELDS)[number]['key'];

export interface EntryForm {
  pattern: string;
  prices: Record<PriceKey, string>;
  ttft: string;
  /** The capabilities as JSON text; empty for none. */
  capabilities: string;
}

export function entryForm(pattern: string | null, entry: Entry | undefined): EntryForm {
  const price = (entry?.price ?? {}) as Partial<Record<PriceKey, string>>;
  return {
    pattern: pattern ?? '',
    prices: {
      input: price.input ?? '',
      output: price.output ?? '',
      cache_read: price.cache_read ?? '',
      cache_write_5m: price.cache_write_5m ?? '',
    },
    ttft: entry?.ttft ?? '',
    capabilities: entry?.capabilities ? JSON.stringify(entry.capabilities, null, 2) : '',
  };
}

/** The entry as the configuration takes it; price members the form does not show are kept. */
export function entrySpec(f: EntryForm, previous: Entry | undefined): Obj {
  const shown = new Set<string>(PRICE_FIELDS.map((p) => p.key));
  const price: Obj = {
    ...Object.fromEntries(Object.entries((previous?.price ?? {}) as Obj).filter(([k]) => !shown.has(k))),
    ...Object.fromEntries(
      PRICE_FIELDS.flatMap(({ key }) => (f.prices[key].trim() ? [[key, f.prices[key].trim()]] : [])),
    ),
  };
  const caps = f.capabilities.trim() ? (JSON.parse(f.capabilities) as Obj) : null;
  return {
    ...(Object.keys(price).length ? { price } : {}),
    ...(f.ttft.trim() ? { ttft: f.ttft.trim() } : {}),
    ...(caps && Object.keys(caps).length ? { capabilities: caps } : {}),
  };
}

const PATTERN_RE = /^[A-Za-z0-9._:/@+-]{1,255}\*?$/;
const MONEY_RE = /^[0-9]+(\.[0-9]{1,12})?$/;

export function checkEntry(f: EntryForm, taken: string[], isNew: boolean): FieldErrors {
  const e: FieldErrors = {};
  const pattern = f.pattern.trim();
  if (isNew) {
    if (!PATTERN_RE.test(pattern))
      e.pattern = 'Enter provider/model or model, with a trailing * to match a prefix';
    else if (taken.includes(pattern)) e.pattern = 'This pattern has an entry already';
  }
  for (const { key } of PRICE_FIELDS) {
    const v = f.prices[key].trim();
    if (v && !MONEY_RE.test(v)) e[`prices.${key}`] = 'An amount in USD, such as 2.50';
  }
  if (f.ttft.trim() && !DURATION_RE.test(f.ttft.trim())) e.ttft = 'A duration such as 2s';
  if (f.capabilities.trim()) {
    try {
      const v: unknown = JSON.parse(f.capabilities);
      if (typeof v !== 'object' || v === null || Array.isArray(v)) e.capabilities = 'A JSON object';
    } catch {
      e.capabilities = 'Not valid JSON';
    }
  }
  return e;
}

function EntryDrawer({
  pattern,
  entry,
  taken,
  onClose,
}: {
  pattern: string | null;
  entry: Entry | undefined;
  taken: string[];
  onClose: () => void;
}) {
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchCatalogSettings');
  const [start] = useState(() => entryForm(pattern, entry));
  const [form, setForm] = useState(start);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(form);
  const isNew = pattern === null;
  const disabled = !canEdit;

  async function submit() {
    const found = checkEntry(form, taken, isNew);
    setErrors(found);
    if (Object.keys(found).length) return;
    const key = isNew ? form.pattern.trim() : pattern;
    const next = entrySpec(form, entry);
    setBusy(true);
    setError(null);
    try {
      await save('catalog', { models: { [key]: isNew ? next : mergePatch(entry, next) } });
      notify('success', isNew ? 'Entry added' : 'Entry saved', key);
      onClose();
    } catch (e) {
      setError(e);
      setErrors(detailErrors(e, { [`catalog.models.${key}`]: 'pattern' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      dirty={edited}
      open
      onClose={onClose}
      title={isNew ? 'Add catalog entry' : pattern}
      subtitle="The price and capabilities of the Models a pattern matches."
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} disabled={disabled} onClick={() => void submit()}>
            {isNew ? 'Add entry' : 'Save entry'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <InlineError error={error} />
        {isNew ? (
          <Field
            label="Pattern"
            error={errors.pattern}
            hint="provider/model or model; a trailing * matches every Model that starts so (the longest wins)."
          >
            <Input
              mono
              value={form.pattern}
              placeholder="openai/gpt-4.1*"
              onChange={(e) => setForm({ ...form, pattern: e.target.value })}
            />
          </Field>
        ) : null}
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-ui font-semibold text-fg">Price, USD per million tokens</legend>
          <div className="grid grid-cols-4 gap-3 max-md:grid-cols-2">
            {PRICE_FIELDS.map(({ key, label }) => (
              <Field key={key} label={label} optional error={errors[`prices.${key}`]}>
                <Input
                  mono
                  inputMode="decimal"
                  value={form.prices[key]}
                  disabled={disabled}
                  onChange={(e) => setForm({ ...form, prices: { ...form.prices, [key]: e.target.value } })}
                />
              </Field>
            ))}
          </div>
          <p className="text-caption text-muted">Other rates and tiers already in the entry are kept.</p>
        </fieldset>
        <Field
          label="Typical time to the first token"
          optional
          error={errors.ttft}
          hint="Routing uses it before it has measured the Model."
          className="w-56 max-sm:w-full"
        >
          <Input
            mono
            value={form.ttft}
            disabled={disabled}
            placeholder="2s"
            onChange={(e) => setForm({ ...form, ttft: e.target.value })}
          />
        </Field>
        <Field
          label="Capabilities (JSON)"
          optional
          error={errors.capabilities}
          hint='Such as {"tools": true, "vision": true}. Empty: what the Model reports.'
        >
          <Textarea
            mono
            rows={5}
            value={form.capabilities}
            disabled={disabled}
            onChange={(e) => setForm({ ...form, capabilities: e.target.value })}
          />
        </Field>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Drawer>
  );
}

const priceWords = (entry: Entry) => {
  const p = (entry.price ?? {}) as Partial<Record<PriceKey, string>>;
  if (!p.input && !p.output) return '—';
  return `$${p.input ?? '—'} in · $${p.output ?? '—'} out`;
};

function EntriesCard() {
  const catalog = useTraffic((s) => s.catalog);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchCatalogSettings');
  const [open, setOpen] = useState<{ pattern: string | null } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  if (!catalog.data) return null;
  const models = (catalog.data.spec.models ?? {}) as Record<string, Entry>;
  const patterns = Object.keys(models).sort();
  return (
    <Card
      title="Your entries"
      description="Prices and capabilities for Models the built-in catalog lacks or gets wrong."
      actions={
        canEdit ? (
          <Button size="sm" icon="plus" onClick={() => setOpen({ pattern: null })}>
            Add entry
          </Button>
        ) : null
      }
    >
      {patterns.length === 0 ? (
        <EmptyState
          size="sm"
          title="No entries"
          description="The built-in catalog and models.dev are used as they are."
        />
      ) : (
        <Table label="Catalog entries">
          <thead>
            <tr>
              <Th>Pattern</Th>
              <Th>Price per million tokens</Th>
              <Th className="max-md:hidden">Capabilities</Th>
              <Th className="max-md:hidden">First token</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {patterns.map((p) => {
              const entry = models[p] ?? {};
              const caps = Object.keys(entry.capabilities ?? {}).length;
              return (
                <Tr key={p}>
                  <Td mono>{p}</Td>
                  <Td muted>{priceWords(entry)}</Td>
                  <Td muted className="max-md:hidden">
                    {caps ? <Badge>{caps} set</Badge> : '—'}
                  </Td>
                  <Td muted className="max-md:hidden">
                    {entry.ttft ?? '—'}
                  </Td>
                  <Td className="text-right">
                    <MenuButton
                      iconOnly
                      variant="ghost"
                      size="sm"
                      label={`Actions for ${p}`}
                      items={[
                        {
                          label: canEdit ? 'Edit' : 'View',
                          icon: 'edit',
                          onSelect: () => setOpen({ pattern: p }),
                        },
                        ...(canEdit
                          ? [
                              {
                                label: 'Remove entry',
                                icon: 'trash' as const,
                                danger: true,
                                onSelect: () => setRemoving(p),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {open ? (
        <EntryDrawer
          pattern={open.pattern}
          entry={open.pattern ? models[open.pattern] : undefined}
          taken={patterns}
          onClose={() => setOpen(null)}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove the entry ${removing ?? ''}?`}
        objectName={removing ?? undefined}
        confirmLabel="Remove entry"
        effect="Its Models go back to the built-in catalog or models.dev, from the next request."
        onConfirm={async (reason) => {
          if (!removing) return;
          await save('catalog', { models: { [removing]: null } }, reason);
          notify('success', 'Entry removed', removing);
        }}
      />
    </Card>
  );
}

/** The model catalog: the layers in use, how your entries combine with them, models.dev fetching. */
export function CatalogSection() {
  const load = useTraffic((s) => s.load);
  const generation = useTraffic((s) => s.catalog.data?.metadata.generation);
  const [status, setStatus] = useState<Slot<CatalogStatus>>(() => ({ ...emptySlot(), status: 'loading' }));
  useEffect(() => {
    void load(['catalog']);
  }, [load]);
  useEffect(() => {
    let live = true;
    api.get('/catalog').then(
      (data) => live && setStatus({ data, status: 'ready', error: null, at: Date.now() }),
      (e: unknown) => live && setStatus((s) => failSlot(s, e)),
    );
    return () => {
      live = false;
    };
  }, [generation]);
  return (
    <>
      <CatalogCard status={status} />
      <EntriesCard />
    </>
  );
}
