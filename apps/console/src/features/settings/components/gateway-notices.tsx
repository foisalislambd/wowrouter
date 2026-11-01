'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { useSettingsHref } from '@/components/layout/url-sync';
import { Banner } from '@/components/ui/states';
import { isGatewayAdmin } from '@/features/test-mode/api';
import { shiftWords, useTestClock } from '@/features/test-mode/clock';
import { useNow } from '@/lib/hooks';
import { formatDateTime } from '@/lib/time';
import { usePreferences } from '@/stores/preferences';
import { useSession } from '@/stores/session';
import { useShell } from '@/stores/shell';

/**
 * Test mode, on every page while the gateway runs with it: the gateway's clock when it was moved
 * (gateway admins can read it), with a link to the tools in Status. Reading the clock also anchors
 * the page's time ranges on it.
 */
export function TestModeNotice() {
  const testMode = useShell((s) => s.status?.test_mode === true);
  const admin = useSession((s) => isGatewayAdmin(s.me));
  const offset = useTestClock((s) => s.offset);
  const read = useTestClock((s) => s.now !== null);
  const timeZone = usePreferences((s) => s.timeZone);
  const statusHref = useSettingsHref('status');
  const now = useNow(30_000);
  useEffect(() => {
    const clock = useTestClock.getState();
    if (testMode && admin) void clock.load();
    if (!testMode) clock.clear();
  }, [testMode, admin]);
  if (!testMode) return null;
  const shifted = read && offset !== 0;
  return (
    <Banner
      tone="info"
      title={
        shifted
          ? `Test mode · gateway clock ${formatDateTime(new Date(now + offset).toISOString(), timeZone)}`
          : 'Test mode'
      }
      actions={
        admin ? (
          <Link href={statusHref} className="text-ui font-medium text-accent hover:underline">
            Test tools
          </Link>
        ) : null
      }
    >
      {shifted
        ? `The gateway's clock is ${shiftWords(offset)} ${offset > 0 ? 'ahead of' : 'behind'} real time. Time ranges follow the gateway's clock.`
        : 'This gateway runs for tests: its clock can be moved and its state reset.'}
    </Banner>
  );
}

/**
 * Gateway-wide states every page should show while they hold: test mode, a dry run of every
 * request, a gateway-wide traffic pause and a maintenance window that is on now. The dry run and
 * the pause link to the danger zone.
 */
export function GatewayNotices() {
  const status = useShell((s) => s.status);
  const timeZone = usePreferences((s) => s.timeZone);
  const dangerHref = useSettingsHref('danger');
  if (!status) return null;
  const pause = (status.ingress_pauses ?? []).find((p) => p.organization === null);
  const window = status.maintenance_window?.active ? status.maintenance_window : null;
  const link = (text: string) => (
    <Link href={dangerHref} className="text-ui font-medium text-accent hover:underline">
      {text}
    </Link>
  );
  return (
    <>
      <TestModeNotice />
      {status.dry_run_all ? (
        <Banner tone="warn" title="Dry run is on for every request" actions={link('Turn off')}>
          Apps get the model the gateway would choose and its estimated cost, not real answers. Nothing is
          sent to providers.
        </Banner>
      ) : null}
      {pause ? (
        <Banner
          tone="error"
          title={`All traffic is paused until ${formatDateTime(pause.resumes_at, timeZone)}`}
          actions={link('Resume')}
        >
          Apps get an error for new requests. {pause.reason}
        </Banner>
      ) : null}
      {window ? (
        <Banner tone="info" title={`Maintenance until ${formatDateTime(window.end, timeZone)}`}>
          {window.description ?? 'Planned work is in progress.'}
        </Banner>
      ) : null}
    </>
  );
}
