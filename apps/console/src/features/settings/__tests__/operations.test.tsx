import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { pickOption, signInAs } from '@/test/utils';

import { auditBounds, zonedInstant } from '../audit-range';
import { AuditSection } from '../components/audit-section';
import { ClusterSection, DRAIN_POLL_MS } from '../components/cluster-section';
import { ConfigSection } from '../components/config-section';
import { HealthSection } from '../components/health-section';
import { MetricsCard } from '../components/metrics-card';
import { ObjectivesSection } from '../components/objectives-section';
import { useAudit, useConfigDoc, useGatewaySettings, useOrgSettings, useRuntime } from '../store';

const meta = { etag: '"7"', generation: 7, created_at: null, updated_at: null, managed_by: 'api' };
const list = (items: unknown[]) => HttpResponse.json({ items, next_cursor: null });
/** A POST to an `<path>:<verb>` operation (msw reads `:verb` in a string path as a parameter). */
const action = (path: string) => (r: { request: Request }) => new URL(r.request.url).pathname.endsWith(path);

function resetConfig() {
  useConfigDoc.setState({
    document: emptySlot(),
    draft: '',
    parseError: null,
    diff: emptySlot(),
    validation: emptySlot(),
    applied: emptySlot(),
    appliedBy: null,
    convergence: null,
  });
  useGatewaySettings.setState({ admin: emptySlot() });
}

/** A gateway at version 7 whose apply makes version 8; `converged` answers each convergence call. */
function serveConfig(opts: {
  converged?: { converged: boolean; lagging?: string[] }[];
  validate?: { valid: boolean; errors: unknown[]; warnings: unknown[] };
}) {
  const asked: string[] = [];
  const applied: unknown[] = [];
  let validated = 0;
  const answers = [...(opts.converged ?? [{ converged: true }])];
  server.use(
    http.get('*/admin/v1/config', () =>
      HttpResponse.json({ routes: {} }, { headers: { ETag: applied.length ? '"8"' : '"7"' } }),
    ),
    http.get('*/admin/v1/config/generations', () => list([])),
    http.get('*/admin/v1/settings/admin', () => HttpResponse.json({ spec: {}, metadata: meta })),
    http.post(action('/config:diff'), () =>
      HttpResponse.json({
        base_generation: 7,
        changes: [{ op: 'update', path: 'routes', before: {}, after: { a: 1 } }],
        static_ignored: [],
        warnings: [],
      }),
    ),
    http.post(action('/config:validate'), () => {
      validated += 1;
      return HttpResponse.json(opts.validate ?? { valid: true, errors: [], warnings: [] });
    }),
    http.post(action('/config:apply'), async ({ request }) => {
      applied.push(await request.json());
      return HttpResponse.json({ generation: 8, changes: [], static_ignored: [], propagated: false });
    }),
    http.get('*/admin/v1/cluster/converged', ({ request }) => {
      asked.push(new URL(request.url).search);
      return HttpResponse.json(answers.length > 1 ? answers.shift() : answers[0]);
    }),
  );
  return { asked, applied, validated: () => validated };
}

async function editAndReview() {
  const editor = await screen.findByRole('textbox', { name: 'The configuration as JSON' });
  await userEvent.clear(editor);
  await userEvent.click(editor);
  await userEvent.paste('{"routes":{"a":1}}');
  await userEvent.click(screen.getByRole('button', { name: 'Review changes' }));
}

