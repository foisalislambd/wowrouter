import { create } from 'zustand';

import { api } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';
import { emptySlot, loadSlot, type Slot } from '@/lib/slot';

type S = components['schemas'];

/** The gateway-wide settings the traffic pages read and write, by their `/settings/<key>`. */
export interface TrafficDocs {
  budgets: S['BudgetsSettings'];
  pricing: S['PricingSettings'];
  cache: S['CacheSettings'];
  guardrails: S['GuardrailsSettings'];
  resilience: S['ResilienceSettings'];
  routing: S['RoutingSettings'];
  server: S['ServerSettings'];
  policies: S['PoliciesSettings'];
  catalog: S['CatalogSettings'];
}

export type TrafficKey = keyof TrafficDocs;

type Spec = Record<string, unknown>;

const READ: { [K in TrafficKey]: () => Promise<TrafficDocs[K]> } = {
  budgets: () => api.get('/settings/budgets'),
  pricing: () => api.get('/settings/pricing'),
  cache: () => api.get('/settings/cache'),
  guardrails: () => api.get('/settings/guardrails'),
  resilience: () => api.get('/settings/resilience'),
  routing: () => api.get('/settings/routing'),
  server: () => api.get('/settings/server'),
  policies: () => api.get('/settings/policies'),
  catalog: () => api.get('/settings/catalog'),
};

type Patch = (spec: Spec, ifMatch: string | undefined, reason: string | undefined) => Promise<unknown>;

const PATCH: Record<TrafficKey, Patch> = {
  budgets: (spec, ifMatch, reason) => api.patch('/settings/budgets', { body: { spec }, ifMatch, reason }),
  pricing: (spec, ifMatch, reason) => api.patch('/settings/pricing', { body: { spec }, ifMatch, reason }),
  cache: (spec, ifMatch, reason) => api.patch('/settings/cache', { body: { spec }, ifMatch, reason }),
  guardrails: (spec, ifMatch, reason) =>
    api.patch('/settings/guardrails', { body: { spec }, ifMatch, reason }),
  resilience: (spec, ifMatch, reason) =>
    api.patch('/settings/resilience', { body: { spec }, ifMatch, reason }),
  routing: (spec, ifMatch, reason) => api.patch('/settings/routing', { body: { spec }, ifMatch, reason }),
  server: (spec, ifMatch, reason) => api.patch('/settings/server', { body: { spec }, ifMatch, reason }),
  policies: (spec, ifMatch, reason) => api.patch('/settings/policies', { body: { spec }, ifMatch, reason }),
  catalog: (spec, ifMatch, reason) => api.patch('/settings/catalog', { body: { spec }, ifMatch, reason }),
};

type TrafficState = { [K in TrafficKey]: Slot<TrafficDocs[K]> } & {
  load: (keys: TrafficKey[]) => Promise<void>;
  /** Merge-patches `spec` into `/settings/<key>` against the copy on screen, then reads it again. */
  save: (key: TrafficKey, spec: Spec, reason?: string) => Promise<void>;
};

/**
 * Budgets, pricing, the model catalog, cache, guardrail, resilience, routing, admission and gateway policy settings,
 * as the Traffic pages of Gateway settings read and write them.
 */
export const useTraffic = create<TrafficState>()((set, get) => ({
  budgets: emptySlot(),
  pricing: emptySlot(),
  cache: emptySlot(),
  guardrails: emptySlot(),
  resilience: emptySlot(),
  routing: emptySlot(),
  server: emptySlot(),
  policies: emptySlot(),
  catalog: emptySlot(),
  async load(keys) {
    await Promise.all(keys.map((key) => loadSlot(set, get, key, READ[key])));
  },
  async save(key, spec, reason) {
    await PATCH[key](spec, get()[key].data?.metadata.etag, reason);
    await loadSlot(set, get, key, READ[key], { quiet: true });
  },
}));
