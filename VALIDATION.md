# Validation

How well the engine reproduces real wars, measured, not claimed. Backtests run with
`npx tsx scripts/backtest.ts --seeds 20`; the engine starts from the researched forces,
tech and terrain of each case in `data/battles/` and is compared with the historical outcome.

## Tolerance (fixed before any tuning, 2026-10-29)

Per case, over 20 seeds:

| Criterion | Pass if |
| --- | --- |
| Winner | the historical winner wins in at least 60% of seeds (a historical draw: no side wins more than 60%) |
| Loss ratio | median model ratio (side 0 losses / side 1 losses) within a factor of 3 of the historical mid ratio |
| Duration | median model duration within a factor of 3 of the historical mid duration (battles shorter than 1 day count as 1 day on both sides, because the engine's time step is a day) |

Phase 1 gate: winner criterion met in at least 18 of 24 cases (75%), loss ratio within
tolerance in at least half. Every case that fails is investigated and either fixed in the engine
(with the change and its reason in the engine commit and in ENGINE.md) or documented here with
the reason the model disagrees. Parameters are not tuned to hit individual cases: any change must
be a general mechanism or a sourced constant, and the before/after table of ALL cases is recorded.

## Results

Pending: baseline run below, then each engine change with its full table.
