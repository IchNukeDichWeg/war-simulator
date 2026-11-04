import { afterEach, describe, expect, it, vi } from 'vitest';

// The settings module reads localStorage when it loads, so each case stubs storage first and then
// imports a fresh copy.
function stubStorage(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  });
  return m;
}
async function fresh() {
  vi.resetModules();
  return import('../src/ui/settings');
}
afterEach(() => { vi.unstubAllGlobals(); });

const LAYERS = { hillshade: true, rivers: true, front: true, fog: false, fogSide: 0 as 0 | 1, stress: false };

describe('viewer settings', () => {
  it('falls back field by field when storage holds unknown or corrupt values', async () => {
    stubStorage({ 'mews.settings': JSON.stringify({ basemap: 'url(//evil)', unitSize: 'large', startSpeed: 7, rememberLayers: 'yes' }) });
    const s = (await fresh()).getSettings();
    expect(s).toEqual({ basemap: 'relief', unitSize: 'large', startSpeed: 3, rememberLayers: true });
    stubStorage({ 'mews.settings': '{not json' });
    expect((await fresh()).getSettings()).toEqual((await fresh()).DEFAULT_SETTINGS);
  });

  it('restores only known layer toggles, never the stress test', async () => {
    stubStorage({ 'mews.layers': JSON.stringify({ rivers: false, fog: true, fogSide: 1, stress: true, bogus: true, front: 'no' }) });
    const { readSavedLayers } = await fresh();
    expect(readSavedLayers(LAYERS)).toEqual({ ...LAYERS, rivers: false, fog: true, fogSide: 1 });
  });

  it('forgets the layers when remembering is switched off', async () => {
    const m = stubStorage({ 'mews.layers': JSON.stringify({ rivers: false }) });
    const { setSettings, readSavedLayers, saveLayers } = await fresh();
    setSettings({ rememberLayers: false });
    expect(m.has('mews.layers')).toBe(false);
    saveLayers({ rivers: false });
    expect(m.has('mews.layers')).toBe(false);
    expect(readSavedLayers(LAYERS)).toBeNull();
  });
});
