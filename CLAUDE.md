# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

DataAfrik is a self-service analytics platform: a user uploads a spreadsheet and the app
builds a semantic model, answers DAX and plain-English questions over it, draws charts and
exports a paid PDF report. **Correctness is the product.** A wrong number that looks
confident is the worst outcome here, which is why the engine refuses rather than guesses and
why its answers are checked against Power BI rather than against this codebase's own reading
of DAX.

Two deployables, both on Vercel, both auto-deployed from `master`:

- **frontend** — Vite + React 18 + TypeScript (project `dataweb1`)
- **backend** — Express + Postgres/Supabase (project `dataweb1-backend`)

## Commands

Frontend, from the repo root:

```bash
npm run dev          # vite dev server on http://localhost:8080
npm test             # vitest run (the whole suite)
npm run test:watch   # vitest
npm run typecheck    # tsc --noEmit -p tsconfig.app.json
npm run build        # vite build (prebuild regenerates public/sitemap.xml)
npm run lint         # eslint . - see "lint backlog" below
npm run build:engine # rebundle the engine for the backend - see "The server runs the same engine"
```

One test file, or one test:

```bash
npm test -- src/lib/__tests__/daxTime.test.ts
npm test -- -t "<part of the test name>"
```

Backend, from `backend/`:

```bash
npm start            # node server.js, port 3001
npm run dev          # nodemon
npm test             # jest
npm test -- datasets.roundtrip   # one suite
npm run test:smoke:v1
```

`npm run start-backend` from the root does the same as `backend/npm start`. Node >= 18;
CI uses 20.

The frontend needs `VITE_BACKEND_URL` and `VITE_API_VERSION=v1` (see below) in `.env.local`.
Backend secrets live in the gitignored `backend/.env`; `backend/env.example` lists the keys.

## Architecture

### The engine stack

Everything that produces a number lives under `src/lib/` and layers like this:

1. **`semantic/`** — `buildSemanticModel()` turns uploaded `Dataset`s into tables, columns,
   roles (`roles.ts`), date tables (`dateTable.ts`) and relationships. `propagation.ts`
   answers "can a filter on A reach B".
2. **`dax/`** — a real tokenizer → parser → AST → evaluator (`tokenizer.ts`, `parser.ts`,
   `evaluate.ts`, `registry.ts`), entered through `runDax()` in `run.ts`. An expression it
   cannot parse **errors loudly**; it never falls back to a plausible number.
3. **`measures/`** — typed `MeasureTemplate` entries carrying portable DAX, a native
   implementation, required roles and an `interpret()` narrative.
4. **`nlq/`** — plain-English questions compiled to a typed query IR that the DAX engine
   executes. The UI shows the resolved query back to the user. There is no regex pattern
   matching here any more.

**One rule governs filter direction: `relationshipsFrom()` in `semantic/model.ts`.** Filters
travel one side → many side (and back only when `crossFilter === 'both'`). Both the evaluator
and NLQ call that same function, so they cannot drift. NLQ *refuses* a cross-table grouping
the filter cannot reach; that refusal is confirmed correct against Power BI (see the
cross-table sheet) — do not relax it without re-running that case.

### Everything that shows a number uses the engine's rules

The panels around the engine (charts, AI Insights, Advanced Stats, Time Series,
the column profile, Data Cleaning, the relationship diagram) used to do their own
arithmetic, and each drifted from the engine in a way that put a confident wrong
number on screen. They now share the engine's rules; keep it that way:

- **Reading a cell as a number**: `cellAsNumber` / `cellNumber` (`lib/dax/value.ts`,
  NaN for blank and non-numbers) or `chartNumber` (`lib/chartValues.ts`, null).
  Never `Number(cell)` — see the trap below.
- **Grouping by a category**: `CategoryGroups` / `sumByCategory` (`lib/chartValues.ts`),
  which use the model's `keyOf` (trimmed, case-insensitive; blank is `(Blank)`).
  `" workshop "` and `"Workshop"` are one group, as in Ask Data.
- **Correlations**: `pairwiseCorrelation` (rows where both values are present).
- **Relationships shown or joined on**: `diagramRelationships(model)` — the model's
  active relationships, never the detector's raw candidates (which link any two
  columns that share values). Joins for charts use `lookupJoin`, which never
  repeats a row.
- **Which columns an auto-analysis picks**: `lib/columnMeaning.ts`
  (`isAdditiveColumn` — sum money/quantities/durations, average ages/scores;
  `isIdentifierLike`). Business measures need a matching column name
  (`requiresNameMatch` in `measures/`).
- **The model the UI answers from** is derived from `datasets`
  (`lib/semantic/liveModel.ts`), so an edit, a cleaning step or a deletion can never
  leave Ask Data answering from old rows.

### The server runs the same engine

