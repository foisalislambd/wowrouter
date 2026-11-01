import { create } from 'zustand';

import { useKeys } from '@/features/keys/store';
import { useTraffic } from '@/features/settings/traffic-store';
import { useOrganizations, useProjects, useTeams } from '@/features/teams-users/store';
import type { ProjectResource, TeamResource } from '@/lib/api/types';
import { asApiError, emptySlot, loadSlot, type Slot } from '@/lib/slot';

import { type Access, type Holder, LEVELS, type TargetLevel } from './access';
import {
  accessApi,
  gatewayHolder,
  holderOf,
  type LevelResource,
  mcpApi,
  type McpGatewayResource,
  type McpGatewaySpec,
  type McpServerResource,
  type McpServerSpec,
  type McpServerStatus,
  type McpSessionStats,
  type McpSettings,
} from './api';

/** One server's status read: the answer, or why there is none (a server that can't be read). */
export interface StatusEntry {
  status: McpServerStatus | null;
  error: string | null;
}

/** The levels the principal may read: the gateway level, and the kinds below it. */
export interface AccessRead {
  gateway: boolean;
  levels: TargetLevel[];
}

interface McpState {
  servers: Slot<McpServerResource[]>;
  statuses: Record<string, StatusEntry>;
  gateways: Slot<McpGatewayResource[]>;
  sessions: Slot<McpSessionStats[]>;
  settings: Slot<McpSettings>;
  /** Who may use MCP servers: the server lists of every level that could be read. */
  access: Slot<Access>;
  loadAccess: (read: AccessRead, options?: { quiet?: boolean }) => Promise<void>;
  /** Writes one level's server list (null removes it), then shows the level as written. */
  setServersAt: (holder: Holder, next: string[] | null, reason?: string) => Promise<void>;
  load: (options?: { quiet?: boolean }) => Promise<void>;
  loadStatuses: () => Promise<void>;
  loadStatus: (name: string) => Promise<void>;
  loadSessions: (options?: { quiet?: boolean }) => Promise<void>;
  saveServer: (name: string, spec: McpServerSpec, existing: McpServerResource | null) => Promise<void>;
  setServerEnabled: (name: string, enabled: boolean) => Promise<void>;
  removeServer: (name: string, reason?: string) => Promise<void>;
  approveTools: (name: string) => Promise<number>;
  saveGateway: (name: string, spec: McpGatewaySpec, existing: McpGatewayResource | null) => Promise<void>;
  setGatewayEnabled: (name: string, enabled: boolean) => Promise<void>;
  removeGateway: (name: string, reason?: string) => Promise<void>;
}

const byName = <T extends { name: string }>(items: T[]) =>
  [...items].sort((a, b) => a.name.localeCompare(b.name));

function upsert<T extends { name: string }>(items: T[] | null, item: T): T[] {
  return byName([...(items ?? []).filter((x) => x.name !== item.name), item]);
}

/** Every readable level with its grants. A level that can't be read is left out, and noted. */
async function readAccess(read: AccessRead): Promise<Access> {
  let first: unknown = null;
  const failed = (e: unknown) => {
    first ??= e;
    return null;
  };
  const [policies, ...lists] = await Promise.all([
    read.gateway ? accessApi.policies().then(gatewayHolder, failed) : Promise.resolve(null),
    ...read.levels.map((l) => accessApi.levels(l).then((items) => items.map((r) => holderOf(l, r)), failed)),
  ]);
  const levels = lists.flatMap((l) => l ?? []);
  if (first !== null && policies === null && lists.every((l) => l === null)) throw asApiError(first);
  return {
    gateway: policies,
    levels,
    complete: read.gateway && read.levels.length === LEVELS.length && first === null,
  };
}

/** The other screens' copies of a level just written, so they show it and send its new ETag. */
function refreshLevel(level: TargetLevel, r: LevelResource) {
  const swap = <T extends { name: string }>(items: T[], next: T) =>
    items.map((i) => (i.name === next.name ? next : i));
  switch (level) {
    case 'organization':
      useOrganizations.setState((s) => ({ items: swap(s.items, r) }));
      break;
    case 'team':
      useTeams.setState((s) => ({ items: swap(s.items, r as TeamResource) }));
      break;
    case 'project':
      useProjects.setState((s) => ({ items: swap(s.items, r as ProjectResource) }));
      break;
    case 'key':
      useKeys.setState((s) => ({ items: swap(s.items, r) }));
      break;
  }
}

