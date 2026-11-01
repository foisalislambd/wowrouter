import type { LogRecord } from '@/lib/api/types';

export type StatusClass = '2xx' | '4xx' | '5xx';

/** How the response cache answered: a hit, a semantic hit, a miss, or not consulted. */
export type CacheOutcome = 'hit' | 'semantic_hit' | 'miss' | 'bypass';
export const CACHE_OUTCOMES: { value: CacheOutcome; label: string; chip: string }[] = [
  { value: 'hit', label: 'Cache hits', chip: 'hits' },
  { value: 'semantic_hit', label: 'Semantic cache hits', chip: 'semantic hits' },
  { value: 'miss', label: 'Cache misses', chip: 'misses' },
  { value: 'bypass', label: 'Cache bypassed', chip: 'bypassed' },
];

export interface LogFilters {
  statusClass: StatusClass[];
  provider: string[];
  model: string[];
  /** Names apps asked for that no Model has (`requested_model`), such as a retired one. */
  requestedModel: string[];
  team: string[];
  project: string[];
  key: string[];
  /** The people the requests were made for (a key's owner or the identity's user). */
  user: string[];
  /** Request ids clients see (`x-request-id`). */
  requestId: string[];
  /** Values of the environment tag (`env:<value>`). */
  environment: string[];
  /** Request tags, every one required. */
  tag: string[];
  /** Deployments that served the final attempt. */
  deployment: string[];
  /** The end users the app sent (`user`, `x-antirion-end-user`). */
  endUser: string[];
  sessionId: string[];
  /** Error codes (`antirion.code`), such as `rate_limited`. */
  code: string[];
  /** Exact statuses, as typed (`429`). */
  statusCode: string[];
  /** How the response was produced: `upstream`, `fallback`, `cache`, … */
  responsePath: string[];
  guardrail: string[];
  guardrailVerdict: string[];
  guardrailCategory: string[];
  /** Metadata members, `name=value`, every one required; one value per name. */
  metadata: string[];
  cache: CacheOutcome[];
  streamed: boolean;
  flagged: boolean;
  /** Milliseconds, as typed. */
  latencyMin: string;
  latencyMax: string;
  /** US dollars, as typed. */
  costMin: string;
  costMax: string;
  q: string;
}

export const EMPTY_LOG_FILTERS: LogFilters = {
  statusClass: [],
  provider: [],
  model: [],
  requestedModel: [],
  team: [],
  project: [],
  key: [],
  user: [],
  requestId: [],
  environment: [],
  tag: [],
  deployment: [],
  endUser: [],
  sessionId: [],
  code: [],
  statusCode: [],
  responsePath: [],
  guardrail: [],
  guardrailVerdict: [],
  guardrailCategory: [],
  metadata: [],
  cache: [],
  streamed: false,
  flagged: false,
  latencyMin: '',
  latencyMax: '',
  costMin: '',
  costMax: '',
  q: '',
};

export const LOG_SORTS = [
  'started_at',
  'latency_ms',
  'ttft_ms',
  'cost_usd',
  'input_tokens',
  'output_tokens',
  'status_code',
] as const;
export type LogSort = (typeof LOG_SORTS)[number];
export type SortOrder = 'asc' | 'desc';

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value !== '' && Number.isFinite(Number(value))
      ? Number(value)
      : null;
}

export function latencyMs(r: LogRecord): number | null {
  return num(r.timing.total_ms);
}

export function ttftMs(r: LogRecord): number | null {
  return num(r.timing.ttft_ms);
}

export function costUsd(r: LogRecord): number | null {
  return num(r.cost.total);
}

export function cacheStatus(r: LogRecord): string {
  return typeof r.cache.status === 'string' ? r.cache.status : 'unknown';
}

export function isStreamed(r: LogRecord): boolean {
  return r.stream !== null;
}

