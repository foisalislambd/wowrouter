import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import type { LogRecord } from '@/lib/api/types';
import { emptySlot } from '@/lib/slot';
import { decodeFilters, encodeFilters } from '@/lib/url-filters';
import { server } from '@/mocks/node';
import { usePreferences } from '@/stores/preferences';
import { useUi } from '@/stores/ui';
import { signInAs } from '@/test/utils';

import { logsApi, type LogQuery } from '../api';
import {
  columnGroups,
  columnOf,
  fieldCell,
  resolveColumns,
  STANDARD_COLUMNS,
  toggleColumn,
} from '../columns';
import { LogDrawer } from '../components/log-drawer';
import { RequestLogScreen } from '../components/request-log-screen';
import { useLogs } from '../store';
import {
  activeFilterCount,
  EMPTY_LOG_FILTERS,
  filterChips,
  filtersFromView,
  filtersToQuery,
  fromUrlState,
  LOG_URL_DEFAULTS,
  type LogFilters,
  matchesFilters,
  toUrlState,
  viewFilters,
} from '../types';

/** Every filter the log has, each set. */
const ALL: LogFilters = {
  ...EMPTY_LOG_FILTERS,
  statusClass: ['4xx'],
  provider: ['openai'],
  deployment: ['gpt-4o-eu'],
  endUser: ['cust-4821'],
  sessionId: ['s-1'],
  code: ['rate_limited'],
  statusCode: ['429'],
  responsePath: ['fallback'],
  guardrail: ['pii-scan'],
  guardrailVerdict: ['block'],
  guardrailCategory: ['pii'],
  metadata: ['tier=gold', 'region=eu'],
  cache: ['semantic_hit', 'bypass'],
  flagged: true,
  latencyMin: '100',
  q: 'refund',
};

function record(extra: Partial<LogRecord> = {}): LogRecord {
  return {
    id: 'r1',
    request_id: 'r1',
    status_code: 429,
    code: 'rate_limited',
    response_path: 'fallback',
    deployment: 'gpt-4o-eu',
    end_user: 'cust-4821',
    session_id: 's-1',
    metadata: { tier: 'gold', region: 'eu', seats: 12 },
    started_at: new Date().toISOString(),
    timing: { total_ms: 500 },
    cost: { total: '0.02' },
    cache: { status: 'semantic_hit' },
    usage: { input: 10, output: 5 },
    guardrails: [{ name: 'pii-scan', verdict: 'block', category: 'pii' }],
    stream: null,
    model: 'gpt-4o',
    provider: 'openai',
    key: 'web',
    team: 'platform',
    tags: ['env:prod'],
    method: 'POST',
    endpoint: '/v1/chat/completions',
    attempts: [],
    attempt_count: 1,
    request_headers: {},
    response_headers: {},
    ...extra,
  } as LogRecord;
}

