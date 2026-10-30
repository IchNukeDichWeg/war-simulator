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

### QA round 3: are the Run 3 passes right for the right reasons?

**Gate NOT CONFIRMED.** Independent QA (it wrote none of the fixes) reproduced Run 3 exactly in a
worktree pinned at `65493a9`, and traced every winner pass with the round-2 definitions. The data
and engine changes committed after `65493a9` are not covered; Run 4 gets its own QA.

| Verdict | Count | Cases |
| --- | --- | --- |
| RIGHT | 7 | Blenheim (thin), Breitenfeld, El Alamein, Gettysburg, Hastings, Mohi, Waterloo |
| PARTLY | 11 | Agincourt, Austerlitz, Cannae, Gaugamela, Zama, Kursk, Tannenberg, Falklands, France 1940, Gulf War, Iraq 2003 |
| WRONG (counted strictly) | 2 | Stalingrad (the Axis attacks a much stronger enemy and collapses on day 6; no encirclement, 6 of 75 days; the capture objective cell starts Soviet-held and never counts), Yom Kippur (the Mitla objective starts Egyptian-held, so Egypt reaching it counts for nothing; Israel wins by taking Deversoir with no decided battle) |

Right or partly right winners: **18/24**, exactly the gate, if Stalingrad counts as WRONG; 19 if it
counts as PARTLY. I count it as WRONG: the result comes from a mechanism history does not record.

The gate is still not confirmed because three of those 18 passes each hang on one grade-D constant.
In a one-at-a-time screen of all 615 grade-D constants over their own ranges (5 seeds, so a screen
and not a measurement):
- Blenheim fails at cropland attack 0.85 instead of 0.95.
- The Gulf War fails at desert movement 0.25 instead of 0.5, or at a winter season factor of 0.4
  instead of 0.7.
- France 1940 fails at urban movement 0.5 instead of 0.7.

Under the rule that no grade-D constant may decide a gate case, the robust count is 15. Six-Day passes
at `armyCollapseMorale` 0.25 or `capitalLossShock` 0.4; moving either for that would be fitting
one case, so it stays a fail.

Specific findings (measured, 20 seeds):
- **Gulf War:** a real fall now. The Coalition takes Kuwait City in 20/20 seeds (days 7 / 9 / 10,
  min / median / max). Iraqi morale only falls 0.20 -> 0.15 and never collapses. Iraqi losses are
  22.5k against 110k historical.
- **Iraq 2003:** the leftover-rule explanation in Run 3 is refuted. Aggression 0.3 or 0.49, no
  stronger-side-advance rule, or a forced leftover test all give identical results. The Iraqi
  attacks come from normal attack slots.
- **Six-Day:** an honest fail. Israel advances 73 of 193 km and wins one battle; Egyptian morale
  ends at 0.20.

Root causes: B2 not fixed (Carrhae still decided by the withdraw-threshold term); C4 better
(Germans attack in 70-75 of 92 slots in France); C5 partly (case fortified positions still sit on
objectives, Six-Day cell 9, Gulf cell 248); C6 open (surprise multiplies every fresh formation's
first battle by 1.8 for the whole campaign; limiting it to day 1 moves no gate number); C7 open (one
Berlin weather table everywhere, so the February Gulf gets 22% snow days; clear weather flips no
winner but shortens the Gulf from 10 to 8 median days and France from 42 to 37).

Invariants: all 48 case runs and 24 preset runs are clean. Land battles on sea cells: 0. Wins by a
side with no personnel: 0. Formations with no crew in battle: 0.

### Run 4: engine fix round 3 and the doctrine re-basing (engine `8d0e4bf`, data `7338fe9`), 20 seeds

On the numbers: winner 20/24, loss ratio 15/24, duration 21/24. I measured this myself in a clean
worktree at `7338fe9` after a rebuild. It matches the engine agent's 20/15/21 at `8d0e4bf`.

