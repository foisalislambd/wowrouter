import { parseDay, parseTime } from '@/components/ui/date-picker';

/** The audit log's time range choices: a span back from now, or two times picked by hand. */
export type AuditRange = '' | '1h' | '24h' | '7d' | '30d' | 'custom';

export const AUDIT_RANGES: { value: AuditRange; label: string }[] = [
  { value: '', label: 'Any time' },
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Between…' },
];

const SPAN_MS: Record<Exclude<AuditRange, '' | 'custom'>, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

/** How far `timeZone` is ahead of UTC at the instant `ms`, in ms. */
function zoneOffset(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return wall - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant a day and `HH:mm` name on the clock of `timeZone` (the console's time zone), as an
 * ISO string; null when either is missing or invalid.
 */
export function zonedInstant(day: string, time: string, timeZone: string): string | null {
  const d = parseDay(day);
  const t = parseTime(time);
  if (!d || !t) return null;
  const wall = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), t.h, t.m);
  // Twice: the first guess can sit on the other side of a daylight-saving change.
  let ms = wall - zoneOffset(wall, timeZone);
  ms = wall - zoneOffset(ms, timeZone);
  return new Date(ms).toISOString();
}

export interface CustomRange {
  fromDay: string;
  fromTime: string;
  toDay: string;
  toTime: string;
}

/**
 * The `from` / `to` of an audit query for a range choice: a span ends now (no `to`); a custom
 * range reads its times on the console's clock. An error names what to fix.
 */
export function auditBounds(
  range: AuditRange,
  custom: CustomRange,
  timeZone: string,
  now: number = Date.now(),
): { from?: string; to?: string; error?: string } {
  if (range === '') return {};
  if (range !== 'custom') return { from: new Date(now - SPAN_MS[range]).toISOString() };
  const from = custom.fromDay ? zonedInstant(custom.fromDay, custom.fromTime || '00:00', timeZone) : null;
  const to = custom.toDay ? zonedInstant(custom.toDay, custom.toTime || '23:59', timeZone) : null;
  if (!from && !to) return { error: 'Choose when the range starts, ends, or both' };
  if (from && to && Date.parse(to) <= Date.parse(from)) return { error: 'End the range after it starts' };
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}