/** MCP servers with their status, gateways, session counters and the `mcp` settings. */
export const useMcp = create<McpState>()((set, get) => ({
  servers: emptySlot(),
  statuses: {},
  gateways: emptySlot(),
  sessions: emptySlot(),
  settings: emptySlot(),
  access: emptySlot(),

  async loadAccess(read, options) {
    if (!read.gateway && read.levels.length === 0) return;
    await loadSlot(set, get, 'access', () => readAccess(read), options);
  },

  async setServersAt(holder, next, reason) {
    let written: Holder;
    if (holder.level === 'gateway') {
      const policies = await accessApi.patchPolicies(next, holder.etag, reason);
      written = gatewayHolder(policies);
      useTraffic.setState((s) => (s.policies.data ? { policies: { ...s.policies, data: policies } } : {}));
    } else {
      const r = await accessApi.patchLevel(holder.level, holder, next, reason);
      written = holderOf(holder.level, r);
      refreshLevel(holder.level, r);
    }
    set((s) => {
      const access = s.access.data;
      if (!access) return {};
      const levels = access.levels.map((h) =>
        h.level === written.level && h.name === written.name ? written : h,
      );
      return {
        access: {
          ...s.access,
          data: { ...access, gateway: written.level === 'gateway' ? written : access.gateway, levels },
        },
      };
    });
  },

  async load(options) {
    await Promise.all([
      loadSlot(set, get, 'servers', mcpApi.servers, options),
      loadSlot(set, get, 'gateways', mcpApi.gateways, options),
    ]);
    await get().loadStatuses();
  },

  async loadStatuses() {
    const names = (get().servers.data ?? []).map((s) => s.name);
    await Promise.all(names.map((n) => get().loadStatus(n)));
  },

  async loadStatus(name) {
    try {
      const status = await mcpApi.status(name);
      set((s) => ({ statuses: { ...s.statuses, [name]: { status, error: null } } }));
    } catch (e) {
      set((s) => ({
        statuses: {
          ...s.statuses,
          [name]: { status: s.statuses[name]?.status ?? null, error: asApiError(e).message },
        },
      }));
    }
  },

  async loadSessions(options) {
    await Promise.all([
      loadSlot(set, get, 'sessions', mcpApi.sessions, options),
      loadSlot(set, get, 'settings', mcpApi.settings, { quiet: true }),
    ]);
  },

  async saveServer(name, spec, existing) {
    const saved = existing
      ? await mcpApi.replaceServer(name, spec, existing.metadata.etag)
      : await mcpApi.createServer(name, spec);
    set((s) => ({ servers: { ...s.servers, data: upsert(s.servers.data, saved) } }));
    void get().loadStatus(name);
  },

  async setServerEnabled(name, enabled) {
    const current = get().servers.data?.find((x) => x.name === name);
    await mcpApi.setServerEnabled(name, enabled, current?.metadata.etag);
    await loadSlot(set, get, 'servers', mcpApi.servers, { quiet: true });
  },

  async removeServer(name, reason) {
    await mcpApi.deleteServer(name, reason);
    set((s) => {
      const { [name]: _gone, ...statuses } = s.statuses;
      return {
        servers: { ...s.servers, data: (s.servers.data ?? []).filter((x) => x.name !== name) },
        statuses,
      };
    });
  },

  async approveTools(name) {
    const approval = await mcpApi.approveTools(name);
    await get().loadStatus(name);
    return approval.tools.length;
  },

  async saveGateway(name, spec, existing) {
    const saved = existing
      ? await mcpApi.replaceGateway(name, spec, existing.metadata.etag)
      : await mcpApi.createGateway(name, spec);
    set((s) => ({ gateways: { ...s.gateways, data: upsert(s.gateways.data, saved) } }));
  },

  async setGatewayEnabled(name, enabled) {
    const current = get().gateways.data?.find((x) => x.name === name);
    await mcpApi.setGatewayEnabled(name, enabled, current?.metadata.etag);
    await loadSlot(set, get, 'gateways', mcpApi.gateways, { quiet: true });
  },

  async removeGateway(name, reason) {
    await mcpApi.deleteGateway(name, reason);
    set((s) => ({
      gateways: { ...s.gateways, data: (s.gateways.data ?? []).filter((x) => x.name !== name) },
    }));
  },
}));
