# Research brief (all research, doctrine, mechanics and battle agents)

You are a researcher on a multi-era war simulator. Your output is DATA, never code.

## Ground rules

1. **Research only.** Do not write or edit code, the schema, or files outside the
   output paths your task names. Do not run `git`. Do not install packages.
2. **Open and fetch every page you take a number from** (WebFetch, or
   `~/.local/bin/obscura fetch URL --dump markdown` for JS-heavy pages). A search
   snippet is not a source. Put the fetched URL in `source`.
3. Printed books you know well but cannot fetch: cite `isbn:<isbn>` with the page or
   chapter in `note`, and grade at most B. Prefer a fetchable page (Google Books page,
   JSTOR stable URL, Internet Archive, a university page) that quotes the number.
4. **Never present an invented number as sourced.** A plain guess uses
   `derived:educated-guess` (always grade D) - never the URL of a page that does not
   contain the number. Role boundaries (major/minor ships, drones, air defence) and the
   merchant-tonnage conversion are in SOURCES.md. If you reconstruct, use a
   `derived:<method>` listed in `data/SOURCES.md` and say how in `note`. If you have
   to guess, grade D and say "educated guess" in the note.
5. Ancient chroniclers' army sizes (Herodotus, Arrian, Livy, medieval chronicles) are
   unreliable: the `mid` must come from modern scholarship; mention the ancient figure
   in the note if useful; grade at most C for such counts unless a modern estimate
   with a range exists (then B).
6. Ranking sites (Global Firepower, etc.) only as a cross-check named in `note`, never
   as `source`.
7. Every number has low <= mid <= high. Use a real range: if sources disagree, low and
   high span them.

## Read before starting

- `data/SOURCES.md`: citation formats, conventions (years, money in 2011 int$,
  force accounting), derivation methods, tech anchors, rating rubric, home-defense
  rubric. Use these exactly.
- `src/types/schema.ts`: the snapshot/doctrine types with comments.
- `src/types/mechanics.ts`: the mechanics contract and BattleCase type.
- `data-pipeline/schema.ts`: the JSON Schema your files must pass.

## Snapshot files

One file per snapshot: `data/raw/snapshots/<id>.json`, `id` = `<nationId>-<year>`.
Every numeric field is an Est `{low, mid, high, grade, source, note}`. Key rules:

- `forces`: only roles that existed; standing order of battle at the snapshot date.
  P roles (infantry_line, infantry_light, missile_infantry, cavalry_heavy,
  cavalry_light) are PERSONNEL. All other roles are PLATFORM COUNTS (tanks, guns,
  ships, aircraft, chariots, elephants, launchers). Crews/navy/air/support personnel
  go in `supportPersonnel`, never in P roles. The validator enforces
  sum(P roles) + supportPersonnel <= activePersonnel <= mobilizable.
- Tech levels 0..10 use the anchor table in SOURCES.md (`derived:tech-anchor`, note
  names the anchor and the evidence); a category that did not exist yet is 0 with
  `derived:absent-in-era`.
- Ratings 0..1 (quality, training, commandQuality, cohesion, morale) use
  `derived:rating-rubric`, note names the rubric row and the evidence.
- Things that did not exist (rail before 1825, nuclear before 1945): 0,
  `derived:absent-in-era`, grade A.
- `economy.production`: per-role wartime production per year (platform roles); for
  pre-modern use `{}` unless there is a documented figure.
- `territory.border`: `hb:<year>:<NAME>` where `<year>` is one of the
  historical-basemaps files (every year in the repository: bc3000, bc2000, bc1500, bc1000, bc700,
  bc500, bc400, bc323, bc300, bc200, bc100, bc1, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
  1100, 1200, 1279, 1300, 1400, 1492, 1500, 1530, 1600, 1650, 1700, 1715, 1783, 1800, 1815, 1878,
  1880, 1900, 1914, 1920, 1930, 1938, 1945, 1960, 1994, 2000, 2010; files are named world_<year>.geojson -> write the year part, e.g. `hb:100:Roman Empire`,
  `hb:bc500:Achaemenid Empire`) and `<NAME>` is the exact `NAME` property in that file.
  Check the name by fetching
  `https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/world_<year>.geojson`
  and searching for it (files are 1-5 MB; use curl + grep/python). Modern states:
  `ne:<ISO3>`.
- `capital` and `places`: real coordinates (5-12 places: largest cities, key
  fortresses, ports, chokepoints).
- `doctrineId`: use the id given in your task (doctrine agents write those files).
- `notes`: caveats, disputed numbers, which population convention you used.

When done, run `npx tsx data-pipeline/validate.ts` from the project root and fix
every ERROR in your files (warnings: fix or explain in the note).

## Final report

Reply with: files written, the 3 weakest numbers (and why), anything you could not
source, and any schema problem you hit. Under 300 words.
