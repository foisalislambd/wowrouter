import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { AuditEntry } from '@/lib/api/types';
import { auditChangeList, auditEntryLabel, auditRecordedFacts } from '@/lib/audit-words';
import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { signInAs } from '@/test/utils';

import { AuditSection } from '../components/audit-section';
import { touches } from '../last-change';
import { useAudit } from '../store';

function entry(over: Omit<Partial<AuditEntry>, 'changes'> & { changes: unknown }): AuditEntry {
  return {
    id: 'au-1',
    time: '2026-10-17T10:00:00Z',
    actor: { type: 'operator', id: 'ada' },
    action: 'logs.export',
    resource: 'logs',
    outcome: 'success',
    status_code: 200,
    request_id: 'req-1',
    source_ip: '127.0.0.1',
    generation_before: 4,
    generation_after: 4,
    kind: 'read',
    ...over,
  } as AuditEntry;
}

/** What `logs.export` records today: its filters and format, not a list of changes. */
const exportChanges = { filters: { model: 'gpt-4o', status: 'error' }, format: 'csv' };

describe('Audit entries whose changes are not a list', () => {
  it('reads every shape as changes and words an export', () => {
    expect(auditChangeList(null)).toEqual([]);
    expect(auditChangeList([{ path: 'a', before: 1, after: 2 }])).toEqual([
      { path: 'a', before: 1, after: 2 },
    ]);
    expect(auditChangeList({ path: 'a', after: 2 })).toEqual([{ path: 'a', after: 2 }]);
    expect(auditChangeList(exportChanges)).toEqual([{ after: exportChanges }]);
    expect(auditRecordedFacts(exportChanges)).toEqual([
      { label: 'Filters', value: 'model: gpt-4o · status: error' },
      { label: 'Format', value: 'csv' },
    ]);
    expect(auditRecordedFacts([{ path: 'a' }])).toBeNull();
    expect(auditEntryLabel(entry({ changes: exportChanges }))).toBe('Request log exported as CSV');
    // The same export once its changes are a list.
    expect(auditEntryLabel(entry({ changes: [{ path: 'logs', after: exportChanges }] }))).toBe(
      'Request log exported as CSV',
    );
    expect(touches(entry({ changes: { path: 'routing.dry_run_all', after: true } }), 'routing')).toBe(true);
  });

  it('shows what such an entry recorded instead of saying nothing changed', async () => {
    signInAs(['audit:read']);
    useAudit.setState({ query: { kind: 'write' }, entries: emptySlot(), cursor: null });
    server.use(
      http.get('*/admin/v1/audit', () =>
        HttpResponse.json({ items: [entry({ changes: exportChanges })], next_cursor: null }),
      ),
    );
    render(<AuditSection />);
    await userEvent.click(await screen.findByText('Request log exported as CSV'));
    const drawer = await screen.findByRole('dialog', { name: 'Request log exported as CSV' });
    expect(within(drawer).getByText('Recorded with this action')).toBeInTheDocument();
    expect(within(drawer).getByText('model: gpt-4o · status: error')).toBeInTheDocument();
    expect(within(drawer).getByText('csv')).toBeInTheDocument();
    expect(within(drawer).queryByText('Nothing was changed by this action.')).not.toBeInTheDocument();
  });
});