`src/lib/engine/index.ts` is the engine's public surface for the backend. `npm run
build:engine` bundles it (esbuild, CJS) into **`backend/engine/engine.cjs`, which is
committed** — the backend has no build step. `engineBundle.test.ts` fails if the
committed bundle differs from a fresh build, and runs every Power BI parity case through
both the source and the bundle. **Any change under `src/lib` that the engine imports
needs `npm run build:engine` and the regenerated bundle in the same commit**, or CI fails.

`POST /api/v1/analytics/query` (`backend/modules/analytics`) evaluates DAX or answers a
question over stored datasets with that bundle: owner-scoped, refuses a dataset still
uploading or a short read, caps rows per query, caches models per dataset version. Never
translate DAX to SQL (`docs/server-side-compute-decision.md`); pushdown may only ever
select rows, never decide a value.

### Upload path

`components/FunctionalDataUpload.tsx` is the hub: file → `lib/excelRows.ts` (shared by the
CSV and Excel paths: `readSheet`, `cellValue`, and `planHeaders` once #12 lands) → `Dataset`
→ everything else. `planHeaders` renames blank headers to `Column N` and duplicates to
`Name (2)`; without it a repeated heading silently dropped a whole column. Stored datasets go
through
`lib/datasetStore.ts` and `hooks/useStoredDatasets.ts` (three-step chunked upload, paged
load, **refuses a short read** rather than returning a partial dataset).

### Frontend → backend URLs

`lib/publicConfig.ts` `getApiUrl()` rewrites `/api/...` to `/api/v1/...` **only when
`VITE_API_VERSION=v1`**. The backend mounts nothing but `/api/v1` (`backend/server.js`), so
without that variable every API call 404s and the failures surface as unrelated symptoms
(e.g. a paid user shown the PDF paywall).

### Backend

`server.js` is the app; `api/index.js` just re-exports it for Vercel's serverless function
(`backend/vercel.json` routes everything there, 30s max duration — there is no build step on
the backend). Routes are `api/v1/routes/*.js`, documented in `openapi/v1.yaml`, and
`tests/openapi-coverage.test.js` fails if a mounted route is undocumented or vice versa.

Database access is `config/database.js`. **`query()` cannot do transactions** — its
`isSqlStatement()` regex does not list BEGIN/COMMIT/ROLLBACK, and each call takes an
arbitrary pooled connection. Use `withTransaction(run)`. Call `closePool()` in `afterAll`
or jest cannot exit.

The Postgres is Supabase, and the durable path is Postgres-specific (JSONB, UUID,
TIMESTAMPTZ, `ON CONFLICT`, `$n` params).

## Verification

### Power BI parity sheets — the thing that makes this engine credible

`src/lib/__tests__/fixtures/powerbi/` holds six sheets (DAX semantics, measures, grouping,
table, blank, cross-table): expressions chosen because the answer is a **judgement call**
rather than a derivation, written so that different readings give different numbers. A human
reads the answers off Power BI Desktop; the suite diffs them automatically. The folder's
`README.md` is the operator's script. A generator builds one pasteable calculated table per
sheet and a drift test asserts the committed `.dax` file still matches the cases.

Why this exists: no property test catches a reading that is wrong *consistently*. If
`SAMEPERIODLASTYEAR` is off by a day everywhere, every law still holds, because they are all
computed from the same misunderstanding.

**Deliberate divergences are pinned, not skipped** — the test asserts the disagreement is
exactly what was recorded, plus a count assertion so it cannot spread. There is one cause:
Power BI's Text/CSV connector stores an empty text field as `""`, while `fromCell` converts
it to BLANK on purpose so missingness stays visible to completeness and null counts. It
changes `ISBLANK`/`COUNTA` on a text column with empty cells and nothing else. A blank
*measure result* (a dimension row with no matching facts) behaves identically in both
engines — the two are distinguishable.

### Test conventions

- **Mutation-test every new guard**: reintroduce the bug, confirm the test fails, restore.
  Several tests in this suite passed vacuously until strengthened this way. A test that
  restates the implementation's logic instead of importing it is two copies that drift while
  staying green — export the real function and call it.
- `src/lib/__tests__/fixtures.ts` has `makeDataset`, `seededRandom` (mulberry32) and
  `seededNormal`. Never put bare `Math.random()` in a test.
- Golden values in the statistics tests came from a high-precision reference implementation,
  not from the engine. Do not "fix" one by pasting what the engine currently returns.
- `vite.config.ts` pins `process.env.TZ = "Pacific/Honolulu"` for the whole suite, and it
  must stay negative: CI runs in UTC, where local-getter and UTC-getter date code behave
  identically and timezone-drift tests pass vacuously. `dateTable.test.ts` asserts the offset
  is behind UTC, so the suite fails loudly if this stops taking effect.
- **The frontend suite is vitest, the backend suite is jest.** `expect(value, message)` works
  in vitest and is a hard error in jest ("Expect takes at most one argument"). In a backend
  test fold the explanation into the compared value:
  `expect(ok ? 'documented' : 'why not').toBe('documented')`.
- The engine's own tests do not exercise the panels beside it. A four-row CSV on the live
  site once found a bug 942 green tests had missed. **Verify UI-visible work in a running
  app with real data**, not only against the suite.

## Repo conventions

- A pre-commit hook runs `scripts/commit-guard.mjs`, which blocks staging `.env*`,
  `public/sitemap.xml` (regenerated by `prebuild`, so it shows as modified most of the time),
  `dist/` and `backend/tmp-*`. Leave those out of commits.
- **Lint backlog**: ~700 pre-existing `no-explicit-any` violations mean CI runs lint with
  `continue-on-error`. The gate is typecheck + tests + build. Don't add to the backlog, and
  check the lint count before/after rather than assuming a clean run.
- The build strips types without checking them, so `npm run typecheck` is a separate gate —
  a type error ships silently without it.
- Merging to `master` deploys to production.

## Traps that have already cost a day

- `Number('')` is `0`. Every aggregation in `kpiFormulaEngine.ts` coerced before the null
  check, so an empty cell became a real zero and `MIN` reported 0 for a column whose smallest
  value was 10 — while the panel beside it answered correctly. Route cell values through
  `cellAsNumber` (`lib/dax/value.ts`), which is the DAX engine's own conversion, so the tiles
  and the engine cannot disagree.
- `Number('')` and `Number(null)` are **0, not NaN**, so `Number(cell)` followed by
  `.filter(v => !isNaN(v))` keeps every blank as a real zero. That pattern sat in ~50
  places and moved a correlation from 0.77 to 0.47 and an average from 65.25 to
  62.62 on a workbook with 10 blank cells. Use `cellNumber` / `chartNumber`.
- Dates are calendar dates at **midnight UTC, read with UTC getters** (the engine's
  convention). `new Date('2026-02-01')` is UTC; reading it with `getMonth()` puts it in
  January anywhere behind UTC. Keying a locally-parsed date with `toISOString()`
  moves it a day back anywhere ahead of UTC.
- In the relationship diagram (an SVG), do not size HTML in a `foreignObject`: its
  height depends on the browser's fonts and it gets cropped. Draw in SVG.
- `Math.min(...values)` throws `RangeError` between 125,000 and 150,000 elements. Use
  `minOf`/`maxOf` in `lib/dataUtils.ts`, which match `Math.min`/`Math.max` exactly
  (`Infinity` on empty, NaN propagation).
- `canvas.toDataURL('image/png')` on a 0×0 canvas returns the **truthy** string `"data:,"`,
  which reaches jsPDF and throws "wrong PNG signature". The guard is `isUsablePng()` in
  `lib/pdfGeneratorEnhanced.ts` (`isUsableImage()` in `lib/chartCapture.ts` once #13 lands).
- Chart capture for the PDF used html2canvas, which clones the whole document and blocks the
  main thread for ~9s **per chart** — a 28-second frozen tab for one report, and its own
  per-chart timeout could not fire because timers do not run on a blocked thread. PR #13
  replaces it with SVG serialisation (`lib/chartCapture.ts`, ~25ms). Related: jsPDF stores a
  PNG as an uncompressed bitmap unless the whole document is deflated, so captures are JPEG.
- `src/lib/pdfGeneratorEnhanced.ts` and the finance report both cap work by dataset size;
  the PDF button is behind a paid-subscription check with 7s + 12s request timeouts.
- Power BI's New Table box reads **everything before the first `=` as the table name**, so a
  comment header above the assignment becomes part of the name. Name first, comments after.
- `IFERROR` cannot catch a *binding* error, only a runtime one, so one compile-error case
  takes a whole `UNION` table down and no case in the sheet answers.
- Never write a NUL separator into a `.ts` source file for composite map keys — the file then
  reads as binary. Use nested maps.

## Where things stand (2026-11-02, evening)

The engine roadmap (PRs #1–#11) and an audit of everything around it (#15–#19) are
merged and deployed:

- #15 Ask Data follows the data (model derived from `datasets`).
- #16 charts: type picker, active dataset first, engine-consistent values, a
  description under every chart.
- #17/#18 relationship diagram draws the engine's links; chart joins no longer fan
  out; Fact/Dimension badge drawn in SVG.
- #19 analysis panels: blanks are missing not zero, business measures need a
  matching column, Time Series averages what does not add up, Advanced Stats picks
  meaningful columns, profile counts match the engine.

~1145 frontend tests and 66 backend tests. Open: #12 (`deliberate-gaps` — header
handling, dataset delete, a jest open handle) and #13 (`pdf-chart-capture`, stacked on
#12 — chart capture without html2canvas). Check `gh pr list` rather than trusting
this paragraph.

Not yet audited: PDF export (paid), the Finance and ML Engine pages, the backend.

Phase 5's server-side compute half is **decided but not built** —
`docs/server-side-compute-decision.md`: keep *one* DAX implementation, run this engine
server-side over Postgres rows, push only row selection and column projection to SQL, never a
value decision. DAX→SQL was rejected because it is a second implementation of ~90
Power BI-verified answers that would have to agree with the first forever. Next steps in that
document, in order: share the engine as one source (it is TypeScript compiled into the
frontend bundle; the backend is plain CommonJS with no build step), then `/api/v1/analytics`,
then a cross-boundary parity test, then pushdown.
