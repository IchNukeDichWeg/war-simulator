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

### Run 1: engine fix round 1 (engine `e1c4896`), 20 seeds

GATE PASSED on the numbers: winner 21/24 (needs 18), loss ratio 15/24 (needs 12), duration 23/24.
Reproduced independently in a clean checkout of `e1c4896` with freshly built data. An independent
QA re-check of whether the passes are for the right reasons is pending; until it reports, the gate
is passed on the numbers only.

| case | hist winner wins | winner | loss ratio vs hist | ratio | losses model vs hist (side 0 / side 1) | days model / hist | duration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| adrianople-378 | 0% | **fail** | x0.09 | **fail** | 1,962 / 4,196 vs 13,000 / 2,500 | 1.1 / 0.25 | pass |
| agincourt-1415 | 65% | pass | x0.27 | **fail** | 2,743 / 770 vs 8,000 / 600 | 0.7 / 0.13 | pass |
| austerlitz-1805 | 100% | pass | x1.12 | pass | 22,157 / 5,465 vs 31,500 / 8,800 | 0.9 / 0.35 | pass |
| blenheim-1704 | 100% | pass | x0.94 | pass | 7,730 / 18,969 vs 12,984 / 30,000 | 1.1 / 0.35 | pass |
| breitenfeld-1631 | 100% | pass | x1.22 | pass | 5,325 / 10,850 vs 5,550 / 13,600 | 1 / 0.37 | pass |
| cannae--216 | 100% | pass | x1.18 | pass | 16,763 / 2,108 vs 55,000 / 8,000 | 0.7 / 0.4 | pass |
| carrhae--53 | 0% | **fail** | x22.79 | **fail** | 1,529 / 4,066 vs 500 / 30,000 | 0.8 / 1 | pass |
| el-alamein-1942 | 100% | pass | x1.13 | pass | 8,031 / 26,213 vs 13,560 / 50,000 | 4.9 / 13 | pass |
| falklands-1982 | 100% | pass | x3.86 | **fail** | 345 / 1,395 vs 800 / 12,600 | 12 / 25 | pass |
| france-1940 | 100% | pass | x6.01 | **fail** | 273,041 / 626,969 vs 156,547 / 2,084,000 | 47 / 43 | pass |
| gaugamela--331 | 100% | pass | x1.69 | pass | 2,653 / 18,643 vs 3,000 / 35,000 | 0.7 / 0.4 | pass |
| gettysburg-1863 | 100% | pass | x1.94 | pass | 15,622 / 7,982 vs 23,231 / 23,049 | 2.4 / 2.4 | pass |
| gulf-war-1991 | 100% | pass | x5.75 | **fail** | 110 / 3,060 vs 700 / 110,000 | 5 / 4.17 | pass |
| hastings-1066 | 100% | pass | x0.50 | pass | 644 / 2,164 vs 3,000 / 5,000 | 1 / 0.35 | pass |
| iraq-2003 | 100% | pass | x1.30 | pass | 3,057 / 107,063 vs 760 / 35,000 | 26 / 21 | pass |
| kursk-1943 | 100% | pass | x3.85 | **fail** | 213,372 / 186,837 vs 54,182 / 177,847 | 9.7 / 12 | pass |
| marathon--490 | 0% | **fail** | x18.03 | **fail** | 1,743 / 945 vs 500 / 5,000 | 0.6 / 0.15 | pass |
| mohi-1241 | 100% | pass | x0.42 | pass | 769 / 13,688 vs 2,000 / 15,000 | 0.6 / 0.35 | pass |
| six-day-war-1967 | 95% | pass | x3.50 | **fail** | 2,136 / 10,198 vs 1,300 / 22,000 | 6 / 4 | pass |
| stalingrad-1942 | 100% | pass | x1.78 | pass | 107,732 / 75,643 vs 485,777 / 600,000 | 4 / 75 | **fail** |
| tannenberg-1914 | 100% | pass | x2.15 | pass | 13,069 / 48,514 vs 15,000 / 120,000 | 1.7 / 5 | pass |
| waterloo-1815 | 100% | pass | x2.78 | pass | 24,464 / 8,217 vs 26,000 / 24,000 | 0.9 / 0.4 | pass |
| yom-kippur-sinai-1973 | 70% | pass | x1.05 | pass | 13,109 / 972 vs 38,000 / 7,500 | 9 / 18 | pass |
| zama--202 | 100% | pass | x2.05 | pass | 2,334 / 9,887 vs 4,000 / 35,000 | 0.9 / 0.35 | pass |
| **total** | | **21/24** | | **15/24** | | | **23/24** |

