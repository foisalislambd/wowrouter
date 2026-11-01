import { create } from 'zustand';

import type { DeploymentHealth, DeploymentResource, ProviderResource, ProviderType } from '@/lib/api/types';
import { emptySlot, loadSlot, type Slot } from '@/lib/slot';

import { providersApi, type ProviderSpec, type ProviderStatus, type ProviderTestResult } from './api';
import { useProviderModels } from './models';

interface ProvidersState {
  providers: Slot<ProviderResource[]>;
  status: Slot<ProviderStatus[]>;
  types: Slot<ProviderType[]>;
  deployments: Slot<DeploymentResource[]>;
  health: Slot<DeploymentHealth[]>;
  /** The last test of each provider in this session, the freshest word on its key. */
  tests: Record<string, ProviderTestResult>;
  /** The last test of each key in this session, by `provider/key`. */
  keyTests: Record<string, ProviderTestResult>;
  load: (options?: { quiet?: boolean }) => Promise<void>;
  loadTypes: () => Promise<void>;
  create: (name: string, spec: ProviderSpec) => Promise<ProviderResource>;
  setEnabled: (name: string, enabled: boolean) => Promise<void>;
  remove: (name: string, reason?: string) => Promise<void>;
  resetKey: (provider: string, key: string) => Promise<void>;
  /** Tests a saved provider; the table shows the outcome at once and reads the gateway's again. */
  test: (name: string) => Promise<ProviderTestResult>;
  /** Tests one saved key of a provider. */
  testKey: (name: string, key: string) => Promise<ProviderTestResult>;
  /** Saves a merge patch of a provider's spec with the ETag it was read with. */
  update: (
    name: string,
    patch: Record<string, unknown>,
    etag: string | undefined,
  ) => Promise<ProviderResource>;
}

/**
 * Providers with their credential state, the types a gateway supports, the deployments on each and
 * their health (the state of each provider key).
 */
export const useProviders = create<ProvidersState>()((set, get) => ({
  providers: emptySlot(),
  status: emptySlot(),
  types: emptySlot(),
  deployments: emptySlot(),
  health: emptySlot(),
  tests: {},
  keyTests: {},

  async load(options) {
    await Promise.all([
      loadSlot(set, get, 'providers', providersApi.list, options),
      loadSlot(set, get, 'status', providersApi.status, options),
      loadSlot(set, get, 'deployments', providersApi.deployments, options),
      loadSlot(set, get, 'health', providersApi.health, options),
    ]);
  },

  async loadTypes() {
    if (get().types.data) return;
    await loadSlot(set, get, 'types', providersApi.types);
  },

  async create(name, spec) {
    const created = await providersApi.create(name, spec);
    set((s) => ({
      providers: {
        ...s.providers,
        data: [...(s.providers.data ?? []), created].sort((a, b) => a.name.localeCompare(b.name)),
      },
    }));
    void loadSlot(set, get, 'status', providersApi.status, { quiet: true });
    return created;
  },

  async setEnabled(name, enabled) {
    const p = get().providers.data?.find((x) => x.name === name);
    await providersApi.setEnabled(name, enabled, p?.metadata.etag);
    await loadSlot(set, get, 'providers', providersApi.list, { quiet: true });
  },

  async resetKey(provider, key) {
    await providersApi.resetKey(provider, key);
    await loadSlot(set, get, 'health', providersApi.health, { quiet: true });
  },

  async test(name) {
    const result = await providersApi.test(name);
    set((s) => ({
      tests: { ...s.tests, [name]: result },
      // What the gateway will say once it is read again: working or failed.
      status: s.status.data
        ? {
            ...s.status,
            data: s.status.data.map((p) =>
              p.name === name
                ? {
                    ...p,
                    credential: {
                      ...p.credential,
                      state: result.ok ? (p.credential.state === 'none' ? 'none' : 'valid') : 'failed',
                      last_error: result.ok ? null : result.error,
                    },
                  }
                : p,
            ),
          }
        : s.status,
    }));
    if (result.ok && result.models)
      useProviderModels.getState().remember(name, result.models, result.tested_at);
    void loadSlot(set, get, 'status', providersApi.status, { quiet: true });
    return result;
  },

  async testKey(name, key) {
    const result = await providersApi.test(name, key);
    set((s) => ({ keyTests: { ...s.keyTests, [`${name}/${key}`]: result } }));
    void loadSlot(set, get, 'status', providersApi.status, { quiet: true });
    return result;
  },

  async update(name, patch, etag) {
    const saved = await providersApi.patch(name, patch, etag);
    set((s) => ({
      providers: {
        ...s.providers,
        data: (s.providers.data ?? []).map((x) => (x.name === name ? saved : x)),
      },
    }));
    void loadSlot(set, get, 'status', providersApi.status, { quiet: true });
    void loadSlot(set, get, 'health', providersApi.health, { quiet: true });
    return saved;
  },

  async remove(name, reason) {
    await providersApi.remove(name, reason);
    set((s) => ({
      providers: { ...s.providers, data: (s.providers.data ?? []).filter((p) => p.name !== name) },
    }));
  },
}));