/** Non-pass guardrail verdicts, by category: what makes a request "flagged". */
export function flags(r: LogRecord): string[] {
  const out = new Set<string>();
  for (const g of r.guardrails) {
    const verdict =
      typeof g.verdict === 'string' ? g.verdict : typeof g.action === 'string' ? g.action : 'pass';
    if (verdict === 'pass') continue;
    out.add(typeof g.category === 'string' ? g.category : 'safety');
  }
  return [...out];
}

/** The first line of the prompt, when content was stored and the reader may see it. */
export function promptPreview(r: LogRecord): string | null {
  const content = r.content;
  if (!content) return null;
  const req = content.request as { body?: unknown } | undefined;
  const body = req?.body as
    { messages?: { content?: unknown }[]; input?: unknown; prompt?: unknown } | undefined;
  const last = body?.messages?.at(-1)?.content;
  const text =
    typeof last === 'string'
      ? last
      : typeof body?.input === 'string'
        ? body.input
        : typeof body?.prompt === 'string'
          ? body.prompt
          : null;
  return text ? (text.split('\n')[0]?.slice(0, 200) ?? null) : null;
}

/** What an MCP or A2A request did, from the record's `mcp` or `a2a` member. */
export interface ProtocolCall {
  kind: 'mcp' | 'a2a';
  /** `crm · search_customers`, `docs · tools/list`, `billing · message/send`. */
  label: string;
  facts: { label: string; value: string }[];
}

function nonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** The record's MCP or A2A call, or null for a model request. */
export function protocolCall(r: LogRecord): ProtocolCall | null {
  if (r.mcp) {
    const server = nonEmpty(r.mcp.server);
    const method = nonEmpty(r.mcp.method);
    const tool = nonEmpty(r.mcp.tool);
    const session = nonEmpty(r.mcp.session_id);
    const code = typeof r.mcp.jsonrpc_error_code === 'number' ? String(r.mcp.jsonrpc_error_code) : null;
    const what = tool ?? method ?? 'MCP';
    return {
      kind: 'mcp',
      label: server ? `${server} · ${what}` : what,
      facts: [
        { label: 'Server', value: server ?? '—' },
        { label: 'Method', value: method ?? '—' },
        ...(tool ? [{ label: 'Tool', value: tool }] : []),
        { label: 'Session', value: session ? `${session.slice(0, 18)}…` : '—' },
        ...(code ? [{ label: 'JSON-RPC error', value: code }] : []),
      ],
    };
  }
  if (r.a2a) {
    const agent = nonEmpty(r.a2a.agent);
    const method = nonEmpty(r.a2a.method);
    const task = nonEmpty(r.a2a.task_id);
    const what = method ?? 'A2A';
    return {
      kind: 'a2a',
      label: agent ? `${agent} · ${what}` : what,
      facts: [
        { label: 'Agent', value: agent ?? '—' },
        { label: 'Method', value: method ?? '—' },
        { label: 'Task', value: task ?? '—' },
      ],
    };
  }
  return null;
}

/** A typed amount as a number, or null when it is blank or not a number. */
function amount(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A typed dollar amount as the contract's decimal string. */
function money(text: string): string | null {
  const n = amount(text);
  return n === null ? null : String(n);
}

/** A typed status as a code the gateway can have sent (100 to 599), or null. */
export function statusCodeOf(text: string): number | null {
  const t = text.trim();
  return /^[1-5]\d\d$/.test(t) ? Number(t) : null;
}

/** A metadata filter `name=value` as its two parts, or null when it has no name or no `=`. */
export function metadataPair(entry: string): [string, string] | null {
  const at = entry.indexOf('=');
  if (at <= 0) return null;
  const name = entry.slice(0, at).trim();
  const value = entry.slice(at + 1).trim();
  return /^[A-Za-z0-9_.-]{1,128}$/.test(name) && value !== '' ? [name, value] : null;
}

/** Adds a metadata filter, replacing an earlier value of the same name. */
export function withMetadata(list: string[], name: string, value: string): string[] {
  return [...list.filter((e) => metadataPair(e)?.[0] !== name), `${name}=${value}`];
}

/** The metadata filters as the contract's `metadata.<name>` parameters. */
export function metadataQuery(list: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of list) {
    const pair = metadataPair(entry);
    if (pair) out[`metadata.${pair[0]}`] = pair[1];
  }
  return out;
}

