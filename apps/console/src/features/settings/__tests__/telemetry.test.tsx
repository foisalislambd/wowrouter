import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { pickOption, signInAs } from '@/test/utils';

import { OtlpDrawer } from '../components/connection-drawers';
import { PrometheusDrawer } from '../components/prometheus-drawer';
import { traceOptions, traceOptionsSpec } from '../components/trace-options';
import { useOrgSettings } from '../store';

const meta = {
  etag: '"9"',
  generation: 9,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  managed_by: 'api',
};

function observability(spec: Record<string, unknown>) {
  const patches: unknown[] = [];
  useOrgSettings.setState({
    observability: { data: { spec, metadata: meta }, status: 'ready', error: null, at: 1 },
  });
  server.use(
    http.get('*/admin/v1/settings/observability', () => HttpResponse.json({ spec, metadata: meta })),
    http.patch('*/admin/v1/settings/observability', async ({ request }) => {
      patches.push(await request.json());
      return HttpResponse.json({ spec, metadata: meta });
    }),
  );
  return patches;
}

beforeEach(() => {
  signInAs(['config:read', 'config:apply']);
  useOrgSettings.setState({ auth: emptySlot(), limits: emptySlot(), security: emptySlot() });
});

describe('Prometheus endpoint', () => {
  it('turns off the token for scrapes after a warning, writing only that', async () => {
    const patches = observability({});
    render(<PrometheusDrawer onClose={() => undefined} />);
    const token = screen.getByRole('switch', { name: 'Require a token to scrape' });
    expect(token).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Serve metrics' })).toBeChecked();
    await userEvent.click(token);
    expect(screen.getByRole('status')).toHaveTextContent('Anyone who can reach the admin listener');
    await userEvent.click(screen.getByRole('button', { name: 'Save endpoint' }));
    await waitFor(() => expect(patches).toEqual([{ spec: { metrics: { auth: 'none' } } }]));
  });

  it('refuses a path that does not start with a slash', async () => {
    const patches = observability({ metrics: { path: '/metrics' } });
    render(<PrometheusDrawer onClose={() => undefined} />);
    const path = screen.getByRole('textbox', { name: 'Path' });
    await userEvent.clear(path);
    await userEvent.type(path, 'metrics');
    await userEvent.click(screen.getByRole('button', { name: 'Save endpoint' }));
    expect(await screen.findByText('Enter a path such as /metrics')).toBeInTheDocument();
    expect(patches).toHaveLength(0);
  });
});

describe('trace details', () => {
  it('reads defaults and clears an emptied viewer address', () => {
    const start = traceOptions({ viewer_url: 'https://t.example/{trace_id}' });
    expect(start).toMatchObject({ serviceName: 'antirion', sampler: 'parent_based_ratio', propagate: true });
    expect(traceOptionsSpec({ ...start, viewerUrl: '' }).viewer_url).toBeNull();
  });

  it('writes the service name and the sampler with the trace export, leaving defaults alone', async () => {
    const patches = observability({
      traces: { enabled: true, exporter: { endpoint: 'https://otel.example.com', protocol: 'grpc' } },
    });
    render(<OtlpDrawer onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByText('Trace details'));
    const name = within(dialog).getByRole('textbox', { name: 'Service name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'gateway-eu');
    await pickOption(
      within(dialog).getByRole('combobox', { name: 'Which requests are traced' }),
      'Every request',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save export' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    const traces = (patches[0] as { spec: { traces: Record<string, unknown> } }).spec.traces;
    expect(traces).toMatchObject({ service_name: 'gateway-eu', sampler: { type: 'always_on' } });
    expect(traces).not.toHaveProperty('propagate_to_upstream');
    expect(traces).not.toHaveProperty('include_end_user');
  });
});