Engine round 3 commits (agent's measurements, clean worktrees, against the commit before each):

| Commit | Fix | Without doctrine re-basing | With it |
| --- | --- | --- | --- |
| `65493a9` | Run 3 | 20/14/22 | 21/13/20 |
| `008853e` | Battle breakpoint = CDB90 loser share at the break for the era, one quantile drawn per seed | 20/17/21 | 20/15/20 |
| `110446a` | Leftovers on a hold side defend (no-op) | 20/17/21 | 20/15/20 |
| `8e1a1e8` | A hold side takes no enemy places as objectives | 20/18/21 | 20/16/20 |
| `0c8ca1a` | Pursuit: artillery is not a pursuer | 21/15/22 | 21/14/20 |
| `69b3d1a` | Pursuit: air power in the same units as ground weight | | 20/15/20 |
| `a7049e7` | Surprise only on day 1 | | 20/15/20 |
| `52e3020` | Capital-loss shock only for a real capital, never a case base | | 20/15/20 |
| `8d0e4bf` | No attack slot the side cannot staff to its doctrine's ratio | | 20/15/21 |

Correction: the commit message of `0c8ca1a` credits it with 21/14/20. That run already included the
doctrine re-basing (`a61c9ba`), which landed in the shared tree mid-run. The corrected figures, in
`7dce88a`: without the re-basing 20/18/21 -> 21/15/22, with it 20/16/20 -> 21/14/20.

Breakpoint sweep at `008853e`, before the re-basing (every member at one quantile): low 21/15/19,
mid 20/17/20, high 21/16/23.

Attribution. To separate the doctrine data from the engine fixes, I re-ran HEAD with the doctrine
files from before `a61c9ba` (clean worktree, 20 seeds). That gives 19/16/22.

| case | Run 3 | HEAD, old doctrines | HEAD (Run 4) | moved by |
| --- | --- | --- | --- | --- |
| adrianople-378 | 40% x0.11 | 45% x0.12 | **80% x0.57** | doctrine |
| carrhae--53 | 15% x20.36 | 35% x19.65 | 50% x15.42 | both |
| el-alamein-1942 | 100% x1.13 4.9d | 100% x1.03 3.4d | **55%** x0.95 2.5d | doctrine (british-ww2 0.2 -> 0.059) |
| falklands-1982 | 100% x0.86 14d | 100% x0.41 9d | 100% **x0.18** 8d | both |
| gulf-war-1991 | x4.87 9d | x3.79 7d | x3.08 7d | engine |
| marathon--490 | 0% x19.58 | 0% x20.04 | **60% x3.88** | doctrine |
| six-day-war-1967 | 0% x3.33 | 0% x1.28 | 0% x1.28 | engine |
| stalingrad-1942 | 6 days | 32 days | 32 days | engine (pursuit fixes) |
| waterloo-1815 | x3.08 | x1.91 | x1.86 | engine |
| yom-kippur-sinai-1973 | 100% x0.44 | **0%** x2.23 38d | 0% x2.37 38d | engine (surprise day 1, staffing rule) |

Read with care:
- **El Alamein** now fails the winner criterion only because of the doctrine data. british-ww2 went
  to the World Wars low quartile (0.059) for a sourced casualty-conserving doctrine. Whether
  casualty conservation belongs in the loss at withdrawal or in the willingness to attack is a
  question for QA round 4. The value is not changed because El Alamein moved.
- **Yom Kippur** loses its WRONG-reason pass. Israel fields 1 to 3 formations and can never staff an
  attack under the staffing rule, so it never counterattacks. That matches neither 1973 nor the
  rule's intent for a small, high-quality force. QA round 4 checks whether the staffing need counts
  quality.
- **Presets.** The staffing rule turns four preset runs into stand-off draws:
  allies-vs-axis-minus-two (both seeds), usa-vs-china-2026 (seed 1), and mongols-vs-rome (120 days
  with no battle). rome-vs-france-equalized goes to Rome. Invariants are clean in all 24 preset runs.
- Stalingrad now runs 31 to 32 days with the pocket cut off from day 10. Soviet losses are still
  about 41k against 486k, so the ratio fails.

### QA round 4: are the Run 4 passes right for the right reasons?

**Gate NOT CONFIRMED.** Independent QA reproduced Run 4 (20/15/21) at `b4198fd` and traced every pass.

| Verdict | Count | Cases |
| --- | --- | --- |
| RIGHT | 7 | Adrianople, Blenheim (thin), Breitenfeld, Gettysburg, Hastings, Mohi, Waterloo |
| PARTLY | 12 | Agincourt, Austerlitz, Cannae, Gaugamela, Zama, Kursk, Tannenberg, Falklands, France 1940, Gulf War, Iraq 2003, Stalingrad |
| WRONG | 1 | Marathon: wins only because the Persians withdraw at 5% (achaemenid low quartile, cited for "the commander fell or fled", which did not happen at Marathon); Athens is weaker in power and 12/20 sits on the 60% line |

Right or partly right: 19. One grade-D constant within its own range flips Adrianople, Falklands, the
Gulf War and Iraq 2003 (confirmed at 20 seeds after a 10-seed screen of all 615), so **15 are
robust**, below the 18 the gate needs.

Findings that changed the plan (measured, 20 seeds):
- **El Alamein** (55%) moved only through the withdraw-threshold term (-0.84 for the British);
  british-ww2 at the era value gives 100%. QA's judgement, which I accept on its reasoning, not on
  the case: casualty conservation is a choice about when to attack (aggression, required ratio) and
  is already priced into the aggression weight, so putting it in the loss at withdrawal counts it
  twice. Evidence at the strategic or political level (us-joint, nato) is the wrong level for a
  battle threshold. Delay and break-contact doctrines (small-state, insurgent) fit.
- **The threshold scheme is one-sided.** The cap at 0.9 of the breakpoint makes every high-quartile
  ("refuses to withdraw") value inert, so only brittleness has any effect.
- **Yom Kippur** (0%): the staffing rule compares raw weapon weight, without quality, training or
  command, of the WHOLE side against the required ratio times a whole enemy group, so a small force
  can never attack locally. With the rule off, Israel wins 45% (coldwar-western) or 100% (idf-1967).
  Both Israeli case sides use the coldwar-western archetype although an idf-1967 profile exists.
- **New decider:** the AI mass ratios (code constants 3.0 attrition and 1.5 manoeuvre, no grade or
  source) now decide whether a side attacks at all; at 1.5 Falklands and Iraq 2003 go to 0%.
- **Preset stand-offs are artefacts**: the Allies reach 3x Axis strength and never attack (defend
  slots fill first, then the attack slot needs 2.4x the concentrated Axis group); 101-136 Mongol
  formations sit out of supply while Rome needs 2.5x to attack.
- **Stalingrad is PARTLY now:** a day-1 breakthrough, Axis supply 1.00 -> 0.36 by day 15 (the
  pocket), collapse and 242k captured; still 32 of 75 days and 41k Soviet losses against 486k.
- B2 moved rather than being fixed: the withdraw threshold now decides Carrhae (-0.24), El Alamein
  (-0.84) and Marathon (+0.92), no longer Zama or Adrianople. C5 and C7 unchanged; clear weather
  flips no gate case.

Invariants: all 48 case runs and 24 preset runs are clean.

### Run 5: engine round 4, doctrine evidence rule, climate (engine `25de49e`), 20 seeds

On the numbers: winner 18/24, loss ratio 13/24, duration 21/24. I measured this myself in a clean
worktree at `25de49e`.

| Commit | Change | Result (measured against the commit before) |
| --- | --- | --- |
| `73fa63c` | Weather drawn from the theatre's climate-zone table (zone C fallback until the grid) | 19/17/22 |
| `1150d3f` | Attack staffing is local and in battle-model combat power; an attack a member cannot fill is not launched | 19/17/21 |
| `ffbf817` | The doctrine moves the break point both ways: break = threshold x bp_era(u) / bp_era(mid) + cohesion shift, withdraw at 0.9 of it | 17/11/20 |
| `c68ea96` | Doctrine quartiles need battlefield evidence of withdrawal (6 profiles to the era mid) | 17/14/21 |
| `b9c77a3` | Snapshots and case sides use their specific doctrine profile (Israel idf-1967 and others) | 17/14/21 |
| `27c49c5` | Köppen-Geiger zone grid (Beck et al. 2018): Gulf, Iraq, Egypt and Sinai cases BW, Stalingrad, Cannae and Zama BS, Falklands E | 18/13/21 |
| `25de49e` | AI force ratios from modelRules.aiForceRatio (attrition 2.5/3/5 B, manoeuvre 1/1.5/2.5 C), own per-seed stream | 18/13/21 |

The symmetric break point cost most. It is kept: the old cap hid every "holds" doctrine and let only
brittle ones act. Gulf War February snow: 0 of 175 days with the grid, against 50 of 186 (26.9%) on
the Berlin table.

Sweeps at `25de49e` (every member at one quantile):

| Quantile | Breakpoint | Force ratio |
| --- | --- | --- |
| low | 18/15/20 | 18/12/21 |
| mid | 18/14/22 | 18/13/21 |
| high | 16/12/24 | 18/13/22 |

| case | hist winner wins | loss ratio vs hist | days model / hist |
| --- | --- | --- | --- |
| adrianople-378 | **10%** | x0.26 | 2.8 / 0.25 |
| agincourt-1415 | 100% | **x0.28** | 1.6 / 0.13 |
| austerlitz-1805 | 100% | x1.22 | 1.1 / 0.35 |
| blenheim-1704 | 65% | x1.41 | 1.7 / 0.35 |
| breitenfeld-1631 | 100% | x1.24 | 1.3 / 0.37 |
| cannae--216 | 100% | x0.78 | 1.2 / 0.4 |
| carrhae--53 | **0%** | x20.06 | 1.3 / 1 |
| el-alamein-1942 | 100% | x1.03 | **3.4 / 13** |
| falklands-1982 | 100% | x0.43 | 12 / 25 |
| france-1940 | 75% | **x3.88** | 57 / 43 |
| gaugamela--331 | 95% | x2.77 | 1.6 / 0.4 |
| gettysburg-1863 | 100% | x2.05 | 2.6 / 2.4 |
| gulf-war-1991 | 85% | **x3.19** | 9 / 4.17 |
| hastings-1066 | 85% | x0.81 | 2.2 / 0.35 |
| iraq-2003 | 100% | **x0.15** | 19 / 21 |
| kursk-1943 | 100% | **x3.62** | 6.7 / 12 |
| marathon--490 | **0%** | x12.99 | 1.2 / 0.15 |
| mohi-1241 | **15%** | x12.96 | 1.6 / 0.35 |
| six-day-war-1967 | **0%** | x2.05 | 10 / 4 |
| stalingrad-1942 | 100% | **x0.12** | **24 / 75** |
| tannenberg-1914 | 100% | x2.32 | **1.3 / 5** |
| waterloo-1815 | 100% | x1.76 | 1.6 / 0.4 |
| yom-kippur-sinai-1973 | **25%** | x0.55 | 38 / 18 |
| zama--202 | 100% | **x3.12** | 1.6 / 0.35 |

Bold = fails its criterion. The gate (18 right-reason winners, none flipped by a single grade-D
constant) is now at most met on raw count and needs QA round 5.

### QA round 5 (final): verdict on Run 5

**Gate NOT MET.** Independent QA reproduced Run 5 (18/13/21) at `6936ffc`.

| Verdict | Count | Cases |
| --- | --- | --- |
| RIGHT | 6 | Blenheim (thin), Breitenfeld, El Alamein, Gettysburg, Hastings, Waterloo |
| PARTLY | 12 | Agincourt, Austerlitz, Cannae, Gaugamela, Kursk, Tannenberg, Zama, Falklands, France 1940, Gulf War, Iraq 2003, Stalingrad |
| WRONG | 0 | |

Right or partly right: 18. Two each flip on one grade-D constant within its own range (10-seed
screen, confirmed at 20 seeds): the Gulf War at a winter season factor of 0.4 instead of 0.7 (85% ->
20%; the factor is a Berlin-latitude daylight rule), and Blenheim at one armour-matrix cell of 0.95
instead of 1.0 (65% -> 50%). **Robust: 16 of the 18 needed.** Zama passes only through the grade-B
roman-imperial threshold (45% at the era mid).

What decides the six winner fails (QA's trace; "inferred" where QA said so):

| case | model result | decided by |
| --- | --- | --- |
| Adrianople | 10% | doctrine value: the Roman "holds" threshold (0.25 vs era 0.20); at the era mid the Goths win 100%. Case data: the Goths use a medieval archetype |
| Carrhae | 0% | missing mechanism: the Parthian break-contact threshold (-0.93) beats its power edge, because breaking contact is scored as losing; 100% at the era mid |
| Mohi | 15% | the same missing mechanism for the Mongols (-0.92); 100% at the era mid |
| Marathon | 0% | the Athenians are out-powered (-0.58) and the tech term runs against hoplites; case data or a missing mechanism (inferred) |
| Six-Day | 0% | Egypt holds its objective at the 10-day limit; missing: the pre-emptive air strike and the Egyptian withdrawal order (inferred) |
| Yom Kippur | 25% | Egypt wins 13/20 on territory share at the limit after 2-3 undecided battles; missing: a crossing at a seam. Case data: Egypt's objective starts Egyptian-held |

## Sensitivity analysis (QA round 5, `6936ffc`)

One at a time, every graded constant (1,025, of which 622 grade D) at its own low and high; gate
counts winner / ratio / duration against 18/13/21. The largest effects:

| constant | grade | at low | at high |
| --- | --- | --- | --- |
| era breakpoints (quantile) | B-D | 18/15/20 | 16/12/24 |
| isrPerLevel | D | 18/13/21 | 20/15/22 |
| commandFactor (switched off) | C | 16/11/22 | 16/11/22 |
| ewPerLevel | C | 17/13/21 | 20/14/22 |
| riverCrossingFactor | C | 17/12/22 | 19/14/22 |
| movement season winter | D | 17/14/22 | 18/13/22 |
| movement terrain desert | C | 16/13/21 | 18/13/21 |

The remaining constants tie at a total change of 2 or less.

Global: every constant drawn independently from its range, 20 draws x 20 seeds (command, quality and
training scales and the per-seed breakpoints left free):

| count | min | median | max |
| --- | --- | --- | --- |
| winner | 15 | 17 | 20 |
| loss ratio | 12 | 14 | 16 |
| duration | 20 | 22 | 24 |

The winner count reaches 18 in 9 of 20 draws. Fragile passes: France 1940 (10/20 draws), the Gulf War
(8/20), Blenheim (15/20). Mohi, a fail, passes in 14/20. The draws ignore correlations between
constants, so this is a picture of the wide end, not a calibrated interval.

Invariants: all 48 case runs and 24 preset runs clean. The allies-vs-axis stand-off is gone (Axis
wins after 138 battles); mongols-vs-rome is still a draw with no battle.

## Verdict

The backtest gate (18 of 24 winners right for the right reasons and not flipped by any single
grade-D constant) is **not met**: 16 robust passes at the final commit, a median of 17 winners when
all constants are drawn together. Five QA rounds moved the model from 14 winners decided largely by
artefacts to 18 with none judged WRONG. The rest was not pursued by tuning: every change was chosen
on sourced data or a stated mechanism, and the costs are recorded above. What would move the
remaining cases is listed per case: breaking contact without counting it as defeat (Carrhae, Mohi),
pre-emptive air strikes and withdrawal orders (Six-Day), seam crossings (Yom Kippur), and sourcing
the grade-D constants that still decide the Gulf War and Blenheim.

### After the verdict: daylight from latitude (`46a3774`)

The grade-D winter factor that flipped the Gulf War in QA round 5 was a Berlin-latitude daylight rule.
It is retired: march hours are now min(1, sunrise-to-sunset hours at the theatre latitude on the sim
date / `movement.marchHoursPerDay` 6.0 h from FM 101-10), with day length from the Spencer 1971 / NOAA
formula. Measured at 20 seeds against `f991a6e`: 18/13/21 unchanged; Gulf War 85% -> 90%, 9 -> 8 days;
France 1940 75% -> 70%, ratio x3.88 -> x5.10. Every backtest theatre has at least 7.7 h of daylight, so
the factor is 1 throughout. That removes one of the two single-constant flips QA found. QA round 6
re-measured the robust count: it stays 16, because France 1940 is fragile too (see that section).

## Release checks (Phase 4)

Measured at `232484f` (Phase 3 in, lazy loading in) on an Apple M5 Pro, macOS, Node 26.5.0, by a
builder who did not write the engine. The backtest at that commit is unchanged: 18/13/21.

| Check | Result |
| --- | --- |
| `tsc --noEmit` | pass, 1.3 s |
| `vitest run` | 42/42 in 12 files, 2.3 s |
| `data-pipeline/validate.ts` | 1,234 snapshots, 0 errors, 1 warning (Athens -480 personnel share) |
| `vite build` | pass; main chunk 1,449 kB (417 kB gzip), over Vite's 500 kB warning; `dist/` 32 MB, 30 MB of it data |
| 12 presets x 2 seeds, headless | 24/24 finish; 0 NaN, 0 negative, 0 conservation failures after every day; 52 s total |
| Dev server, headless Chrome (`--headless=new`, Metal) | 0 console errors or warnings; map and units render; preset starts in 609 ms |
| Sim speed | 1x: 1.00 days/s; max: 29.66 days/s against a 30 days/s target |
| Frame rate, 10 s with the sim running | 60.0 fps at 1x and at max, p95 16.8 ms, no frame over 50 ms |

The frame rate is at the 60 Hz ceiling headless Chrome paces to, so it shows no dropped frames on this
machine, not headroom, and says nothing about a slower GPU.

Preset outcomes worth knowing (not failures of the checks):
- `usa-vs-china-2026`, `usa-spain-vs-russia-2026` and `japan-vs-usa-1941` end on the time limit
  as draws on both seeds. Why was not diagnosed; the sides are separated by sea and the engine's
  amphibious moves need sea control above 0.6 (ENGINE.md section 6).
- `mongols-vs-rome` ends after 120 days without battle: the two armies never meet in the theatre.
- `allies-vs-axis-minus-two` flips between seeds (Allies on day 649, Axis on day 149).
- `macedon-vs-persia-timeslice` flips between seeds (Persia by territory on day 167, Macedon by
  collapse on day 239). Alexander won historically; the Gaugamela backtest case itself passes, so
  the campaign-scale preset and the battle case disagree. Not diagnosed.

## Red team

An adversarial pass by an agent that wrote none of the code, at `6936ffc`: share links, loaded
files, editor values, matchups across eras, the UI in headless Chrome, and the data. Full report with
repro scripts: kept outside the repository with the QA scratch files; the findings and their
status are below. Re-tested by the same red team at `2202ec3`.

Clean at both passes: determinism (same seed, in-process and across processes, snapshot/restore
replay, step chunking: bit-identical); no NaN, negative personnel or conservation break in the 12
presets, 89 cross-era matchups and the edge cases; all 12 presets run in the UI and match the headless
results; 60 fps with the 6,000-unit stress layer (0.5 ms unit CPU per frame); no XSS through names,
descriptions or colours.

| Finding | What happened | Fix | Re-test |
| --- | --- | --- | --- |
| C1 | A share-link override path `__proto__.x` polluted the engine worker's prototype and broke every later run in the tab | `1be5c9d` path whitelist, own properties only | FIXED |
| C2 | A force count of 1e9 grew formations without bound; 1e15 aborted V8 | `b589e77` per-role caps (10x the largest researched value), 6,000 formations per member | FIXED |
| C3 | Negative counts accepted; conservation off by 2.5M | `b589e77` values must be finite and at least 0 | FIXED |
| C4 | An enemy capital inside the attacker's historical borders counted as captured on day 1 (Egypt 1274 BCE beat Israel 2026 in 20/20 seeds) | `a69810b` overlapping land starts contested, capture needs an enemy formation on or next to the capital | FIXED; two states with the same capital city still fight it out on day 1, now in a real battle |
| C5 | A 174 KB link that inflated to 128 MB froze the tab | `e6f6ec5` streaming decompression capped at 16 KiB, length caps | FIXED |
| W1 | Wrong types in a link (`nuclear: "false"`) switched nuclear on or crashed the engine | `f1d9fbd` type checks and clamps in the loader | FIXED in the loader; scripts calling the engine directly are unguarded |
| W2 | No WebGL2 blanked the whole app | `68ca596` map error boundary | FIXED |
| W3 | Editor fields with no effect | `fd3d493` tagged "not used by the engine" | FIXED; three fields the red team listed matter only in long or nuclear wars |
| W5 | Zero-personnel states never fell | `a09c46f` capital cell starts with its owner; an empty side's places open to the first enemy | FIXED (Andorra day 5) |
| W7 | Nuclear casualties missing from the reasons | `f7e3795` nuclear strikes factor; `dd0d666` always listed when they happened | PARTLY at re-test (a small share fell under the 1% display cut), then fixed |
| W8 | Palestine's capital at 0,0 | `2202ec3` Ramallah; validation rejects 0,0 | FIXED |
| W9 | Keyframes would reach 0.9-2.1 GB on the longest runs | `1763633` at most 64, thinned | FIXED; seeks match a fresh run |
| W4 | The USA needs about 90 days and 6,000 casualties to take the Vatican's 135 guards | not fixed: supply exhaustion at the end of the line | limits page |
| W6 | Rome 117 lost its capital to a landing without a battle | not fixed: the defending AI does not garrison against a landing | limits page |
| N1 (re-test) | Only force counts were capped: trainedReserves 1e15 gave 861 trillion personnel | `6806c3f` every editable field capped at 10x the largest snapshot value | fixed after the re-test, not re-tested |
| N2 (re-test) | Share URL copied links above about 240 edits that the app refused | `ef4423f` Share checks the loader's limit, Save falls back to compact JSON | fixed after the re-test; unit-tested, not checked in a browser |
| Same vs same | A snapshot against itself: side B wins on day 3 | not fixed; the loader accepts it | open |
| L1-L5 | Narrow nuclear trigger and no deterrence; neutral territory transparent; time-slice equals native; reasons ordered winner-first; zero-army microstates | limits | limits page |

None of the fixes moved the backtest: 18/13/21 with every case line identical at `dd0d666`. Every preset winner is
unchanged; C4 shortened two preset wars (rome-117-vs-spain, rome-vs-france-equalized).

## QA round 6: break contact (REJECTED)

Hypothesis from round 5: Carrhae and Mohi fail because a side that breaks contact is scored as
beaten. The trace at `a35d728` holds for Mohi and is half the story for Carrhae: the Parthians also rout
at the era break, and no horse-archer standoff exists. The mechanism was built behind a toggle
(`19cd622`) and reverted (the commit after it); `git revert` of that revert brings it back.

| 20 seeds, 24 cases | Off (`a35d728`) | On |
| --- | --- | --- |
| Winner / ratio / duration | 18/13/21 | 19/14/21 |
| Reasons: right or partly right | 18 | 19 (RIGHT 6, PARTLY 13, WRONG 0) |
| Robust on 618 of 623 grade-D constants, low and high | 16 (Blenheim, France fail) | 16 (Blenheim, France, Mohi fail) |
| Also counting grade-D era breakpoints | 14 | 14 |
| Gate (18 robust) | not met | not met |

- Mohi went 15% -> 95%, but break-off alone gives 35%; the morale-scale side of the change gives 80%, and
  in 13 of 20 seeds nobody withdraws. It falls to 55% at the low end of the new grade-D constant.
- Carrhae stays 0%: the Parthians break off and return in 20 of 20 seeds, and still lose.
- In war mode foot formations qualify against foot-only enemies; no test caught that.

Two corrections to the record, from this round's stricter screen (every grade-D constant at 20 seeds,
where round 5 screened at 10):
- The gate count is 16 at this commit, not "probably 17". The Gulf War flip is gone, but France 1940
  drops below 60% on 9 grade-D constants. Reproduced by hand for two of them:
  `attrition.starvationMultiplier` at 5 and `attrition.diseaseDaily.7` at 0.008.
- Round 5's 16 was overstated. France already flipped at `6936ffc`, so that figure was at most 15.

## QA round 7: sourcing the constants that decide Blenheim and France

QA round 6 named 10 grade-D constants that flip Blenheim or France 1940. A researcher with no access to
the backtest sourced 8 of them; `armorMatrix.8.8` and `morale.supplyShortfallPenalty` have no source.
Effect of each proposed mid on the 24 cases at 20 seeds, against 18/13/21:

| Constant | Proposed mid (was) | Grade | Result | Applied |
| --- | --- | --- | --- | --- |
| `attrition.diseaseDaily.7` | 0.0025 (0.004) | B | 18/13/22 | yes |
| `logistics.carriedDaysFood.8` | 6 (5) | C after QA | 18/13/21 | yes |
| `lethality.tli.cavalry_light.7` | 380 (350) | C | 17/13/21, France 55% | yes |
| `lethality.tli.cavalry_light.8` | 555 (400) | D after QA | 18/13/21, France 60% | reverted |
| `attrition.starvationMultiplier` | 2.5 (2.5), high 6 | D | 18/13/21 | no |
| `lethality.tli.aircraft_strike.8` | 2.3M (2.5M) | D | 18/13/22, France 65% | no |
| `lethality.armorMatrix.6.5` | 0.96 (1.0) | D | 17/13/21, Blenheim 55% | no |
| `combat.specialEffects.massedArtillery` | 1.4 (1.2) | D | 17/13/22, France 50% | no |
| All 8 together | | | 16/13/22 | no |

The rule for what went in: a value is replaced only if the evidence raises it above grade D, since a
guess does not replace a guess. **That rule was chosen after these results were seen**, and it keeps out
the two values that hurt most, so it is not a neutral one. QA read all four derivations it kept out and
found D correct for each, which is the only support it has. Read the all-8 line as the honest
sensitivity: Blenheim and France lean on guessed values.

Final state at `3b053d3`: **18/13/22**, three constants applied. QA measured `ece72e4`, with
`cavalry_light.8` still applied. Re-screened after the revert with `scripts/robustness.ts`
(`validation/robustness-20.jsonl`): the same flips as QA and the same **16** robust winners, 14 counting
grade-D era breakpoints.

| Check at `ece72e4` | Result |
| --- | --- |
| Reasons | Stalingrad PARTLY (24 -> 27 days, duration now passes, from `diseaseDaily.7` alone); France PARTLY, thin; Blenheim RIGHT, thin |
| Fails the robust screen | Blenheim (`armorMatrix.6.5` 0.95, 50%), France (`starvationMultiplier` 5, 40%) |
| Also fails with era breakpoints | Hastings, Gulf War |
| **Gate (18 robust)** | **not met** |

Corrections and limits from this round:
- The message of `ece72e4` says France went from 60 to 50 days. That is a bimodal median artefact: France
  got slower.
- France still drops to 35% at the sourced high of `diseaseDaily.7`. That constant is grade B now, so the
  screen no longer counts it.
- `cavalry_light.7` (380) now exceeds `cavalry_heavy.7` (370), which is still grade D on the old method.
- `diseaseDaily.7` now sits under `diseaseDaily.8` (0.0028), so the series is not monotonic with tech.
- Twenty seeds cannot resolve a 60% line. At 400 seeds France is 81% and Blenheim 74%, against 70% and 65%
  at 20. At 400 seeds Blenheim survives its constant (63.1 +/- 3.3), while France fails
  `aircraft_strike.8` low as well (52.8). The screen stays at 20 seeds so that the count compares with
  earlier rounds; a change of instrument would be its own campaign.

## Robustness campaign at 200 seeds

A separate campaign from every 20-seed count above, never pooled with them: same data (`3b053d3`, data
hash `05fd7676dd1481b8`), same 60% line, same constants, 200 seeds per evaluation
(`validation/robustness-200.jsonl`, 1,177 evaluations, 0 errors, 1 h 07 min on 18 cores, Apple M5 Pro).

| | 20 seeds | 200 seeds |
| --- | --- | --- |
| Winners at base | 18 | 18 |
| Robust, grade-D constants | 16 | **17** |
| Robust, also era breakpoints | 14 | **15** |
| Gate (18 robust) | not met | **not met** |

The same 18 cases pass at base in both. What changed is which flips were real:

- **Blenheim was noise.** 74.0% +/- 6.1 at base, and it holds on `armorMatrix.6.5` low at 63.5% +/- 6.7, over
  the line but not clear of it.
- **France 1940 is the real failure.** 81.5% +/- 5.4 at base, and clearly under the line on two grade-D
  constants: `starvationMultiplier` high 48.0% +/- 6.9, and `aircraft_strike.8` low 51.5% +/- 6.9.
  The 20-seed screen found only the first.
- **Gulf War and Hastings fall to 0% at breakpoint quantile 1**, clearly and at both seed counts. They
  fail differently (40 seeds at that quantile): Iraq wins the Gulf War 40 of 40, and Hastings ends a draw
  40 of 40. No other single constant takes either under the line.
- The next closest is Gaugamela, 98.0% at base and 91.5% at its lowest.
- Failing cases stay failed: Mohi 38.0% +/- 6.7, Yom Kippur 33.5% +/- 6.5, Adrianople 6.5%, and
  Carrhae, Marathon and the Six-Day War at 0%.

The gate is one case short on grade-D constants. Under the 20-seed screen it was two short, and that
reading was partly noise. The closest routes to 18 are France 1940 and one more winner, and any
route still has to survive the era breakpoints, which cost two more cases at this count.

## Diagnosis: the high era breakpoint

Instrument: 40 seeds per line at HEAD 048ff5c, same seeds across columns, with the time limit or the
per-seed breakpoint overridden from a scratch script. No engine or data value changed. These are not
pooled with the 200-seed campaign, and 40 seeds is a diagnostic count, not a gate reading.

**Both collapses are time-limit endings, not lost fights.** Every seed at quantile 1 reaches the limit:

| Case, quantile 1 | Limit as set | Limit x2 | Historical |
| --- | --- | --- | --- |
| Gulf War | Iraq 40 of 40 at 10 days, on "still holds its objective" | Coalition 40 of 40, median 12 days | 4.17 days |
| Hastings | draw 40 of 40 at 3 days | Normans 40 of 40, median 3.8 days | 0.35 days |

At the same quantile the Gulf War stands at a median 2,818 Coalition and 61,582 Iraqi losses when the
limit fires (20 seeds). The base losses are the same thing: each case misses 5 of 40 at base, and all 5
are time-limit endings. The flip sits between quantiles 0.7 and 0.9 in both cases.

**The Six-Day War has the same trigger with no breakpoint moved.** Egypt "wins" 40 of 40 at the limit of 10
days. With no binding limit Israel wins 40 of 40, on its objective or a morale collapse, at a median 20
days against 4 historical, so x5.0 and outside the duration window. The miss is speed, not the winner.

**Is the range right?**

- **Modern: no, as applied.** Iraq's break at quantile 1 is 0.462, above the era high of 0.30. The doctrine
  threshold 0.154 is scaled by the era's high/mid of 3.0, so a doctrine already high in its era leaves the
  sourced range. The modern range is grade D besides, and the doctrine values are coldwar quartiles.
- **Medieval: not shown wrong, and weak.** The feudal doctrine sits at the era mid, so quantile 1 is exactly
  the era high, 0.41. Its own note calls that an upper bound from totals dominated by the rout, grade D.
  Hastings stays a timing failure there: the Normans win at x2 the limit, at x10.9 the historical duration.
  No sourced replacement is in hand.

**Counterfactuals** (winner hits of 40 seeds, base draws unless stated):

| Case | Now | Break clamped to era low-high | Campaign limit 3 x high duration |
| --- | --- | --- | --- |
| Gulf War | 35 | 40 | 40 |
| Gulf War at quantile 1 | 0 | 40, median 8 days | 33 |
| Hastings | 35 | 35 | 35 |
| Hastings at quantile 1 | 0 | 0 | 0 |
| Six-Day War | 0 | 0 | 0 |
| Adrianople | 2 | 19 | 2 |
| Mohi | 11 | 19 | 11 |
| France 1940 | 32 | 33 | 32 |

Winners at the line stay 18 of 24 in all three columns, and the other 18 cases do not move. The clamp is the
fix the range argument supports. It was chosen after seeing these results, so it would need its own
toggle and a fresh campaign, not pooled with this one. Neither change has been applied.
