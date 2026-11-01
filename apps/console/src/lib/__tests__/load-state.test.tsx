import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { create } from 'zustand';

import { LoadError } from '@/components/ui/states';
import { ApiError } from '@/lib/api/client';
import { createCollectionStore } from '@/lib/collection-store';
import { emptySlot, failSlot, hasLoaded, loadFailure, loadSlot, type Slot } from '@/lib/slot';

const boom = new ApiError({
  status: 503,
  code: 'unavailable',
  message: 'The gateway is restarting',
  requestId: null,
  operation: 'GET /providers',
});

describe('loadFailure', () => {
  it('tells a first load that failed from a refresh that failed', () => {
    expect(loadFailure({ data: null, error: boom })).toEqual({ failed: boom, stale: null });
    expect(loadFailure({ data: [], error: boom })).toEqual({ failed: null, stale: boom });
    expect(loadFailure({ data: [], error: null })).toEqual({ failed: null, stale: null });
    expect(loadFailure({ loadedAt: null, error: boom })).toEqual({ failed: boom, stale: null });
    expect(loadFailure({ loadedAt: 1, error: boom })).toEqual({ failed: null, stale: boom });
    expect(loadFailure(undefined)).toEqual({ failed: null, stale: null });
  });

  it('counts an empty list as loaded', () => {
    expect(hasLoaded({ data: [], error: null })).toBe(true);
    expect(hasLoaded({ data: null, error: null })).toBe(false);
  });
});

describe('failed reads in the stores', () => {
  it('keeps a slot’s data and stays ready when a refresh fails', async () => {
    const useStore = create<{ list: Slot<string[]> }>()(() => ({ list: emptySlot() }));
    const { setState, getState } = useStore;
    await loadSlot(setState, getState, 'list', () => Promise.reject(boom));
    expect(getState().list).toMatchObject({ data: null, status: 'error', error: boom });

    await loadSlot(setState, getState, 'list', () => Promise.resolve(['a']));
    await loadSlot(setState, getState, 'list', () => Promise.reject(boom), { quiet: true });
    expect(getState().list).toMatchObject({ data: ['a'], status: 'ready', error: boom });

    await loadSlot(setState, getState, 'list', () => Promise.resolve(['a', 'b']), { quiet: true });
    expect(getState().list).toMatchObject({ data: ['a', 'b'], status: 'ready', error: null });
  });

  it('failSlot keeps data', () => {
    const slot: Slot<number[]> = { data: [1], status: 'ready', error: null, at: 1 };
    expect(failSlot(slot, boom)).toEqual({ data: [1], status: 'ready', error: boom, at: 1 });
    expect(failSlot(emptySlot<number[]>(), boom).status).toBe('error');
  });

  it('keeps a collection’s items when a refresh fails', async () => {
    let fail = false;
    const item = { name: 'a', metadata: { etag: '"1"' } };
    const useItems = createCollectionStore({
      list: () => (fail ? Promise.reject(boom) : Promise.resolve([item])),
      create: () => Promise.resolve(item),
      update: () => Promise.resolve(item),
      remove: () => Promise.resolve(),
    });
    await useItems.getState().fetch();
    fail = true;
    await useItems.getState().fetch({ quiet: true });
    expect(useItems.getState()).toMatchObject({ items: [item], status: 'ready', error: boom });
  });
});

describe('LoadError', () => {
  it('shows the error state when nothing loaded', () => {
    render(<LoadError of={{ data: null, error: boom }} subject="Providers" onRetry={() => undefined} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load providers'.replace('’', "'"));
    expect(screen.queryByText(/Couldn.t refresh/)).not.toBeInTheDocument();
  });

  it('shows one quiet notice over data that stays', () => {
    render(<LoadError of={{ data: [], error: boom }} subject="Providers" onRetry={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't refresh providers");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows nothing without an error', () => {
    const { container } = render(<LoadError of={{ data: [], error: null }} subject="Providers" />);
    expect(container).toBeEmptyDOMElement();
  });
});
