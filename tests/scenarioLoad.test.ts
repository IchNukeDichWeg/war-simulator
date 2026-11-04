import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '../src/types/scenario';
import { normalizeScenario, SIDE_COLORS } from '../src/ui/scenarioDefaults';

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

describe('side colours on load', () => {
  it('only a #rrggbb colour is kept; anything else takes the default', () => {
    // the colour lands in CSS `background`, so a url() made every viewer fetch from that host
    const s = preset('germany-vs-france-1940');
    s.sides[0].color = 'url(//evil.example/a.gif)';
    s.sides[1].color = '#ABCdef';
    let n = normalizeScenario(s);
    expect(n.sides.map((x) => x.color)).toEqual([SIDE_COLORS[0], '#ABCdef']);
    for (const c of ['red', '#abc', '#abcdefa', 'rgb(1,2,3)', '#12345g', ' #123456']) {
      s.sides[1].color = c;
      n = normalizeScenario(s);
      expect(n.sides[1].color, c).toBe(SIDE_COLORS[1]);
    }
  });
});

describe('overrides on load', () => {
  it('keeps only the last of several edits to one field', () => {
    // two rows for one field gave the Editor's change list duplicate React keys
    const s = preset('germany-vs-france-1940');
    s.overrides = [
      { snapshotId: 'germany-1939', path: 'tech.weapons.mid', value: 3 },
      { snapshotId: 'france-1939', path: 'tech.weapons.mid', value: 5 },
      { snapshotId: 'germany-1939', path: 'tech.weapons.mid', value: 4 },
    ];
    expect(normalizeScenario(s).overrides).toEqual([
      { snapshotId: 'france-1939', path: 'tech.weapons.mid', value: 5 },
      { snapshotId: 'germany-1939', path: 'tech.weapons.mid', value: 4 },
    ]);
  });
});
