## What changed

## How it was checked

- [ ] `npm run typecheck` and `npm test` pass
- [ ] Engine changes sit behind a constant in `src/engine/constants.ts` and carry a backtest measurement (`npx tsx scripts/backtest.ts --seeds 20`)
- [ ] Data changes cite a source and were rebuilt with `npm run data:build`
