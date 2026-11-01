import { http, HttpResponse, type HttpHandler } from 'msw';

import type { components } from '@/lib/api/schema';

import { mcpDemo } from './fixtures';
import { mock } from './http';

type S = components['schemas'];
type Json = Record<string, unknown>;

let state = mcpDemo();

/** Resets the MCP demo's in-memory state (between tests). */
export function resetMcpDemo(): void {
  state = mcpDemo();
}

/** The demo's MCP state as written so far, for tests to check what a write left. */
export function mcpDemoState(): ReturnType<typeof mcpDemo> {
  return state;
}

/** RFC 7396: objects merge member by member, `null` removes a member, anything else replaces it. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const base =
    target !== null && typeof target === 'object' && !Array.isArray(target) ? (target as Json) : {};
  const out = new Map(Object.entries(base));
  for (const [k, v] of Object.entries(patch as Json)) {
    if (v === null) out.delete(k);
    else out.set(k, mergePatch(out.get(k), v));
  }
  return Object.fromEntries(out);
}

function bump(meta: S['ResourceMetadata']): S['ResourceMetadata'] {
  const generation = meta.generation + 1;
  return {
    ...meta,
    generation,
    etag: `"${meta.etag.replace(/"/g, '')}-${generation}"`,
    updated_at: new Date().toISOString(),
  };
}

const stale = () =>
  HttpResponse.json(
    {
      error: {
        code: 'precondition_failed',
        message: 'It changed since you read it. Reload to see the current version.',
      },
    },
    { status: 412 },
  );

type Level = 'organizations' | 'teams' | 'projects' | 'keys';

/**
 * MCP servers, gateways and who may use them, for `pnpm dev:mock`: the servers with their status,
 * the gateways (one granted, one that no key can use yet), and the gateway level's and every
 * organization's, team's, project's and key's policies, with merge-patch writes checked against
 * their ETags.
 */
export function mcpDemoHandlers(): HttpHandler[] {
  return [
    mock('get', '/mcp/servers', () => ({ items: state.servers, next_cursor: null })),
    mock('get', '/mcp/servers/{name}/status', ({ params }) => {
      const status = state.statuses[params.name ?? ''];
      if (!status) throw new Error(`no server ${params.name ?? ''}`);
      return status;
    }),
    mock('get', '/mcp/gateways', () => ({ items: state.gateways, next_cursor: null })),
    mock('get', '/runtime/mcp/sessions', () => ({ items: state.sessions, next_cursor: null })),
    mock('get', '/settings/mcp', () => ({
      spec: { session: { max_lifetime: '24h' } },
      metadata: { ...state.policies.metadata, etag: '"mcp1"' },
    })),
    mock('get', '/settings/policies', () => state.policies),
    http.patch(/\/admin\/v1\/settings\/policies$/, async ({ request }) => {
      const ifMatch = request.headers.get('if-match');
      if (ifMatch && ifMatch !== state.policies.metadata.etag) return stale();
      const body = (await request.json()) as { spec: unknown };
      state.policies = {
        spec: mergePatch(state.policies.spec, body.spec) as S['PoliciesSettings']['spec'],
        metadata: bump(state.policies.metadata),
      };
      return HttpResponse.json(state.policies);
    }),
    mock('get', '/organizations', () => ({ items: state.organizations, next_cursor: null })),
    mock('get', '/teams', () => ({ items: state.teams, next_cursor: null })),
    mock('get', '/projects', () => ({ items: state.projects, next_cursor: null })),
    mock('get', '/keys', () => ({ items: state.keys, next_cursor: null, counts: {} })),
    http.patch(/\/admin\/v1\/(organizations|teams|projects|keys)\/([^/]+)$/, async ({ request }) => {
      const [, level, raw] = /\/admin\/v1\/(\w+)\/([^/]+)$/.exec(new URL(request.url).pathname) ?? [];
      const items = state[level as Level] as {
        name: string;
        spec: unknown;
        metadata: S['ResourceMetadata'];
      }[];
      const name = decodeURIComponent(raw ?? '');
      const i = items.findIndex((r) => r.name === name);
      const current = items[i];
      if (!current)
        return HttpResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 });
      const ifMatch = request.headers.get('if-match');
      if (ifMatch && ifMatch !== current.metadata.etag) return stale();
      const body = (await request.json()) as { spec: unknown };
      const next = {
        ...current,
        spec: mergePatch(current.spec, body.spec),
        metadata: bump(current.metadata),
      };
      items[i] = next;
      return HttpResponse.json(next);
    }),
  ];
}
