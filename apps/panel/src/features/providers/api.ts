import { api, listAll } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';
import type { DeploymentHealth, DeploymentResource, ProviderResource, ProviderType } from '@/lib/api/types';

type S = components['schemas'];
export type ProviderSpec = S['Provider'];
export type ProviderStatus = S['ProviderStatus'];
export type ProviderTestResult = S['ProviderTestResult'];
export type ProviderModel = S['ProviderModel'];
export type ProviderModelList = S['ProviderModelList'];

/**
 * The gateway's upstream providers: the list, the supported types, create, enable, test (saved or
 * not), rotate, delete, the models each offers, and the runtime state of their keys (health and reset).
 */
export const providersApi = {
  list: (): Promise<ProviderResource[]> =>
    listAll((cursor) => api.get('/providers', { query: { limit: 200, cursor } })),
  types: (): Promise<ProviderType[]> =>
    listAll((cursor) => api.get('/provider-types', { query: { limit: 200, cursor } })),
  status: async (): Promise<ProviderStatus[]> => (await api.get('/runtime/providers')).items,
  deployments: (): Promise<DeploymentResource[]> =>
    listAll((cursor) => api.get('/deployments', { query: { limit: 200, cursor } })),
  create: (name: string, spec: ProviderSpec): Promise<ProviderResource> =>
    api.post('/providers', { body: { name, spec } }),
  setEnabled: (name: string, enabled: boolean, etag: string | undefined) =>
    api.patch('/providers/{name}', { path: { name }, body: { spec: { enabled } }, ifMatch: etag }),
  /** Tests a saved provider's credential (the provider's own list of models, else a minimal call). */
  /** A merge patch of the provider's spec, against the ETag it was read with. */
  patch: (name: string, spec: Record<string, unknown>, etag: string | undefined): Promise<ProviderResource> =>
    api.patch('/providers/{name}', { path: { name }, body: { spec }, ifMatch: etag }),
  test: (name: string, credential?: string): Promise<ProviderTestResult> =>
    api.post('/providers/{name}:test', { path: { name }, ...(credential ? { body: { credential } } : {}) }),
  /** Tests a provider that is not saved: the form's values, as a create would check them. */
  testSpec: (name: string, spec: ProviderSpec): Promise<ProviderTestResult> =>
    api.post('/providers:test', { body: { name, spec } }),
  /** The models a provider offers: its own list with the catalog's details, else the catalog's. */
  models: (
    name: string,
    query: { refresh?: boolean; q?: string; id?: string } = {},
  ): Promise<ProviderModelList> => api.get('/providers/{name}/models', { path: { name }, query }),
  rotateCredential: (name: string, secret: string, overlap: string, key?: string) =>
    api.post('/providers/{name}:rotate_credential', {
      path: { name },
      body: { credential: secret, retire_after: overlap, ...(key ? { key } : {}) },
    }),
  /** Deployment health, for the state of each provider key on each deployment. */
  health: (): Promise<DeploymentHealth[]> =>
    listAll((cursor) => api.get('/runtime/deployments', { query: { limit: 200, cursor } })),
  resetKey: (provider: string, key: string) =>
    api.post('/runtime/providers/{provider}/keys/{key}:reset', { path: { provider, key } }),
  remove: (name: string, reason?: string) => api.delete('/providers/{name}', { path: { name }, reason }),
};
