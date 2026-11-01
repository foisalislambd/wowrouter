import { z } from 'zod';

import type { DeploymentResource, ModelResource, ModelSpec, RouteResource } from '@/lib/api/types';
import { resourceName, splitList } from '@/lib/validation';

import { collectLeaves } from './types';

export interface AddModelValues {
  name: string;
  displayName: string;
  deploymentMode: 'new' | 'existing';
  existingDeployment: string;
  provider: string;
  upstreamModel: string;
  tier: string;
  lifecycle: 'ga' | 'preview' | 'restricted';
  labels: string;
  description: string;
  inputPrice: string;
  outputPrice: string;
  accessTeams: string;
}

export const EMPTY_ADD_MODEL: AddModelValues = {
  name: '',
  displayName: '',
  deploymentMode: 'new',
  existingDeployment: '',
  provider: '',
  upstreamModel: '',
  tier: 'balanced',
  lifecycle: 'ga',
  labels: '',
  description: '',
  inputPrice: '',
  outputPrice: '',
  accessTeams: '',
};

const label = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const optionalMoney = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d+(\.\d{1,9})?$/.test(v), 'Enter a price in US dollars, e.g. 2.50');

/** The name apps send (`gpt-4o`, `meta/llama-3.1:8b`), with errors that say what to type. */
const modelName = z
  .string()
  .trim()
  .min(1, 'Enter the name apps will send, e.g. gpt-4o-mini')
  .max(128, 'Use at most 128 characters')
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    'Use letters, digits and . _ : / - only, starting with a letter or digit',
  );

const labelList = z
  .string()
  .refine(
    (v) => splitList(v).every((l) => label.test(l)),
    'Use lowercase labels separated by commas, e.g. chat, vision',
  );

const teamList = z
  .string()
  .refine(
    (v) => splitList(v).every((t) => resourceName.safeParse(t).success),
    'Enter team names separated by commas, e.g. support, search',
  );

export const addModelSchema = z
  .object({
    name: modelName,
    displayName: z.string().trim().max(200, 'Use at most 200 characters'),
    deploymentMode: z.enum(['new', 'existing']),
    existingDeployment: z.string(),
    provider: z.string(),
    upstreamModel: z.string().trim(),
    tier: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, 'Select a tier'),
    lifecycle: z.enum(['ga', 'preview', 'restricted']),
    labels: labelList,
    description: z.string().max(1024, 'Use at most 1,024 characters'),
    inputPrice: optionalMoney,
    outputPrice: optionalMoney,
    accessTeams: teamList,
  })
  .superRefine((v, ctx) => {
    if (v.deploymentMode === 'existing' && !v.existingDeployment)
      ctx.addIssue({ code: 'custom', path: ['existingDeployment'], message: 'Select a deployment' });
    if (v.deploymentMode === 'new') {
      if (!v.provider) ctx.addIssue({ code: 'custom', path: ['provider'], message: 'Select a provider' });
      if (!v.upstreamModel)
        ctx.addIssue({
          code: 'custom',
          path: ['upstreamModel'],
          message: 'Enter the model ID the provider uses, e.g. gpt-4o-mini',
        });
      if ((v.inputPrice === '') !== (v.outputPrice === ''))
        ctx.addIssue({
          code: 'custom',
          path: ['outputPrice'],
          message: 'Set both prices, or leave both blank to use list prices',
        });
    }
  });

/**
 * The deployments no Model routes to (its target or route, followed into shared routes): set up
 * in the configuration, or left after their Model was deleted.
 */
export function unusedDeployments(
  deployments: DeploymentResource[],
  models: ModelResource[],
  routes: RouteResource[],
): DeploymentResource[] {
  const map = new Map(routes.map((r) => [r.name, r]));
  const used = new Set<string>();
  for (const m of models) {
    const tree = (m.spec.target ?? (m.spec.route ? { route: m.spec.route } : null)) as Parameters<
      typeof collectLeaves
    >[0];
    for (const leaf of collectLeaves(tree, map)) used.add(leaf);
  }
  return deployments.filter((d) => !used.has(d.name));
}

