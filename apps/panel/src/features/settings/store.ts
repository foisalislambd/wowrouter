import { create } from 'zustand';

import type {
  ApplyResult,
  AuditEntry,
  DeploymentHealth,
  DiffResult,
  Health,
  OrganizationResource,
  ProviderResource,
  ValidateResult,
} from '@/lib/api/types';
import { hasGatewayPermission, useSession } from '@/stores/session';
import { asApiError, emptySlot, loadSlot, type Slot } from '@/lib/slot';

import {
  type AuditQuery,
  type GovernanceSettings,
  type AuditSinkStatus,
  type ConfigDoc,
  type Convergence,
  type ClusterView,
  type ProviderStatus,
  settingsApi,
} from './api';

type SettingsResource = Awaited<ReturnType<typeof settingsApi.authSettings>>;

interface ConfigState {
  document: Slot<{ doc: ConfigDoc; etag: string | null }>;
  draft: string;
  parseError: string | null;
  diff: Slot<DiffResult>;
  /** The gateway's checks of the draft, run with the diff by Review changes. */
  validation: Slot<ValidateResult>;
  applied: Slot<ApplyResult>;
  /** What made the last version from here: an apply or a rollback (to that version). */
  appliedBy: { kind: 'apply' } | { kind: 'rollback'; to: number } | null;
  /** Whether every node runs the version the last apply or rollback made. */
  convergence: ConvergenceState | null;
  loadDocument: () => Promise<void>;
  setDraft: (text: string) => void;
  runDiff: () => Promise<void>;
  apply: (reason?: string) => Promise<ApplyResult | null>;
  /** Records a rollback's new version like an apply's, and follows it to every node. */
  rolledBack: (to: number, result: ApplyResult) => Promise<void>;
}

/**
 * Following a new configuration version to every node: `checking` until the first answer,
 * `waiting` while some nodes lag, `converged` once all run it, `lagging` when they still did not
 * after every wait, `unknown` when the cluster can't be asked (no permission, or the call failed).
 */
export interface ConvergenceState {
  generation: number;
  state: 'checking' | 'waiting' | 'converged' | 'lagging' | 'unknown';
  lagging: string[];
}

/** How many times the cluster is asked, each waiting up to `CONVERGE_WAIT`, before giving up. */
export const CONVERGE_ATTEMPTS = 6;
export const CONVERGE_WAIT = '10s';

