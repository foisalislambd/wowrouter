import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { signInAs } from '@/test/utils';

import { DangerSection } from '../components/danger-section';
import { EXPORT_JOB_KEY, useDanger } from '../danger-store';

const meta = { etag: '"1"', generation: 1, created_at: '2026-10-01T00:00:00Z', managed_by: 'api' };
const list = (items: unknown[]) => HttpResponse.json({ items, next_cursor: null });

/** A reload: the page's memory is gone, the browser's storage is not. */
function reload() {
  useDanger.setState({
    status: emptySlot(),
    governance: emptySlot(),
    organizations: emptySlot(),
    target: emptySlot(),
    pending: emptySlot(),
    job: null,
    jobOrganization: null,
  });
}

function job(over: Record<string, unknown>) {
  return { id: 'job-1', kind: 'organization_export', created_at: '2026-10-17T10:00:00Z', ...over };
}

describe('Organization export', () => {
  beforeEach(() => {
    reload();
    signInAs(['config:read', 'security:read', 'organizations:read', 'organizations:export']);
    server.use(
      http.get('*/admin/v1/status', () => HttpResponse.json({ nodes: [] })),
      http.get('*/admin/v1/settings/governance', () => HttpResponse.json({ spec: {}, metadata: meta })),
      http.get('*/admin/v1/organizations', () => list([])),
      http.get('*/admin/v1/change_requests', () => list([])),
    );
  });

  it('keeps the export it started across a reload and picks it back up', async () => {
    const expires = new Date(Date.now() + 3_600_000).toISOString();
    server.use(
      http.post('*/admin/v1/organizations/acme:export', () =>
        HttpResponse.json(job({ state: 'running', progress: 0.4 }), { status: 202 }),
      ),
      http.get('*/admin/v1/jobs/job-1', () =>
        HttpResponse.json(
          job({
            state: 'succeeded',
            progress: 1,
            download_url: '/admin/v1/jobs/job-1/download',
            expires_at: expires,
          }),
        ),
      ),
    );
    await useDanger.getState().startExport('acme');
    expect(JSON.parse(localStorage.getItem(EXPORT_JOB_KEY) ?? 'null')).toEqual({
      id: 'job-1',
      organization: 'acme',
    });

    reload();
    render(<DangerSection />);
    expect(await screen.findByRole('link', { name: 'Download ZIP' })).toHaveAttribute(
      'href',
      '/admin/v1/jobs/job-1/download',
    );
    expect(screen.getByText('acme')).toBeInTheDocument();

    // Dismissing it forgets it, so the next reload shows nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(localStorage.getItem(EXPORT_JOB_KEY)).toBeNull();
  });

  it('follows an export still running after the reload', async () => {
    localStorage.setItem(EXPORT_JOB_KEY, JSON.stringify({ id: 'job-1', organization: 'acme' }));
    server.use(
      http.get('*/admin/v1/jobs/job-1', () => HttpResponse.json(job({ state: 'running', progress: 0.25 }))),
    );
    render(<DangerSection />);
    expect(await screen.findByText('25% done')).toBeInTheDocument();
  });

  it('forgets an export the gateway no longer has, or whose link has lapsed', async () => {
    localStorage.setItem(EXPORT_JOB_KEY, JSON.stringify({ id: 'job-1', organization: 'acme' }));
    server.use(
      http.get('*/admin/v1/jobs/job-1', () =>
        HttpResponse.json({ error: { code: 'not_found', message: 'gone' } }, { status: 404 }),
      ),
    );
    await useDanger.getState().resumeJob();
    expect(useDanger.getState().job).toBeNull();
    expect(localStorage.getItem(EXPORT_JOB_KEY)).toBeNull();

    localStorage.setItem(EXPORT_JOB_KEY, JSON.stringify({ id: 'job-1', organization: 'acme' }));
    server.use(
      http.get('*/admin/v1/jobs/job-1', () =>
        HttpResponse.json(
          job({
            state: 'succeeded',
            download_url: '/x',
            expires_at: new Date(Date.now() - 1000).toISOString(),
          }),
        ),
      ),
    );
    await useDanger.getState().resumeJob();
    await waitFor(() => expect(localStorage.getItem(EXPORT_JOB_KEY)).toBeNull());
    expect(useDanger.getState().job).toBeNull();
  });
});
