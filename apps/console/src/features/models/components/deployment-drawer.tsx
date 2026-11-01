'use client';

import { type ReactNode, useState } from 'react';

import { Icon } from '@/components/ui/icon';
import { Button, IconButton } from '@/components/ui/button';
import {
  Combobox,
  Field,
  Input,
  MultiSelect,
  NumberInput,
  Select,
  Switch,
  Textarea,
} from '@/components/ui/form';
import { ProviderMark } from '@/components/ui/marks';
import { CancelButton, Drawer } from '@/components/ui/overlay';
import { InlineError } from '@/components/ui/states';
import { isChangeControl } from '@/lib/api/client';
import type { DeploymentResource } from '@/lib/api/types';
import { useEdited, useTokenPrice } from '@/lib/hooks';
import { providerTypeLabel } from '@/lib/providers';
import { type FieldErrors, serverFieldErrors } from '@/lib/validation';
import { notify } from '@/stores/ui';

import type { HeaderRow } from '@/features/mcp/fields';

import { capability } from '../catalog';
import {
  CAPABILITY_FLAGS,
  CAPABILITY_NUMBERS,
  deploymentErrors,
  type DeploymentValues,
  fromDeploymentSpec,
  type LimitRow,
  otherCapabilities,
  PRICE_FIELDS,
  toDeploymentSpec,
  type TriState,
} from '../deployment-form';
import { deploymentNameFor } from '../form';
import { saveDeployment, useCatalog } from '../store';

/** A titled group of the drawer's fields, split by a hairline. */
function Group({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4 border-t border-line pt-4">
      <legend className="float-left mb-1 w-full text-ui font-semibold text-fg">{title}</legend>
      {hint ? <p className="-mt-3 text-caption text-muted">{hint}</p> : null}
      {children}
    </fieldset>
  );
}

