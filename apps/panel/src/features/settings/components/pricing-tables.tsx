'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm';
import { Field, Input, Select } from '@/components/ui/form';
import { useCan } from '@/components/ui/gate';
import { MenuButton } from '@/components/ui/menu';
import { CancelButton, Dialog } from '@/components/ui/overlay';
import { EmptyState, InlineError } from '@/components/ui/states';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import type { components } from '@/lib/api/schema';
import { useEdited } from '@/lib/hooks';
import type { FieldErrors } from '@/lib/validation';
import { notify } from '@/stores/ui';

import { useTraffic } from '../traffic-store';
import { Card } from './parts';

type Pricing = components['schemas']['PricingSettings']['spec'];

/* ---------------------------------------------------------------- Markups */

export type MarkupLevel = 'organizations' | 'teams' | 'projects' | 'keys';

/** Levels from the most specific, which is the one that applies when several name a request. */
export const MARKUP_LEVELS: { value: MarkupLevel; label: string; one: string }[] = [
  { value: 'keys', label: 'Key', one: 'key' },
  { value: 'projects', label: 'Project', one: 'project' },
  { value: 'teams', label: 'Team', one: 'team' },
  { value: 'organizations', label: 'Organization', one: 'organization' },
];

export interface Markup {
  level: MarkupLevel;
  name: string;
  factor: string;
}

