import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '../src/types/scenario';
import { normalizeScenario } from '../src/ui/scenarioDefaults';

// Pre-release review findings on what a share link or file may carry. Each case loads a real
// preset with one field changed, the way a hand-edited link would.
const presets = JSON.parse(readFileSync('public/data/presets.json', 'utf8')) as Scenario[];
const preset = (id: string) => structuredClone(presets.find((p) => p.id === id)!) as any;

describe('theater box on load', () => {
  it('refuses a box beyond the poles or upside down', () => {
    // [-500,-100,500,100] loaded, then MapController.fit threw "Invalid LngLat latitude"
    for (const bbox of [[-500, -100, 500, 100], [0, -95, 10, 10], [0, 10, 10, 91], [0, 10, 10, 10], [0, 20, 10, 10]]) {
      const s = preset('germany-vs-france-1940');
      s.theater.bbox = bbox;
      expect(() => normalizeScenario(s), bbox.join()).toThrow(/^theater\.bbox /);
    }
  });

  it('keeps a box that runs past 180 degrees east', () => {
    // the Pacific preset crosses the antimeridian on purpose (east = 210)
    const s = preset('japan-vs-usa-1941');
    expect(normalizeScenario(s).theater.bbox).toEqual([100, -15, 210, 55]);
    s.theater.bbox = [0, -90, 10, 90];
    expect(normalizeScenario(s).theater.bbox).toEqual([0, -90, 10, 90]);
  });
});
