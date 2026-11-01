import { api, ApiError, listAll } from '@/lib/api/client';
import type {
  GuardrailResource,
  KeyResource,
  ModelResource,
  SafetyEvent,
  TeamResource,
  UsageBucket,
  UserResource,
} from '@/lib/api/types';
import type { components } from '@/lib/api/schema';

import type { Doc, GenerationAt } from './posture';
import type { GuardrailSpec } from './rules';

export type GuardrailRuntime = components['schemas']['GuardrailRuntime'];
export type GuardrailTestResult = components['schemas']['GuardrailTestResult'];
export type PoliciesSettings = components['schemas']['PoliciesSettings'];
export type SummaryRow = components['schemas']['GuardrailSummaryRow'];
export type Interval = components['parameters']['Interval'];
export type ReviewState = 'reviewed' | 'false_positive' | 'escalated';
export type TestStage = 'input' | 'output';

/**
 * A rule's test: its verdict and category, the matches (code-point offsets, the kind found and
 * what it became), the text after the rule (what goes on), and, for a rule that puts values back
 * in the answer, what restore gives back when the answer repeats the placeholders.
 */
export interface RuleTestResult {
  verdict: string;
  category: string | null;
  spans: GuardrailTestResult['spans'];
  redacted: string | Record<string, unknown> | null;
  restored: string | Record<string, unknown> | null;
}

function testResult(raw: GuardrailTestResult): RuleTestResult {
  return {
    verdict: raw.verdict,
    category: raw.category ?? null,
    spans: raw.spans,
    redacted: raw.redacted ?? null,
    restored: raw.restored ?? null,
  };
}

/**
 * Settings that need not be saved, run on sample text as a stage would run them, with nothing
 * sent to a provider or logged. `name` is the saved rule being edited, whose stored secrets a
 * `[REDACTED]` stands for.
 */
async function testSpec(
  spec: GuardrailSpec,
  stage: TestStage,
  text: string,
  name?: string,
): Promise<RuleTestResult> {
  return testResult(
    await api.post('/guardrails:test', {
      body: { ...(name ? { name } : {}), spec, input: { stage, text } },
    }),
  );
}

/** Whether a gateway answered that it has no test for unsaved settings (it predates it). */
export function noSpecTest(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.operation === 'POST /guardrails:test' &&
    (error.status === 404 || error.status === 405)
  );
}

/** The query parameter a gateway refused as unknown ("unknown query parameter "from""), if any. */
function refusedParam(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 400 || error.code !== 'invalid_parameter') return null;
  return /unknown query parameter "([a-z_]+)"/.exec(error.message)?.[1] ?? null;
}

/**
 * Safety events in a window. The contract's list takes `from` and `to`; a gateway that predates the
 * list answers the path as a guardrail named "events" and refuses them. The console then asks
 * without the window: such a gateway says the list does not exist (shown as "not available"), and
 * any gateway that does answer gets its events kept to the window here.
 */
async function events(from: string, to: string): Promise<SafetyEvent[]> {
  try {
    return (await api.get('/guardrails/events', { query: { from, to, limit: 200 } })).items;
  } catch (error) {
    const param = refusedParam(error);
    if (param !== 'from' && param !== 'to') throw error;
    const items = (await api.get('/guardrails/events', { query: { limit: 200 } })).items;
    const start = Date.parse(from);
    const end = Date.parse(to);
    return items.filter((e) => {
      const t = Date.parse(e.time);
      return t >= start && t <= end;
    });
  }
}

export type TopicShare = { topic: string; events: number };

/** Topic-restriction findings of the last 7 days by the topic that decided them (the event's entity). */
async function topics(now: number = Date.now()): Promise<TopicShare[]> {
  const from = new Date(now - 7 * 86_400_000).toISOString();
  const to = new Date(now).toISOString();
  const page = await api.get('/reports/guardrails/summary', {
    query: { from, to, category: ['off_topic'], group_by: ['entity'], limit: 50 },
  });
  return page.items
    .map((row) => ({ topic: row.group.entity ?? '', events: row.events }))
    .filter((row) => row.topic !== '')
    .sort((a, b) => b.events - a.events);
}

/** Safety events per bucket and category over a window, for the stacked chart. */
async function byCategory(from: string, to: string, interval: Interval): Promise<SummaryRow[]> {
  return listAll(
    (cursor) =>
      api.get('/reports/guardrails/summary', {
        query: { from, to, interval, group_by: ['category'], limit: 1000, ...(cursor ? { cursor } : {}) },
      }),
    5,
  );
}