describe('the new filters in the URL, the query and saved views', () => {
  it('round-trip through the URL with the sort', () => {
    const params = encodeFilters(
      new URLSearchParams('org=gateway'),
      toUrlState(ALL, 'cost_usd', 'asc'),
      LOG_URL_DEFAULTS,
    );
    expect(params.getAll('end_user')).toEqual(['cust-4821']);
    expect(params.getAll('status_code')).toEqual(['429']);
    expect(params.getAll('metadata')).toEqual(['tier=gold', 'region=eu']);
    expect(params.getAll('cache')).toEqual(['semantic_hit', 'bypass']);
    const back = fromUrlState(decodeFilters(new URLSearchParams(params.toString()), LOG_URL_DEFAULTS));
    expect(back).toEqual({ filters: ALL, sort: 'cost_usd', order: 'asc' });
  });

  it('drops malformed values a link carries', () => {
    const back = fromUrlState(
      decodeFilters(
        new URLSearchParams('status_code=42&status_code=503&metadata=novalue&cache=maybe'),
        LOG_URL_DEFAULTS,
      ),
    );
    expect(back.filters.statusCode).toEqual(['503']);
    expect(back.filters.metadata).toEqual([]);
    expect(back.filters.cache).toEqual([]);
  });

  it('are sent as the contract parameters, metadata as metadata.<name>', () => {
    expect(filtersToQuery(ALL)).toMatchObject({
      deployment: ['gpt-4o-eu'],
      end_user: ['cust-4821'],
      session_id: ['s-1'],
      code: ['rate_limited'],
      status_code: [429],
      response_path: ['fallback'],
      guardrail: ['pii-scan'],
      guardrail_verdict: ['block'],
      guardrail_category: ['pii'],
      'metadata.tier': 'gold',
      'metadata.region': 'eu',
      cache: ['semantic_hit', 'bypass'],
    });
  });

  it('survive saving and loading a view, and read a view another client wrote', () => {
    expect(filtersFromView(viewFilters(ALL))).toEqual(ALL);
    expect(
      filtersFromView({
        end_user: 'ada',
        status_code: [500, '502'],
        'metadata.tier': 'gold',
        cache: ['bypass'],
      }),
    ).toMatchObject({
      endUser: ['ada'],
      statusCode: ['500', '502'],
      metadata: ['tier=gold'],
      cache: ['bypass'],
    });
  });

  it('carry into the live tail, the export and the side counts', () => {
    const query: LogQuery = {
      from: '2026-10-01T00:00:00Z',
      to: '2026-10-02T00:00:00Z',
      filters: ALL,
      sort: 'started_at',
      order: 'desc',
      organization: null,
      tag: null,
    };
    const tail = new URL(logsApi.tailUrl(query), 'http://x').searchParams;
    expect(tail.getAll('end_user')).toEqual(['cust-4821']);
    expect(tail.getAll('status_code')).toEqual(['429']);
    expect(tail.get('metadata.tier')).toBe('gold');
    const exported = new URL(logsApi.exportUrl(query), 'http://x').searchParams;
    expect(exported.getAll('guardrail_verdict')).toEqual(['block']);
    expect(exported.getAll('status_code')).toEqual(['429']);
    expect(exported.get('metadata.region')).toBe('eu');
  });

  it('match live records, name chips and count as active', () => {
    expect(matchesFilters(record(), { ...ALL, flagged: false, latencyMin: '', q: '', statusClass: [] })).toBe(
      true,
    );
    const only = (patch: Partial<LogFilters>) => matchesFilters(record(), { ...EMPTY_LOG_FILTERS, ...patch });
    expect(only({ endUser: ['someone-else'] })).toBe(false);
    expect(only({ statusCode: ['500'] })).toBe(false);
    expect(only({ metadata: ['seats=12'] })).toBe(true);
    expect(only({ metadata: ['tier=silver'] })).toBe(false);
    expect(only({ guardrailCategory: ['toxicity'] })).toBe(false);
    expect(only({ cache: ['hit'] })).toBe(false);
    expect(only({ cache: ['semantic_hit'] })).toBe(true);
    const chips = filterChips(ALL).map((c) => `${c.label}: ${c.value}`);
    expect(chips).toEqual(
      expect.arrayContaining([
        'End user: cust-4821',
        'Status code: 429',
        'Error code: rate_limited',
        'Response path: From a fallback deployment',
        'Metadata: tier=gold, region=eu',
        'Cache: semantic hits, bypassed',
      ]),
    );
    expect(activeFilterCount({ ...EMPTY_LOG_FILTERS, metadata: ['a=1', 'b=2'], sessionId: ['s'] })).toBe(3);
  });
});

describe('columns from the record schema', () => {
  const fields = [
    'id',
    'started_at',
    'status_code',
    'deployment',
    'end_user',
    'usage',
    'cost',
    'node_id',
    'shiny_new',
  ];

  it('offers every curated column and each described field, grouped, with readable labels', () => {
    const groups = columnGroups(fields);
    const all = groups.flatMap((g) => g.columns.map((c) => c.id));
    expect(all.filter((id) => !id.startsWith('field:'))).toHaveLength(16);
    expect(all).toEqual(
      expect.arrayContaining(['field:deployment', 'field:end_user', 'field:node_id', 'field:shiny_new']),
    );
    expect(all).not.toContain('field:started_at');
    expect(all).not.toContain('field:status_code');
    expect(groups.find((g) => g.title === 'Routing')?.columns.map((c) => c.label)).toContain('Deployment');
    expect(groups.at(-1)).toMatchObject({ title: 'Other fields', columns: [{ label: 'Shiny new' }] });
    expect(columnGroups(null).flatMap((g) => g.columns)).toHaveLength(16);
  });

  it('keeps field columns in a choice, adds them last and reads their cells', () => {
    expect(resolveColumns(['field:deployment', 'field:bad name', 'cost'])).toEqual([
      'time',
      'field:deployment',
      'cost',
    ]);
    expect(toggleColumn(STANDARD_COLUMNS, 'field:node_id').at(-1)).toBe('field:node_id');
    expect(columnOf('field:client_retry_count')).toMatchObject({ label: 'Client retries', numeric: true });
    const r = record({ attempts: [{ index: 0 }, { index: 1 }] } as Partial<LogRecord>);
    expect(fieldCell(r, 'deployment')?.text).toBe('gpt-4o-eu');
    expect(fieldCell(r, 'usage')?.text).toBe('input 10 · output 5');
    expect(fieldCell(r, 'attempts')?.text).toBe('2 entries');
    expect(fieldCell(r, 'node_id')).toBeNull();
  });
});

