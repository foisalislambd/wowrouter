'use client';

import { useState, type ReactNode } from 'react';

import { usePermission } from '@/components/ui/gate';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Tooltip } from '@/components/ui/tooltip';
import {
  Checkbox,
  Combobox,
  Field,
  Input,
  MultiSelect,
  NumberInput,
  Segmented,
  Select,
  Textarea,
} from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { CancelButton, Drawer } from '@/components/ui/overlay';
import { InlineError } from '@/components/ui/states';
import type { KeyResource } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useEdited } from '@/lib/hooks';
import { plural } from '@/lib/format';
import { serverFieldErrors, validate, type FieldErrors } from '@/lib/validation';
import { notify } from '@/stores/ui';

import {
  type CertBinding,
  EMPTY_KEY_FORM,
  type ExpiryChoice,
  fromKeySpec,
  keyFormSchema,
  type KeyFormValues,
  type KeyKind,
  limitWindow,
  toKeySpec,
} from '../form';
import { createKey, useKeys, useKeysContext } from '../store';
import { KEY_PERMISSIONS } from '../types';
import { EndpointsField, LabelFields, ModelFields, NetworkFields, ProviderFields } from './access-fields';

export interface KeyFormDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The key to edit; absent to create one. */
  editing?: KeyResource | undefined;
  /** Receives a new key's secret, to show once. */
  onCreated: (name: string, secret: string) => void;
}

const ADVANCED_FIELDS = ['rpm', 'tpm', 'allowedIps', 'permissions', 'priorityClass', 'certValue'] as const;

