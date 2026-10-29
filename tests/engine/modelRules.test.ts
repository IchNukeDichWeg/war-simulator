import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { eraOfYear, rule, ruleMV, validateMechanics } from '../../src/engine/mech';
import { fixtureMechanics, mv } from '../fixtures/mechanics.fixture';
import type { EraRule } from '../../src/types/mechanics';

describe('model rules', () => {
  const r: EraRule = { iron: mv(1), medieval: mv(2), gunpowder: mv(3), napoleonic: mv(4), industrial: mv(5), modern: mv(9) };
  it('picks napoleonic for 1789-1849 when present, else the ERA_SPANS era', () => {
    expect(rule(r, -480)).toBe(1);
    expect(rule(r, 1788)).toBe(3);
    expect(rule(r, 1789)).toBe(4);
    expect(rule(r, 1849)).toBe(4);
    expect(rule(r, 1850)).toBe(5);
    expect(rule({ industrial: mv(5) }, 1815)).toBe(5);
    expect(rule(r, 2026)).toBe(9);
  });
  it('clamps years outside the spans and reports absent eras', () => {
    expect(eraOfYear(-5000)).toBe('bronze');
    expect(eraOfYear(2100)).toBe('modern');
    expect(ruleMV(r, 1940)).toBeUndefined();
    expect(rule(r, 1940, -1)).toBe(-1);
    expect(rule(mv(0.25), 1940)).toBe(0.25);
  });
  it('the fixture and the built runtime data both validate', () => {
    expect(validateMechanics(fixtureMechanics())).toEqual([]);
    const built = JSON.parse(readFileSync(new URL('../../public/data/mechanics.json', import.meta.url), 'utf8'));
    expect(validateMechanics(built)).toEqual([]);
  });
});
