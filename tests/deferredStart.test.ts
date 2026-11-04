import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppData } from '../src/ui/data';
import { engineAssetsReady } from '../src/ui/lazy';
import { store } from '../src/ui/store';

// Review finding: a run clicked before the engine assets were in started, once they arrived, the
// scenario captured at the click even when the user had loaded another one meanwhile.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('deferred run start', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('drops the request when the scenario changed while assets loaded', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    store.set({ data: { snapshots: [], missing: [], assetsLoaded: false } as unknown as AppData });
    const s = store.get().scenario;
    const retry = vi.fn();
    const cancel = vi.fn();
    expect(engineAssetsReady('run', s, retry, () => true, cancel)).toBe(false);
    store.set({ scenario: { ...s } });
    await flush(); await flush();
    expect(retry).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);

    // Same scenario: assets are in by now, so it reports ready and the caller proceeds.
    expect(engineAssetsReady('run', store.get().scenario, retry, () => true, cancel)).toBe(true);
  });
});