export function markupRows(spec: Pricing | undefined): Markup[] {
  const m = spec?.multipliers ?? {};
  return MARKUP_LEVELS.flatMap(({ value }) =>
    Object.entries(m[value] ?? {})
      .map(([name, factor]) => ({ level: value, name, factor }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}

const DECIMAL_RE = /^[0-9]+(\.[0-9]{1,12})?$/;
const TENANT_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function checkMarkup(m: Markup, taken: Markup[]): FieldErrors {
  const e: FieldErrors = {};
  const name = m.name.trim();
  if (!(m.level === 'keys' ? KEY_RE : TENANT_RE).test(name))
    e.name =
      m.level === 'keys'
        ? 'Enter a key name'
        : 'Lowercase letters, digits, dashes or underscores, as in its name';
  else if (taken.some((t) => t.level === m.level && t.name === name))
    e.name = 'This one has a markup already';
  if (!DECIMAL_RE.test(m.factor.trim())) e.factor = 'Enter a number such as 1.2, or 0 to make it free';
  return e;
}

/** "×1.2", "free" for 0. */
const factorWords = (f: string) => (Number(f) === 0 ? 'Free' : `×${f}`);

function MarkupDialog({
  initial,
  taken,
  onClose,
}: {
  initial: Markup | null;
  taken: Markup[];
  onClose: () => void;
}) {
  const save = useTraffic((s) => s.save);
  const [form, setForm] = useState<Markup>(initial ?? { level: 'teams', name: '', factor: '1' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(form);
  const set = <K extends keyof Markup>(k: K, v: Markup[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest);
  };
  async function submit() {
    const others = initial
      ? taken.filter((t) => !(t.level === initial.level && t.name === initial.name))
      : taken;
    const found = checkMarkup(form, others);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      await save('pricing', { multipliers: { [form.level]: { [form.name.trim()]: form.factor.trim() } } });
      notify('success', initial ? 'Markup saved' : 'Markup added', form.name.trim());
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      dirty={edited}
      onClose={onClose}
      title={initial ? `Markup for ${initial.name}` : 'Add markup'}
      description="Its requests cost the price times this number, in budgets and reports."
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {initial ? 'Save markup' : 'Add markup'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <InlineError error={error} />
        <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3 max-sm:grid-cols-1">
          <Field label="For a">
            <Select
              value={form.level}
              disabled={initial !== null}
              onChange={(v) => set('level', v as MarkupLevel)}
              options={MARKUP_LEVELS.map((l) => ({ value: l.value, label: l.label }))}
            />
          </Field>
          <Field label="Name" error={errors.name}>
            <Input
              mono
              value={form.name}
              disabled={initial !== null}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
        </div>
        <Field label="Multiply the cost by" error={errors.factor} hint="1.2 adds 20%; 0 makes it free.">
          <Input
            mono
            inputMode="decimal"
            value={form.factor}
            onChange={(e) => set('factor', e.target.value)}
          />
        </Field>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}

/** Markups on what an organization, team, project or key is charged, for chargeback. */
export function MarkupsCard() {
  const pricing = useTraffic((s) => s.pricing);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchPricingSettings');
  const [open, setOpen] = useState<{ row: Markup | null } | null>(null);
  const [removing, setRemoving] = useState<Markup | null>(null);
  if (!pricing.data) return null;
  const rows = markupRows(pricing.data.spec);
  return (
    <Card
      title="Markups"
      description="Charge an organization, team, project or key more or less than the price. When several apply, the most specific one counts: key, then project, team, organization."
      actions={
        canEdit ? (
          <Button size="sm" icon="plus" onClick={() => setOpen({ row: null })}>
            Add markup
          </Button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <EmptyState size="sm" title="No markups" description="Every request costs its price." />
      ) : (
        <Table label="Markups">
          <thead>
            <tr>
              <Th>For</Th>
              <Th>Name</Th>
              <Th numeric>Cost</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={`${r.level}/${r.name}`}>
                <Td muted>{MARKUP_LEVELS.find((l) => l.value === r.level)?.label}</Td>
                <Td mono>{r.name}</Td>
                <Td numeric>{factorWords(r.factor)}</Td>
                <Td className="text-right">
                  {canEdit ? (
                    <MenuButton
                      iconOnly
                      variant="ghost"
                      size="sm"
                      label={`Actions for ${r.name}`}
                      items={[
                        { label: 'Edit', icon: 'edit', onSelect: () => setOpen({ row: r }) },
                        {
                          label: 'Remove markup',
                          icon: 'trash',
                          danger: true,
                          onSelect: () => setRemoving(r),
                        },
                      ]}
                    />
                  ) : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {open ? <MarkupDialog initial={open.row} taken={rows} onClose={() => setOpen(null)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove the markup for ${removing?.name ?? ''}?`}
        confirmLabel="Remove markup"
        effect="Its requests cost the price, or a less specific markup, from the next request."
        onConfirm={async (reason) => {
          if (!removing) return;
          await save('pricing', { multipliers: { [removing.level]: { [removing.name]: null } } }, reason);
          notify('success', 'Markup removed', removing.name);
        }}
      />
    </Card>
  );
}

/* ---------------------------------------------------------------- Tool and agent prices */

export type CallKind = 'tools' | 'agents';

export interface CallPriceRow {
  kind: CallKind;
  name: string;
  perCall: string;
}

export function callPriceRows(spec: Pricing | undefined): CallPriceRow[] {
  const of = (kind: CallKind, map: Record<string, { per_call: string }> | undefined) =>
    Object.entries(map ?? {})
      .map(([name, p]) => ({ kind, name, perCall: p.per_call }))
      .sort((a, b) => a.name.localeCompare(b.name));
  return [...of('tools', spec?.tools), ...of('agents', spec?.agents)];
}

const TOOL_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?\/.+$/;
const AGENT_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

export function checkCallPrice(r: CallPriceRow, taken: CallPriceRow[]): FieldErrors {
  const e: FieldErrors = {};
  const name = r.name.trim();
  if (!(r.kind === 'tools' ? TOOL_RE : AGENT_RE).test(name))
    e.name =
      r.kind === 'tools'
        ? 'Enter server/tool, or server/* for every tool of a server'
        : 'Enter the agent name';
  else if (taken.some((t) => t.kind === r.kind && t.name === name)) e.name = 'This one has a price already';
  if (!DECIMAL_RE.test(r.perCall.trim())) e.perCall = 'Enter an amount in USD, such as 0.002';
  return e;
}

function CallPriceDialog({
  initial,
  taken,
  onClose,
}: {
  initial: CallPriceRow | null;
  taken: CallPriceRow[];
  onClose: () => void;
}) {
  const save = useTraffic((s) => s.save);
  const [form, setForm] = useState<CallPriceRow>(initial ?? { kind: 'tools', name: '', perCall: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(form);
  const set = <K extends keyof CallPriceRow>(k: K, v: CallPriceRow[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest);
  };
  async function submit() {
    const others = initial
      ? taken.filter((t) => !(t.kind === initial.kind && t.name === initial.name))
      : taken;
    const found = checkCallPrice(form, others);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      await save('pricing', { [form.kind]: { [form.name.trim()]: { per_call: form.perCall.trim() } } });
      notify('success', initial ? 'Price saved' : 'Price added', form.name.trim());
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      dirty={edited}
      onClose={onClose}
      title={initial ? `Price of ${initial.name}` : 'Add tool or agent price'}
      description="Each call the gateway makes for a request adds this to the request's cost."
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {initial ? 'Save price' : 'Add price'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <InlineError error={error} />
        <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3 max-sm:grid-cols-1">
          <Field label="For a">
            <Select
              value={form.kind}
              disabled={initial !== null}
              onChange={(v) => set('kind', v as CallKind)}
              options={[
                { value: 'tools', label: 'MCP tool' },
                { value: 'agents', label: 'Agent' },
              ]}
            />
          </Field>
          <Field
            label="Name"
            error={errors.name}
            hint={form.kind === 'tools' ? 'server/tool, or server/* for every tool of a server.' : undefined}
          >
            <Input
              mono
              value={form.name}
              disabled={initial !== null}
              placeholder={form.kind === 'tools' ? 'search/web_search' : 'researcher'}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
        </div>
        <Field label="Per call (USD)" error={errors.perCall}>
          <Input
            mono
            inputMode="decimal"
            value={form.perCall}
            placeholder="0.002"
            onChange={(e) => set('perCall', e.target.value)}
          />
        </Field>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}

/** What each call to an MCP tool or an agent costs, on top of the Model's tokens. */
export function CallPricesCard() {
  const pricing = useTraffic((s) => s.pricing);
  const save = useTraffic((s) => s.save);
  const canEdit = useCan('patchPricingSettings');
  const [open, setOpen] = useState<{ row: CallPriceRow | null } | null>(null);
  const [removing, setRemoving] = useState<CallPriceRow | null>(null);
  if (!pricing.data) return null;
  const rows = callPriceRows(pricing.data.spec);
  return (
    <Card
      title="Tool and agent prices"
      description="What a call to an MCP tool or an agent adds to a request's cost. Calls without a price are free."
      actions={
        canEdit ? (
          <Button size="sm" icon="plus" onClick={() => setOpen({ row: null })}>
            Add price
          </Button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <EmptyState size="sm" title="No tool or agent prices" />
      ) : (
        <Table label="Tool and agent prices">
          <thead>
            <tr>
              <Th>For</Th>
              <Th>Name</Th>
              <Th numeric>Per call</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={`${r.kind}/${r.name}`}>
                <Td muted>{r.kind === 'tools' ? 'MCP tool' : 'Agent'}</Td>
                <Td mono>{r.name}</Td>
                <Td numeric>${r.perCall}</Td>
                <Td className="text-right">
                  {canEdit ? (
                    <MenuButton
                      iconOnly
                      variant="ghost"
                      size="sm"
                      label={`Actions for ${r.name}`}
                      items={[
                        { label: 'Edit', icon: 'edit', onSelect: () => setOpen({ row: r }) },
                        {
                          label: 'Remove price',
                          icon: 'trash',
                          danger: true,
                          onSelect: () => setRemoving(r),
                        },
                      ]}
                    />
                  ) : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {open ? <CallPriceDialog initial={open.row} taken={rows} onClose={() => setOpen(null)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove the price of ${removing?.name ?? ''}?`}
        confirmLabel="Remove price"
        effect="Its calls are free from the next request."
        onConfirm={async (reason) => {
          if (!removing) return;
          await save('pricing', { [removing.kind]: { [removing.name]: null } }, reason);
          notify('success', 'Price removed', removing.name);
        }}
      />
    </Card>
  );
}
