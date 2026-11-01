import { create } from 'zustand';

import { providersApi, type ProviderModel, type ProviderModelList } from './api';

export interface ProviderModelsEntry {
  /** The last list read, or the models a passing test returned. */
  list: ProviderModelList | null;
  loading: boolean;
  /** Whether the gateway's list was read in this session (a test's models are only the provider's). */
  loaded: boolean;
  /** The read itself failed (not the provider: that is `list.error`). */
  error: unknown;
}

interface ProviderModelsState {
  byProvider: Record<string, ProviderModelsEntry>;
  /** Single ids looked up with `?id=`, by `provider/id`: the model, or null when nothing knows it. */
  resolved: Record<string, ProviderModel | null>;
  /** Reads a provider's models; a list already in memory is shown while it is read again. */
  load: (provider: string, options?: { refresh?: boolean }) => Promise<void>;
  /** Keeps the models a passing test returned, so a form opens with them at once. */
  remember: (provider: string, models: ProviderModel[], at: string) => void;
  /** One model by id, from the list in memory or the gateway (`?id=`). */
  resolve: (provider: string, id: string) => Promise<ProviderModel | null>;
}

const EMPTY: ProviderModelsEntry = { list: null, loading: false, loaded: false, error: null };

/** Listed models first, then the catalog's, each by id. */
export function orderModels(items: ProviderModel[]): ProviderModel[] {
  return [...items].sort(
    (a, b) => Number(b.listed_by_provider) - Number(a.listed_by_provider) || a.id.localeCompare(b.id),
  );
}

/**
 * The models each provider offers, kept for the session: the Add model form lists them and
 * prefills prices from them. A test before saving a provider seeds its list.
 */
export const useProviderModels = create<ProviderModelsState>()((set, get) => ({
  byProvider: {},
  resolved: {},

  async load(provider, options = {}) {
    const entry = get().byProvider[provider] ?? EMPTY;
    set((s) => ({ byProvider: { ...s.byProvider, [provider]: { ...entry, loading: true, error: null } } }));
    try {
      const list = await providersApi.models(provider, options.refresh ? { refresh: true } : {});
      set((s) => ({
        byProvider: {
          ...s.byProvider,
          [provider]: {
            list: { ...list, items: orderModels(list.items) },
            loading: false,
            loaded: true,
            error: null,
          },
        },
      }));
    } catch (error) {
      set((s) => ({
        byProvider: {
          ...s.byProvider,
          [provider]: { ...(s.byProvider[provider] ?? EMPTY), loading: false, loaded: true, error },
        },
      }));
    }
  },

  remember(provider, models, at) {
    set((s) => ({
      byProvider: {
        ...s.byProvider,
        [provider]: {
          list: { items: orderModels(models), source: 'provider', fetched_at: at, error: null },
          loading: false,
          loaded: false,
          error: null,
        },
      },
    }));
  },

  async resolve(provider, id) {
    const listed = get().byProvider[provider]?.list?.items.find((m) => m.id === id);
    if (listed) return listed;
    const key = `${provider}/${id}`;
    if (key in get().resolved) return get().resolved[key] ?? null;
    const answer = await providersApi.models(provider, { id });
    const found = answer.items.find((m) => m.id === id) ?? null;
    set((s) => ({ resolved: { ...s.resolved, [key]: found } }));
    return found;
  },
}));

/** "128K context", "1M context". */
export function contextText(tokens: number | null): string | null {
  if (tokens === null || tokens <= 0) return null;
  if (tokens >= 1_000_000) return `${String(Number((tokens / 1_000_000).toFixed(1)))}M context`;
  if (tokens >= 1000) return `${String(Math.round(tokens / 1000))}K context`;
  return `${String(tokens)} context`;
}
