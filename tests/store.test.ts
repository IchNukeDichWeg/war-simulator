import { afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '../src/ui/store';

describe('store listeners', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('a throwing listener does not stop the ones after it', () => {
    // one failing subscriber used to leave every later one (React's included) on stale state
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const later = vi.fn();
    const offBad = store.subscribe(() => { throw new Error('boom'); });
    const offLater = store.subscribe(later);
    expect(() => store.set({ showLimits: true })).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
    offBad(); offLater();
    store.set({ showLimits: false });
  });
});