describe('Configuration: review and apply', () => {
  beforeEach(() => {
    resetConfig();
  });

  it('checks the draft with the gateway when reviewing, and blocks apply on a problem', async () => {
    signInAs(['config:read', 'config:apply']);
    const { validated } = serveConfig({
      validate: {
        valid: false,
        errors: [{ path: 'routes.a', code: 'type', message: 'must be an object' }],
        warnings: [{ path: 'routes', code: 'deprecated', message: 'routes will be renamed' }],
      },
    });
    render(<ConfigSection />);
    await editAndReview();
    expect(await screen.findByText('One problem to fix before you can apply')).toBeInTheDocument();
    expect(screen.getByText('routes.a')).toBeInTheDocument();
    expect(screen.getByText(/must be an object/)).toBeInTheDocument();
    expect(screen.getByText(/routes will be renamed/)).toBeInTheDocument();
    expect(validated()).toBe(1);
    expect(screen.getByRole('button', { name: 'Apply 1 change' })).toBeDisabled();
  });

  it('keeps the apply result and follows the new version to every node', async () => {
    signInAs(['config:read', 'config:apply', 'cluster:read']);
    const { asked, applied } = serveConfig({
      converged: [{ converged: false, lagging: ['node-b'] }, { converged: true }],
    });
    render(<ConfigSection />);
    await editAndReview();
    const apply = await screen.findByRole('button', { name: 'Apply 1 change' });
    await waitFor(() => expect(apply).toBeEnabled());
    await userEvent.click(apply);
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(
      await screen.findByText('Applied as version 8, live on every node', { exact: false }),
    ).toBeInTheDocument();
    expect(asked[0]).toContain('config_version=8');
    expect(asked[0]).toContain('timeout=10s');
    expect(asked).toHaveLength(2);
  });

  it('names the nodes that still lag', async () => {
    signInAs(['config:read', 'config:apply', 'cluster:read']);
    serveConfig({ converged: [{ converged: false, lagging: ['node-b', 'node-c'] }] });
    render(<ConfigSection />);
    await editAndReview();
    const apply = await screen.findByRole('button', { name: 'Apply 1 change' });
    await waitFor(() => expect(apply).toBeEnabled());
    await userEvent.click(apply);
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Apply changes' }),
    );
    expect(await screen.findByText(/still not on node-b and node-c after a minute/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the nodes' })).toBeInTheDocument();
  });

  it('falls back to the apply answer without permission to read the cluster', async () => {
    signInAs(['config:read', 'config:apply']);
    const { asked } = serveConfig({});
    render(<ConfigSection />);
    await editAndReview();
    const apply = await screen.findByRole('button', { name: 'Apply 1 change' });
    await waitFor(() => expect(apply).toBeEnabled());
    await userEvent.click(apply);
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Apply changes' }),
    );
    expect(await screen.findByText(/Applied as version 8, reaching every node/)).toBeInTheDocument();
    expect(asked).toHaveLength(0);
  });
});

