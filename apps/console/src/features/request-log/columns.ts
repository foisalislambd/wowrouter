import type { LogSort } from './types';

/** A column of the request table: its id (kept in preferences and saved views), label and sort. */
export interface LogColumn {
  id: string;
  label: string;
  /** The server-side sort the header applies, when the contract has one for it. */
  sort?: LogSort;
  numeric?: boolean;
  /** Shown when the user has not chosen columns. */
  standard: boolean;
  /** Cannot be hidden: a row needs it to be recognised. */
  fixed?: boolean;
  /** When a chosen column still gives way, said where columns are chosen. */
  note?: string;
  /** For a column of a record field (`field:<name>`): the field's name. */
  field?: string;
}

export const LOG_COLUMNS: LogColumn[] = [
  { id: 'time', label: 'Time', sort: 'started_at', standard: true, fixed: true },
  { id: 'request_id', label: 'Request ID', standard: true, note: 'Gives way while the table is narrow' },
  { id: 'status', label: 'Status', sort: 'status_code', standard: true },
  { id: 'model', label: 'Model', standard: true },
  { id: 'team', label: 'Team · user', standard: true },
  { id: 'prompt', label: 'Prompt', standard: true, note: 'Shown when a request has a prompt to preview' },
  { id: 'tokens', label: 'Tokens', sort: 'input_tokens', numeric: true, standard: true },
  { id: 'output', label: 'Output tokens', sort: 'output_tokens', numeric: true, standard: false },
  { id: 'latency', label: 'Latency', sort: 'latency_ms', numeric: true, standard: true },
  { id: 'ttft', label: 'Time to first token', sort: 'ttft_ms', numeric: true, standard: false },
  { id: 'cost', label: 'Cost', sort: 'cost_usd', numeric: true, standard: true },
  { id: 'flags', label: 'Flags', standard: true, note: 'Shown when a request is flagged' },
  { id: 'key', label: 'API key', standard: false },
  { id: 'environment', label: 'Environment', standard: false },
  { id: 'endpoint', label: 'Endpoint', standard: false },
  { id: 'route', label: 'Route', standard: false },
];

export const STANDARD_COLUMNS: string[] = LOG_COLUMNS.filter((c) => c.standard).map((c) => c.id);

const BY_ID = new Map(LOG_COLUMNS.map((c) => [c.id, c]));

/** Record fields a curated column already shows: the chooser offers that column instead. */
export const FIELD_ALIASES: Record<string, string> = {
  started_at: 'time',
  request_id: 'request_id',
  status_code: 'status',
  model: 'model',
  key: 'key',
  endpoint: 'endpoint',
  route: 'route',
};

/**
 * The chooser's groups, in order: record fields by name, and curated columns as `col:<id>`.
 */
export const COLUMN_GROUPS: { title: string; members: string[] }[] = [
  {
    title: 'Request',
    members: [
      'id',
      'request_id',
      'trace_id',
      'span_id',
      'method',
      'endpoint',
      'operation',
      'dialect',
      'stream',
      'session_id',
      'client_ip',
      'user_agent',
      'client_retry_count',
      'started_at',
      'ended_at',
      'request_headers',
      'response_headers',
    ],
  },
  {
    title: 'Who',
    members: [
      'col:team',
      'organization',
      'team',
      'project',
      'key',
      'col:environment',
      'end_user',
      'tags',
      'metadata',
      'metadata_dropped',
    ],
  },
  {
    title: 'Routing',
    members: [
      'requested_model',
      'model',
      'route',
      'route_path',
      'route_rules',
      'provider',
      'deployment',
      'upstream_model',
      'response_model',
      'upstream_request_id',
      'attempt_count',
      'attempts',
      'skipped_candidates',
      'experiment',
      'budget_downgrade',
      'params_applied',
      'translation_warnings',
    ],
  },
  {
    title: 'Outcome',
    members: [
      'status_code',
      'col:flags',
      'code',
      'reason',
      'stage',
      'error_message',
      'response_path',
      'finish_reasons',
      'stop_category',
      'client_disconnected',
      'cache',
      'admission',
      'degraded',
      'guardrails',
      'extensions',
    ],
  },
  {
    title: 'Usage, cost and timing',
    members: ['col:tokens', 'col:output', 'col:latency', 'col:ttft', 'col:cost', 'usage', 'cost', 'timing'],
  },
  { title: 'Content and protocols', members: ['col:prompt', 'content', 'mcp', 'a2a'] },
  { title: 'Gateway', members: ['node_id', 'gateway_version', 'config_generation', 'schema_version'] },
];