const empty = () => HttpResponse.json({ items: [], next_cursor: null });

describe('on the Request log screen', () => {
  let views: Record<string, unknown>[];
  let listed: URLSearchParams[];

  beforeEach(() => {
    window.history.replaceState(null, '', '/request-log/');
    useLogs.setState({
      records: emptySlot(),
      aggregates: emptySlot(),
      views: emptySlot(),
      fields: emptySlot(),
      filters: EMPTY_LOG_FILTERS,
      sort: 'started_at',
      order: 'desc',
      facets: {},
    });
    usePreferences.setState({ logColumns: null });
    views = [];
    listed = [];
    server.use(
      http.get('*/admin/v1/logs', ({ request }) => {
        listed.push(new URL(request.url).searchParams);
        return HttpResponse.json({ items: [record()], next_cursor: null });
      }),
      http.get('*/admin/v1/analytics/usage', empty),
      http.get('*/admin/v1/logs/views', () => HttpResponse.json({ items: views, next_cursor: null })),
      http.get('*/admin/v1/logs/views/:id', ({ params }) => {
        const found = views.find((v) => v.id === params.id);
        return found
          ? HttpResponse.json(found)
          : HttpResponse.json({ error: { code: 'not_found', message: 'no view' } }, { status: 404 });
      }),
      http.post('*/admin/v1/logs/views', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        const created = { id: 'v-new', starred: true, shared: false, created_by: 'tester', ...body };
        views = [...views, created];
        return HttpResponse.json(created, { status: 201 });
      }),
      http.get('*/admin/v1/logs/schema', () =>
        HttpResponse.json({
          type: 'object',
          properties: Object.fromEntries(fields().map((f) => [f, { type: ['string', 'null'] }])),
        }),
      ),
    );
    signInAs(['logs:read', 'analytics:read', 'logs:delete']);
  });

  const fields = () => ['id', 'started_at', 'request_id', 'deployment', 'end_user', 'session_id', 'node_id'];

  it('adds an end user and an exact status from the rail, into the URL and the list query', async () => {
    render(<RequestLogScreen />);
    const rail = await screen.findByRole('group', { name: 'End user' });
    await userEvent.type(
      within(rail).getByRole('textbox', { name: 'Add an end user filter' }),
      'cust-9{Enter}',
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Add an exact status code' }), '503{Enter}');
    expect(await screen.findByRole('button', { name: 'Remove filter End user: cust-9' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove filter Status code: 503' })).toBeInTheDocument();
    expect(window.location.search).toContain('end_user=cust-9');
    expect(window.location.search).toContain('status_code=503');
    await waitFor(() => expect(listed.at(-1)?.getAll('end_user')).toEqual(['cust-9']));
    expect(listed.at(-1)?.getAll('status_code')).toEqual(['503']);
  });

  it('saves a view with the new filters and opens it again from its link', async () => {
    window.history.replaceState(
      null,
      '',
      '/request-log/?end_user=cust-4821&metadata=tier%3Dgold&cache=bypass',
    );
    render(<RequestLogScreen />);
    const nav = await screen.findByRole('navigation', { name: 'Saved views' });
    await userEvent.click(within(nav).getByRole('button', { name: 'Save view' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save the current view' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Gold');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save view' }));
    await waitFor(() => expect(views).toHaveLength(1));
    expect(views[0]?.filters).toEqual({
      end_user: ['cust-4821'],
      'metadata.tier': 'gold',
      cache: ['bypass'],
    });

    useLogs.setState({ filters: EMPTY_LOG_FILTERS, views: emptySlot() });
    window.history.replaceState(null, '', '/request-log/?view=v-new');
    render(<RequestLogScreen />);
    await waitFor(() => expect(window.location.search).not.toContain('view='));
    expect(useLogs.getState().filters).toMatchObject({
      endUser: ['cust-4821'],
      metadata: ['tier=gold'],
      cache: ['bypass'],
    });
  });

  it('says so when a view link no longer opens', async () => {
    window.history.replaceState(null, '', '/request-log/?view=gone');
    render(<RequestLogScreen />);
    await waitFor(() =>
      expect(useUi.getState().toasts.some((t) => t.title === "Couldn't open the saved view")).toBe(true),
    );
    expect(window.location.search).not.toContain('view=');
  });

  it('erases the selected end user from the facet with the same confirmation', async () => {
    const erased: (string | null)[] = [];
    server.use(
      http.delete('*/admin/v1/logs', ({ request }) => {
        erased.push(new URL(request.url).searchParams.get('end_user'));
        return HttpResponse.json({ deleted: 3 });
      }),
    );
    window.history.replaceState(null, '', '/request-log/?end_user=cust-4821');
    render(<RequestLogScreen />);
    const rail = await screen.findByRole('group', { name: /End user/ });
    await userEvent.click(within(rail).getByRole('button', { name: 'Erase the records of cust-4821' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Erase the records of cust-4821?' });
    await userEvent.type(within(dialog).getByRole('textbox'), 'cust-4821');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Erase records' }));
    await waitFor(() => expect(erased).toEqual(['cust-4821']));
    await waitFor(() => expect(useLogs.getState().filters.endUser).toEqual([]));
  });

  it('offers the schema fields in the column chooser and shows a chosen one', async () => {
    render(<RequestLogScreen />);
    await screen.findByRole('columnheader', { name: /Cost/ });
    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    const chooser = await screen.findByRole('dialog', { name: 'Columns' });
    const routing = await within(chooser).findByRole('list', { name: 'Hidden columns: Routing' });
    await userEvent.click(within(routing).getByRole('checkbox', { name: 'Deployment' }));
    expect(usePreferences.getState().logColumns?.at(-1)).toBe('field:deployment');
    expect(screen.getByRole('columnheader', { name: 'Deployment' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'gpt-4o-eu' })).toBeInTheDocument();
    await userEvent.type(within(chooser).getByRole('textbox', { name: 'Find a column' }), 'node');
    expect(within(chooser).getByRole('checkbox', { name: 'Node' })).toBeInTheDocument();
    expect(within(chooser).queryByRole('checkbox', { name: 'API key' })).not.toBeInTheDocument();
  });
});

describe('content past its retention', () => {
  it('says how long content is kept instead of asking to turn logging on', async () => {
    useLogs.setState({ detail: emptySlot(), contentRetention: undefined });
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    server.use(
      http.get('*/admin/v1/logs/:id', () => HttpResponse.json(record({ started_at: old, content: null }))),
      http.get('*/admin/v1/settings/observability', () =>
        HttpResponse.json({
          spec: { request_logs: { sinks: { store: { retention: '30d', content_retention: '7d' } } } },
          metadata: {},
        }),
      ),
    );
    signInAs(['logs:read', 'logs:read_content', 'config:read']);
    render(<LogDrawer id="r1" onClose={() => undefined} onOpen={() => undefined} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Request' }));
    expect(await screen.findByText('Content is kept for 7 days; this request is older.')).toBeInTheDocument();
    expect(screen.queryByText(/Turn on content logging/)).not.toBeInTheDocument();
  });
});

describe('the calls the gateway made for a request', () => {
  it('shows their cost beside the total that includes it', async () => {
    useLogs.setState({ detail: emptySlot(), contentRetention: undefined });
    server.use(
      http.get('*/admin/v1/logs/:id', () =>
        HttpResponse.json(
          record({
            status_code: 200,
            code: null,
            cost: { total: '0.021', auxiliary: '0.001', status: 'exact' },
          }),
        ),
      ),
    );
    signInAs(['logs:read']);
    render(<LogDrawer id="r1" onClose={() => undefined} onOpen={() => undefined} />);
    expect(await screen.findByText('Gateway calls')).toBeInTheDocument();
    expect(screen.getByText(/cache lookups and routing, in the total/)).toBeInTheDocument();
  });

  it('leaves the row out when the gateway made none', async () => {
    useLogs.setState({ detail: emptySlot(), contentRetention: undefined });
    server.use(
      http.get('*/admin/v1/logs/:id', () =>
        HttpResponse.json(record({ status_code: 200, code: null, cost: { total: '0.02', status: 'exact' } })),
      ),
    );
    signInAs(['logs:read']);
    render(<LogDrawer id="r1" onClose={() => undefined} onOpen={() => undefined} />);
    expect(await screen.findByText('Total cost')).toBeInTheDocument();
    expect(screen.queryByText('Gateway calls')).not.toBeInTheDocument();
  });
});
