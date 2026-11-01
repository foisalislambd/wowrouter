import { create } from 'zustand';

import { useTimeRange } from '@/stores/time-range';

import { testModeApi } from './api';

/** A gateway clock this far from the browser's counts as moved, not as drift between machines. */
export const SHIFT_THRESHOLD_MS = 60_000;

interface TestClockState {
  /** The gateway's time when it was last read, or null before a read (or outside test mode). */
  now: string | null;
  /** The gateway's clock less the browser's, in milliseconds. */
  offset: number;
  /** Reads the test clock (gateway admins only) and anchors the page's time ranges on it. */
  load: () => Promise<void>;
  /** Takes a time the gateway just answered with (after the clock was moved). */
  set: (now: string) => void;
  /** Back to the browser's clock: test mode is off. */
  clear: () => void;
}

/**
 * The test clock of a gateway in test mode. Moving it shifts what "now" means to the gateway, so
 * relative time ranges ("Last 1 h") are anchored on it, or they would miss what it wrote.
 */
export const useTestClock = create<TestClockState>()((set, get) => ({
  now: null,
  offset: 0,
  async load() {
    try {
      get().set((await testModeApi.clock()).now);
    } catch {
      // Not readable (not a gateway admin, or test mode just ended): ranges keep the browser's clock.
    }
  },
  set(now) {
    const at = Date.parse(now);
    if (Number.isNaN(at)) return;
    const offset = Math.abs(at - Date.now()) < SHIFT_THRESHOLD_MS ? 0 : at - Date.now();
    set({ now, offset });
    useTimeRange.getState().setClockOffset(offset);
  },
  clear() {
    if (get().now === null && get().offset === 0) return;
    set({ now: null, offset: 0 });
    useTimeRange.getState().setClockOffset(0);
  },
}));

/** "3 days", "2 h 5 min": how far the test clock is from real time, for a banner. */
export function shiftWords(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [
    days ? `${days} ${days === 1 ? 'day' : 'days'}` : '',
    hours ? `${hours} h` : '',
    !days && mins ? `${mins} min` : '',
  ].filter(Boolean);
  return parts.join(' ') || 'less than a minute';
}