/**
 * The filters as the list's query parameters. The tags of the environments and the tags are sent
 * together (`tag`), with the scope's environment added by the caller.
 */
export function filtersToQuery(f: LogFilters) {
  const statusCodes = f.statusCode.map(statusCodeOf).filter((v): v is number => v !== null);
  const latencyMin = amount(f.latencyMin);
  const latencyMax = amount(f.latencyMax);
  const costMin = money(f.costMin);
  const costMax = money(f.costMax);
  return {
    ...(f.statusClass.length ? { status_class: f.statusClass } : {}),
    ...(f.provider.length ? { provider: f.provider } : {}),
    ...(f.model.length ? { model: f.model } : {}),
    ...(f.requestedModel.length ? { requested_model: f.requestedModel } : {}),
    ...(f.team.length ? { team: f.team } : {}),
    ...(f.project.length ? { project: f.project } : {}),
    ...(f.key.length ? { key: f.key } : {}),
    ...(f.user.length ? { user: f.user } : {}),
    ...(f.requestId[0] ? { request_id: f.requestId[0] } : {}),
    ...(f.environment.length ? { environment: f.environment } : {}),
    ...(f.deployment.length ? { deployment: f.deployment } : {}),
    ...(f.endUser.length ? { end_user: f.endUser } : {}),
    ...(f.sessionId.length ? { session_id: f.sessionId } : {}),
    ...(f.code.length ? { code: f.code } : {}),
    ...(statusCodes.length ? { status_code: statusCodes } : {}),
    ...(f.responsePath.length ? { response_path: f.responsePath } : {}),
    ...(f.guardrail.length ? { guardrail: f.guardrail } : {}),
    ...(f.guardrailVerdict.length ? { guardrail_verdict: f.guardrailVerdict } : {}),
    ...(f.guardrailCategory.length ? { guardrail_category: f.guardrailCategory } : {}),
    ...metadataQuery(f.metadata),
    ...(f.cache.length ? { cache: f.cache } : {}),
    ...(f.streamed ? { stream: true } : {}),
    ...(f.flagged ? { flagged: true } : {}),
    ...(latencyMin !== null ? { latency_ms_min: latencyMin } : {}),
    ...(latencyMax !== null ? { latency_ms_max: latencyMax } : {}),
    ...(costMin !== null ? { cost_usd_min: costMin } : {}),
    ...(costMax !== null ? { cost_usd_max: costMax } : {}),
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
  };
}

export function activeFilterCount(f: LogFilters): number {
  return (
    f.statusClass.length +
    f.provider.length +
    f.model.length +
    f.requestedModel.length +
    f.team.length +
    f.project.length +
    f.key.length +
    f.user.length +
    f.requestId.length +
    f.environment.length +
    f.tag.length +
    f.deployment.length +
    f.endUser.length +
    f.sessionId.length +
    f.code.length +
    f.statusCode.length +
    f.responsePath.length +
    f.guardrail.length +
    f.guardrailVerdict.length +
    f.guardrailCategory.length +
    f.metadata.length +
    f.cache.length +
    (f.streamed ? 1 : 0) +
    (f.flagged ? 1 : 0) +
    (f.latencyMin || f.latencyMax ? 1 : 0) +
    (f.costMin || f.costMax ? 1 : 0) +
    (f.q ? 1 : 0)
  );
}

const STATUS_VALUES: readonly string[] = ['2xx', '4xx', '5xx'];
const CACHE_VALUES: readonly string[] = CACHE_OUTCOMES.map((c) => c.value);

function strings(value: unknown): string[] {
  if (typeof value === 'string') return value === '' ? [] : [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];
}

function text(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : typeof value === 'string' && amount(value) !== null
      ? value
      : '';
}