describe('Objectives', () => {
  beforeEach(() => {
    useOrgSettings.setState({ observability: emptySlot() });
  });

  function serveSlos() {
    const patches: unknown[] = [];
    let slos: Record<string, unknown> = {
      'chat-availability': {
        kind: 'availability',
        objective: 0.999,
        window: '30d',
        scope: { model: 'gpt-4.1' },
      },
    };
    let generation = 7;
    server.use(
      http.get('*/admin/v1/settings/observability', () =>
        HttpResponse.json({ spec: { slos }, metadata: { ...meta, generation, etag: `"${generation}"` } }),
      ),
      http.patch('*/admin/v1/settings/observability', async ({ request }) => {
        const body = (await request.json()) as { spec: { slos: Record<string, unknown> } };
        patches.push(body.spec);
        for (const [k, v] of Object.entries(body.spec.slos)) {
          if (v === null) {
            const { [k]: _, ...rest } = slos;
            slos = rest;
          } else slos = { ...slos, [k]: { ...(slos[k] as object), ...(v as object) } };
        }
        generation += 1;
        return HttpResponse.json({ spec: { slos }, metadata: { ...meta, generation } });
      }),
      http.get('*/admin/v1/runtime/slos', () =>
        list([
          {
            name: 'chat-availability',
            kind: 'availability',
            objective: 0.999,
            attained: 0.9994,
            error_budget_remaining: 0.4,
            burn_rate_1h: 2.5,
            burn_rate_6h: 0.7,
            window: '30d',
          },
        ]),
      ),
    );
    return patches;
  }

  it('lists objectives with their status, then adds, edits and removes one', async () => {
    signInAs(['config:read', 'config:apply', 'analytics:read', 'health:read']);
    const patches = serveSlos();
    render(<ObjectivesSection />);
    const table = await screen.findByRole('table', { name: 'Objectives' });
    const row = within(table).getByText('chat-availability').closest('tr') ?? table;
    expect(within(row).getByText('99.9%')).toBeInTheDocument();
    expect(await within(row).findByText('99.940%')).toBeInTheDocument();
    expect(within(row).getByText('40%')).toBeInTheDocument();
    expect(within(row).getByText('2.5×')).toBeInTheDocument();
    expect(within(row).getByText('Model gpt-4.1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add objective' }));
    const drawer = await screen.findByRole('dialog', { name: 'Add objective' });
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Name' }), 'chat-latency');
    await userEvent.click(within(drawer).getByRole('radio', { name: 'Requests answered in time' }));
    await userEvent.type(
      within(drawer).getByRole('spinbutton', { name: 'In time means within (ms)' }),
      '2000',
    );
    const target = within(drawer).getByRole('spinbutton', { name: 'Target (%)' });
    await userEvent.clear(target);
    await userEvent.type(target, '95');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Add objective' }));
    await waitFor(() =>
      expect(patches[0]).toEqual({
        slos: {
          'chat-latency': { kind: 'latency', objective: 0.95, latency_threshold_ms: 2000, window: '30d' },
        },
      }),
    );
    expect(await within(table).findByText('chat-latency')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Actions for chat-availability' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const edit = await screen.findByRole('dialog', { name: 'Objective chat-availability' });
    await userEvent.click(within(edit).getByRole('button', { name: 'Remove condition 1' }));
    await userEvent.click(within(edit).getByRole('button', { name: 'Save objective' }));
    await waitFor(() => expect(patches[1]).toEqual({ slos: { 'chat-availability': { scope: null } } }));

    await userEvent.click(screen.getByRole('button', { name: 'Actions for chat-latency' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove objective' }));
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove objective' }));
    await waitFor(() => expect(patches[2]).toEqual({ slos: { 'chat-latency': null } }));
  });

  it('refuses a target of 100% or more', async () => {
    signInAs(['config:read', 'config:apply']);
    const patches = serveSlos();
    render(<ObjectivesSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add objective' }));
    const drawer = await screen.findByRole('dialog', { name: 'Add objective' });
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Name' }), 'perfect');
    const target = within(drawer).getByRole('spinbutton', { name: 'Target (%)' });
    await userEvent.clear(target);
    await userEvent.type(target, '100');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Add objective' }));
    expect(await within(drawer).findByText(/above 0 and below 100/)).toBeInTheDocument();
    expect(patches).toHaveLength(0);
  });
});

describe('Audit log time range', () => {
  beforeEach(() => {
    useAudit.setState({ query: { kind: 'write' }, entries: emptySlot(), cursor: null });
  });

  it('sends the chosen range as from, and exports every matching page', async () => {
    signInAs(['audit:read']);
    const seen: URLSearchParams[] = [];
    const entry = (id: string) => ({
      id,
      time: '2026-10-17T14:30:00Z',
      actor: { type: 'operator', id: 'ada' },
      action: 'keys.create',
      resource: `keys/${id}`,
      outcome: 'success',
      status_code: 201,
      generation_before: 1,
      generation_after: 2,
      request_id: `r-${id}`,
      source_ip: '10.0.0.1',
      changes: null,
    });
    server.use(
      http.get('*/admin/v1/audit', ({ request }) => {
        const q = new URL(request.url).searchParams;
        seen.push(q);
        if (q.get('limit') === '500')
          return HttpResponse.json(
            q.get('cursor')
              ? { items: [entry('b')], next_cursor: null }
              : { items: [entry('a')], next_cursor: 'c2' },
          );
        return list([entry('a')]);
      }),
    );
    const created = vi.fn(() => 'blob:audit');
    URL.createObjectURL = created;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<AuditSection />);
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.get('from')).toBeNull();
    await pickOption(screen.getByRole('combobox', { name: 'When' }), 'Last 24 hours');
    const before = Date.now();
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await waitFor(() => expect(seen).toHaveLength(2));
    const from = Date.parse(seen[1]?.get('from') ?? '');
    expect(Math.abs(before - 86_400_000 - from)).toBeLessThan(10_000);
    expect(seen[1]?.get('to')).toBeNull();
    expect(seen[1]?.get('kind')).toBe('write');
    expect(screen.getByText(/Since /)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const pages = seen.filter((q) => q.get('limit') === '500');
    expect(pages.map((q) => q.get('cursor'))).toEqual([null, 'c2']);
    expect(pages.every((q) => q.get('from') === seen[1]?.get('from'))).toBe(true);
    const blob = (created.mock.calls[0] as unknown as [Blob])[0];
    const csv = await blob.text();
    expect(csv).toContain('keys/a');
    expect(csv).toContain('keys/b');
    click.mockRestore();
  });

  it('reads a custom range on the console clock', () => {
    const custom = { fromDay: '2026-10-17', fromTime: '14:00', toDay: '2026-10-17', toTime: '15:00' };
    expect(auditBounds('custom', custom, 'UTC')).toEqual({
      from: '2026-10-17T14:00:00.000Z',
      to: '2026-10-17T15:00:00.000Z',
    });
    expect(auditBounds('custom', custom, 'America/Sao_Paulo')).toEqual({
      from: '2026-10-17T17:00:00.000Z',
      to: '2026-10-17T18:00:00.000Z',
    });
    expect(zonedInstant('2026-07-01', '12:00', 'Europe/Berlin')).toBe('2026-07-01T10:00:00.000Z');
    expect(auditBounds('custom', { ...custom, toTime: '13:00' }, 'UTC').error).toBe(
      'End the range after it starts',
    );
    expect(auditBounds('7d', custom, 'UTC', Date.parse('2026-10-17T00:00:00Z'))).toEqual({
      from: '2026-10-10T00:00:00.000Z',
    });
  });
});

describe('Cluster view', () => {
  const node = (id: string, extra: Record<string, unknown> = {}) => ({
    node_id: id,
    version: '0.1.0',
    config_version: 9,
    ready: true,
    draining: false,
    degraded: [],
    last_seen: new Date().toISOString(),
    in_flight: 12,
    max_in_flight: 16384,
    queue_depth: 3,
    started_at: '2026-10-17T08:00:00Z',
    ready_since: '2026-10-17T08:01:00Z',
    ...extra,
  });

  beforeEach(() => {
    useRuntime.setState({
      health: emptySlot(),
      deployments: emptySlot(),
      providerStatus: emptySlot(),
      cluster: emptySlot(),
    });
  });

  it('shows the cluster totals, each node load, job leases and a node in a drawer', async () => {
    signInAs(['health:read', 'cluster:read', 'node:drain']);
    const opened: string[] = [];
    let reads = 0;
    server.use(
      http.get('*/admin/v1/cluster', () =>
        HttpResponse.json({
          mode: 'cluster',
          nodes: [node('node-a'), node('node-b', { config_version: 8, in_flight: 40, queue_depth: 0 })],
          jobs: [
            { name: 'rollups', holder: 'node-a', expires_at: new Date(Date.now() + 30_000).toISOString() },
          ],
          totals: { in_flight: 52, max_in_flight: 32768, queue_depth: 3 },
        }),
      ),
      http.get('*/admin/v1/health', () =>
        HttpResponse.json({
          status: 'ok',
          config: { generation: 9, hash: 'h' },
          admission: { in_flight: 0, max_in_flight: 1, queued: 0, max_queue: 1 },
          spool: { bytes: 0, max_bytes: 1, records: 0 },
          dependencies: {},
          clock_skew_ms: 0,
        }),
      ),
      http.get('*/admin/v1/runtime/deployments', () => list([])),
      http.get('*/admin/v1/runtime/providers', () => list([])),
      http.get('*/admin/v1/runtime/nodes/:id', ({ params }) => {
        opened.push(String(params.id));
        reads += 1;
        // Draining: two requests left on the first read, none on the next.
        return HttpResponse.json(node(String(params.id), { draining: true, in_flight: reads > 1 ? 0 : 2 }));
      }),
    );
    render(<HealthSection />);
    expect(
      await screen.findByText(/Cluster · 2 of 2 ready · 52 of 32,768 active · 3 waiting/),
    ).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Nodes' });
    const rowB = within(table).getByText('node-b').closest('tr') ?? table;
    expect(within(rowB).getByText('40 / 16,384')).toBeInTheDocument();
    expect(within(rowB).getByText('behind')).toBeInTheDocument();
    const jobs = screen.getByRole('table', { name: 'Background jobs' });
    expect(within(jobs).getByText('rollups')).toBeInTheDocument();
    expect(within(jobs).getByText('node-a')).toBeInTheDocument();

    await userEvent.click(within(rowB).getByText('node-b'));
    const drawer = await screen.findByRole('dialog', { name: 'Node node-b' });
    expect(await within(drawer).findByText(/Draining: 2 requests still in progress/)).toBeInTheDocument();
    expect(opened[0]).toBe('node-b');
    expect(
      await within(drawer).findByText(
        /Drained: no request in progress/,
        {},
        { timeout: DRAIN_POLL_MS + 2000 },
      ),
    ).toBeInTheDocument();
  });

  it('shows nothing of the cluster without permission to read it', () => {
    signInAs(['health:read']);
    render(<ClusterSection running={null} />);
    expect(screen.queryByRole('table', { name: 'Nodes' })).not.toBeInTheDocument();
  });
});

describe('Metrics on Status', () => {
  it('shows the scrape address and links to the endpoint tile in Notifications', async () => {
    signInAs(['config:read']);
    useOrgSettings.setState({ observability: emptySlot() });
    server.use(
      http.get('*/admin/v1/settings/observability', () =>
        HttpResponse.json({
          spec: { metrics: { path: '/prom', auth: 'none', tenant_labels: ['team'] } },
          metadata: meta,
        }),
      ),
    );
    render(<MetricsCard />);
    expect(await screen.findByText(`${window.location.origin}/prom`)).toBeInTheDocument();
    expect(screen.getByText(/anyone who can reach the admin listener/)).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change in Notifications' }).getAttribute('href')).toContain(
      'settings=notifications',
    );
  });
});
