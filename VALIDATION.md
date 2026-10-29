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

### Run 2: sourced case fields (engine `e1c4896`, cases `61f5bb9`), 20 seeds

Gate still passes on the numbers: winner 19/24, loss ratio 15/24, duration 22/24. The case fields
the fix round introduced (`prepared`, `riverCrossing`, `objective.kind`, Stalingrad's objective) were
filled by a researcher from the historical record without running the model. The result is worse
than Run 1 and the data is kept: changing sourced case data to recover passes would be fitting.

| case | hist winner wins | winner | loss ratio vs hist | ratio | losses model vs hist (side 0 / side 1) | days model / hist | duration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| adrianople-378 | 40% | **fail** | x0.11 | **fail** | 2,481 / 4,147 vs 13,000 / 2,500 | 1.3 / 0.25 | pass |
| agincourt-1415 | 95% | pass | x0.36 | pass | 2,775 / 607 vs 8,000 / 600 | 0.7 / 0.13 | pass |
| austerlitz-1805 | 100% | pass | x1.40 | pass | 22,261 / 4,498 vs 31,500 / 8,800 | 0.8 / 0.35 | pass |
| blenheim-1704 | 30% | **fail** | x4.00 | **fail** | 17,228 / 10,154 vs 12,984 / 30,000 | 1.2 / 0.35 | pass |
| breitenfeld-1631 | 100% | pass | x1.22 | pass | 5,325 / 10,850 vs 5,550 / 13,600 | 1 / 0.37 | pass |
| cannae--216 | 100% | pass | x1.18 | pass | 16,763 / 2,108 vs 55,000 / 8,000 | 0.7 / 0.4 | pass |
| carrhae--53 | 0% | **fail** | x22.79 | **fail** | 1,529 / 4,066 vs 500 / 30,000 | 0.8 / 1 | pass |
| el-alamein-1942 | 100% | pass | x1.13 | pass | 8,031 / 26,213 vs 13,560 / 50,000 | 4.9 / 13 | pass |
| falklands-1982 | 100% | pass | x3.86 | **fail** | 345 / 1,395 vs 800 / 12,600 | 12 / 25 | pass |
| france-1940 | 100% | pass | x6.01 | **fail** | 273,041 / 626,969 vs 156,547 / 2,084,000 | 47 / 43 | pass |
| gaugamela--331 | 100% | pass | x1.69 | pass | 2,653 / 18,643 vs 3,000 / 35,000 | 0.7 / 0.4 | pass |
| gettysburg-1863 | 100% | pass | x2.11 | pass | 15,341 / 7,377 vs 23,231 / 23,049 | 2.4 / 2.4 | pass |
| gulf-war-1991 | 100% | pass | x5.75 | **fail** | 110 / 3,060 vs 700 / 110,000 | 5 / 4.17 | pass |
| hastings-1066 | 100% | pass | x0.50 | pass | 644 / 2,164 vs 3,000 / 5,000 | 1 / 0.35 | pass |
| iraq-2003 | 100% | pass | x1.30 | pass | 3,057 / 107,063 vs 760 / 35,000 | 26 / 21 | pass |
| kursk-1943 | 100% | pass | x3.85 | **fail** | 213,372 / 186,837 vs 54,182 / 177,847 | 9.7 / 12 | pass |
| marathon--490 | 0% | **fail** | x18.03 | **fail** | 1,743 / 945 vs 500 / 5,000 | 0.6 / 0.15 | pass |
| mohi-1241 | 100% | pass | x0.54 | pass | 989 / 13,634 vs 2,000 / 15,000 | 0.7 / 0.35 | pass |
| six-day-war-1967 | 95% | pass | x3.50 | **fail** | 2,136 / 10,198 vs 1,300 / 22,000 | 6 / 4 | pass |
| stalingrad-1942 | 100% | pass | x1.25 | pass | 17,130 / 16,953 vs 485,777 / 600,000 | 1 / 75 | **fail** |
| tannenberg-1914 | 100% | pass | x2.15 | pass | 13,069 / 48,514 vs 15,000 / 120,000 | 1.7 / 5 | pass |
| waterloo-1815 | 100% | pass | x2.98 | pass | 24,713 / 7,825 vs 26,000 / 24,000 | 0.9 / 0.4 | pass |
| yom-kippur-sinai-1973 | 0% | **fail** | x2.42 | pass | 8 / 1 vs 38,000 / 7,500 | 3 / 18 | **fail** |
| zama--202 | 100% | pass | x2.05 | pass | 2,334 / 9,887 vs 4,000 / 35,000 | 0.9 / 0.35 | pass |
| **total** | | **19/24** | | **15/24** | | | **22/24** |

What moved against Run 1:
- **Blenheim** flips (100% -> 30%): the Nebel is now a contested crossing. The researcher marked
  this a judgement call: the Allies bridged it under fire, but Tallard chose not to defend the bank.
- **Yom Kippur** flips (70% -> 0%) and fails duration: the Egyptian canal assault is a river
  crossing and Israel's Sinai defence is no longer marked prepared (the Bar Lev line was thinly
  held). The case had passed narrowly before (see Run 1 cautions).
