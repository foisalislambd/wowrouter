import { ApiError } from '@/lib/api/client';

import type { LoadStatus } from './collection-store';

/** One read's state inside a feature store: its data, load status, error and time. */
export interface Slot<T> {
  data: T | null;
  /** `error` only when there is no data; a refresh that fails after data came stays `ready`. */
  status: LoadStatus;
  /** The last read's failure, cleared by the next read that succeeds. */
  error: ApiError | null;
  at: number | null;
}

export function emptySlot<T>(): Slot<T> {
  return { data: null, status: 'idle', error: null, at: null };
}

type SlotKeys<S> = { [K in keyof S]: S[K] extends Slot<unknown> ? K : never }[keyof S];
type SlotData<X> = X extends Slot<infer T> ? T : never;

export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError({
    status: 0,
    code: 'client_error',
    message: error instanceof Error ? error.message : 'Unexpected error',
    requestId: null,
    operation: 'client',
  });
}

/**
 * A slot after a failed read: it keeps its data, so a failed refresh leaves the last data on screen
 * (`ready`, with the error), and only a slot that never had data becomes `error`.
 */
export function failSlot<T>(previous: Slot<T>, error: unknown): Slot<T> {
  return { ...previous, status: previous.data === null ? 'error' : 'ready', error: asApiError(error) };
}

/**
 * Runs `fn` and stores its result in the slot `key` of a Zustand store. A quiet load (a poll)
 * keeps the previous data on screen while it runs, and a load that fails keeps it too: the slot
 * then has its data and the error (see `loadFailure`).
 */
export async function loadSlot<S, K extends SlotKeys<S>>(
  set: (partial: Partial<S>) => void,
  get: () => S,
  key: K,
  fn: () => Promise<SlotData<S[K]>>,
  options: { quiet?: boolean } = {},
): Promise<void> {
  const previous = get()[key] as Slot<SlotData<S[K]>>;
  if (!options.quiet || previous.data === null) {
    set({ [key]: { ...previous, status: 'loading', error: null } } as Partial<S>);
  }
  try {
    const data = await fn();
    set({ [key]: { data, status: 'ready', error: null, at: Date.now() } } as Partial<S>);
  } catch (error) {
    set({ [key]: failSlot(get()[key] as Slot<SlotData<S[K]>>, error) } as Partial<S>);
  }
}

/**
 * A read as a screen sees it: a slot (`data`), a collection store's state (`loadedAt`), or a
 * screen's own `{ error, data }`.
 */
export type Loadable = { error: unknown } & ({ data: unknown } | { loadedAt: number | null });

/** Whether a read has succeeded at least once, so it has data to show (an empty list included). */
export function hasLoaded(read: Loadable): boolean {
  return 'data' in read ? read.data !== null && read.data !== undefined : read.loadedAt !== null;
}

export interface LoadFailure {
  /** The read never succeeded and its last try failed: the error takes the content's place. */
  failed: unknown;
  /** It succeeded before and a later refresh failed: the last data stays, under a small notice. */
  stale: unknown;
}

/**
 * How a read's failure shows, so an error and the content it replaces never appear together: a
 * first load that fails is `failed` (only the error state), a refresh that fails after data came
 * is `stale` (the data and a notice), and anything else is neither. A refresh that succeeds clears
 * the error, so the notice goes with it.
 */
export function loadFailure(read: Loadable | null | undefined): LoadFailure {
  if (!read?.error) return { failed: null, stale: null };
  return hasLoaded(read) ? { failed: null, stale: read.error } : { failed: read.error, stale: null };
}
