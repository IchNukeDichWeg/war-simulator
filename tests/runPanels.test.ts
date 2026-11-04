import { describe, expect, it } from 'vitest';
import { clampRuns } from '../src/ui/panels/MonteCarloView';

describe('run panel text', () => {
  // Review finding: the custom run count clamped every keystroke, so typing 150 gave 250.
  it('the custom run count is clamped only when committed', () => {
    // the field holds "1", "15", "150" as typed; only the committed text is clamped
    expect(clampRuns('150', 100)).toBe(150);
    expect(clampRuns('1', 100)).toBe(2);
    expect(clampRuns('99999', 100)).toBe(5000);
    expect(clampRuns('12.9', 100)).toBe(12);
    expect(clampRuns('', 100)).toBe(100);
  });
});