function flag(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

/** Statuses stored as numbers (the list's parameters) or typed text, kept when they are real codes. */
function statusCodes(value: unknown): string[] {
  const list = Array.isArray(value) ? (value as unknown[]) : value === undefined ? [] : [value];
  return list
    .map((v) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''))
    .filter((v) => statusCodeOf(v) !== null);
}

/**
 * A view's metadata filters: its `metadata.<name>` members (the list's parameters) and the
 * console's own `metadata` list of `name=value`, one value per name.
 */
function metadataOf(raw: Record<string, unknown>): string[] {
  let out: string[] = [];
  for (const entry of strings(raw.metadata)) {
    const pair = metadataPair(entry);
    if (pair) out = withMetadata(out, pair[0], pair[1]);
  }
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith('metadata.')) continue;
    const value = typeof v === 'number' || typeof v === 'boolean' ? String(v) : strings(v)[0];
    const pair = value === undefined ? null : metadataPair(`${k.slice(9)}=${value}`);
    if (pair) out = withMetadata(out, pair[0], pair[1]);
  }
  return out;
}

/**
 * The filters a saved view stores, in the list's query-parameter names (`status_class`,
 * `latency_ms_min`, …), so a view written by any client reads the same.
 */
export function viewFilters(f: LogFilters): Record<string, unknown> {
  return { ...filtersToQuery(f), ...(f.tag.length ? { tag: f.tag } : {}) };
}

/** A saved view's filters, in query-parameter names (or the console's own older names). */
export function filtersFromView(raw: Record<string, unknown>): LogFilters {
  const pick = (a: string, b: string) => raw[a] ?? raw[b];
  return {
    statusClass: strings(pick('status_class', 'statusClass')).filter((v): v is StatusClass =>
      STATUS_VALUES.includes(v),
    ),
    provider: strings(raw.provider),
    model: strings(raw.model),
    requestedModel: strings(pick('requested_model', 'requestedModel')),
    team: strings(raw.team),
    project: strings(raw.project),
    key: strings(raw.key),
    user: strings(raw.user),
    requestId: strings(pick('request_id', 'requestId')),
    environment: strings(raw.environment),
    tag: strings(raw.tag),
    deployment: strings(raw.deployment),
    endUser: strings(pick('end_user', 'endUser')),
    sessionId: strings(pick('session_id', 'sessionId')),
    code: strings(raw.code),
    statusCode: statusCodes(pick('status_code', 'statusCode')),
    responsePath: strings(pick('response_path', 'responsePath')),
    guardrail: strings(raw.guardrail),
    guardrailVerdict: strings(pick('guardrail_verdict', 'guardrailVerdict')),
    guardrailCategory: strings(pick('guardrail_category', 'guardrailCategory')),
    metadata: metadataOf(raw),
    cache: strings(raw.cache).filter((v): v is CacheOutcome => CACHE_VALUES.includes(v)),
    streamed: flag(pick('stream', 'streamed')),
    flagged: flag(raw.flagged),
    latencyMin: text(pick('latency_ms_min', 'latencyMin')),
    latencyMax: text(pick('latency_ms_max', 'latencyMax')),
    costMin: text(pick('cost_usd_min', 'costMin')),
    costMax: text(pick('cost_usd_max', 'costMax')),
    q: typeof raw.q === 'string' ? raw.q : '',
  };
}

/** A view's sort as stored: `<key>:<asc|desc>`; null for the default, newest first. */
export function encodeSort(sort: LogSort, order: SortOrder): string | null {
  return sort === 'started_at' && order === 'desc' ? null : `${sort}:${order}`;
}

export function decodeSort(value: unknown): { sort: LogSort; order: SortOrder } {
  const [key, dir] = typeof value === 'string' ? value.split(':') : [];
  const sort = (LOG_SORTS as readonly string[]).includes(key ?? '') ? (key as LogSort) : 'started_at';
  return { sort, order: dir === 'asc' ? 'asc' : 'desc' };
}