const FIELD_LABELS: Record<string, string> = {
  id: 'Record ID',
  trace_id: 'Trace ID',
  span_id: 'Span ID',
  method: 'Method',
  operation: 'Operation',
  dialect: 'API dialect',
  stream: 'Stream details',
  session_id: 'Session',
  client_ip: 'Client IP',
  user_agent: 'User agent',
  client_retry_count: 'Client retries',
  ended_at: 'Ended at',
  request_headers: 'Request headers',
  response_headers: 'Response headers',
  organization: 'Organization',
  team: 'Team',
  project: 'Project',
  end_user: 'End user',
  tags: 'Tags',
  metadata: 'Metadata',
  metadata_dropped: 'Metadata dropped',
  requested_model: 'Requested model',
  route_path: 'Route path',
  route_rules: 'Route rules',
  provider: 'Provider',
  deployment: 'Deployment',
  upstream_model: 'Upstream model',
  response_model: 'Response model',
  upstream_request_id: 'Upstream request ID',
  attempt_count: 'Attempts',
  attempts: 'Attempt details',
  skipped_candidates: 'Skipped candidates',
  experiment: 'Experiment',
  budget_downgrade: 'Budget downgrade',
  params_applied: 'Parameters applied',
  translation_warnings: 'Translation warnings',
  code: 'Error code',
  reason: 'Error reason',
  stage: 'Error stage',
  error_message: 'Error message',
  response_path: 'Response path',
  finish_reasons: 'Finish reasons',
  stop_category: 'Stop category',
  client_disconnected: 'Client disconnected',
  cache: 'Cache',
  admission: 'Admission',
  degraded: 'Degraded',
  guardrails: 'Guardrails',
  extensions: 'Extensions',
  usage: 'Usage',
  cost: 'Cost details',
  timing: 'Timing',
  content: 'Content',
  mcp: 'MCP',
  a2a: 'A2A',
  node_id: 'Node',
  gateway_version: 'Gateway version',
  config_generation: 'Configuration version',
  schema_version: 'Record version',
};

/** Fields whose values are counts, drawn right-aligned. */
const NUMERIC_FIELDS = new Set([
  'client_retry_count',
  'metadata_dropped',
  'attempt_count',
  'config_generation',
  'schema_version',
]);

const FIELD_NAME = /^[A-Za-z0-9_]{1,64}$/;

