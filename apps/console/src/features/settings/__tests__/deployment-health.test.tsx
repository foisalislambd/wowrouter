import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { runtimeStatus, useDeploymentDisables } from '@/features/models/deployment-state';
import type { DeploymentHealth } from '@/lib/api/types';
import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { signInAs } from '@/test/utils';

import { HealthSection } from '../components/health-section';
import { useRuntime } from '../store';

const list = (items: unknown[]) => HttpResponse.json({ items, next_cursor: null });

function health(name: string, patch: Partial<DeploymentHealth> = {}): DeploymentHealth {
  return {
    name,
    state: 'closed',
    open_until: null,
    trips: 0,
    consecutive: 0,
    window: { requests: 10, failures: 0 },
    cooldown_until: null,
    disabled_until: null,
    keys: [],
    ...patch,
  };
}

const soon = () => new Date(Date.now() + 120_000).toISOString();

describe('deployment runtime states', () => {
  it('tells a manual disable from a breaker or cooldown pause, with the way back of each', () => {
    expect(runtimeStatus(health('a', { state: 'disabled' }))).toMatchObject({
      kind: 'off',
      label: 'Turned off',
      action: 'enable',
    });
    expect(runtimeStatus(health('a', { state: 'open', open_until: soon() }))).toMatchObject({
      kind: 'paused',
      label: 'Paused after errors',
      action: 'reset',
    });
    expect(runtimeStatus(health('a', { state: 'half_open' }))).toMatchObject({ action: 'reset' });
    expect(runtimeStatus(health('a', { cooldown_until: soon() }))).toMatchObject({
      kind: 'paused',
      action: 'reset',
    });
    // A cooldown that has ended is no pause.
    expect(
      runtimeStatus(health('a', { cooldown_until: new Date(Date.now() - 1000).toISOString() })),
    ).toMatchObject({ kind: 'healthy', action: null });
    expect(runtimeStatus(undefined)).toMatchObject({ kind: 'unknown', action: null });
  });
});

describe('Settings › Status › deployments', () => {
  let actions: string[];
  let rows: DeploymentHealth[];

  beforeEach(() => {
    signInAs(['health:read', 'health:write', 'audit:read']);
    useRuntime.setState({
      health: emptySlot(),
      deployments: emptySlot(),
      providerStatus: emptySlot(),
      cluster: emptySlot(),
    });
    useDeploymentDisables.setState({ byName: {}, at: null });
    actions = [];
    rows = [
      health('manual', { state: 'disabled' }),
      health('tripped', {
        state: 'open',
        trips: 3,
        open_until: soon(),
        window: { requests: 10, failures: 6 },
      }),
      health('fine'),
    ];
    server.use(
      http.get('*/admin/v1/runtime/deployments', () => list(rows)),
      http.post('*/admin/v1/runtime/deployments/:action', async ({ params, request }) => {
        const action = String(params.action);
        actions.push(action);
        const [name, verb] = action.split(':');
        const text = await request.text();
        if (verb === 'disable') actions.push(`body ${text}`);
        rows = rows.map((r) =>
          r.name !== name
            ? r
            : verb === 'enable' || verb === 'reset'
              ? { ...r, state: verb === 'enable' ? 'closed' : r.state === 'disabled' ? 'disabled' : 'closed' }
              : { ...r, state: 'disabled' },
        );
        return HttpResponse.json(rows.find((r) => r.name === name));
      }),
      http.get('*/admin/v1/audit', ({ request }) => {
        const q = new URL(request.url).searchParams;
        expect(q.get('action')).toBe('deployments.disable');
        return list([
          {
            id: 'a1',
            time: new Date(Date.now() - 5 * 60_000).toISOString(),
            actor: { type: 'user', id: 'ada' },
            action: 'deployments.disable',
            resource: 'runtime/deployments/manual',
            outcome: 'success',
            status_code: 200,
            kind: 'write',
          },
        ]);
      }),
    );
  });

  const rowOf = async (name: string) => {
    const table = await screen.findByRole('table', { name: 'Deployment health' });
    const cell = await within(table).findByText(name);
    return cell.closest('tr') as HTMLElement;
  };

  it('shows who turned a deployment off, and turns it on with :enable, never :reset', async () => {
    render(<HealthSection />);
    const row = await rowOf('manual');
    expect(await within(row).findByText(/^by ada 5m ago$/)).toBeInTheDocument();
    expect(within(row).getByText('Turned off')).toBeInTheDocument();
    expect(within(row).queryByText('Paused after errors')).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Resume now' })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(actions).toEqual(['manual:enable']));
    await waitFor(async () => expect(within(await rowOf('manual')).getByText('Healthy')).toBeInTheDocument());
  });

  it('resumes a deployment paused after errors with :reset', async () => {
    render(<HealthSection />);
    const row = await rowOf('tripped');
    expect(within(row).getByText('Paused after errors')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Turn on' })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Resume now' }));
    await waitFor(() => expect(actions).toEqual(['tripped:reset']));
  });

  it('turns a healthy deployment off for a while with :disable', async () => {
    render(<HealthSection />);
    const row = await rowOf('fine');
    expect(within(row).queryByRole('button', { name: 'Resume now' })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Actions for fine' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Turn off…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn off fine?' });
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'How long' }));
    await userEvent.click(await screen.findByRole('option', { name: 'For 1 hour' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn off deployment' }));
    await waitFor(() => expect(actions[0]).toBe('fine:disable'));
    const body = JSON.parse(actions[1]?.slice(5) ?? '{}') as { until?: string };
    expect(Date.parse(body.until ?? '') - Date.now()).toBeGreaterThan(3_500_000);
  });
});