/** The log's state in the URL: every filter and the sort, so a copied link reopens the same view. */
export const LOG_URL_DEFAULTS = {
  status: [] as string[],
  provider: [] as string[],
  model: [] as string[],
  requested_model: [] as string[],
  team: [] as string[],
  project: [] as string[],
  key: [] as string[],
  user: [] as string[],
  request_id: [] as string[],
  environment: [] as string[],
  tag: [] as string[],
  deployment: [] as string[],
  end_user: [] as string[],
  session_id: [] as string[],
  code: [] as string[],
  status_code: [] as string[],
  response_path: [] as string[],
  guardrail: [] as string[],
  guardrail_verdict: [] as string[],
  guardrail_category: [] as string[],
  metadata: [] as string[],
  cache: [] as string[],
  stream: false,
  flagged: false,
  latency_min: '',
  latency_max: '',
  cost_min: '',
  cost_max: '',
  q: '',
  sort: '',
};
export type LogUrlState = typeof LOG_URL_DEFAULTS;

export function toUrlState(f: LogFilters, sort: LogSort, order: SortOrder): LogUrlState {
  return {
    status: f.statusClass,
    provider: f.provider,
    model: f.model,
    requested_model: f.requestedModel,
    team: f.team,
    project: f.project,
    key: f.key,
    user: f.user,
    request_id: f.requestId,
    environment: f.environment,
    tag: f.tag,
    deployment: f.deployment,
    end_user: f.endUser,
    session_id: f.sessionId,
    code: f.code,
    status_code: f.statusCode,
    response_path: f.responsePath,
    guardrail: f.guardrail,
    guardrail_verdict: f.guardrailVerdict,
    guardrail_category: f.guardrailCategory,
    metadata: f.metadata,
    cache: f.cache,
    stream: f.streamed,
    flagged: f.flagged,
    latency_min: f.latencyMin,
    latency_max: f.latencyMax,
    cost_min: f.costMin,
    cost_max: f.costMax,
    q: f.q,
    sort: encodeSort(sort, order) ?? '',
  };
}

export function fromUrlState(u: LogUrlState): { filters: LogFilters; sort: LogSort; order: SortOrder } {
  return {
    filters: filtersFromView({
      status_class: u.status,
      provider: u.provider,
      model: u.model,
      requested_model: u.requested_model,
      team: u.team,
      project: u.project,
      key: u.key,
      user: u.user,
      request_id: u.request_id,
      environment: u.environment,
      tag: u.tag,
      deployment: u.deployment,
      end_user: u.end_user,
      session_id: u.session_id,
      code: u.code,
      status_code: u.status_code,
      response_path: u.response_path,
      guardrail: u.guardrail,
      guardrail_verdict: u.guardrail_verdict,
      guardrail_category: u.guardrail_category,
      metadata: u.metadata,
      cache: u.cache,
      stream: u.stream,
      flagged: u.flagged,
      latency_ms_min: u.latency_min,
      latency_ms_max: u.latency_max,
      cost_usd_min: u.cost_min,
      cost_usd_max: u.cost_max,
      q: u.q,
    }),
    ...decodeSort(u.sort),
  };
}

/** Whether two filter sets select the same requests. */
export function sameFilters(a: LogFilters, b: LogFilters): boolean {
  return JSON.stringify(viewFilters(a)) === JSON.stringify(viewFilters(b));
}

/** The record's environment: the value of its `env:` tag. */
export function environmentOf(r: LogRecord): string | null {
  const tag = r.tags.find((t) => t.startsWith('env:'));
  return tag ? tag.slice(4) : null;
}

/** A record's guardrail facts: the names, verdicts and categories of the guardrails that ran. */
export function guardrailFacts(r: LogRecord): { name: string[]; verdict: string[]; category: string[] } {
  const pick = (k: string) =>
    r.guardrails.map((g) => g[k]).filter((v): v is string => typeof v === 'string' && v !== '');
  return { name: pick('name'), verdict: pick('verdict'), category: pick('category') };
}

/** A metadata member of a record as text (`a.b` reads a nested member), or null. */
export function metadataValue(r: LogRecord, name: string): string | null {
  let v: unknown = (r as { metadata?: unknown }).metadata;
  for (const part of name.split('.'))
    v = v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : null;
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;
}