- **Stalingrad** now ends on day 1. The new Soviet objective (the 6th Army pocket) lies in the same
  0.25 degree cell (about 28 km) as the 62nd Army's start position in the city, so the capture is
  met at once. This is a grid-resolution limit of a city fight, recorded here as a wrong-reason
  pass of the winner criterion; it needs an annihilation objective (destroy the encircled force),
  which the engine does not have.
- Adrianople moves from 0% to 40% and Agincourt from 65% to 95% (prepared defenders).

### QA round 2: are the Run 2 passes right for the right reasons?

**Gate NOT CONFIRMED.** Independent QA (it wrote none of the fixes) traced every winner pass and
classified it. RIGHT = the factor history records decides the run and it ends the way the battle or
war ended; PARTLY = right winner and kind of ending, but a recorded key mechanism is missing; WRONG =
an artefact decides.

| Verdict | Count | Cases |
| --- | --- | --- |
| RIGHT | 6 | Breitenfeld, El Alamein, Gettysburg, Hastings, Mohi, Waterloo |
| PARTLY | 10 | Agincourt, Austerlitz, Cannae, Gaugamela, Zama, Kursk, Tannenberg, France 1940, Iraq 2003, Falklands |
| WRONG | 3 | Stalingrad (capture objective already holds Soviet troops at start, won day 1), Six-Day (decided by the unsourced collapse-morale threshold; 0% at 0.15), Gulf War (Iraq starts at morale 0.20, exactly the threshold, and "collapses" after one contact) |

Right or partly right winners: **16/24**, below the 18 the gate needs. The Run 1 and Run 2 gate lines
above are therefore "passed on the numbers only".

Corrections to earlier statements in this file:
- Run 1 attributed Adrianople and Carrhae to missing mechanisms. In the model they are decided by the
  doctrine withdraw thresholds (steppe 0.06): a uniform threshold passes both. Both are true; the
  thresholds need a source before either reading is trusted.
- The model-rules commit bundled seven constants. Split, only one moves a winner:
  `collapse.armyCollapseMorale` 0.2, an educated guess on an engine-internal scale. A grade D guess
  must not decide a gate case.
- `armyCollapsePersonnelFraction` 0.4 was derived from France 1940 and the Gulf War, both backtest cases:
  in-sample, so those two cases cannot validate it.
- Leaving three case-construction toggles OFF because each cost a pass was selection by outcome.

Root causes from the first QA pass: B1, B5, B6, C1, C2, C3 fixed (C1: 0 cells missed against a Float64
reference); B3 and B4 partly; B2, C4, C5, C7 not fixed; C6 regressed (the explicit capture rule).
Invariants all hold over 24 cases and 12 presets (conservation residual 1.7e-13, losses by cause sum
exactly, deterministic per seed, no teleports). New preset defects: crewless platform formations win
battles (Japan vs USA: 18 wins, 849k of 1.09M battle casualties) and land battles are fought on sea
cells (allies-vs-axis 15, usa-vs-china 173).

### Run 3: engine fix round 2 (engine `18cc5b2`, data `1b234fc`), 20 seeds

On the numbers: winner 20/24, loss ratio 14/24, duration 22/24. I reproduced this myself in a clean
worktree at `1b234fc` after a rebuild. The per-fix progression below was measured by the engine
agent, one commit at a time, and I did not re-run it. Whether the passes are right for the right
reasons is QA round 3's job; until then the gate stays NOT CONFIRMED.

