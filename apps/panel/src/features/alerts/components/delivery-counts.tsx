'use client';

import { useCan } from '@/components/ui/gate';
import { formatCount } from '@/lib/format';

import type { DeliveryStatus } from '../api';
import { useAlertEditors } from '../editors';

/**
 * A webhook's or channel's last 24 hours ("12 sent, 2 failed"), each figure opening the delivery
 * log over the drawer: the failures, or every attempt.
 */
export function DeliveryCounts({
  status,
  target,
  kind,
}: {
  status: DeliveryStatus | undefined;
  target: string;
  kind: 'webhook' | 'channel';
}) {
  const show = useAlertEditors((s) => s.show);
  const canRead = useCan('listAlertDeliveries');
  if (!status) return <>—</>;
  const open = (result: 'failed' | '') =>
    show({ kind: 'deliveries', target, targetKind: kind, result }, { over: true });
  const sent = `${formatCount(status.deliveries_24h)} sent`;
  const failed = status.failures_24h ? `${formatCount(status.failures_24h)} failed` : null;
  if (!canRead) return <>{failed ? `${sent}, ${failed}` : sent}</>;
  return (
    <>
      <button type="button" className="hover:text-accent hover:underline" onClick={() => open('')}>
        {sent}
      </button>
      {failed ? (
        <>
          ,{' '}
          <button type="button" className="text-error hover:underline" onClick={() => open('failed')}>
            {failed}
          </button>
        </>
      ) : null}
    </>
  );
}
