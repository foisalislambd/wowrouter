'use client';

import { type ReactNode, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Input, MultiSelect, Segmented, Select, Switch } from '@/components/ui/form';
import { CancelButton, Drawer } from '@/components/ui/overlay';
import { InlineError } from '@/components/ui/states';
import type { RouteResource } from '@/lib/api/types';
import { isChangeControl } from '@/lib/api/client';
import { useEdited } from '@/lib/hooks';
import { notify } from '@/stores/ui';

import { ListInput } from '@/features/mcp/components/parts';

import { blankDraft, draftFrom, type RuleDraft, targetsLocked, toTarget } from '../draft';
import {
  mergePatchOf,
  otherPolicies,
  ROUTE_NAME,
  routeSettingsErrors,
  routeSettingsForm,
  type RouteSettingsForm,
  routeSettingsSpec,
} from '../route-form';
import { useRouting } from '../store';
import { isRecord, type Json, nodeTypeLabel, STRATEGIES, type Strategy, strategyOf } from '../types';
import { validateRule } from './rule-wizard';
import { LimitsFields, StrategyStep, TargetsStep } from './wizard-steps';

const NONE: never[] = [];

function Group({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-5 first:border-0 first:pt-0">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-ui font-semibold text-fg">{title}</h3>
        {hint ? <p className="text-caption text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** The errors of a target draft alone: no rule name, no conditions. */
function targetErrors(draft: RuleDraft): Record<string, string> {
  const all = validateRule(draft, { when: true, targets: targetsLocked(draft) });
  return Object.fromEntries(Object.entries(all).filter(([k]) => k !== 'name'));
}

/** The strategy picker of a target drawer: a list, then the wizard's own targets step. */
function TargetFields({
  draft,
  set,
  errors,
}: {
  draft: RuleDraft;
  set: <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => void;
  errors: Record<string, string>;
}) {
  const deployments = useRouting((s) => s.deployments.data) ?? NONE;
  const tiers = useRouting((s) => s.tiers.data) ?? NONE;
  const other = draft.original !== undefined && strategyOf(draft.original) === 'other';
  const locked = targetsLocked(draft);
  return (
    <div className="flex flex-col gap-5">
      {other ? (
        <StrategyStep draft={draft} set={set} locked={nodeTypeLabel(draft.original)} />
      ) : (
        <Field label="Strategy" hint={STRATEGIES.find((s) => s.value === draft.strategy)?.description}>
          <Select
            value={draft.strategy}
            onChange={(v) => set('strategy', v as Strategy)}
            options={STRATEGIES.map((s) => ({ value: s.value, label: s.label }))}
          />
        </Field>
      )}
      <TargetsStep
        draft={draft}
        set={set}
        errors={errors}
        deployments={deployments}
        tiers={tiers}
        locked={locked ? `${nodeTypeLabel(draft.original)} target` : null}
      />
    </div>
  );
}

type RootKind = 'rules' | 'strategy';

/**
 * A new shared route: its name, and either a rule list (the rule wizard writes the first rule) or
 * one strategy for every request. Created with POST, so a name already taken is refused.
 */
export function NewRouteDrawer({
  taken,
  onClose,
  onRules,
  onCreated,
}: {
  taken: string[];
  onClose: () => void;
  /** The route will hold rules: the rule wizard creates it with its first rule. */
  onRules: (name: string) => void;
  onCreated: (name: string) => void;
}) {
  const createRoute = useRouting((s) => s.createRoute);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<RootKind>('rules');
  const [draft, setDraft] = useState<RuleDraft>(() => blankDraft());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  function nameError(): string | undefined {
    const v = name.trim();
    if (!v) return 'Name the route, e.g. support';
    if (!ROUTE_NAME.test(v))
      return 'Letters, digits, ., _ and -, up to 128 characters; start with a letter or digit';
    if (taken.includes(v)) return `Route ${v} already exists`;
    return undefined;
  }

  async function submit() {
    const nameErr = nameError();
    const found = {
      ...(nameErr ? { routeName: nameErr } : {}),
      ...(kind === 'strategy' ? targetErrors(draft) : {}),
    };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const route = name.trim();
    if (kind === 'rules') {
      onRules(route);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createRoute(route, toTarget(draft));
      notify('success', 'Route created', route);
      onCreated(route);
      onClose();
    } catch (e) {
      if (isChangeControl(e)) onClose();
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      dirty={name !== '' || JSON.stringify(draft) !== JSON.stringify(blankDraft())}
      width="lg"
      title="New route"
      subtitle="A shared route that Models send requests to"
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            {kind === 'rules' ? 'Next: first rule' : 'Create route'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <InlineError error={error} />
        <Field
          label="Name"
          required
          error={errors.routeName}
          hint="Models name it to send their requests here. It can’t change later."
        >
          <Input mono value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Sends requests">
          <Segmented<RootKind>
            label="Sends requests"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'rules', label: 'By rules' },
              { value: 'strategy', label: 'With one strategy' },
            ]}
          />
        </Field>
        {kind === 'rules' ? (
          <p className="text-ui text-muted">
            Rules are checked from top to bottom and the first match wins. Next you write the first rule and
            choose where everything else goes.
          </p>
        ) : (
          <TargetFields draft={draft} set={set} errors={errors} />
        )}
      </div>
    </Drawer>
  );
}

type DefaultMode = 'target' | 'error';

/** "Everything else": where a route's requests go when no rule matches, or an error. */
export function DefaultTargetDrawer({ route, onClose }: { route: RouteResource; onClose: () => void }) {
  const saveTree = useRouting((s) => s.saveTree);
  const tree: Json = route.spec.tree;
  const fallback = isRecord(tree) ? tree.default : undefined;
  const start = (): RuleDraft =>
    fallback === undefined || fallback === null
      ? blankDraft()
      : draftFrom({
          index: -1,
          name: 'everything-else',
          description: '',
          enabled: true,
          tags: [],
          when: undefined,
          target: fallback,
        });
  const [mode, setMode] = useState<DefaultMode>(
    fallback === undefined || fallback === null ? 'error' : 'target',
  );
  const [draft, setDraft] = useState<RuleDraft>(start);
  const [initial] = useState<RuleDraft>(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function submit() {
    const found = mode === 'target' ? targetErrors(draft) : {};
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (!isRecord(tree)) return;
    const next: Record<string, Json> = { ...tree };
    if (mode === 'error') Reflect.deleteProperty(next, 'default');
    else next.default = toTarget(draft);
    setBusy(true);
    setError(null);
    try {
      await saveTree(route.name, next);
      notify(
        'success',
        'Everything else saved',
        mode === 'error' ? 'Requests no rule matches get an error.' : route.name,
      );
      onClose();
    } catch (e) {
      if (isChangeControl(e)) onClose();
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      dirty={
        JSON.stringify(draft) !== JSON.stringify(initial) ||
        mode !== (fallback === undefined || fallback === null ? 'error' : 'target')
      }
      width="lg"
      title="Everything else"
      subtitle={`Where requests to route ${route.name} go when no rule matches`}
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <InlineError error={error} />
        <Field label="Requests no rule matches">
          <Segmented<DefaultMode>
            label="Requests no rule matches"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'target', label: 'Go to a target' },
              { value: 'error', label: 'Get an error' },
            ]}
          />
        </Field>
        {mode === 'target' ? (
          <>
            <TargetFields draft={draft} set={set} errors={errors} />
            <LimitsFields draft={draft} set={set} errors={errors} />
          </>
        ) : (
          <p className="text-ui text-muted">The gateway answers them with an error saying no rule matched.</p>
        )}
      </div>
    </Drawer>
  );
}

/**
 * A route's own settings: on or off, session affinity, what happens when every target is
 * unhealthy, the tag filter, and its policies. Only what changed is written, as a merge patch.
 */
export function RouteSettingsDrawer({ route, onClose }: { route: RouteResource; onClose: () => void }) {
  const patchRoute = useRouting((s) => s.patchRoute);
  const guardrails = useRouting((s) => s.guardrails.data) ?? NONE;
  const [v, setV] = useState<RouteSettingsForm>(() => routeSettingsForm(route.spec));
  const [errors, setErrors] = useState<Partial<Record<keyof RouteSettingsForm, string>>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const edited = useEdited(v, true);
  const put = (patch: Partial<RouteSettingsForm>) => setV((prev) => ({ ...prev, ...patch }));
  const others = otherPolicies(route.spec.policies);
  const guardOptions = [...new Set([...guardrails, ...v.guardIn, ...v.guardOut])].map((g) => ({
    value: g,
    label: g,
  }));

  async function submit() {
    const found = routeSettingsErrors(v);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const patch = mergePatchOf(route.spec, routeSettingsSpec(route.spec, v));
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await patchRoute(route.name, patch);
      notify('success', 'Route settings saved', route.name);
      onClose();
    } catch (e) {
      if (isChangeControl(e)) onClose();
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      dirty={edited}
      width="lg"
      title={`Settings of route ${route.name}`}
      subtitle="The route’s name can’t change; its rules are edited on the Rules tab"
      footer={
        <>
          <CancelButton />
          <Button variant="primary" busy={busy} onClick={() => void submit()}>
            Save settings
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <InlineError error={error} />
        <Group title="Route">
          <Switch label="Route on" checked={v.enabled} onChange={(enabled) => put({ enabled })} />
        </Group>

        <Group
          title="Session affinity"
          hint="Requests of one session go to the deployment that served it first, which keeps its prompt cache warm."
        >
          <Switch
            label="Keep sessions on one deployment"
            checked={v.session}
            onChange={(session) => put({ session })}
          />
          {v.session ? (
            <>
              <Field
                label="When that deployment can’t serve"
                hint={
                  v.mode === 'prefer'
                    ? 'The request goes elsewhere and the session moves with it.'
                    : 'The request fails rather than move the session.'
                }
              >
                <Segmented<RouteSettingsForm['mode']>
                  label="When that deployment can’t serve"
                  value={v.mode}
                  onChange={(mode) => put({ mode })}
                  options={[
                    { value: 'prefer', label: 'Move the session' },
                    { value: 'strict', label: 'Fail the request' },
                  ]}
                />
              </Field>
              <Field
                label="Read the session id from"
                optional
                error={errors.sources}
                hint="header:<name> or body:<path>, in order. Empty: the gateway’s list."
              >
                <ListInput noun="place" value={v.sources} onChange={(sources) => put({ sources })} />
              </Field>
              {v.mode === 'prefer' ? (
                <Switch
                  label="Without a session id, group requests by the start of the prompt"
                  checked={v.promptPrefix}
                  onChange={(promptPrefix) => put({ promptPrefix })}
                />
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Sessions are kept apart per">
                  <Select
                    value={v.scope}
                    onChange={(scope) => put({ scope: scope as RouteSettingsForm['scope'] })}
                    options={[
                      { value: 'project', label: 'Project' },
                      { value: 'key', label: 'API key' },
                      { value: 'organization', label: 'Organization' },
                    ]}
                  />
                </Field>
                <Field
                  label="A session is kept for"
                  optional
                  error={errors.ttl}
                  hint="1s to 30d. Empty: the gateway’s, 1h unless set."
                >
                  <Input mono value={v.ttl} onChange={(e) => put({ ttl: e.target.value })} />
                </Field>
              </div>
            </>
          ) : null}
        </Group>

        <Group title="When every target is unhealthy">
          <Field label="Requests then">
            <Select
              value={v.onAllUnhealthy}
              onChange={(o) => put({ onAllUnhealthy: o as RouteSettingsForm['onAllUnhealthy'] })}
              options={[
                { value: '', label: 'Follow the gateway’s setting' },
                { value: 'reject', label: 'Get an error' },
                { value: 'ignore_health', label: 'Try the targets anyway' },
              ]}
            />
          </Field>
        </Group>

        <Group title="Tag filter" hint="A request with tags goes only to deployments that carry one of them.">
          <Switch
            label="Filter deployments by the request’s tags"
            checked={v.tagFilter}
            onChange={(tagFilter) => put({ tagFilter })}
          />
          {v.tagFilter ? (
            <Field
              label="Default tag"
              error={errors.defaultTag}
              hint="Requests with no matching tag go to deployments with this tag."
            >
              <Input mono value={v.defaultTag} onChange={(e) => put({ defaultTag: e.target.value })} />
            </Field>
          ) : null}
        </Group>

        <Group
          title="Policies"
          hint="They apply to every request this route sends, on top of the gateway’s and the key’s."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Requests per minute" optional error={errors.rpm} hint="Empty for no limit here.">
              <Input mono inputMode="numeric" value={v.rpm} onChange={(e) => put({ rpm: e.target.value })} />
            </Field>
            <Field label="Tokens per minute" optional error={errors.tpm} hint="Empty for no limit here.">
              <Input mono inputMode="numeric" value={v.tpm} onChange={(e) => put({ tpm: e.target.value })} />
            </Field>
          </div>
          <Field label="Guardrails on prompts" optional>
            <MultiSelect
              noun="guardrail"
              value={v.guardIn}
              onChange={(guardIn) => put({ guardIn })}
              options={guardOptions}
            />
          </Field>
          <Field label="Guardrails on answers" optional>
            <MultiSelect
              noun="guardrail"
              value={v.guardOut}
              onChange={(guardOut) => put({ guardOut })}
              options={guardOptions}
            />
          </Field>
          <Field
            label="Attempts per request"
            optional
            error={errors.maxAttempts}
            hint="1 to 10. Empty: the gateway’s."
          >
            <Input
              mono
              inputMode="numeric"
              className="w-28"
              value={v.maxAttempts}
              onChange={(e) => put({ maxAttempts: e.target.value })}
            />
          </Field>
          <Switch
            label="Move on to another deployment after a failed attempt"
            checked={v.fallback}
            onChange={(fallback) => put({ fallback })}
          />
          {others ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-ui font-medium text-fg">Other policies</span>
              <pre className="mono max-h-60 overflow-auto rounded-control border border-line bg-sunken px-3 py-2 text-caption text-fg">
                {JSON.stringify(others, null, 2)}
              </pre>
              <p className="text-caption text-muted">Kept as written. Edit them in the configuration.</p>
            </div>
          ) : null}
        </Group>
      </div>
    </Drawer>
  );
}