Progression, each fix measured alone on top of the previous ones (one commit each):

| Step | Commit | Winner / ratio / duration |
| --- | --- | --- |
| Run 0 baseline | `2574ec6` | 14 / 9 / 21 |
| 1 Dijkstra keys rounded to float32 like the distances | `503cf86` | 12 / 10 / 21 |
| 2 Withdrawing losers pursued; morale on the loss basis | `6d00ddf` | 12 / 13 / 21 |
| 3 Defensive factors are alternatives; assault factor only at real forts; `prepared` field | `2920329` | 14 / 16 / 22 |
| 4 Beaten formations leave the cell or surrender; reserve never overshoots | `2c58ffc` | 18 / 14 / 22 |
| 5 Battle mode: range class, river from the case, tie-break by severity, sub-day arrivals | `5cf42fb` | 20 / 15 / 22 |
| 6 Case construction (explicit objective kind ON; three toggles OFF, see below) | `a212c61` | 20 / 15 / 22 |
| 7 Hospital admissions return to duty; casualties = sum by cause | `c8c4b28` | 20 / 15 / 22 |
| 8 Sea movement inside a theater | `8088ebc` | 20 / 15 / 22 |
| 9 AI compares cross-era power; the stronger side advances | `8acdb82` | 20 / 15 / 22 |
| 10 Explanation reports personnel and local power separately | `bcca072` | 20 / 15 / 22 |
| 11 Control overlay checkerboard (oscillating cut-off cells) | `c4e8492` | 20 / 15 / 22 |
| Model rules: type and era accessor | `725c9de` | 20 / 15 / 22 |
| Model rules: foot-pursuit floor, disengage share | `407a73f` | 20 / 15 / 22 |
| Model rules: disease deaths per admission, return-to-duty days | `9be83cf` | 20 / 15 / 22 |
| Model rules: encircled surrender share | `99c61a4` | 20 / 15 / 22 |
| Model rules: sea lift by tonnage | `185d9c6` | 20 / 15 / 22 |
| Model rules: noise 0.25, river delay, collapse at 40%, fog, C2, blockade | `e1c4896` | 21 / 15 / 23 |

Fix 1 cost two winners on its own: the Float32 bug had been handing some campaigns to the historical
winner by marking the loser's routes unreachable. It is a correctness fix and stays.

**Measured negative and left OFF:** fix 6's three toggles (`CASE_SUPPLY_RANGE_FROM_SNAPSHOT`,
`CASE_SUPPLY_RULE_ON`, `CASE_CAPITAL_UNFORTIFIED` in `src/engine/constants.ts`) each cost one
loss-ratio pass. They are kept visible rather than tuned.

**Sourced constants that made a case worse** (kept, because they are sourced): Marathon loss ratio
x9 -> x18; Yom Kippur winner 85% -> 70%.

**Still failing, and why the model disagrees:**
- Winner: Adrianople, Carrhae, Marathon. All three turn on mechanisms the engine does not have:
  cavalry arriving on a flank mid-battle (Adrianople), horse archers keeping standoff range with
  resupply (Carrhae), and a hoplite charge closing through an archery zone (Marathon). No general
  constant fixes them; adding the mechanisms is Phase 4 work.
- Loss ratio: Agincourt, Falklands, Six-Day, Kursk (x3.5-x3.9, just outside), France 1940 and Gulf
  War (x6, x5.8: no mass surrender of bypassed forces), plus the three above.
- Duration: Stalingrad. The case objective (the Kalach link-up, 4 days historically too) does not
  match its 75-day loss window; a case-data issue, not an engine one.

**Passes that need caution:** Iraq 2003 wins with Iraqi losses about 3x the historical figure;
Yom Kippur at 70% sits near the threshold.

