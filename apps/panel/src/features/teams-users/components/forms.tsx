'use client';

import { useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Checkbox, Combobox, Field, Input, Select } from '@/components/ui/form';
import { CancelButton, Dialog, Drawer } from '@/components/ui/overlay';
import { InlineError } from '@/components/ui/states';
import type {
  OrganizationResource,
  ProjectResource,
  TeamResource,
  UserResource,
  UserSpec,
} from '@/lib/api/types';
import { resourceName, serverFieldErrors, validate, type FieldErrors } from '@/lib/validation';
import { notify } from '@/stores/ui';

import { useDirectory, useOrganizations, useProjects, useTeams, useUsers } from '../store';
import {
  inheritedKeyPolicy,
  projectSchema,
  projectValues,
  type ProjectValues,
  TEAM_COLORS,
  teamSchema,
  teamValues,
  type TeamValues,
  tenantSchema,
  tenantSpec,
  tenantValues,
  type TenantValues,
  toProjectSpec,
  toTeamSpec,
} from '../form';
import { TenantSections } from './tenant-fields';
import {
  ROLE_DESCRIPTIONS,
  SCOPE_KIND_LABEL,
  roleLabel,
  scopeKindFor,
  scopeKinds,
  type ScopeKind,
} from '../types';
import { useEdited } from '@/lib/hooks';

const email = z
  .string()
  .trim()
  .regex(/^[^@\s]+@[^@\s]+$/, 'Enter a valid email address');

const userSchema = z
  .object({
    name: resourceName,
    displayName: z.string().trim().max(200, 'At most 200 characters'),
    email: z.string().trim(),
    title: z.string().trim().max(100, 'At most 100 characters'),
    kind: z.enum(['human', 'service']),
    primaryTeam: z.string(),
    enabled: z.boolean(),
    role: z.string(),
    scope: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'human' && !email.safeParse(v.email).success)
      ctx.addIssue({ code: 'custom', path: ['email'], message: 'People need a valid email' });
  });

type UserValues = z.input<typeof userSchema>;

