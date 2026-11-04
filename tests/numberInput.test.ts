import { describe, expect, it } from 'vitest';
import { parseNumberText } from '../src/ui/panels/ScenarioBuilder';
import { MAX_TIME_LIMIT_DAYS } from '../src/ui/scenarioDefaults';

// Review finding: the Setup number boxes wrote every keystroke through a clamp, so clearing the
// time limit snapped it to 1 and typing 500 after that gave 1500; the seed box showed "07".
// The text is now committed on blur or Enter through parseNumberText.
describe('number box text', () => {
  it('an empty or non-number entry reverts instead of snapping to the minimum', () => {
    expect(parseNumberText('', 1, MAX_TIME_LIMIT_DAYS, true)).toBeNull();
    expect(parseNumberText('  ', 1, MAX_TIME_LIMIT_DAYS, true)).toBeNull();
    expect(parseNumberText('-', 1, MAX_TIME_LIMIT_DAYS, true)).toBeNull();
    expect(parseNumberText('abc', 1, MAX_TIME_LIMIT_DAYS, true)).toBeNull();
  });

  it('a number is clamped to the range the loader applies, and rounded for counts', () => {
    expect(parseNumberText('500', 1, MAX_TIME_LIMIT_DAYS, true)).toBe(500);
    expect(parseNumberText('07', 0, 100, true)).toBe(7);
    // the loader clamps the time limit to MAX_TIME_LIMIT_DAYS, so save and load used to change it
    expect(parseNumberText('99999', 1, MAX_TIME_LIMIT_DAYS, true)).toBe(MAX_TIME_LIMIT_DAYS);
    expect(parseNumberText('0', 1, MAX_TIME_LIMIT_DAYS, true)).toBe(1);
    expect(parseNumberText('2.6', 2, 5000, true)).toBe(3);
    expect(parseNumberText('12.25', -90, 90)).toBe(12.25);
  });
});
