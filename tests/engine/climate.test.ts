import { describe, expect, it } from 'vitest';
import { CLIMATE_H, CLIMATE_W, CLIMATE_ZONES, climateCell, theaterZone, zoneOfSymbol } from '../../src/engine/climate';
import { battleCaseScenario } from '../../src/engine/battleCase';
import { createSim } from '../../src/engine/sim';
import { loadBattles, loadEngineData } from '../../scripts/lib/loadData';

describe('climate zones', () => {
  it('collapses the 30 Koppen-Geiger symbols to six zones, B split into BW and BS', () => {
    const syms = ['Af', 'Am', 'Aw', 'BWh', 'BWk', 'BSh', 'BSk', 'Csa', 'Csb', 'Csc', 'Cwa', 'Cwb', 'Cwc', 'Cfa', 'Cfb', 'Cfc',
      'Dsa', 'Dsb', 'Dsc', 'Dsd', 'Dwa', 'Dwb', 'Dwc', 'Dwd', 'Dfa', 'Dfb', 'Dfc', 'Dfd', 'ET', 'EF'];
    const got = syms.map(zoneOfSymbol);
    expect(got.every((z) => z !== null)).toBe(true);
    expect(syms.filter((_, i) => got[i] === 'BW')).toEqual(['BWh', 'BWk']);
    expect(syms.filter((_, i) => got[i] === 'BS')).toEqual(['BSh', 'BSk']);
    expect(zoneOfSymbol('Ocean')).toBeNull();
  });

  it('indexes 0.5 deg cells from 90 N and 180 W', () => {
    expect(climateCell(89.9, -179.9)).toBe(0);
    expect(climateCell(-89.9, 179.9)).toBe(CLIMATE_W * CLIMATE_H - 1);
    expect(climateCell(0.1, 0.1)).toBe(179 * CLIMATE_W + 360);
  });

  it('takes the majority over land cells only, null when none is classified', () => {
    const zones = new Uint8Array(CLIMATE_W * CLIMATE_H);
    const BW = CLIMATE_ZONES.indexOf('BW') + 1, C = CLIMATE_ZONES.indexOf('C') + 1;
    const lat = [30.2, 30.2, 30.2, 30.7], lon = [40.2, 40.7, 41.2, 40.2];
    lat.forEach((la, i) => (zones[climateCell(la, lon[i])] = i < 2 ? BW : C));
    expect(theaterZone(zones, { n: 4, lat, lon, land: [1, 1, 1, 0] }).zone).toBe('BW'); // BW 2, C 1
    expect(theaterZone(zones, { n: 4, lat, lon, land: [1, 0, 1, 1] }).zone).toBe('C');  // BW 1, C 2
    expect(theaterZone(zones, { n: 2, lat, lon, land: [1, 0] }).share).toBe(1);
    expect(theaterZone(new Uint8Array(CLIMATE_W * CLIMATE_H), { n: 4, lat, lon, land: [1, 1, 1, 1] }).zone).toBeNull();
  });
});

// Oracle on the built Beck et al. 2018 grid (public/data/climate/zones.bin): the majority zone over
// each theater's land cells. Stalingrad is BS (248 cells) over D (140) on the 0.5 deg map.
describe('theater climate zones on the built grid', () => {
  const dir = new URL('../../public/data', import.meta.url).pathname;
  const data = loadEngineData(dir);
  const battles = loadBattles(dir);
  const zoneOf = (id: string) => {
    const bc = battles.find((b) => b.id === id)!;
    const x = battleCaseScenario(data, bc, 1);
    return createSim(x.data, x.scenario, x.opts).setup.climateZone;
  };
  it('has the grid', () => expect(data.climate?.byteLength).toBe(CLIMATE_W * CLIMATE_H));
  it('Gulf War 1991 is desert (BW)', () => expect(zoneOf('gulf-war-1991')).toBe('BW'));
  it('France 1940 is temperate (C)', () => expect(zoneOf('france-1940')).toBe('C'));
  it('Stalingrad is steppe (BS), as the map says', () => expect(zoneOf('stalingrad-1942')).toBe('BS'));
});