/** "client_retry_count" → "Client retry count", for a field the console has no label for. */
function humanize(name: string): string {
  const words = name.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The column of a record field: `field:<name>`, labelled in plain words. */
export function fieldColumn(name: string): LogColumn {
  return {
    id: `field:${name}`,
    label: FIELD_LABELS[name] ?? humanize(name),
    standard: false,
    field: name,
    ...(NUMERIC_FIELDS.has(name) ? { numeric: true } : {}),
  };
}

/** The column a chooser entry stands for: a curated column, or a record field's. */
export function columnOf(id: string): LogColumn | undefined {
  const curated = BY_ID.get(id);
  if (curated) return curated;
  const name = id.startsWith('field:') ? id.slice(6) : null;
  return name && FIELD_NAME.test(name) && !(name in FIELD_ALIASES) ? fieldColumn(name) : undefined;
}

/**
 * The chooser's columns, grouped: every curated column and a column for each field the schema
 * describes (a field a curated column shows is offered as that column), in the groups' order;
 * fields no group names go last, under "Other fields". Without the schema, the curated columns.
 */
export function columnGroups(fields: readonly string[] | null): { title: string; columns: LogColumn[] }[] {
  const described = new Set(fields ?? []);
  const placed = new Set<string>();
  const groups = COLUMN_GROUPS.map((g) => ({
    title: g.title,
    columns: g.members.flatMap((m): LogColumn[] => {
      const curated = BY_ID.get(m.startsWith('col:') ? m.slice(4) : (FIELD_ALIASES[m] ?? ''));
      if (curated) {
        if (placed.has(curated.id)) return [];
        placed.add(curated.id);
        return [curated];
      }
      if (!described.has(m)) return [];
      placed.add(`field:${m}`);
      return [fieldColumn(m)];
    }),
  }));
  const curatedLeft = LOG_COLUMNS.filter((c) => !placed.has(c.id));
  const others = [...described]
    .filter((m) => FIELD_NAME.test(m) && !(m in FIELD_ALIASES) && !placed.has(`field:${m}`))
    .map(fieldColumn);
  return [
    ...(curatedLeft.length ? [{ title: 'Request log', columns: curatedLeft }] : []),
    ...groups,
    { title: 'Other fields', columns: others },
  ].filter((g) => g.columns.length > 0);
}

/**
 * The columns to show, in order: the chosen ids the console knows, without repeats, with the fixed
 * ones kept; the standard set when nothing (or nothing known) was chosen.
 */
export function resolveColumns(chosen: readonly string[] | null | undefined): string[] {
  const known = [...new Set((chosen ?? []).filter((id) => columnOf(id) !== undefined))];
  if (known.length === 0) return STANDARD_COLUMNS;
  const fixed = LOG_COLUMNS.filter((c) => c.fixed && !known.includes(c.id)).map((c) => c.id);
  return [...fixed, ...known];
}

/** Whether a choice is the standard set, so it need not be stored. */
export function isStandard(columns: readonly string[]): boolean {
  return columns.length === STANDARD_COLUMNS.length && columns.every((c, i) => c === STANDARD_COLUMNS[i]);
}

/** Moves a column one place up or down. */
export function moveColumn(columns: readonly string[], id: string, by: -1 | 1): string[] {
  const i = columns.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= columns.length) return [...columns];
  const next = [...columns];
  const a = next[i];
  const b = next[j];
  if (a === undefined || b === undefined) return next;
  next[i] = b;
  next[j] = a;
  return next;
}

/**
 * Shows or hides a column; a shown curated column goes back to its place in the standard order,
 * and a field's column goes last.
 */
export function toggleColumn(columns: readonly string[], id: string): string[] {
  if (columnOf(id)?.fixed) return [...columns];
  if (columns.includes(id)) return columns.filter((c) => c !== id);
  const order = LOG_COLUMNS.map((c) => c.id);
  const at = order.indexOf(id);
  if (at < 0) return [...columns, id];
  const next = [...columns];
  const after = next.findIndex((c) => order.indexOf(c) > at);
  next.splice(after < 0 ? next.length : after, 0, id);
  return next;
}

/** A tooltip's text, cut where it would fill the screen. */
function clip(text: string): string {
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

/** A scalar as text: numbers with their digits, switches as yes or no. */
function scalarText(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return null;
}

/**
 * A record field as one line for a table cell, with the whole value for its tooltip: scalars as
 * they are, lists of scalars joined, other lists by count, and objects as their filled-in members.
 * Null when the record has nothing there.
 */
export function fieldCell(record: unknown, name: string): { text: string; full: string } | null {
  const v = record && typeof record === 'object' ? (record as Record<string, unknown>)[name] : undefined;
  const scalar = scalarText(v);
  if (scalar !== null) return { text: scalar, full: scalar };
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    const texts = v.map(scalarText);
    const text = texts.every((t) => t !== null)
      ? texts.join(', ')
      : v.length === 1
        ? '1 entry'
        : `${String(v.length)} entries`;
    return { text, full: clip(JSON.stringify(v)) };
  }
  if (v && typeof v === 'object') {
    const members = Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => {
      const t = scalarText(x);
      if (t !== null) return [`${k} ${t}`];
      return x && typeof x === 'object' && Object.keys(x).length > 0 ? [`${k} …`] : [];
    });
    if (members.length === 0) return null;
    return { text: members.join(' · '), full: clip(JSON.stringify(v)) };
  }
  return null;
}
