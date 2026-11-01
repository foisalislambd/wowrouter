import { create } from 'zustand';

import { api } from '@/lib/api/client';
import type { AuditEntry, DeploymentHealth } from '@/lib/api/types';

import { healthName } from './types';

/**
 * A deployment's runtime state as people read it, and what they can do about it. A manual disable
 * ("Turned off") is cleared only by turning it back on (`:enable`); a breaker or cooldown pause
 * ("Paused after errors") is cleared by resuming it (`:reset`), which never clears a manual disable.
 */
export type RuntimeKind = 'healthy' | 'off' | 'paused' | 'testing' | 'unknown';

export interface RuntimeStatus {
  kind: RuntimeKind;
  label: string;
  tone: 'success' | 'warn' | 'error' | 'neutral';
  /** When it ends by itself: the end of a timed disable, of the pause, or of the cooldown. */
  until: string | null;
  /** The way back: `enable` for a manual disable, `reset` for a pause; none when healthy. */
  action: 'enable' | 'reset' | null;
}

export function runtimeStatus(h: DeploymentHealth | undefined, now = Date.now()): RuntimeStatus {
  if (!h) return { kind: 'unknown', label: 'No traffic yet', tone: 'neutral', until: null, action: null };
  if (h.state === 'disabled')
    return { kind: 'off', label: 'Turned off', tone: 'neutral', until: h.disabled_until, action: 'enable' };
  if (h.state === 'open')
    return {
      kind: 'paused',
      label: 'Paused after errors',
      tone: 'error',
      until: h.open_until ?? h.cooldown_until,
      action: 'reset',
    };
  if (h.state === 'half_open')
    return { kind: 'testing', label: 'Testing again', tone: 'warn', until: null, action: 'reset' };
  const cooling = h.cooldown_until && Date.parse(h.cooldown_until) > now ? h.cooldown_until : null;
  if (cooling)
    return { kind: 'paused', label: 'Paused after errors', tone: 'warn', until: cooling, action: 'reset' };
  return { kind: 'healthy', label: 'Healthy', tone: 'success', until: null, action: null };
}

export const deploymentRuntimeApi = {
  /** A manual disable, until a time or until someone turns it on; it survives reloads and restarts. */
  disable: (name: string, until: string | undefined, reason?: string): Promise<DeploymentHealth> =>
    api.post('/runtime/deployments/{name}:disable', {
      path: { name },
      body: until ? { until } : {},
      reason,
    }),
  enable: (name: string, reason?: string): Promise<DeploymentHealth> =>
    api.post('/runtime/deployments/{name}:enable', { path: { name }, reason }),
  reset: (name: string, reason?: string): Promise<DeploymentHealth> =>
    api.post('/runtime/deployments/{name}:reset', { path: { name }, reason }),
};

interface DisablesState {
  /** The latest manual disable of each deployment, from the audit log; null when none is recorded. */
  byName: Record<string, AuditEntry | null>;
  at: number | null;
  load: () => Promise<void>;
}

/** Who turned each deployment off and when: the audit log's newest `deployments.disable` entries. */
export const useDeploymentDisables = create<DisablesState>()((set) => ({
  byName: {},
  at: null,
  async load() {
    try {
      const page = await api.get('/audit', {
        query: {
          resource: 'runtime/deployments/*',
          action: 'deployments.disable',
          outcome: 'success',
          limit: 200,
        },
      });
      const byName: Record<string, AuditEntry | null> = {};
      for (const entry of [...page.items].sort((a, b) => b.time.localeCompare(a.time))) {
        const name = (entry.resource ?? '').replace(/^runtime\/deployments\//, '');
        if (!(name in byName)) byName[name] = entry;
      }
      set({ byName, at: Date.now() });
    } catch {
      set({ at: Date.now() });
    }
  },
}));

/** The health entry of one deployment in a list, by its name. */
export function healthOf(
  list: DeploymentHealth[] | null | undefined,
  name: string,
): DeploymentHealth | undefined {
  return list?.find((h) => healthName(h) === name);
}