/**
 * Matches per entity over the last 24 hours, for the personal data grid: personal data, secrets
 * and pattern rules (the custom entities of Settings › Data & privacy).
 */
async function byEntity(now: number = Date.now()): Promise<Record<string, number>> {
  const page = await api.get('/reports/guardrails/summary', {
    query: {
      from: new Date(now - 86_400_000).toISOString(),
      to: new Date(now).toISOString(),
      category: ['pii', 'secret', 'deny_pattern'],
      group_by: ['entity'],
      limit: 100,
    },
  });
  const out: Record<string, number> = {};
  for (const row of page.items) {
    const entity = row.group.entity;
    if (entity) out[entity] = (out[entity] ?? 0) + (row.matches ?? row.events);
  }
  return out;
}

/** The last hour of traffic per provider, with the guardrails' blocks and redactions. */
async function lastHour(now: number = Date.now()): Promise<UsageBucket[]> {
  return listAll(
    (cursor) =>
      api.get('/analytics/usage', {
        query: {
          from: new Date(now - 3_600_000).toISOString(),
          to: new Date(now).toISOString(),
          group_by: ['provider'],
          limit: 200,
          ...(cursor ? { cursor } : {}),
        },
      }),
    3,
  );
}

export const safetyApi = {
  byCategory,
  byEntity,
  lastHour,
  create: (name: string, spec: GuardrailSpec) => api.post('/guardrails', { body: { name, spec } }),
  replace: (name: string, spec: GuardrailSpec, etag: string | undefined) =>
    api.put('/guardrails/{name}', { path: { name }, body: { spec }, ifMatch: etag }),
  remove: (name: string) => api.delete('/guardrails/{name}', { path: { name } }),
  /** Runs a saved guardrail on sample text. */
  test: async (name: string, stage: TestStage, text: string): Promise<RuleTestResult> =>
    testResult(await api.post('/guardrails/{name}:test', { path: { name }, body: { stage, text } })),
  testSpec,
  policies: (): Promise<PoliciesSettings> => api.get('/settings/policies'),
  /** Writes the gateway-level input and output lists (a merge patch replaces the arrays). */
  attach: (lists: { input: string[]; output: string[] }, etag: string | undefined) =>
    api.patch('/settings/policies', { body: { spec: { guardrails: lists } }, ifMatch: etag }),
  notify: (body: {
    to: { team?: string; users?: string[] };
    subject: string;
    message: string;
    link?: string;
  }) => api.post('/notifications:send', { body }),
  config: (): Promise<Doc> => api.get('/config'),
  generations: async (): Promise<GenerationAt[]> =>
    (await api.get('/config/generations', { query: { limit: 200 } })).items,
  generation: (n: number): Promise<Doc> =>
    api.get('/config/generations/{generation}', { path: { generation: n } }),
  users: (): Promise<UserResource[]> =>
    listAll((cursor) => api.get('/users', { query: { limit: 200, cursor } })),
  keys: (): Promise<KeyResource[]> =>
    listAll((cursor) => api.get('/keys', { query: { limit: 200, cursor } })),
  teams: (): Promise<TeamResource[]> =>
    listAll((cursor) => api.get('/teams', { query: { limit: 200, cursor } })),
  /** Providers by name and type, for the guardrails that sign calls with one's credentials. */
  providers: async (): Promise<{ name: string; type: string }[]> =>
    (await listAll((cursor) => api.get('/providers', { query: { limit: 200, cursor } }))).map((p) => ({
      name: p.name,
      type: p.spec.type,
    })),
  models: (): Promise<ModelResource[]> =>
    listAll((cursor) => api.get('/models', { query: { limit: 200, cursor } })),
  events,
  topics,
  review: (id: string, state: ReviewState, note?: string) =>
    api.post('/guardrails/events/{event_id}:review', {
      path: { event_id: id },
      body: { state, ...(note ? { note } : {}) },
    }),
  guardrails: (): Promise<GuardrailResource[]> =>
    listAll((cursor) => api.get('/guardrails', { query: { limit: 200, cursor } })),
  runtime: async (): Promise<GuardrailRuntime[]> => (await api.get('/runtime/guardrails')).items,
  setEnabled: (name: string, enabled: boolean, etag: string | undefined) =>
    api.patch('/guardrails/{name}', { path: { name }, body: { spec: { enabled } }, ifMatch: etag }),
};