/** How many advanced settings the values set, for the collapsed section's summary. */
function advancedCount(v: KeyFormValues): number {
  return (
    (v.rpm.trim() ? 1 : 0) +
    (v.tpm.trim() ? 1 : 0) +
    (v.allowedIps.trim() ? 1 : 0) +
    v.ipSets.length +
    (v.regions.length > 0 ? 1 : 0) +
    (v.denyRegions.length > 0 ? 1 : 0) +
    (v.priorityClass.trim() ? 1 : 0) +
    (v.certBinding !== 'none' ? 1 : 0) +
    v.permissions.length
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-body font-semibold text-fg">{title}</h3>
        {description ? <p className="mt-0.5 text-caption text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Create or edit a key. The basics come first; which endpoints it may call is one choice that opens
 * a grouped list only when needed; limits, IP ranges and key permissions sit under Advanced.
 */
export function KeyFormDrawer({ open, onClose, editing, onCreated }: KeyFormDrawerProps) {
  const [values, setValues] = useState<KeyFormValues>(() =>
    editing ? fromKeySpec(editing.name, editing.spec) : EMPTY_KEY_FORM,
  );
  const [advanced, setAdvanced] = useState(() => advancedCount(values) > 0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(values);
  const projects = useKeysContext((s) => s.projects.data) ?? [];
  const users = useKeysContext((s) => s.users.data) ?? [];
  const update = useKeys((s) => s.update);
  const canGrant = usePermission('keys:grant_permissions');
  const team = projects.find((p) => p.name === values.project)?.spec.team;
  const ownerKind = users.find((u) => u.name === values.owner)?.spec.kind;
  const declaredLimits = editing?.spec.policies?.limits as
    Record<string, { per?: string } | undefined> | undefined;

  function set<K extends keyof KeyFormValues>(key: K, value: KeyFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  }

  /** Merges several changed members, clearing their errors. */
  function change(patch: Partial<KeyFormValues>) {
    setValues((v) => ({ ...v, ...patch }));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch))));
  }

  function toggle(key: 'permissions', item: string) {
    setValues((v) => ({
      ...v,
      [key]: v[key].includes(item) ? v[key].filter((x) => x !== item) : [...v[key], item],
    }));
  }

  async function submit() {
    const result = validate(keyFormSchema, values);
    if (!result.ok) {
      setErrors(result.errors);
      if (ADVANCED_FIELDS.some((f) => result.errors[f])) setAdvanced(true);
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        const keepExpiry =
          editing.spec.expires_at !== undefined &&
          values.expiry === 'custom' &&
          values.expiresOn === editing.spec.expires_at.slice(0, 10);
        await update(editing.name, toKeySpec(values, editing.spec, Date.now(), keepExpiry));
        notify('success', 'Key saved', editing.name);
        onClose();
      } else {
        const secret = await createKey({ name: values.name.trim(), spec: toKeySpec(values) });
        onCreated(values.name.trim(), secret);
        setValues(EMPTY_KEY_FORM);
        onClose();
      }
    } catch (e) {
      setError(e);
      setErrors(serverFieldErrors(e, `keys.${values.name.trim()}`));
    } finally {
      setBusy(false);
    }
  }

  const setCount = advancedCount(values);

  return (
    <Drawer
      dirty={edited}
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : 'Create API key'}
      subtitle={
        editing
          ? 'Changes apply right away and are recorded in the audit log.'
          : values.kind === 'jwt'
            ? 'Requests with a token mapped to it get its access and limits.'
            : "You'll see the key once, right after you create it."
      }
      width="lg"
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {editing ? 'Save changes' : 'Create key'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <InlineError error={error} />
        <Section title="Basics">
          {editing ? null : (
            <div className="flex flex-col gap-1.5">
              <span className="text-ui font-medium text-fg" id="key-kind-label">
                Apps prove they hold it with
              </span>
              <Segmented<KeyKind>
                label="Apps prove they hold it with"
                value={values.kind}
                onChange={(v) => set('kind', v)}
                options={[
                  { value: 'secret', label: 'A secret' },
                  { value: 'jwt', label: 'A signed token (JWT)' },
                ]}
                className="w-fit max-w-full"
              />
              <p className="text-caption text-muted">
                {values.kind === 'jwt'
                  ? 'Requests carry a token from your identity provider; the sign-in settings map its issuer and claims to this key. There is no secret to copy or rotate.'
                  : "The gateway makes a secret; you'll see it once, right after you create the key."}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Field
              label="Name"
              error={errors.name}
              required
              hint={editing ? "A key's name can't be changed." : 'Lowercase letters, numbers, - and _'}
            >
              <Input
                mono
                value={values.name}
                onChange={(e) => set('name', e.target.value)}
                readOnly={Boolean(editing)}
                data-autofocus
                placeholder="e.g. support-bot-prod"
                autoComplete="off"
              />
            </Field>
            <Field
              label="Project"
              error={errors.project}
              required
              hint={team ? `In team ${team}` : undefined}
            >
              <Combobox
                value={values.project}
                onChange={(v) => set('project', v)}
                options={(projects.length > 0
                  ? projects
                  : [{ name: 'default', spec: { team: 'default' } }]
                ).map((p) => ({ value: p.name, label: p.name }))}
              />
            </Field>
          </div>
          <Field label="Description" optional error={errors.description}>
            <Textarea
              rows={2}
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="e.g. Support chatbot in production"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Field
              label="Owner"
              hint={
                !values.owner || ownerKind === 'service'
                  ? 'A service key keeps working when people leave.'
                  : 'Keys owned by a person stop working when they leave.'
              }
            >
              <Combobox
                value={values.owner}
                onChange={(v) => set('owner', v)}
                emptyOption="None (service key)"
                options={users.map((u) => ({
                  value: u.name,
                  label: `${u.spec.display_name ?? u.name}${u.spec.kind === 'service' ? ' (service account)' : ''}`,
                }))}
              />
            </Field>
            <Field label="Expires" error={errors.expiresOn}>
              <div className="flex gap-2">
                <Select
                  aria-label="Expires"
                  value={values.expiry}
                  onChange={(v) => set('expiry', v as ExpiryChoice)}
                  options={[
                    { value: '7d', label: 'In 7 days' },
                    { value: '30d', label: 'In 30 days' },
                    { value: '90d', label: 'In 90 days' },
                    { value: '365d', label: 'In 1 year' },
                    { value: 'custom', label: 'On a date' },
                    { value: 'never', label: 'Never' },
                  ]}
                />
                {values.expiry === 'custom' ? (
                  <DatePicker
                    aria-label="Expiry date"
                    value={values.expiresOn}
                    onChange={(v) => set('expiresOn', v)}
                  />
                ) : null}
              </div>
            </Field>
          </div>
        </Section>

        <Section title="Access" description="API keys can't be used for admin access.">
          <EndpointsField id="key" value={values.endpoints} onChange={(v) => set('endpoints', v)} />
          <ModelFields values={values} set={change} errors={errors} />
          <ProviderFields values={values} set={change} errors={errors} />
          <Checkbox
            label="Require an end-user id"
            description="Refuse requests that don't say which of the app's users they are for. Budgets and limits split by end user count them."
            checked={values.endUser === 'required'}
            onChange={(v) =>
              set('endUser', v ? 'required' : editing?.spec.end_user === 'optional' ? 'optional' : '')
            }
          />
        </Section>

        <Section
          title="Tags and metadata"
          description="Labels that budgets, limits, routing and analytics can match and group by."
        >
          <LabelFields values={values} set={change} errors={errors} />
          <Field
            label="Tags a request may add"
            optional
            error={errors.requestTags}
            hint="With the Tag requests permission. Leave blank for any; use * as a wildcard, e.g. env:*."
          >
            <MultiSelect
              mono
              creatable
              noun="tag"
              placeholder="Any tag"
              options={[]}
              value={values.requestTags}
              onChange={(v) => set('requestTags', v)}
            />
          </Field>
        </Section>

        <section className="flex flex-col gap-4 border-t border-line pt-5">
          <button
            type="button"
            aria-expanded={advanced}
            aria-controls="key-advanced"
            onClick={() => setAdvanced(!advanced)}
            className="-mx-1 flex items-center gap-2 rounded-xs px-1 text-left"
          >
            <Icon
              name="chevronRight"
              size={14}
              className={cn('text-muted transition-transform', advanced && 'rotate-90')}
            />
            <span className="text-body font-semibold text-fg">Advanced</span>
            <span className="text-caption text-muted">
              {setCount > 0
                ? `${plural(setCount, 'setting')} on`
                : 'Limits, IP addresses, regions, priority, client certificate and key permissions'}
            </span>
          </button>
          {advanced ? (
            <div id="key-advanced" className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                <Field
                  label={`Rate limit (requests ${limitWindow(declaredLimits?.rpm)})`}
                  optional
                  error={errors.rpm}
                  hint="Leave blank for no limit."
                >
                  <NumberInput
                    steppers
                    min={0}
                    step={10}
                    value={values.rpm}
                    onChange={(v) => set('rpm', v)}
                  />
                </Field>
                <Field
                  label={`Token limit (${limitWindow(declaredLimits?.tpm)})`}
                  optional
                  error={errors.tpm}
                  hint="Leave blank for no limit."
                >
                  <NumberInput
                    steppers
                    min={0}
                    step={1000}
                    value={values.tpm}
                    onChange={(v) => set('tpm', v)}
                  />
                </Field>
              </div>
              <NetworkFields values={values} set={change} errors={errors} />
              <Field
                label="Priority class"
                optional
                error={errors.priorityClass}
                hint="Limits with priority shares keep part of their capacity for each class, such as interactive or batch."
              >
                <Input
                  mono
                  value={values.priorityClass}
                  onChange={(e) => set('priorityClass', e.target.value)}
                  placeholder="e.g. interactive"
                />
              </Field>
              <Field
                label="Client certificate"
                optional
                error={errors.certValue}
                hint={
                  values.certBinding === 'none'
                    ? 'Bind the key to a certificate so it works only over mutual TLS with that certificate.'
                    : 'Requests with this key are refused unless the client certificate verified for the connection matches.'
                }
              >
                <div
                  className={cn(
                    'grid gap-2',
                    values.certBinding !== 'none' && 'grid-cols-[14rem_1fr] max-sm:grid-cols-1',
                  )}
                >
                  <Select
                    aria-label="Client certificate"
                    value={values.certBinding}
                    onChange={(v) => set('certBinding', v as CertBinding)}
                    options={[
                      { value: 'none', label: 'Not required' },
                      { value: 'fingerprint', label: 'SHA-256 fingerprint' },
                      { value: 'san', label: 'Subject alternative name' },
                    ]}
                  />
                  {values.certBinding !== 'none' ? (
                    <Input
                      mono
                      aria-label={
                        values.certBinding === 'fingerprint' ? 'Certificate fingerprint' : 'Certificate name'
                      }
                      value={values.certValue}
                      onChange={(e) => set('certValue', e.target.value)}
                      placeholder={
                        values.certBinding === 'fingerprint'
                          ? 'e.g. 3F:A2:…:9C (64 hexadecimal digits)'
                          : 'e.g. spiffe://acme.test/billing'
                      }
                      autoComplete="off"
                      spellCheck={false}
                    />
                  ) : null}
                </div>
              </Field>
              <fieldset className="flex flex-col gap-3" disabled={!canGrant}>
                <legend className="mb-1 text-ui font-medium text-fg">Key permissions</legend>
                <p className="-mt-1 text-caption text-muted">
                  {canGrant
                    ? 'Extra abilities a request with this key may use. Most keys need none.'
                    : "Your role can't grant key permissions."}
                </p>
                <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-1">
                  {(['Routing', 'Providers', 'Requests'] as const).map((group) => (
                    <div key={group} className="flex flex-col gap-2">
                      <span className="text-caption font-medium text-muted">{group}</span>
                      {KEY_PERMISSIONS.filter((p) => p.group === group).map((p) => (
                        <Tooltip key={p.id} content={p.id} side="bottom">
                          <span>
                            <Checkbox
                              label={p.label}
                              checked={values.permissions.includes(p.id)}
                              onChange={() => toggle('permissions', p.id)}
                            />
                          </span>
                        </Tooltip>
                      ))}
                    </div>
                  ))}
                </div>
              </fieldset>
            </div>
          ) : null}
        </section>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Drawer>
  );
}
