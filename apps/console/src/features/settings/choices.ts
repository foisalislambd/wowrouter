import { plural } from '@/lib/format';

const UNIT: Record<string, string> = { ms: 'millisecond', s: 'second', m: 'minute', h: 'hour', d: 'day' };

/** A configuration duration in words: "15m" → "15 minutes", "1h" → "1 hour", "7d" → "7 days". */
export function durationWords(value: string): string {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(value.trim());
  if (!m?.[1] || !m[2]) return value;
  let n = Number(m[1]);
  let unit = m[2];
  // The largest whole unit: 300s reads "5 minutes", 24h "1 day".
  const up: Record<string, [number, string]> = { s: [60, 'm'], m: [60, 'h'], h: [24, 'd'] };
  for (let step = up[unit]; step && n >= step[0] && n % step[0] === 0; step = up[unit]) {
    n /= step[0];
    unit = step[1];
  }
  if (unit === 'd' && n % 365 === 0) return plural(n / 365, 'year');
  return plural(n, UNIT[unit] ?? unit);
}

/** Select options for durations, keeping a stored value the list lacks. */
export function durationOptions(values: string[], current?: string): { value: string; label: string }[] {
  const list = current && !values.includes(current) ? [...values, current] : values;
  return list.map((v) => ({ value: v, label: durationWords(v) }));
}

/** A whole number from form text, or null when it is not one. */
export function whole(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

/** "Enter a number from 1 to 5" unless `text` is a whole number in [min, max]. */
export function rangeError(text: string, min: number, max?: number): string | undefined {
  const n = whole(text);
  if (n !== null && n >= min && (max === undefined || n <= max)) return undefined;
  return max === undefined
    ? `Enter a whole number of at least ${min}`
    : `Enter a number from ${min} to ${max}`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `b` merged into `a`, objects member by member (b wins elsewhere); neither is changed. */
export function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const old = out[k];
    out[k] = isObj(old) && isObj(v) ? deepMerge(old, v) : v;
  }
  return out;
}