/** Header rows: plain values; one the gateway keeps hidden shows as stored and stays unless replaced. */
function HeadersField({
  rows,
  error,
  onChange,
}: {
  rows: HeaderRow[];
  error: string | undefined;
  onChange: (rows: HeaderRow[]) => void;
}) {
  const update = (i: number, patch: Partial<HeaderRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div role="group" aria-label="Headers" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ui font-medium text-fg">
          Headers <span className="font-normal text-dim">(optional)</span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          onClick={() => onChange([...rows, { name: '', value: '', stored: false }])}
        >
          Add header
        </Button>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2">
          <Input
            mono
            aria-label={`Header ${String(i + 1)} name`}
            placeholder="anthropic-beta"
            value={row.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <Input
            mono
            aria-label={`Header ${String(i + 1)} value`}
            placeholder={row.stored ? 'Stored, hidden. Type to replace' : 'Value or ${env:NAME}'}
            value={row.value}
            onChange={(e) => update(i, { value: e.target.value })}
          />
          <IconButton
            icon="trash"
            label={`Remove header ${row.name || String(i + 1)}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-caption text-error">
          {error}
        </p>
      ) : (
        <p className="text-caption text-muted">
          {rows.length === 0
            ? 'None. Headers added here go with every request to this deployment, over the provider’s.'
            : 'Sent with every request to this deployment, over the provider’s headers.'}
        </p>
      )}
    </div>
  );
}

const UNITS = [
  { value: 'requests', label: 'Requests' },
  { value: 'tokens', label: 'Tokens' },
  { value: 'concurrency', label: 'Requests at once' },
];

/** The deployment's own limits on what the gateway sends it: name, unit, amount, window and burst. */
function LimitsField({
  rows,
  errors,
  onChange,
}: {
  rows: LimitRow[];
  errors: FieldErrors;
  onChange: (rows: LimitRow[]) => void;
}) {
  const update = (i: number, patch: Partial<LimitRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div role="group" aria-label="Limits" className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="text-caption text-muted">
          None. The provider’s own limits and the gateway’s policies still apply.
        </p>
      ) : null}
      {rows.map((row, i) => {
        const err = (f: string) => errors[`limits.${String(i)}.${f}`];
        return (
          <div
            key={i}
            className="grid grid-cols-2 gap-2 border-b border-line pb-3 sm:grid-cols-[1.4fr_1.2fr_1fr_0.8fr_0.8fr_auto]"
          >
            <Field label="Name" error={err('name')}>
              <Input mono value={row.name} onChange={(e) => update(i, { name: e.target.value })} />
            </Field>
            <Field label="Counts">
              <Select
                value={row.unit}
                onChange={(v) => update(i, { unit: v as LimitRow['unit'] })}
                options={UNITS}
              />
            </Field>
            <Field label="Limit" error={err('limit')}>
              <NumberInput value={row.limit} min={0} onChange={(v) => update(i, { limit: v })} />
            </Field>
            <Field label="Per" error={err('per')}>
              <Input
                mono
                disabled={row.unit === 'concurrency'}
                placeholder={row.unit === 'concurrency' ? '—' : '1m'}
                value={row.unit === 'concurrency' ? '' : row.per}
                onChange={(e) => update(i, { per: e.target.value })}
              />
            </Field>
            <Field label="Burst" optional error={err('burst')}>
              <NumberInput value={row.burst} min={1} onChange={(v) => update(i, { burst: v })} />
            </Field>
            <div className="flex items-end pb-0.5">
              <IconButton
                icon="trash"
                label={`Remove limit ${row.name || String(i + 1)}`}
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              />
            </div>
          </div>
        );
      })}
      <div>
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          onClick={() =>
            onChange([...rows, { original: '', name: '', unit: 'requests', limit: '', per: '1m', burst: '' }])
          }
        >
          Add limit
        </Button>
      </div>
    </div>
  );
}

function stateWord(value: unknown): string {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  if (typeof value === 'number') return value.toLocaleString('en-US');
  return 'not stated';
}

export interface DeploymentDrawerProps {
  /** The deployment to edit, or null to add one. */
  deployment: DeploymentResource | null;
  /** The provider a new deployment starts on. */
  provider?: string;
  /** The provider's type, when the catalog's providers aren't loaded (the provider drawer). */
  providerType?: string | undefined;
  onClose: () => void;
  onSaved?: (deployment: DeploymentResource) => void;
}

/**
 * Edits a deployment: the provider's model it calls, where it runs, how requests to it are shaped,
 * the capabilities it states, its own limits and its price. Saving replaces its spec (with its
 * ETag); what the drawer doesn't show is kept as written.
 */
export function DeploymentDrawer({
  deployment,
  provider,
  providerType,
  onClose,
  onSaved,
}: DeploymentDrawerProps) {
  const tokenPrice = useTokenPrice();
  const providers = useCatalog((s) => s.providers.data ?? []);
  const existing = useCatalog((s) => s.deployments.data ?? []);
  const effective = useCatalog((s) =>
    deployment ? s.capabilities[deployment.name]?.capabilities : undefined,
  );
  const create = deployment === null;
  const [values, setValues] = useState<DeploymentValues>(() => {
    const v = fromDeploymentSpec(deployment?.spec ?? null, tokenPrice.unit, deployment?.name ?? '');
    return create ? { ...v, provider: provider ?? '' } : v;
  });
  const [nameEdited, setNameEdited] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(values);
  const type = providerType ?? providers.find((p) => p.name === values.provider)?.spec.type;
  const set = <K extends keyof DeploymentValues>(key: K, value: DeploymentValues[K]) =>
    setValues((v) => {
      const next = { ...v, [key]: value };
      if (create && !nameEdited && (key === 'provider' || key === 'model'))
        next.name = next.provider && next.model ? deploymentNameFor(next.provider, next.model) : '';
      return next;
    });
  const others = otherCapabilities(deployment?.spec ?? null);
  const unit = `USD per ${tokenPrice.unit} tokens`;
  const more = PRICE_FIELDS.filter((p) => !p.main);
  const moreSet = more.filter((p) => values.price[p.field] !== '').length;

  async function submit() {
    const found = deploymentErrors(
      values,
      create,
      existing.map((d) => d.name),
    );
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (!create && !edited) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const spec = toDeploymentSpec(deployment?.spec ?? null, values, tokenPrice.unit);
      const name = create ? values.name.trim() : deployment.name;
      const saved = await saveDeployment(name, spec, create ? null : deployment.metadata.etag);
      notify('success', create ? 'Deployment added' : 'Deployment saved', name);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      if (isChangeControl(e)) {
        onClose();
        return;
      }
      setError(e);
      const name = create ? values.name.trim() : deployment.name;
      const server = serverFieldErrors(e, `deployments.${name}`);
      const map: Record<string, string> = {
        model: 'model',
        base_model: 'baseModel',
        default_max_tokens: 'defaultMaxTokens',
        headers: 'headers',
        params: 'paramsDefaults',
        region: 'region',
        location: 'location',
      };
      setErrors(Object.fromEntries(Object.entries(server).map(([k, m]) => [map[k] ?? k, m])));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      dirty={edited}
      open
      width="lg"
      onClose={onClose}
      title={create ? 'Add deployment' : `Edit ${deployment.name}`}
      subtitle={
        create
          ? 'A provider’s model the gateway can send requests to. Models route to it.'
          : 'Changes apply right away and are recorded in the audit log.'
      }
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {create ? 'Add deployment' : 'Save changes'}
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
        {create ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider" required error={errors.provider}>
              <Combobox
                value={values.provider}
                onChange={(v) => set('provider', v)}
                emptyOption="Select a provider"
                options={providers.map((p) => ({
                  value: p.name,
                  label: p.name,
                  description: providerTypeLabel(p.spec.type),
                }))}
              />
            </Field>
            <Field label="Name" required error={errors.name} hint="Models and routes name it.">
              <Input
                mono
                value={values.name}
                onChange={(e) => {
                  setNameEdited(true);
                  set('name', e.target.value);
                }}
              />
            </Field>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-ui text-muted">
            Provider <ProviderMark type={type} />
            <span className="mono text-fg">{values.provider}</span>
            {type ? <span>· {providerTypeLabel(type)}</span> : null}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Provider’s model ID"
            required
            error={errors.model}
            hint={
              type === 'azure_openai'
                ? 'The Azure deployment name.'
                : type === 'bedrock'
                  ? 'A model ID, inference profile ID or ARN.'
                  : 'The model the provider runs, as its API names it.'
            }
          >
            <Input mono value={values.model} onChange={(e) => set('model', e.target.value)} data-autofocus />
          </Field>
          <Field
            label="Base model"
            optional
            error={errors.baseModel}
            hint="The catalog model it is priced and described as, when the ID is a custom one."
          >
            <Input mono value={values.baseModel} onChange={(e) => set('baseModel', e.target.value)} />
          </Field>
        </div>
        <Switch checked={values.enabled} onChange={(v) => set('enabled', v)} label="Serves requests" />
        {!values.enabled ? (
          <p className="-mt-2 text-caption text-muted">
            Off in its settings: models move on to their other deployments until it is turned on here.
          </p>
        ) : null}

        <Group title="Where it runs">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Region"
              optional
              error={errors.region}
              hint={
                type === 'bedrock'
                  ? 'Also the region requests are signed for, over the provider’s.'
                  : 'Keys and teams limited to regions are matched against it.'
              }
            >
              <Input mono value={values.region} onChange={(e) => set('region', e.target.value)} />
            </Field>
            {type === 'vertex' || values.location ? (
              <Field label="Location" optional error={errors.location} hint="The Vertex AI location.">
                <Input mono value={values.location} onChange={(e) => set('location', e.target.value)} />
              </Field>
            ) : null}
            {type === 'vertex' || values.vertexPublisher ? (
              <Field label="Publisher" optional hint="Who publishes the model on Vertex AI.">
                <Select
                  value={values.vertexPublisher}
                  onChange={(v) => set('vertexPublisher', v as DeploymentValues['vertexPublisher'])}
                  emptyOption="From the model ID"
                  options={[
                    { value: 'google', label: 'Google' },
                    { value: 'anthropic', label: 'Anthropic' },
                  ]}
                />
              </Field>
            ) : null}
            {type === 'bedrock' || values.bedrockApi ? (
              <Field label="Bedrock API" optional hint="Which Bedrock API requests use.">
                <Select
                  value={values.bedrockApi}
                  onChange={(v) => set('bedrockApi', v as DeploymentValues['bedrockApi'])}
                  emptyOption="Default (automatic)"
                  options={[
                    { value: 'auto', label: 'Automatic' },
                    { value: 'converse', label: 'Converse' },
                    { value: 'invoke', label: 'Invoke' },
                    { value: 'openai', label: 'OpenAI-compatible' },
                  ]}
                />
              </Field>
            ) : null}
          </div>
        </Group>

        <Group title="Requests">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Default max tokens"
              optional
              error={errors.defaultMaxTokens}
              hint="Sent when a request sets none and the provider needs one. 4,096 when empty."
            >
              <NumberInput
                value={values.defaultMaxTokens}
                min={1}
                max={10_000_000}
                onChange={(v) => set('defaultMaxTokens', v)}
              />
            </Field>
            <Field
              label="Callers’ own provider keys"
              optional
              hint="Whether a request may bring its own key."
            >
              <Select
                value={values.byok}
                onChange={(v) => set('byok', v as DeploymentValues['byok'])}
                emptyOption="As the provider says"
                options={[
                  { value: 'disabled', label: 'Not allowed' },
                  { value: 'allowed', label: 'Allowed' },
                  { value: 'required', label: 'Required' },
                ]}
              />
            </Field>
          </div>
          <HeadersField rows={values.headers} error={errors.headers} onChange={(v) => set('headers', v)} />
          <Field
            label="Remove from requests"
            optional
            error={errors.paramsRemove}
            hint="Body fields dropped before sending, as paths: /logprobs, /metadata/user."
          >
            <MultiSelect
              mono
              creatable
              noun="field"
              placeholder="Type a path and press Enter"
              options={values.paramsRemove.map((p) => ({ value: p, label: p }))}
              value={values.paramsRemove}
              onChange={(v) => set('paramsRemove', v)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Defaults"
              optional
              error={errors.paramsDefaults}
              hint="Set when the request leaves them out, as JSON by path."
            >
              <Textarea
                mono
                rows={4}
                placeholder={'{"/temperature": 0.2}'}
                value={values.paramsDefaults}
                onChange={(e) => set('paramsDefaults', e.target.value)}
              />
            </Field>
            <Field
              label="Always set"
              optional
              error={errors.paramsOverrides}
              hint="Replace what the request sends, as JSON by path."
            >
              <Textarea
                mono
                rows={4}
                placeholder={'{"/service_tier": "auto"}'}
                value={values.paramsOverrides}
                onChange={(e) => set('paramsOverrides', e.target.value)}
              />
            </Field>
          </div>
        </Group>

        <Group
          title="Capabilities"
          hint={
            others > 0
              ? `What it can do, when the provider’s values are wrong for it. ${String(others)} more set in the configuration ${others === 1 ? 'is' : 'are'} kept.`
              : 'What it can do, when the provider’s values are wrong for it.'
          }
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {CAPABILITY_FLAGS.map((f) => (
              <Field key={f.name} label={f.label}>
                <Select
                  value={values.flags[f.name]}
                  onChange={(v) => set('flags', { ...values.flags, [f.name]: v as TriState })}
                  options={[
                    {
                      value: 'inherit',
                      label: effective
                        ? `Provider’s value (${stateWord(capability(effective, f.name))})`
                        : 'Provider’s value',
                    },
                    { value: 'yes', label: 'Yes' },
                    { value: 'no', label: 'No' },
                  ]}
                />
              </Field>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {CAPABILITY_NUMBERS.map((n) => (
              <Field
                key={n.name}
                label={n.label}
                optional
                error={errors[`numbers.${n.name}`]}
                hint={
                  effective
                    ? `Tokens. Empty for the provider’s value (${stateWord(capability(effective, n.name))}).`
                    : 'Tokens. Empty for the provider’s value.'
                }
              >
                <NumberInput
                  value={values.numbers[n.name]}
                  min={1}
                  onChange={(v) => set('numbers', { ...values.numbers, [n.name]: v })}
                />
              </Field>
            ))}
          </div>
        </Group>

        <Group
          title="Limits"
          hint="Caps on what the gateway sends this deployment, across every model, key and team."
        >
          <LimitsField rows={values.limits} errors={errors} onChange={(v) => set('limits', v)} />
        </Group>

        <Group
          title="Price"
          hint="Replaces the list price for every model that uses this deployment. Empty rates use the list price."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {PRICE_FIELDS.filter((p) => p.main).map((p) => (
              <Field key={p.field} label={p.label} optional error={errors[`price.${p.field}`]} hint={unit}>
                <Input
                  mono
                  inputMode="decimal"
                  value={values.price[p.field]}
                  onChange={(e) => set('price', { ...values.price, [p.field]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <details className="group" open={moreSet > 0 ? true : undefined}>
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-ui text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
              <Icon name="chevronRight" size={12} className="transition-transform group-open:rotate-90" />
              More rates{moreSet > 0 ? ` (${String(moreSet)} set)` : ''}
            </summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {more.map((p) => (
                <Field
                  key={p.field}
                  label={p.label}
                  optional
                  error={errors[`price.${p.field}`]}
                  hint={p.perToken ? unit : 'USD'}
                >
                  <Input
                    mono
                    inputMode="decimal"
                    value={values.price[p.field]}
                    onChange={(e) => set('price', { ...values.price, [p.field]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
          </details>
        </Group>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Drawer>
  );
}