/**
 * The checks on a record's own members that the new filters add, for the live tail and for an
 * older gateway that refused their parameters (`skip` names the ones the gateway applied).
 */
function memberChecks(f: LogFilters, skip: (param: string) => boolean = () => false) {
  const inList = (values: string[], v: string | null) =>
    values.length === 0 || (v !== null && values.includes(v));
  const any = (values: string[], have: string[]) =>
    values.length === 0 || have.some((v) => values.includes(v));
  const checks: ((r: LogRecord) => boolean)[] = [];
  const add = (param: string, active: boolean, check: (r: LogRecord) => boolean) => {
    if (active && !skip(param)) checks.push(check);
  };
  add('deployment', f.deployment.length > 0, (r) => inList(f.deployment, r.deployment));
  add('end_user', f.endUser.length > 0, (r) => inList(f.endUser, r.end_user));
  add('session_id', f.sessionId.length > 0, (r) => inList(f.sessionId, r.session_id));
  add('code', f.code.length > 0, (r) => inList(f.code, r.code));
  add('status_code', f.statusCode.length > 0, (r) => inList(f.statusCode, String(r.status_code)));
  add('response_path', f.responsePath.length > 0, (r) => inList(f.responsePath, r.response_path));
  add('guardrail', f.guardrail.length > 0, (r) => any(f.guardrail, guardrailFacts(r).name));
  add('guardrail_verdict', f.guardrailVerdict.length > 0, (r) =>
    any(f.guardrailVerdict, guardrailFacts(r).verdict),
  );
  add('guardrail_category', f.guardrailCategory.length > 0, (r) =>
    any(f.guardrailCategory, guardrailFacts(r).category),
  );
  for (const entry of f.metadata) {
    const pair = metadataPair(entry);
    if (pair) add(`metadata.${pair[0]}`, true, (r) => metadataValue(r, pair[0]) === pair[1]);
  }
  add('cache', f.cache.length > 0, (r) => f.cache.includes(cacheStatus(r) as CacheOutcome));
  return (r: LogRecord) => checks.every((c) => c(r));
}

/**
 * Whether a record the live tail sent belongs to the filtered list. The tail filters on equality
 * only; the ranges, flags and search are checked here, as the list would.
 */