/** A deployment name for a provider and upstream model: `openai-gpt-4o`. */
export function deploymentNameFor(provider: string, upstream: string): string {
  return `${provider}-${upstream}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63);
}

export function toModelSpec(v: AddModelValues): ModelSpec {
  const labels = splitList(v.labels);
  const teams = splitList(v.accessTeams);
  return {
    ...(v.displayName.trim() ? { display_name: v.displayName.trim() } : {}),
    ...(v.description.trim() ? { description: v.description.trim() } : {}),
    tier: v.tier,
    lifecycle: { state: v.lifecycle },
    ...(labels.length > 0 ? { labels } : {}),
    ...(v.lifecycle !== 'ga' && teams.length > 0 ? { access: { teams } } : {}),
  };
}

export interface EditModelValues {
  displayName: string;
  tier: string;
  description: string;
  labels: string;
  lifecycle: 'ga' | 'preview' | 'restricted' | 'deprecated';
  eolAt: string;
  replacement: string;
  accessTeams: string;
  /** What it serves from: a tree of its own, or a shared route. */
  serves: 'own' | 'route';
  route: string;
  /** The deployment a Model leaving a shared route starts its own tree with. */
  deployment: string;
  /** Whether it had a tree of its own when the form opened. */
  hadTarget: boolean;
  /** Listed in `/v1/models` (public) or left out of it (internal); requests work either way. */
  visibility: 'public' | 'internal';
  family: string;
  version: string;
  revision: string;
  releasedAt: string;
  ownedBy: string;
  annotations: { key: string; value: string }[];
}

export const editModelSchema = z
  .object({
    displayName: z.string().trim().max(200, 'Use at most 200 characters'),
    tier: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, 'Select a tier'),
    description: z.string().max(1024, 'Use at most 1,024 characters'),
    labels: labelList,
    lifecycle: z.enum(['ga', 'preview', 'restricted', 'deprecated']),
    eolAt: z.string(),
    replacement: z.string(),
    accessTeams: teamList,
    serves: z.enum(['own', 'route']),
    route: z.string(),
    deployment: z.string(),
    hadTarget: z.boolean(),
    visibility: z.enum(['public', 'internal']),
    family: z.string().trim().max(100, 'Use at most 100 characters'),
    version: z.string().trim().max(100, 'Use at most 100 characters'),
    revision: z.string().trim().max(100, 'Use at most 100 characters'),
    releasedAt: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
    ownedBy: z.string().trim().max(128, 'Use at most 128 characters'),
    annotations: z
      .array(z.object({ key: z.string(), value: z.string() }))
      .max(32, 'Use at most 32 annotations'),
  })
  .superRefine((v, ctx) => {
    const keys = new Set<string>();
    v.annotations.forEach((a, i) => {
      const key = a.key.trim();
      if (!key && !a.value.trim()) return;
      if (!key || key.length > 64)
        ctx.addIssue({
          code: 'custom',
          path: ['annotations'],
          message: `Annotation ${String(i + 1)}: a name of 1 to 64 characters`,
        });
      else if (keys.has(key))
        ctx.addIssue({ code: 'custom', path: ['annotations'], message: `${key} is listed twice` });
      else if (a.value.length > 512)
        ctx.addIssue({
          code: 'custom',
          path: ['annotations'],
          message: `${key}: use at most 512 characters`,
        });
      keys.add(key);
    });
    if (v.lifecycle === 'deprecated' && !v.eolAt)
      ctx.addIssue({ code: 'custom', path: ['eolAt'], message: 'Choose the date it stops working' });
    if (v.serves === 'route' && !v.route)
      ctx.addIssue({ code: 'custom', path: ['route'], message: 'Select the shared route it follows' });
    if (v.serves === 'own' && !v.hadTarget && !v.deployment)
      ctx.addIssue({ code: 'custom', path: ['deployment'], message: 'Select the deployment it sends to' });
  });

export function fromModelSpec(spec: ModelSpec): EditModelValues {
  return {
    displayName: spec.display_name ?? '',
    tier: spec.tier ?? 'balanced',
    description: spec.description ?? '',
    labels: (spec.labels ?? []).join(', '),
    lifecycle: spec.lifecycle?.state ?? 'ga',
    eolAt: spec.lifecycle?.eol_at?.slice(0, 10) ?? '',
    replacement: spec.lifecycle?.replacement ?? '',
    accessTeams: (spec.access?.teams ?? []).join(', '),
    serves: spec.route ? 'route' : 'own',
    route: spec.route ?? '',
    deployment: '',
    hadTarget: spec.target !== undefined && spec.target !== null,
    visibility: spec.visibility ?? 'public',
    family: spec.catalog?.family ?? '',
    version: spec.catalog?.version ?? '',
    revision: spec.catalog?.revision ?? '',
    releasedAt: spec.catalog?.released_at ?? '',
    ownedBy: spec.owned_by ?? '',
    annotations: Object.entries(spec.annotations ?? {}).map(([key, value]) => ({ key, value })),
  };
}

/** Sets a member when the text is set, removes it otherwise. */
function putText<T extends object>(target: T, key: keyof T, value: string): void {
  const v = value.trim();
  if (v) (target as Record<keyof T, unknown>)[key] = v;
  else Reflect.deleteProperty(target, key);
}

/**
 * The listing, catalog, owner and annotations of the edit form over a spec: a field left as it
 * was keeps the spec's value as written.
 */
function applyCatalogEdit(spec: ModelSpec, v: EditModelValues): ModelSpec {
  const init = fromModelSpec(spec);
  const out: ModelSpec = { ...spec };
  if (v.visibility !== init.visibility) {
    if (v.visibility === 'internal') out.visibility = 'internal';
    else delete out.visibility;
  }
  const catalogFields = [
    ['family', 'family'],
    ['version', 'version'],
    ['revision', 'revision'],
    ['releasedAt', 'released_at'],
  ] as const;
  if (catalogFields.some(([f]) => v[f] !== init[f])) {
    const catalog: NonNullable<ModelSpec['catalog']> = { ...(spec.catalog ?? {}) };
    for (const [f, key] of catalogFields) if (v[f] !== init[f]) putText(catalog, key, v[f]);
    if (Object.keys(catalog).length > 0) out.catalog = catalog;
    else delete out.catalog;
  }
  if (v.ownedBy !== init.ownedBy) putText(out, 'owned_by', v.ownedBy);
  if (JSON.stringify(v.annotations) !== JSON.stringify(init.annotations)) {
    const map = Object.fromEntries(
      v.annotations.filter((a) => a.key.trim()).map((a) => [a.key.trim(), a.value]),
    );
    if (Object.keys(map).length > 0) out.annotations = map;
    else delete out.annotations;
  }
  return out;
}

/** Applies the edit form over the Model's spec, keeping its tree, aliases and policies. */
export function applyModelEdit(spec: ModelSpec, v: EditModelValues): ModelSpec {
  const labels = splitList(v.labels);
  const teams = splitList(v.accessTeams);
  const lifecycle: NonNullable<ModelSpec['lifecycle']> = { state: v.lifecycle };
  if (v.lifecycle === 'deprecated') {
    lifecycle.eol_at = `${v.eolAt}T00:00:00Z`;
    if (v.replacement) lifecycle.replacement = v.replacement;
  }
  const {
    display_name: _d,
    description: _desc,
    labels: _l,
    access: _a,
    route: _r,
    target: _t,
    ...rest
  } = applyCatalogEdit(spec, v);
  const tree: Pick<ModelSpec, 'route' | 'target'> =
    v.serves === 'route'
      ? { route: v.route }
      : v.hadTarget
        ? { target: spec.target }
        : { target: v.deployment };
  return {
    ...rest,
    ...tree,
    tier: v.tier,
    lifecycle,
    ...(v.displayName.trim() ? { display_name: v.displayName.trim() } : {}),
    ...(v.description.trim() ? { description: v.description.trim() } : {}),
    ...(labels.length > 0 ? { labels } : {}),
    ...(teams.length > 0 || spec.access ? { access: { ...(spec.access ?? {}), teams } } : {}),
  };
}