| # | Fix (commit) | winner / ratio / duration after |
| --- | --- | --- |
| | Run 2 data, rebuilt | 19 / 15 / 22 |
| 1 | Capture needs enemy control at start; `destroy` objective kind (`77516ca`) | 20 / 15 / 24 |
| 2 | Crewless formations cannot win or claim cells (`556207e`) | 20 / 15 / 24 |
| 3 | Naval interception only for embarked troops (`a5edea8`) | 20 / 15 / 24 |
| 4 | Collapse needs morale below min(0.15, start - one defeat shock) (`ecfeb87`) | 19 / 16 / 24 |
| 5 | Supply range, supply rule, unfortified case capitals ON (`7d92bb9`) | 19 / 15 / 23 |
| 6 | A Defend objective takes at most its value's share of the army (`d6ea628`) | 19 / 15 / 23 |
| | Rebuild for the out-of-sample collapse fraction 0.5 (`a270a09`) | 19 / 15 / 23 |
| 7 | Mass surrender at the sourced `encircledSurrenderShare` (`9149fcf`) | 19 / 14 / 23 |
| 8 | No field fortification for a side marked unprepared (`1d418be`) | 20 / 15 / 22 |
| 9 | No daily attrition inside a battle shorter than a day (`e63593d`) | 20 / 14 / 22 |
| 10 | Test: public/data battles and mechanics must match data/ (`18cc5b2`) | tooling |

Every fix is ON, including the ones that cost a pass (4, 5, 7, 9): each was decided on what history
records, not on the score.

| case | hist winner wins | loss ratio vs hist | days model / hist | fails |
| --- | --- | --- | --- | --- |
| adrianople-378 | 40% | x0.11 | 1.3 / 0.25 | winner, ratio |
| agincourt-1415 | 95% | x0.37 | 0.7 / 0.13 | |
| austerlitz-1805 | 100% | x1.42 | 0.8 / 0.35 | |
| blenheim-1704 | 90% | x1.12 | 1.2 / 0.35 | |
| breitenfeld-1631 | 100% | x0.98 | 0.9 / 0.37 | |
| cannae--216 | 100% | x1.19 | 0.7 / 0.4 | |
| carrhae--53 | 15% | x20.36 | 0.8 / 1 | winner, ratio |
| el-alamein-1942 | 100% | x1.13 | 4.9 / 13 | |
| falklands-1982 | 100% | x0.86 | 14 / 25 | |
| france-1940 | 90% | x4.63 | 42 / 43 | ratio |
| gaugamela--331 | 100% | x1.69 | 0.7 / 0.4 | |
| gettysburg-1863 | 100% | x2.11 | 2.4 / 2.4 | |
| gulf-war-1991 | 100% | x4.87 | 9 / 4.17 | ratio |
| hastings-1066 | 100% | x0.47 | 1 / 0.35 | |
| iraq-2003 | 100% | x0.24 | 25 / 21 | ratio |
| kursk-1943 | 100% | x3.96 | 10.3 / 12 | ratio |
| marathon--490 | 0% | x19.58 | 0.6 / 0.15 | winner, ratio |
| mohi-1241 | 100% | x0.52 | 0.7 / 0.35 | |
| six-day-war-1967 | 0% | x3.33 | 10 / 4 | winner, ratio |
| stalingrad-1942 | 100% | x0.09 | 6 / 75 | ratio, duration |
| tannenberg-1914 | 100% | x1.84 | 1.5 / 5 | duration |
| waterloo-1815 | 100% | x3.08 | 0.9 / 0.4 | ratio |
| yom-kippur-sinai-1973 | 100% | x0.44 | 9 / 18 | |
| zama--202 | 100% | x1.98 | 0.9 / 0.35 | |

What moved against Run 2:
- **Six-Day** now fails (95% -> 0%). Its Run 2 pass was the WRONG-reason collapse at a guessed
  threshold. Collapse-morale sweep at fix 4: 0.10 and 0.15 give 19/16/24, 0.20 and 0.25 give
  20/15/24. Six-Day passes only from 0.20, so it is reported as unresolved, not as a pass.
- **Stalingrad** no longer wins on day 1 (fix 1 ran it to day 36), but since fix 5 the Axis collapses
  by morale on day 6 with 439k losses against 600k historical over 75 days. The winner pass is
  still suspect.
- **Blenheim** passes again (30% -> 90%, ratio x4.00 -> x1.12) once the unprepared Franco-Bavarian
  line gets no field fortification.
- **Falklands** ratio now passes: Argentine losses 1.4k -> 8.1k with mass surrender.
- **Iraq 2003** ratio fails (x0.24): mass surrender at the sourced share hands over 209k against
  35k historical casualties. Kept, because the share is sourced.
- **Tannenberg** duration (1.5 vs 5 days) and **Waterloo** ratio (x3.08) now fail, the costs of
  fixes 8 and 9.

Still open: the Iraqi army attacks in 2003 because its leftover formations follow the aggression >=
0.5 rule (doctrine aggression is exactly 0.5); the Yom Kippur Egyptian objective (Mitla Pass) may
start in Egyptian control; doctrine withdraw thresholds still decide Adrianople, Carrhae and Marathon
(B2), and the engine does not yet read the CDB90 era breakpoints committed in `39490b0`.