/** Creates a user (with a first role binding) or edits one. */
export function UserFormDrawer({
  editing,
  kind = 'human',
  onClose,
  onSaved,
}: {
  editing?: UserResource | undefined;
  /** The type a new account starts with ("Create service account" opens it as a service). */
  kind?: 'human' | 'service';
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const teams = useTeams((s) => s.items);
  const roles = useDirectory((s) => s.roles.data) ?? [];
  const create = useUsers((s) => s.create);
  const update = useUsers((s) => s.update);
  const [values, setValues] = useState<UserValues>(() => ({
    name: editing?.name ?? '',
    displayName: editing?.spec.display_name ?? '',
    email: editing?.spec.email ?? '',
    title: editing?.spec.title ?? '',
    kind: editing?.spec.kind ?? kind,
    primaryTeam: editing?.spec.primary_team ?? '',
    enabled: editing?.spec.enabled !== false,
    role: 'developer',
    scope: teams[0] ? `team/${teams[0].name}` : 'organization/default',
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(values);
  const set = <K extends keyof UserValues>(key: K, value: UserValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function submit() {
    const result = validate(userSchema, values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    const v = result.data;
    const spec: UserSpec = {
      ...(editing?.spec ?? {}),
      kind: v.kind,
      enabled: v.enabled,
      ...(v.email ? { email: v.email } : {}),
      ...(v.displayName ? { display_name: v.displayName } : {}),
      ...(v.title ? { title: v.title } : {}),
      ...(v.primaryTeam ? { primary_team: v.primaryTeam } : {}),
    };
    if (!v.displayName) delete spec.display_name;
    if (!v.title) delete spec.title;
    if (!v.primaryTeam) delete spec.primary_team;
    if (!editing && v.role) spec.role_bindings = [{ role: v.role, scope: v.scope }];
    try {
      if (editing) await update(editing.name, spec);
      else await create({ name: v.name, spec });
      notify('success', editing ? 'User saved' : 'User added', v.name);
      onSaved(v.name);
      onClose();
    } catch (e) {
      setError(e);
      setErrors(serverFieldErrors(e, `users.${v.name}`));
    } finally {
      setBusy(false);
    }
  }

  const scopes = [
    { value: 'organization/default', label: 'organization · default' },
    ...teams.map((t) => ({ value: `team/${t.name}`, label: `team · ${t.name}` })),
  ];

  return (
    <Drawer
      dirty={edited}
      open
      onClose={onClose}
      title={
        editing
          ? `Edit ${editing.name}`
          : kind === 'service'
            ? 'Create service account'
            : 'Add user without inviting'
      }
      subtitle={
        editing
          ? "Roles are assigned on the user's page."
          : 'Creates the account right away, with no email. To send a sign-in link, invite them instead.'
      }
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {editing ? 'Save changes' : 'Add user'}
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
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Username"
            error={errors.name}
            required
            hint="Lowercase letters, numbers, - and _. Shown in the audit log."
          >
            <Input
              mono
              value={values.name}
              readOnly={Boolean(editing)}
              onChange={(e) => set('name', e.target.value)}
              data-autofocus
            />
          </Field>
          <Field label="Type">
            <Select
              value={values.kind}
              onChange={(v) => set('kind', v === 'service' ? 'service' : 'human')}
              options={[
                { value: 'human', label: 'Person' },
                { value: 'service', label: 'Service account' },
              ]}
            />
          </Field>
          <Field label="Name" optional error={errors.displayName}>
            <Input
              value={values.displayName}
              onChange={(e) => set('displayName', e.target.value)}
              placeholder="e.g. Ada Lovelace"
            />
          </Field>
          <Field label="Email" error={errors.email} required={values.kind === 'human'}>
            <Input type="email" value={values.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Job title" optional error={errors.title}>
            <Input value={values.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Team" optional>
            <Combobox
              value={values.primaryTeam}
              onChange={(v) => set('primaryTeam', v)}
              emptyOption="None"
              options={teams.map((t) => ({ value: t.name, label: t.spec.display_name ?? t.name }))}
            />
          </Field>
        </div>
        {editing ? null : (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Role">
              <Select
                value={values.role}
                onChange={(v) => set('role', v)}
                emptyOption="No role yet"
                options={roles.map((r) => ({ value: r.name, label: roleLabel(r.name) }))}
              />
            </Field>
            <Field label="Scope">
              <Select value={values.scope} onChange={(v) => set('scope', v)} options={scopes} />
            </Field>
          </div>
        )}
        <Checkbox
          label="Enabled"
          description="A disabled user cannot sign in and their sessions end."
          checked={values.enabled}
          onChange={(v) => set('enabled', v)}
        />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Drawer>
  );
}

/** Creates or edits a team: display name, colour, lead, organization and a monthly budget. */
export function TeamFormDrawer({
  editing,
  onClose,
  onSaved,
}: {
  editing?: TeamResource | undefined;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const orgs = useOrganizations((s) => s.items);
  const users = useUsers((s) => s.items);
  const create = useTeams((s) => s.create);
  const update = useTeams((s) => s.update);
  const [values, setValues] = useState<TeamValues>(() => teamValues(editing, orgs[0]?.name ?? 'default'));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(values);
  const set = <K extends keyof TeamValues>(key: K, value: TeamValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const change = useChange(setValues, setErrors);
  const org = orgs.find((o) => o.name === values.organization);

  async function submit() {
    const result = validate(teamSchema, values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    const v = result.data;
    const spec = toTeamSpec(v, editing?.spec);
    try {
      if (editing) await update(editing.name, spec);
      else await create({ name: v.name, spec });
      await useProjects.getState().fetch({ quiet: true });
      notify('success', editing ? 'Team saved' : 'Team created', v.name);
      onSaved(v.name);
      onClose();
    } catch (e) {
      setError(e);
      setErrors(serverFieldErrors(e, `teams.${v.name}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      dirty={edited}
      open
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : 'Create team'}
      width="lg"
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {editing ? 'Save changes' : 'Create team'}
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
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" error={errors.name} required hint="Lowercase letters, numbers, - and _.">
            <Input
              mono
              value={values.name}
              readOnly={Boolean(editing)}
              onChange={(e) => set('name', e.target.value)}
              data-autofocus
            />
          </Field>
          <Field label="Display name" optional error={errors.displayName}>
            <Input
              value={values.displayName}
              onChange={(e) => set('displayName', e.target.value)}
              placeholder="e.g. Support AI"
            />
          </Field>
          <Field label="Organization" error={errors.organization} required>
            <Combobox
              value={values.organization}
              onChange={(v) => set('organization', v)}
              options={(orgs.length > 0 ? orgs.map((o) => o.name) : ['default']).map((o) => ({
                value: o,
                label: o,
              }))}
            />
          </Field>
          <Field label="Lead" optional>
            <Combobox
              value={values.lead}
              onChange={(v) => set('lead', v)}
              emptyOption="No lead"
              options={users.map((u) => ({ value: u.name, label: u.spec.display_name ?? u.name }))}
            />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-ui font-medium text-fg">Colour</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Team colour">
            {TEAM_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={values.color === c}
                aria-label={c}
                onClick={() => set('color', c)}
                ref={(el) => {
                  if (el) el.style.backgroundColor = c;
                }}
                className={`h-6 w-6 rounded-full border-2 ${values.color === c ? 'border-fg' : 'border-transparent'}`}
              />
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label={`Monthly budget (${values.budgetUnit === 'tokens' ? 'tokens' : 'USD'})`}
            optional
            error={errors.budget}
            hint="Leave blank for no team budget."
          >
            <Input
              mono
              inputMode="decimal"
              value={values.budget}
              onChange={(e) => set('budget', e.target.value)}
            />
          </Field>
          <Field label="When the budget is reached">
            <Select
              value={values.mode}
              onChange={(v) => set('mode', v === 'hard' ? 'hard' : v === 'kept' ? 'kept' : 'soft')}
              options={[
                { value: 'soft', label: 'Alert only' },
                { value: 'hard', label: 'Hard block · requests refused with 402' },
                ...(values.mode === 'kept' ? [{ value: 'kept', label: 'As set on the Budgets page' }] : []),
              ]}
            />
          </Field>
        </div>
        <TenantSections
          values={values}
          change={change}
          errors={errors}
          level="team"
          inherited={inheritedKeyPolicy([{ label: `organization ${values.organization}`, spec: org?.spec }])}
        />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Drawer>
  );
}

/** Edits a project: its team, whether it is on, its access, labels, key lifetimes and limits. */
export function ProjectFormDrawer({ project, onClose }: { project: ProjectResource; onClose: () => void }) {
  const teams = useTeams((s) => s.items);
  const orgs = useOrganizations((s) => s.items);
  const update = useProjects((s) => s.update);
  const [values, setValues] = useState<ProjectValues>(() => projectValues(project));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(values);
  const change = useChange(setValues, setErrors);
  const team = teams.find((t) => t.name === values.team);
  const org = orgs.find((o) => o.name === team?.spec.organization);

  async function submit() {
    const result = validate(projectSchema, values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      await update(project.name, toProjectSpec(values, project.spec));
      notify('success', 'Project saved', project.name);
      onClose();
    } catch (e) {
      setError(e);
      setErrors(serverFieldErrors(e, `projects.${project.name}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      dirty={edited}
      open
      onClose={onClose}
      title={`Edit ${project.name}`}
      subtitle="Changes apply right away and are recorded in the audit log."
      width="lg"
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            Save changes
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
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Field label="Name" hint="A project's name can't be changed.">
            <Input mono value={project.name} readOnly />
          </Field>
          <Field
            label="Team"
            error={errors.team}
            required
            hint={team ? `In organization ${team.spec.organization}` : undefined}
          >
            <Combobox
              value={values.team}
              onChange={(v) => change({ team: v })}
              options={teams.map((t) => ({ value: t.name, label: t.spec.display_name ?? t.name }))}
            />
          </Field>
        </div>
        <Checkbox
          label="Enabled"
          description="A disabled project refuses the requests of its keys until it is enabled again."
          checked={values.enabled}
          onChange={(v) => change({ enabled: v })}
        />
        <TenantSections
          values={values}
          change={change}
          errors={errors}
          level="project"
          inherited={inheritedKeyPolicy([
            { label: `team ${values.team}`, spec: team?.spec },
            { label: `organization ${team?.spec.organization ?? ''}`, spec: org?.spec },
          ])}
        />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Drawer>
  );
}

/**
 * Edits who may call through an organization and its labels. Its key lifetimes, default limits and
 * allow-list are also in Settings › API access.
 */
export function OrganizationAccessDrawer({
  organization,
  onClose,
}: {
  organization: OrganizationResource;
  onClose: () => void;
}) {
  const update = useOrganizations((s) => s.update);
  const [values, setValues] = useState<TenantValues>(() => tenantValues(organization.spec));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(values);
  const change = useChange(setValues, setErrors);

  async function submit() {
    const result = validate(tenantSchema, values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      await update(organization.name, tenantSpec(values, organization.spec));
      notify('success', 'Organization saved', organization.name);
      onClose();
    } catch (e) {
      setError(e);
      setErrors(serverFieldErrors(e, `organizations.${organization.name}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      dirty={edited}
      open
      onClose={onClose}
      title={`Access for ${organization.spec.display_name ?? organization.name}`}
      subtitle="Key lifetimes and default rate limits are in Settings › API access."
      width="lg"
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            Save changes
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4 [&>section:first-of-type]:border-t-0 [&>section:first-of-type]:pt-0"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <InlineError error={error} />
        <TenantSections values={values} change={change} errors={errors} level="organization" />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Drawer>
  );
}

/** A setter that merges changed members into a form's values and clears their errors. */
function useChange<T>(
  setValues: (f: (v: T) => T) => void,
  setErrors: (f: (e: FieldErrors) => FieldErrors) => void,
): (patch: Partial<T>) => void {
  return (patch) => {
    setValues((v) => ({ ...v, ...patch }));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch))));
  };
}

const bindingSchema = z.object({
  role: z.string().min(1, 'Pick a role'),
  kind: z.enum(['gateway', 'organization', 'team', 'project']),
  target: z.string(),
});

/** The names a binding at `kind` can target: organizations, teams or projects; none for the gateway. */
function useScopeTargets(kind: ScopeKind): string[] {
  const teams = useTeams((s) => s.items);
  const projects = useProjects((s) => s.items);
  const orgs = useOrganizations((s) => s.items);
  if (kind === 'organization') return orgs.map((o) => o.name);
  if (kind === 'team') return teams.map((t) => t.name);
  if (kind === 'project') return projects.map((p) => p.name);
  return [];
}

/** The first name a binding at `kind` can target, to preselect it. */
function useFirstTarget(): (kind: ScopeKind) => string {
  const teams = useTeams((s) => s.items);
  const projects = useProjects((s) => s.items);
  const orgs = useOrganizations((s) => s.items);
  return (kind) =>
    (kind === 'organization'
      ? orgs[0]?.name
      : kind === 'team'
        ? teams[0]?.name
        : kind === 'project'
          ? projects[0]?.name
          : '') ?? '';
}

/** Where a role applies: the levels the role can be bound at, and the one to bind at. */
function ScopeFields({
  bindable,
  kind,
  target,
  onChange,
}: {
  bindable: readonly string[] | undefined;
  kind: ScopeKind;
  target: string;
  onChange: (kind: ScopeKind, target: string) => void;
}) {
  const targets = useScopeTargets(kind);
  const first = useFirstTarget();
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Scope">
        <Select
          value={kind}
          onChange={(v) => onChange(v as ScopeKind, first(v as ScopeKind))}
          options={scopeKinds(bindable).map((k) => ({ value: k, label: SCOPE_KIND_LABEL[k] }))}
        />
      </Field>
      {kind === 'gateway' ? null : (
        <Field label={SCOPE_KIND_LABEL[kind]}>
          <Select
            value={target}
            onChange={(v) => onChange(kind, v)}
            placeholder="Select one"
            options={targets.map((t) => ({ value: t, label: t }))}
          />
        </Field>
      )}
    </div>
  );
}

/** Adds a role binding for a user, or for one of their admin tokens, at a scope. */
export function BindingDialog({
  user,
  token,
  onClose,
}: {
  user: string;
  /** Binds the role to this admin token instead of the user. */
  token?: { kid: string; hint: string } | undefined;
  onClose: () => void;
}) {
  const roles = useDirectory((s) => s.roles.data) ?? [];
  const teams = useTeams((s) => s.items);
  const addBinding = useDirectory((s) => s.addBinding);
  const first = useFirstTarget();
  const [values, setValues] = useState({
    role: '',
    kind: 'team' as ScopeKind,
    target: teams[0]?.name ?? '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(values);
  const role = roles.find((r) => r.name === values.role);
  /** A new role keeps the scope while it can be bound there, else moves to a level it allows. */
  function pickRole(name: string) {
    const kind = scopeKindFor(roles.find((r) => r.name === name)?.bindable_at, values.kind);
    setValues({ role: name, kind, target: kind === values.kind ? values.target : first(kind) });
  }

  async function submit() {
    const result = validate(bindingSchema, values);
    if (!result.ok || (values.kind !== 'gateway' && !values.target)) {
      setError(new Error('Pick a role and a scope.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addBinding({
        principal: token ? { type: 'token', id: token.kid } : { type: 'user', id: user },
        role: values.role,
        scope: values.kind === 'gateway' ? 'gateway' : `${values.kind}/${values.target}`,
      });
      notify('success', 'Role assigned', `${roleLabel(values.role)} to ${token ? token.hint : user}`);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      dirty={edited}
      open
      onClose={onClose}
      title={token ? `Give a role to token ${token.hint}` : `Assign a role to ${user}`}
      size="sm"
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            Assign role
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <InlineError error={error} />
        <Field
          label="Role"
          hint={role ? (ROLE_DESCRIPTIONS[role.name] ?? `${role.permissions.length} permissions`) : undefined}
        >
          <Select
            value={values.role}
            onChange={pickRole}
            placeholder="Select a role"
            options={roles.map((r) => ({ value: r.name, label: roleLabel(r.name) }))}
          />
        </Field>
        <ScopeFields
          bindable={role?.bindable_at}
          kind={values.kind}
          target={values.target}
          onChange={(kind, target) => setValues({ ...values, kind, target })}
        />
        <p className="text-caption text-muted">
          {token
            ? `The token gets this role on top of what it does as ${user}. Revoking the token ends it.`
            : 'Admin access is always a role binding; API key scopes never grant it.'}
        </p>
      </div>
    </Dialog>
  );
}

const inviteSchema = z.object({
  email,
  displayName: z.string().trim().max(200),
  role: z.string(),
  kind: z.enum(['gateway', 'organization', 'team', 'project']),
  target: z.string(),
});

/** Invites a person by email with a role at a scope; the gateway emails the link. */
export function InviteDialog({ onClose, onLink }: { onClose: () => void; onLink: (link: string) => void }) {
  const teams = useTeams((s) => s.items);
  const roles = useDirectory((s) => s.roles.data) ?? [];
  const invite = useDirectory((s) => s.invite);
  const first = useFirstTarget();
  const [values, setValues] = useState({
    email: '',
    displayName: '',
    role: 'developer',
    kind: 'team' as ScopeKind,
    target: teams[0]?.name ?? '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(values);
  const role = roles.find((r) => r.name === values.role);
  // The roles load after the dialog opens: the default role's level applies once they have.
  const kind = scopeKindFor(role?.bindable_at, values.kind);
  const target = kind === values.kind ? values.target : first(kind);
  /** A new role keeps the scope while it can be bound there, else moves to a level it allows. */
  function pickRole(name: string) {
    const next = scopeKindFor(roles.find((r) => r.name === name)?.bindable_at, kind);
    setValues({ ...values, role: name, kind: next, target: next === kind ? target : first(next) });
  }
  async function submit() {
    const result = validate(inviteSchema, values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      const scope = kind === 'gateway' ? 'gateway' : target ? `${kind}/${target}` : null;
      const link = await invite({
        email: values.email.trim(),
        ...(values.displayName ? { display_name: values.displayName } : {}),
        role_bindings:
          values.role && scope
            ? [{ principal: { type: 'user', id: values.email.trim() }, role: values.role, scope }]
            : [],
      });
      notify('success', 'Invitation sent', values.email);
      if (link) onLink(link);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      dirty={edited}
      open
      onClose={onClose}
      title="Invite people"
      size="sm"
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            Send invite
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
        <Field label="Email" error={errors.email} required>
          <Input
            type="email"
            value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })}
            data-autofocus
          />
        </Field>
        <Field label="Name" optional>
          <Input
            value={values.displayName}
            onChange={(e) => setValues({ ...values, displayName: e.target.value })}
          />
        </Field>
        <Field label="Role" hint={role ? ROLE_DESCRIPTIONS[role.name] : undefined}>
          <Select
            value={values.role}
            onChange={pickRole}
            options={roles.map((r) => ({ value: r.name, label: roleLabel(r.name) }))}
          />
        </Field>
        <ScopeFields
          bindable={role?.bindable_at}
          kind={kind}
          target={target}
          onChange={(k, t) => setValues({ ...values, kind: k, target: t })}
        />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
