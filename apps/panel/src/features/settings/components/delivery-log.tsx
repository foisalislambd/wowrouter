'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { permissionOf, useCan } from '@/components/ui/gate';
import { noPermissionReason } from '@/lib/permissions';
import { Drawer } from '@/components/ui/overlay';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/states';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { EVENT_TYPES, eventWords } from '@/features/alerts/events';
import { describeError } from '@/lib/api/client';
import { formatDateTime, formatRelative } from '@/lib/time';
import { usePreferences } from '@/stores/preferences';
import { notify } from '@/stores/ui';

import { type AlertDelivery, type DeliveryResult, settingsApi } from '../api';

const RESULTS: { value: DeliveryResult; label: string }[] = [
  { value: 'failed', label: 'Failed' },
  { value: 'timeout', label: 'Timed out' },
  { value: 'delivered', label: 'Delivered' },
];

function resultTone(d: AlertDelivery): 'success' | 'warn' | 'error' {
  if (d.result === 'delivered') return 'success';
  if (d.result === 'timeout') return 'warn';
  return 'error';
}

function resultWords(d: AlertDelivery): string {
  if (d.result === 'delivered') return d.status_code ? `Delivered (${d.status_code})` : 'Delivered';
  if (d.result === 'timeout') return 'Timed out';
  return d.status_code ? `Failed (${d.status_code})` : 'Failed';
}

/**
 * Every delivery attempt of the last 7 days, newest first, to one webhook or channel or to all of
 * them, by result and event, with a redelivery of an event that failed. Settings and Alerts open
 * the same log.
 */
export function DeliveryLog({
  target = null,
  kind,
  result: initialResult = '',
  onClose,
}: {
  /** A webhook's or channel's name; null for every target. */
  target?: string | null;
  kind?: 'webhook' | 'channel';
  /** The result the log opens on ("failed" from a failure count). */
  result?: DeliveryResult | '';
  onClose: () => void;
}) {
  const timeZone = usePreferences((s) => s.timeZone);
  const canRedeliver = useCan('redeliverAlert');
  const [result, setResult] = useState<DeliveryResult | ''>(initialResult);
  const [eventType, setEventType] = useState('');
  const [items, setItems] = useState<AlertDelivery[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(
    (after?: string) => {
      settingsApi.deliveries({ target, result, eventType }, after).then((page) => {
        setItems((prev) => (after ? [...(prev ?? []), ...page.items] : page.items));
        setCursor(page.next_cursor ?? null);
        setError(null);
      }, setError);
    },
    [target, result, eventType],
  );
  useEffect(() => load(), [load]);
  const filtered = result !== '' || eventType !== '';
  const what = result === 'failed' ? 'failed ' : result === 'timeout' ? 'timed-out ' : '';
  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={target ? `Deliveries to ${target}` : 'Alert deliveries'}
      subtitle={`Every ${what}attempt ${target ? `to this ${kind ?? 'target'}` : 'to a webhook or channel'} in the last 7 days, newest first. A redelivery sends the same event again with its id.`}
      headerActions={
        <Button size="sm" variant="ghost" icon="refresh" onClick={() => load()}>
          Refresh
        </Button>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="w-40">
          <Select
            aria-label="Result"
            value={result}
            onChange={(v) => {
              setItems(null);
              setResult(v as DeliveryResult | '');
            }}
            emptyOption="Any result"
            options={RESULTS}
          />
        </div>
        <div className="w-60 max-sm:w-full">
          <Select
            aria-label="Event"
            value={eventType}
            onChange={(v) => {
              setItems(null);
              setEventType(v);
            }}
            emptyOption="Any event"
            searchable
            options={EVENT_TYPES.map((ev) => ({ value: ev.type, label: ev.label }))}
          />
        </div>
      </div>
      {error ? <ErrorState error={error} subject="Deliveries" size="sm" onRetry={() => load()} /> : null}
      {!items && !error ? <LoadingRows rows={5} /> : null}
      {items?.length === 0 ? (
        <EmptyState
          size="sm"
          title={filtered ? 'No deliveries match these filters' : 'No deliveries in the last 7 days'}
          description={filtered ? undefined : target ? 'Send a test to see one.' : undefined}
        />
      ) : null}
      {items && items.length > 0 ? (
        <div className="flex flex-col gap-3">
          <Table label="Deliveries">
            <thead>
              <tr>
                <Th>When</Th>
                {target ? null : <Th>To</Th>}
                <Th>Event</Th>
                <Th numeric>Attempt</Th>
                <Th>Result</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <Tr key={`${d.event_id}-${d.attempt}-${d.time}`}>
                  <Td muted title={formatDateTime(d.time, timeZone)}>
                    {formatRelative(d.time)}
                  </Td>
                  {target ? null : (
                    <Td mono>
                      {d.webhook}
                      {d.target_kind ? (
                        <span className="block font-sans text-caption text-dim">
                          {d.target_kind === 'channel' ? 'Channel' : 'Webhook'}
                        </span>
                      ) : null}
                    </Td>
                  )}
                  <Td>
                    {d.event_type ? eventWords(d.event_type) : 'Event'}
                    <span className="mono block text-caption text-dim">{d.event_id.slice(0, 18)}…</span>
                  </Td>
                  <Td numeric>{d.attempt}</Td>
                  <Td>
                    <Badge tone={resultTone(d)}>{resultWords(d)}</Badge>
                  </Td>
                  <Td>
                    {d.result === 'delivered' ? null : (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="send"
                        busy={busy === d.event_id}
                        disabled={!canRedeliver}
                        disabledReason={
                          canRedeliver ? undefined : noPermissionReason(permissionOf('redeliverAlert'))
                        }
                        onClick={() => {
                          setBusy(d.event_id);
                          settingsApi
                            .redeliver(d.event_id)
                            .then(
                              () => {
                                notify('success', 'Redelivery queued', d.event_id);
                                load();
                              },
                              (e: unknown) => notify('error', "Couldn't redeliver", describeError(e)),
                            )
                            .finally(() => setBusy(null));
                        }}
                      >
                        Redeliver
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {cursor ? (
            <div>
              <Button size="sm" onClick={() => load(cursor)}>
                Show more
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
