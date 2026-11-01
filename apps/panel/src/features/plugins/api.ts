import { api, listAll } from '@/lib/api/client';
import type { OperationId } from '@/lib/api/operations';
import type { components } from '@/lib/api/schema';

type S = components['schemas'];
export type PluginResource = S['PluginResource'];
export type PluginSpec = PluginResource['spec'];
export type PluginRuntime = S['PluginRuntime'];
export type PoliciesSettings = S['PoliciesSettings'];
export type Attachment = NonNullable<S['PolicyPlugins']['attach']>[number];

/**
 * Plugins (extensions): their declarations, the answering node's call counters, and the gateway
 * level's attachments in `/settings/policies`.
 */
export const pluginsApi = {
  list: (): Promise<PluginResource[]> =>
    listAll((cursor) => api.get('/plugins', { query: { limit: 200, cursor } })),
  runtime: (): Promise<PluginRuntime[]> =>
    listAll((cursor) => api.get('/runtime/plugins', { query: { limit: 200, cursor } })),
  create: (name: string, spec: PluginSpec): Promise<PluginResource> =>
    api.post('/plugins', { body: { name, spec } }),
  replace: (name: string, spec: PluginSpec, etag: string | undefined): Promise<PluginResource> =>
    api.put('/plugins/{name}', { path: { name }, body: { spec }, ifMatch: etag }),
  setEnabled: (name: string, enabled: boolean, etag: string | undefined) =>
    api.patch('/plugins/{name}', { path: { name }, body: { spec: { enabled } }, ifMatch: etag }),
  remove: (name: string, reason?: string) => api.delete('/plugins/{name}', { path: { name }, reason }),
  policies: (): Promise<PoliciesSettings> => api.get('/settings/policies'),
  setAttached: (attach: Attachment[], etag: string | undefined) =>
    api.patch('/settings/policies', { body: { spec: { plugins: { attach } } }, ifMatch: etag }),
};

/** The levels below the gateway whose own policies can attach a plugin. */
export type OwnerKind = 'organization' | 'team' | 'project' | 'key' | 'model' | 'route';

export const OWNER_KINDS: { value: OwnerKind; label: string; list: OperationId; patch: OperationId }[] = [
  { value: 'organization', label: 'Organization', list: 'listOrganizations', patch: 'patchOrganization' },
  { value: 'team', label: 'Team', list: 'listTeams', patch: 'patchTeam' },
  { value: 'project', label: 'Project', list: 'listProjects', patch: 'patchProject' },
  { value: 'key', label: 'API key', list: 'listKeys', patch: 'patchKey' },
  { value: 'model', label: 'Model', list: 'listModels', patch: 'patchModel' },
  { value: 'route', label: 'Route', list: 'listRoutes', patch: 'patchRoute' },
];

/** One level's plugin attachments, as its own `policies.plugins` writes them. */
export interface Owner {
  kind: OwnerKind;
  name: string;
  etag: string | undefined;
  attach: Attachment[];
  detach: string[];
}

interface Owned {
  name: string;
  spec: unknown;
  metadata: { etag?: string };
}

/** A level below the gateway with its `policies` as written. */
export interface PolicyOwner {
  kind: OwnerKind;
  name: string;
  policies: Record<string, unknown>;
}

function ownerOf(kind: OwnerKind, r: Owned): Owner {
  const spec = (r.spec ?? {}) as { policies?: { plugins?: S['PolicyPlugins'] } };
  const plugins = spec.policies?.plugins;
  return {
    kind,
    name: r.name,
    etag: r.metadata.etag,
    attach: plugins?.attach ?? [],
    detach: plugins?.detach ?? [],
  };
}

const page = { limit: 200 };

/** Every level of these kinds with its attachments. */
export async function listOwners(kinds: OwnerKind[]): Promise<Owner[]> {
  return (await readOwners(kinds)).map(([kind, r]) => ownerOf(kind, r));
}

/** Every level of these kinds with its policies, for any member of them. */
export async function listPolicyOwners(kinds: OwnerKind[]): Promise<PolicyOwner[]> {
  return (await readOwners(kinds)).map(([kind, r]) => {
    const spec = (r.spec ?? {}) as { policies?: Record<string, unknown> };
    return { kind, name: r.name, policies: spec.policies ?? {} };
  });
}

async function readOwners(kinds: OwnerKind[]): Promise<[OwnerKind, Owned][]> {
  const read = async (kind: OwnerKind): Promise<Owned[]> => {
    switch (kind) {
      case 'organization':
        return listAll((cursor) => api.get('/organizations', { query: { ...page, cursor } }));
      case 'team':
        return listAll((cursor) => api.get('/teams', { query: { ...page, cursor } }));
      case 'project':
        return listAll((cursor) => api.get('/projects', { query: { ...page, cursor } }));
      case 'key':
        return listAll((cursor) => api.get('/keys', { query: { ...page, cursor } }));
      case 'model':
        return listAll((cursor) => api.get('/models', { query: { ...page, cursor } }));
      case 'route':
        return listAll((cursor) => api.get('/routes', { query: { ...page, cursor } }));
    }
  };
  // A level that can't be read is left out rather than hiding the others.
  const lists = await Promise.allSettled(
    kinds.map(async (k) => (await read(k)).map((r): [OwnerKind, Owned] => [k, r])),
  );
  const fulfilled = lists.flatMap((l) => (l.status === 'fulfilled' ? [l.value] : []));
  if (fulfilled.length === 0 && lists[0]?.status === 'rejected') throw lists[0].reason;
  return fulfilled.flat();
}

/**
 * Writes a level's attach list (a merge patch of `policies.plugins.attach`) with its ETag, and
 * returns the level as written.
 */
export async function patchOwnerAttach(owner: Owner, attach: Attachment[]): Promise<Owner> {
  const body = { spec: { policies: { plugins: { attach: attach.length > 0 ? attach : null } } } };
  const path = { name: owner.name };
  const ifMatch = owner.etag;
  switch (owner.kind) {
    case 'organization':
      return ownerOf(owner.kind, await api.patch('/organizations/{name}', { path, body, ifMatch }));
    case 'team':
      return ownerOf(owner.kind, await api.patch('/teams/{name}', { path, body, ifMatch }));
    case 'project':
      return ownerOf(owner.kind, await api.patch('/projects/{name}', { path, body, ifMatch }));
    case 'key':
      return ownerOf(owner.kind, await api.patch('/keys/{name}', { path, body, ifMatch }));
    case 'model':
      return ownerOf(owner.kind, await api.patch('/models/{name}', { path, body, ifMatch }));
    case 'route':
      return ownerOf(owner.kind, await api.patch('/routes/{name}', { path, body, ifMatch }));
  }
}

export function attachmentName(a: Attachment): string {
  return typeof a === 'string' ? a : a.name;
}
