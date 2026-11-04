# Releasing

Version, freeze, publish, in that order. Every step is here because it is the one that gets skipped
when shipping from memory.

## 1. Version
- Bump `version` in `package.json` and in both places in `package-lock.json` (the top level and
  `packages[""]`): `npm version <x.y.z> --no-git-tag-version` does all three.
- `npm run typecheck`, `npm test`, `npx tsx data-pipeline/validate.ts --quiet`.
- `npx tsx scripts/backtest.ts --seeds 20` and compare the winner / ratio / duration triple with the
  previous release. Any change goes in the notes.
- `npm run data:build` and `git status`: `public/data` must not change.

## 2. Freeze
- Write the notes in `docs/releases/v<x.y.z>.md`: a bold one-line headline, the fixed-field stats
  block, short `###` sections covering only this release, and a Known limits section.
- Commit, then tag: `git tag -a v<x.y.z> -m v<x.y.z>`. The tag is the frozen snapshot later work is
  measured against.

## 3. Publish
- `git push origin main --follow-tags` and wait for CI to pass.
- Build the web bundle and zip it: `npm run build`, then `cd dist && zip -qr ../war-simulator-v<x.y.z>-web.zip .`.
- `gh release create v<x.y.z> war-simulator-v<x.y.z>-web.zip --title "v<x.y.z>" --notes-file docs/releases/v<x.y.z>.md`.
- Check that the Pages deploy for the tag finished and the live page loads a preset.

One-time setup, already done: Pages builds from GitHub Actions, and the `github-pages` environment
allows `v*` tags as well as `main` (Settings, Environments). Without the tag rule the deploy job is
rejected with "not allowed to deploy to github-pages due to environment protection rules".
The social preview card, `docs/social-preview.png`, is uploaded by hand in Settings, General.
