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

Each engine change gets its full table here, oldest first. Machine for all runs: the
project Mac (darwin, arm64), `npx tsx`. A full 20-seed run takes about 2 s.

### Run 0: baseline (engine `2574ec6`, data `2a99734`), 20 seeds

GATE FAILED: winner 14/24 (needs 18), loss ratio 9/24 (needs 12), duration 21/24.

| case | hist winner wins | winner | loss ratio vs hist | ratio | days model / hist | duration |
| --- | --- | --- | --- | --- | --- | --- |
| adrianople-378 | 0% | **fail** | x0.25 | **fail** | 1.2 / 0.25 | pass |
| agincourt-1415 | 50% | **fail** | x0.17 | **fail** | 3 / 0.13 | pass |
| austerlitz-1805 | 100% | pass | x1.42 | pass | 0.8 / 0.35 | pass |
| blenheim-1704 | 0% | **fail** | x4.83 | **fail** | 1.1 / 0.35 | pass |
| breitenfeld-1631 | 95% | pass | x1.57 | pass | 1.1 / 0.37 | pass |
| cannae--216 | 100% | pass | x0.56 | pass | 0.6 / 0.4 | pass |
| carrhae--53 | 0% | **fail** | x11.67 | **fail** | 0.8 / 1 | pass |
| el-alamein-1942 | 0% | **fail** | x8.43 | **fail** | 2.6 / 13 | **fail** |
| falklands-1982 | 0% | **fail** | x15.75 | **fail** | 50 / 25 | pass |
| france-1940 | 65% | pass | x6.14 | **fail** | 76 / 43 | pass |
| gaugamela--331 | 100% | pass | x5.64 | **fail** | 0.8 / 0.4 | pass |
| gettysburg-1863 | 100% | pass | x5.79 | **fail** | 1 / 2.4 | pass |
| gulf-war-1991 | 0% | **fail** | x3.16 | **fail** | 10 / 4.17 | pass |
| hastings-1066 | 75% | pass | x1.69 | pass | 1.1 / 0.35 | pass |
| iraq-2003 | 0% | **fail** | x2.03 | pass | 54 / 21 | pass |
| kursk-1943 | 100% | pass | x18.69 | **fail** | 2.6 / 12 | **fail** |
| marathon--490 | 0% | **fail** | x12.94 | **fail** | 0.6 / 0.15 | pass |
| mohi-1241 | 100% | pass | x3.38 | **fail** | 0.7 / 0.35 | pass |
| six-day-war-1967 | 70% | pass | x2.33 | pass | 10 / 4 | pass |
| stalingrad-1942 | 100% | pass | x1.27 | pass | 4 / 75 | **fail** |
| tannenberg-1914 | 100% | pass | x2.72 | pass | 1.9 / 5 | pass |
| waterloo-1815 | 100% | pass | x3.67 | **fail** | 0.8 / 0.4 | pass |
| yom-kippur-sinai-1973 | 10% | **fail** | x2.44 | pass | 38 / 18 | pass |
| zama--202 | 100% | pass | x6.65 | **fail** | 1 / 0.35 | pass |
| **total** | | **14/24** | | **9/24** | | **21/24** |

Ratio factor = model loss ratio / historical loss ratio (side 0 losses over side 1 losses).
Days: battles under 1 day count as 1 day on both sides.

**Diagnosis** (independent QA pass, instrumented copy of the engine that reproduces this table
exactly; full traces and the ablation matrix stay with the QA notes, not in the repo):

| Cause | Kind | Cases it explains |
| --- | --- | --- |
| Pursuit only hits routed units, and the withdraw threshold always sits below the rout breakpoint, so pre-gunpowder losers withdraw intact (0 routs in 77-209 losing formations per case); gunpowder and modern sides rout only because morale is decremented additively while losses compound | bug | Cannae, Zama, Gaugamela, Mohi, Hastings, Marathon, Agincourt, Adrianople, Carrhae, Kursk |
| Who breaks first is set by the doctrine retreat threshold more than by combat power (a closed form reproduces the engine winner in 16/16 decided battles) | design | Zama, Adrianople, Gaugamela, Carrhae |
| Alternative defensive factors multiplied: prepared 1.5 x field fortification 1.3 = 1.95 (above QJM's fortified 1.6), and the Badajoz breach-storming factor x3 applied to field positions | constant misuse | El Alamein, Kursk, Blenheim, Waterloo, Gettysburg, Falklands |
| Dijkstra pushes Float64 keys but stores Float32 distances: 15-23% of reachable cells come out unreachable, up to 64% overpriced, false supply cut-offs | bug | every campaign; Falklands 0/0 |
| Beaten defenders never leave their supply-source cell, so the objective cannot be entered | bug | Iraq 2003, Gulf War |
| Reserve allocation overshoots by a whole formation (can reserve a side's only attacker) | bug | Falklands, Six-Day |
| Battle mode: opening-round range rule decided by interpolation noise; the 25 km grid river flag cuts every Blenheim attack to x0.6; same-round withdrawal by both sides scores a draw | bug | Agincourt, Blenheim, Waterloo, Gettysburg |
| Case construction: synthesized sides have no supply range (AI distance scale 1 km), synthesized capitals are fortified, objectives come from the Voronoi start split, Stalingrad's objective does not match its 75-day window | case | El Alamein, France, Yom Kippur, Six-Day, Stalingrad |
| Missing: horse-archer standoff, role matchups, flank arrival and sub-day timing, frontage, mass surrender | missing | Carrhae, Marathon, Adrianople, Waterloo, Kursk, Gulf, France, Stalingrad |

Diagnostic switches for the first seven rows together reach 20/14/23. These switches isolate
mechanisms; they are not proposed values and that number is not a validation result. Changing
the Lanchester exponent, per-doctrine retreat thresholds, missile vs melee TLI or a common base
rate was measured as curve-fitting (no gain or -1 winner) and is not done.