export function matchesFilters(r: LogRecord, f: LogFilters): boolean {
  const inList = (values: string[], v: string | null) =>
    values.length === 0 || (v !== null && values.includes(v));
  if (f.statusClass.length && !f.statusClass.includes(`${String(r.status_code).charAt(0)}xx` as StatusClass))
    return false;
  if (!inList(f.provider, r.provider) || !inList(f.model, r.model) || !inList(f.team, r.team)) return false;
  if (!inList(f.requestedModel, r.requested_model)) return false;
  if (!inList(f.project, r.project) || !inList(f.key, r.key) || !inList(f.requestId, r.request_id))
    return false;
  if (!inList(f.environment, environmentOf(r))) return false;
  // A record does not carry the person a key acts for; with that filter, new requests wait for a reload.
  if (f.user.length) return false;
  if (f.tag.some((t) => !r.tags.includes(t))) return false;
  if (!memberChecks(f)(r)) return false;
  if (f.streamed && !isStreamed(r)) return false;
  if (f.flagged && flags(r).length === 0) return false;
  const latency = latencyMs(r) ?? 0;
  const cost = costUsd(r) ?? 0;
  const latencyMin = amount(f.latencyMin);
  const latencyMax = amount(f.latencyMax);
  const costMin = amount(f.costMin);
  const costMax = amount(f.costMax);
  if (latencyMin !== null && latency < latencyMin) return false;
  if (latencyMax !== null && latency > latencyMax) return false;
  if (costMin !== null && cost < costMin) return false;
  if (costMax !== null && cost > costMax) return false;
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = [
      r.id,
      r.request_id,
      r.model ?? '',
      r.key ?? '',
      r.end_user ?? '',
      r.team ?? '',
      promptPreview(r) ?? '',
    ]
      .join(' ')
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Applies, to loaded records, the filters and sort the gateway did not accept as parameters. */
export function applyLocally(
  records: LogRecord[],
  f: LogFilters,
  unsupported: ReadonlySet<string>,
  sort: LogSort,
  order: SortOrder,
): LogRecord[] {
  let out = records;
  if (unsupported.has('status_class') && f.statusClass.length)
    out = out.filter((r) => f.statusClass.includes(`${String(r.status_code).charAt(0)}xx` as StatusClass));
  const members = memberChecks(f, (param) => !unsupported.has(param));
  out = out.filter(members);
  if (unsupported.has('stream') && f.streamed) out = out.filter(isStreamed);
  if (unsupported.has('flagged') && f.flagged) out = out.filter((r) => flags(r).length > 0);
  if (unsupported.has('latency_ms_min') && f.latencyMin)
    out = out.filter((r) => (latencyMs(r) ?? 0) >= Number(f.latencyMin));
  if (unsupported.has('latency_ms_max') && f.latencyMax)
    out = out.filter((r) => (latencyMs(r) ?? 0) <= Number(f.latencyMax));
  if (unsupported.has('cost_usd_min') && f.costMin)
    out = out.filter((r) => (costUsd(r) ?? 0) >= Number(f.costMin));
  if (unsupported.has('cost_usd_max') && f.costMax)
    out = out.filter((r) => (costUsd(r) ?? 0) <= Number(f.costMax));
  if (unsupported.has('environment') && f.environment.length)
    out = out.filter((r) => f.environment.includes(environmentOf(r) ?? ''));
  if (unsupported.has('q') && f.q.trim()) {
    const q = f.q.trim().toLowerCase();
    out = out.filter((r) =>
      [r.id, r.request_id, r.model ?? '', r.key ?? '', r.end_user ?? '', r.team ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }
  if (unsupported.has('sort') && !(sort === 'started_at' && order === 'desc')) {
    const value = (r: LogRecord): number => {
      if (sort === 'latency_ms') return latencyMs(r) ?? 0;
      if (sort === 'cost_usd') return costUsd(r) ?? 0;
      if (sort === 'input_tokens') return r.usage.input ?? 0;
      if (sort === 'output_tokens') return r.usage.output ?? 0;
      if (sort === 'ttft_ms') return ttftMs(r) ?? 0;
      if (sort === 'status_code') return r.status_code;
      return new Date(r.started_at).getTime();
    };
    out = [...out].sort((a, b) => (order === 'asc' ? value(a) - value(b) : value(b) - value(a)));
  }
  return out;
}

/** The gateway's error codes (`antirion.code`), for the error-code filter. */
export const ERROR_CODES: readonly string[] = [
  'invalid_request',
  'unsupported_capability',
  'no_route_matched',
  'guardrail_blocked',
  'unauthenticated',
  'budget_exceeded',
  'forbidden',
  'model_not_found',
  'not_found',
  'method_not_allowed',
  'not_acceptable',
  'request_timeout',
  'payload_too_large',
  'unsupported_media_type',
  'headers_too_large',
  'rate_limited',
  'request_exceeds_limit',
  'upstream_rejected',
  'upstream_auth_failed',
  'upstream_quota_exhausted',
  'upstream_bad_response',
  'upstream_rate_limited',
  'upstream_unavailable',
  'upstream_timeout',
  'no_healthy_deployment',
  'dependency_unavailable',
  'overloaded',
  'draining',
  'internal',
];

/** How a response was produced (`response_path`), in plain words. */
export const RESPONSE_PATHS: { value: string; label: string }[] = [
  { value: 'upstream', label: 'From the first deployment' },
  { value: 'fallback', label: 'From a fallback deployment' },
  { value: 'cache', label: 'From the cache' },
  { value: 'local', label: 'Answered by the gateway' },
  { value: 'extension', label: 'Answered by an extension' },
  { value: 'rate_limited', label: 'Refused by a rate limit' },
  { value: 'budget', label: 'Refused by a budget' },
  { value: 'blocked', label: 'Blocked by a guardrail' },
  { value: 'error', label: 'Failed' },
];

export function responsePathLabel(value: string): string {
  return RESPONSE_PATHS.find((p) => p.value === value)?.label ?? value;
}

/** The status classes the log filters on, with their plain-word labels. */
export const STATUS_CLASSES: { value: StatusClass; label: string }[] = [
  { value: '2xx', label: '2xx · Success' },
  { value: '4xx', label: '4xx · Client error' },
  { value: '5xx', label: '5xx · Server error' },
];

export interface FilterChip {
  /** "Status", "Model", "Latency". */
  label: string;
  value: string;
  /** The filters without this one. */
  without: LogFilters;
}

/** The active filters as removable chips ("Status: 4xx, 5xx ×"), in the rail's order. */
export function filterChips(f: LogFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  const list = (
    label: string,
    key:
      | 'statusClass'
      | 'provider'
      | 'model'
      | 'requestedModel'
      | 'team'
      | 'project'
      | 'key'
      | 'user'
      | 'requestId'
      | 'environment'
      | 'tag'
      | 'deployment'
      | 'endUser'
      | 'sessionId'
      | 'code'
      | 'statusCode'
      | 'guardrail'
      | 'guardrailVerdict'
      | 'guardrailCategory'
      | 'metadata',
  ) => {
    if (f[key].length) chips.push({ label, value: f[key].join(', '), without: { ...f, [key]: [] } });
  };
  list('Status', 'statusClass');
  list('Status code', 'statusCode');
  list('Error code', 'code');
  list('Provider', 'provider');
  list('Deployment', 'deployment');
  list('Model', 'model');
  list('Requested model', 'requestedModel');
  list('Team', 'team');
  list('Project', 'project');
  list('Key', 'key');
  list('User', 'user');
  list('End user', 'endUser');
  list('Session', 'sessionId');
  list('Request ID', 'requestId');
  list('Environment', 'environment');
  list('Tags', 'tag');
  if (f.responsePath.length)
    chips.push({
      label: 'Response path',
      value: f.responsePath.map(responsePathLabel).join(', '),
      without: { ...f, responsePath: [] },
    });
  list('Guardrail', 'guardrail');
  list('Guardrail verdict', 'guardrailVerdict');
  list('Guardrail category', 'guardrailCategory');
  list('Metadata', 'metadata');
  const range = (min: string, max: string, unit: (v: string) => string) =>
    min && max ? `${unit(min)} to ${unit(max)}` : min ? `at least ${unit(min)}` : `at most ${unit(max)}`;
  if (f.latencyMin || f.latencyMax)
    chips.push({
      label: 'Latency',
      value: range(f.latencyMin, f.latencyMax, (v) => `${v} ms`),
      without: { ...f, latencyMin: '', latencyMax: '' },
    });
  if (f.costMin || f.costMax)
    chips.push({
      label: 'Cost',
      value: range(f.costMin, f.costMax, (v) => `$${v}`),
      without: { ...f, costMin: '', costMax: '' },
    });
  if (f.cache.length)
    chips.push({
      label: 'Cache',
      value: f.cache.map((c) => CACHE_OUTCOMES.find((o) => o.value === c)?.chip ?? c).join(', '),
      without: { ...f, cache: [] },
    });
  if (f.streamed) chips.push({ label: 'Streamed', value: 'yes', without: { ...f, streamed: false } });
  if (f.flagged)
    chips.push({ label: 'Flagged by guardrails', value: 'yes', without: { ...f, flagged: false } });
  if (f.q.trim()) chips.push({ label: 'Search', value: `“${f.q.trim()}”`, without: { ...f, q: '' } });
  return chips;
}

/** Whether a request has nothing to show in its token columns (it failed before the upstream answered). */
export function hasUsage(r: LogRecord): boolean {
  return r.usage.input != null || r.usage.output != null;
}