function parseDraft(text: string): { doc: ConfigDoc | null; error: string | null } {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return { doc: null, error: 'The document must be a JSON object.' };
    return { doc: value as ConfigDoc, error: null };
  } catch (e) {
    return { doc: null, error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
}

/** The configuration document: export, edit as JSON, diff against the running generation, apply. */
export const useConfigDoc = create<ConfigState>()((set, get) => {
  /** Asks the cluster until every node runs `generation`, unless a newer version took over. */
  async function follow(generation: number, propagated: boolean) {
    const mine = () => get().convergence?.generation === generation;
    if (!hasGatewayPermission(useSession.getState().me, 'cluster:read')) {
      set({ convergence: { generation, state: propagated ? 'converged' : 'unknown', lagging: [] } });
      return;
    }
    set({ convergence: { generation, state: 'checking', lagging: [] } });
    for (let i = 0; i < CONVERGE_ATTEMPTS; i++) {
      let answer: Convergence;
      try {
        answer = await settingsApi.converged(generation, CONVERGE_WAIT);
      } catch {
        if (mine()) set({ convergence: { generation, state: 'unknown', lagging: [] } });
        return;
      }
      if (!mine()) return;
      if (answer.converged) {
        set({ convergence: { generation, state: 'converged', lagging: [] } });
        return;
      }
      set({ convergence: { generation, state: 'waiting', lagging: answer.lagging ?? [] } });
    }
    if (mine())
      set({ convergence: { generation, state: 'lagging', lagging: get().convergence?.lagging ?? [] } });
  }

  return {
    document: emptySlot(),
    draft: '',
    parseError: null,
    diff: emptySlot(),
    validation: emptySlot(),
    applied: emptySlot(),
    appliedBy: null,
    convergence: null,

    async loadDocument() {
      await loadSlot(set, get, 'document', settingsApi.exportConfig);
      const doc = get().document.data?.doc;
      if (doc)
        set({
          draft: JSON.stringify(doc, null, 2),
          parseError: null,
          diff: emptySlot(),
          validation: emptySlot(),
        });
    },

    setDraft(text) {
      set({ draft: text, parseError: parseDraft(text).error, diff: emptySlot(), validation: emptySlot() });
    },

    async runDiff() {
      const { doc, error } = parseDraft(get().draft);
      if (!doc) {
        set({ parseError: error });
        return;
      }
      await Promise.all([
        loadSlot(set, get, 'validation', () => settingsApi.validate(doc)),
        loadSlot(set, get, 'diff', () => settingsApi.diff(doc)),
      ]);
    },

    async apply(reason) {
      const { doc, error } = parseDraft(get().draft);
      if (!doc) {
        set({ parseError: error });
        return null;
      }
      set({ applied: { ...get().applied, status: 'loading', error: null } });
      try {
        const result = await settingsApi.apply(doc, get().document.data?.etag ?? null, reason);
        set({
          applied: { data: result, status: 'ready', error: null, at: Date.now() },
          appliedBy: { kind: 'apply' },
        });
        await get().loadDocument();
        void follow(result.generation, result.propagated);
        return result;
      } catch (e) {
        set({ applied: { data: null, status: 'error', error: asApiError(e), at: null }, appliedBy: null });
        throw e;
      }
    },

    async rolledBack(to, result) {
      set({
        applied: { data: result, status: 'ready', error: null, at: Date.now() },
        appliedBy: { kind: 'rollback', to },
      });
      await get().loadDocument();
      void follow(result.generation, result.propagated);
    },
  };
});

interface AuditState {
  query: AuditQuery;
  entries: Slot<AuditEntry[]>;
  cursor: string | null;
  setQuery: (query: AuditQuery) => void;
  load: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Every entry the filters match, not only the loaded pages, up to `AUDIT_EXPORT_MAX`. */
  exportAll: () => Promise<{ entries: AuditEntry[]; complete: boolean }>;
}

/** The most entries one export reads (pages of `AUDIT_EXPORT_PAGE`). */
export const AUDIT_EXPORT_PAGE = 500;
export const AUDIT_EXPORT_MAX = 50_000;

/** The audit log with its filters and cursor; reads are left out on the server unless asked for. */
export const useAudit = create<AuditState>()((set, get) => ({
  query: { kind: 'write' },
  entries: emptySlot(),
  cursor: null,
  setQuery(query) {
    set({ query });
  },
  async load() {
    let cursor: string | null = null;
    await loadSlot(set, get, 'entries', async () => {
      const page = await settingsApi.audit(get().query);
      cursor = page.next_cursor ?? null;
      return page.items;
    });
    set({ cursor });
  },
  async loadMore() {
    const cursor = get().cursor;
    if (!cursor) return;
    const page = await settingsApi.audit(get().query, cursor);
    set((s) => ({
      entries: { ...s.entries, data: [...(s.entries.data ?? []), ...page.items] },
      cursor: page.next_cursor ?? null,
    }));
  },
  async exportAll() {
    const query = get().query;
    const entries: AuditEntry[] = [];
    let cursor: string | undefined;
    while (entries.length < AUDIT_EXPORT_MAX) {
      const page = await settingsApi.audit(query, cursor, AUDIT_EXPORT_PAGE);
      entries.push(...page.items);
      if (!page.next_cursor) return { entries, complete: true };
      cursor = page.next_cursor;
    }
    return { entries, complete: false };
  },
}));

interface RuntimeState {
  health: Slot<Health>;
  deployments: Slot<DeploymentHealth[]>;
  providerStatus: Slot<ProviderStatus[]>;
  /** The cluster: mode, nodes with their load, background job leases and totals. */
  cluster: Slot<ClusterView>;
  providers: Slot<ProviderResource[]>;
  auditSinks: Slot<AuditSinkStatus[]>;
  load: (options?: { quiet?: boolean }) => Promise<void>;
  loadProviders: () => Promise<void>;
  /** Re-reads the deployments' health, after one is turned off, on or resumed. */
  loadDeployments: () => Promise<void>;
  setProviderEnabled: (name: string, enabled: boolean) => Promise<void>;
}

/** Runtime health: dependencies, admission, the cluster's nodes, deployments and providers. */
export const useRuntime = create<RuntimeState>()((set, get) => ({
  health: emptySlot(),
  deployments: emptySlot(),
  providerStatus: emptySlot(),
  cluster: emptySlot(),
  providers: emptySlot(),
  auditSinks: emptySlot(),
  async load(options) {
    await Promise.all([
      loadSlot(set, get, 'health', settingsApi.health, options),
      loadSlot(set, get, 'deployments', settingsApi.deployments, options),
      loadSlot(set, get, 'providerStatus', settingsApi.providerStatus, options),
      loadSlot(set, get, 'cluster', settingsApi.cluster, options),
    ]);
  },
  async loadProviders() {
    await Promise.all([
      loadSlot(set, get, 'providers', settingsApi.providers),
      loadSlot(set, get, 'providerStatus', settingsApi.providerStatus),
      loadSlot(set, get, 'auditSinks', settingsApi.auditSinks),
    ]);
  },
  async loadDeployments() {
    await loadSlot(set, get, 'deployments', settingsApi.deployments, { quiet: true });
  },
  async setProviderEnabled(name, enabled) {
    const p = get().providers.data?.find((x) => x.name === name);
    await settingsApi.setProviderEnabled(name, enabled, p?.metadata.etag);
    await loadSlot(set, get, 'providers', settingsApi.providers, { quiet: true });
  },
}));

interface OrgSettingsState {
  organization: Slot<OrganizationResource>;
  auth: Slot<SettingsResource>;
  observability: Slot<Awaited<ReturnType<typeof settingsApi.observabilitySettings>>>;
  limits: Slot<Awaited<ReturnType<typeof settingsApi.limitsSettings>>>;
  security: Slot<Awaited<ReturnType<typeof settingsApi.securitySettings>>>;
  loadOrganization: (name: string) => Promise<void>;
  saveOrganization: (
    name: string,
    spec: Partial<OrganizationResource['spec']>,
    reason?: string,
  ) => Promise<void>;
  loadSettings: () => Promise<void>;
  /** Only `observability`, for pages that need nothing else. */
  loadObservability: () => Promise<void>;
  saveAuth: (spec: Record<string, unknown>, reason?: string) => Promise<void>;
  saveObservability: (spec: Record<string, unknown>, reason?: string) => Promise<void>;
  saveSecurity: (spec: Record<string, unknown>, reason?: string) => Promise<void>;
  saveLimits: (spec: Record<string, unknown>, reason?: string) => Promise<void>;
}

/** The settings singletons and the scope's organization, as the Settings sections read and write them. */
export const useOrgSettings = create<OrgSettingsState>()((set, get) => ({
  organization: emptySlot(),
  auth: emptySlot(),
  observability: emptySlot(),
  limits: emptySlot(),
  security: emptySlot(),
  loadOrganization: (name) => loadSlot(set, get, 'organization', () => settingsApi.organization(name)),
  async saveOrganization(name, spec, reason) {
    const current = get().organization.data;
    await settingsApi.patchOrganization(
      name,
      spec,
      current?.name === name ? current.metadata.etag : undefined,
      reason,
    );
    await get().loadOrganization(name);
  },
  async loadSettings() {
    await Promise.all([
      loadSlot(set, get, 'auth', settingsApi.authSettings),
      loadSlot(set, get, 'observability', settingsApi.observabilitySettings),
      loadSlot(set, get, 'limits', settingsApi.limitsSettings),
      loadSlot(set, get, 'security', settingsApi.securitySettings),
    ]);
  },
  loadObservability: () => loadSlot(set, get, 'observability', settingsApi.observabilitySettings),
  async saveAuth(spec, reason) {
    await settingsApi.patchAuthSettings(spec, get().auth.data?.metadata.etag, reason);
    await loadSlot(set, get, 'auth', settingsApi.authSettings, { quiet: true });
  },
  async saveObservability(spec, reason) {
    await settingsApi.patchObservabilitySettings(spec, get().observability.data?.metadata.etag, reason);
    await loadSlot(set, get, 'observability', settingsApi.observabilitySettings, { quiet: true });
  },
  async saveSecurity(spec, reason) {
    await settingsApi.patchSecurity(spec, get().security.data?.metadata.etag, reason);
    await loadSlot(set, get, 'security', settingsApi.securitySettings, { quiet: true });
  },
  async saveLimits(spec, reason) {
    await settingsApi.patchLimits(spec, get().limits.data?.metadata.etag, reason);
    await loadSlot(set, get, 'limits', settingsApi.limitsSettings, { quiet: true });
  },
}));

type Read<F extends () => Promise<unknown>> = Slot<Awaited<ReturnType<F>>>;

interface GatewaySettingsState {
  api: Read<typeof settingsApi.apiSettings>;
  streaming: Read<typeof settingsApi.streamingSettings>;
  server: Read<typeof settingsApi.serverSettings>;
  admin: Read<typeof settingsApi.adminSettings>;
  store: Read<typeof settingsApi.storeSettings>;
  cluster: Read<typeof settingsApi.clusterSettings>;
  loadApi: () => Promise<void>;
  saveApi: (spec: Record<string, unknown>, reason?: string) => Promise<void>;
  saveStreaming: (spec: Record<string, unknown>, reason?: string) => Promise<void>;
  /** The startup settings (server, admin, store, cluster), as the configuration file set them. */
  loadNode: () => Promise<void>;
  /** Only `admin`: the audit retention and the apply lock, for the Audit log and Configuration pages. */
  loadAdmin: () => Promise<void>;
}

/** The API & endpoints page and the read-only Node page. */
export const useGatewaySettings = create<GatewaySettingsState>()((set, get) => ({
  api: emptySlot(),
  streaming: emptySlot(),
  server: emptySlot(),
  admin: emptySlot(),
  store: emptySlot(),
  cluster: emptySlot(),
  async loadApi() {
    await Promise.all([
      loadSlot(set, get, 'api', settingsApi.apiSettings),
      loadSlot(set, get, 'streaming', settingsApi.streamingSettings),
    ]);
  },
  async saveApi(spec, reason) {
    await settingsApi.patchApi(spec, get().api.data?.metadata.etag, reason);
    await loadSlot(set, get, 'api', settingsApi.apiSettings, { quiet: true });
  },
  async saveStreaming(spec, reason) {
    await settingsApi.patchStreaming(spec, get().streaming.data?.metadata.etag, reason);
    await loadSlot(set, get, 'streaming', settingsApi.streamingSettings, { quiet: true });
  },
  loadAdmin: () => loadSlot(set, get, 'admin', settingsApi.adminSettings),
  async loadNode() {
    await Promise.all([
      loadSlot(set, get, 'server', settingsApi.serverSettings),
      loadSlot(set, get, 'admin', settingsApi.adminSettings),
      loadSlot(set, get, 'store', settingsApi.storeSettings),
      loadSlot(set, get, 'cluster', settingsApi.clusterSettings),
    ]);
  },
}));

type Roles = Awaited<ReturnType<typeof settingsApi.roles>>;
type Named = { name: string }[];

interface DirectoryState {
  users: Slot<Awaited<ReturnType<typeof settingsApi.users>>>;
  roles: Slot<Roles>;
  /** Every scope a role binding can name: the gateway, organizations, teams and projects. */
  scopes: Slot<string[]>;
  loadUsers: () => Promise<void>;
  loadRoles: () => Promise<void>;
}

const names = async (read: () => Promise<Named>, kind: string): Promise<string[]> => {
  try {
    return (await read()).map((r) => `${kind}/${r.name}`);
  } catch {
    return [];
  }
};

/** People (for sign-in coverage and counts per provider), roles and binding scopes. */
export const useDirectory = create<DirectoryState>()((set, get) => ({
  users: emptySlot(),
  roles: emptySlot(),
  scopes: emptySlot(),
  loadUsers: () => loadSlot(set, get, 'users', settingsApi.users),
  async loadRoles() {
    await Promise.all([
      loadSlot(set, get, 'roles', settingsApi.roles),
      loadSlot(set, get, 'scopes', async () => [
        'gateway',
        ...(await names(settingsApi.organizations, 'organization')),
        ...(await names(settingsApi.teams, 'team')),
        ...(await names(settingsApi.projects, 'project')),
      ]),
    ]);
  },
}));

type Smtp = Awaited<ReturnType<typeof settingsApi.smtp>>;

interface LinksState {
  smtp: Slot<Smtp>;
  governance: Slot<GovernanceSettings>;
  /** The newest configuration writes, for "changed by … 2 h ago" on each connection. */
  writes: Slot<AuditEntry[]>;
  loadSmtp: () => Promise<void>;
  saveSmtp: (spec: Record<string, unknown>) => Promise<void>;
  loadGovernance: () => Promise<void>;
  saveGovernance: (spec: Record<string, unknown>, reason?: string) => Promise<void>;
  loadWrites: () => Promise<void>;
}

/** Outgoing mail, audit copies (in the governance settings) and recent writes, for the integrations pages. */
export const useLinks = create<LinksState>()((set, get) => ({
  smtp: emptySlot(),
  governance: emptySlot(),
  writes: emptySlot(),
  loadSmtp: () => loadSlot(set, get, 'smtp', settingsApi.smtp),
  async saveSmtp(spec) {
    await settingsApi.patchSmtp(spec, get().smtp.data?.metadata.etag);
    await loadSlot(set, get, 'smtp', settingsApi.smtp, { quiet: true });
  },
  loadGovernance: () => loadSlot(set, get, 'governance', settingsApi.governance),
  async saveGovernance(spec, reason) {
    await settingsApi.patchGovernance(spec, get().governance.data?.metadata.etag, reason);
    await loadSlot(set, get, 'governance', settingsApi.governance, { quiet: true });
  },
  loadWrites: () => loadSlot(set, get, 'writes', settingsApi.recentWrites),
}));
