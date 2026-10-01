# Where a DAX query gets evaluated

**Status:** decided, 2026-10-01. Phase 5 of the engine roadmap.

**Decision:** keep **one** DAX implementation. Run the existing engine
server-side over rows loaded from Postgres, and push to SQL only the work
whose equivalence is obvious — row filtering, column projection, counts.
Do **not** translate DAX to SQL.

---

## What Phase 5 was for

> Server-side compute — `/api/v1/analytics` plus dataset persistence, to lift
> the browser-memory ceiling.

The persistence half is built and verified against the production Supabase.
This document settles the half that was left open: once a dataset lives on
the server, **where does a query run**?

## The ceiling, measured

Numbers from this repo's engine on the project's Node build, one table, five
columns, generated rows. Not estimates.

| rows | JSON size | build model | `SUM` | group by | two filters |
|---:|---:|---:|---:|---:|---:|
| 10,000 | 0.9 MB | 190 ms | 46 ms | 72 ms | 43 ms |
| 100,000 | 9.5 MB | 914 ms | 119 ms | 504 ms | 404 ms |
| 500,000 | — | **crash** | — | — | — |

Roughly linear in rows, so a million rows is about nine seconds to build the
model and half a second to five seconds per query — in the browser, on the
same thread as the UI.

The crash is not a memory limit. `Math.min(...values)` passes every element as
a separate argument, and the argument stack runs out between **125,000 and
150,000** elements, throwing `RangeError: Maximum call stack size exceeded`
out of column statistics, anomaly fixes, the time series engine and the ML
engine's feature scaling. Fixed in the same change as this document, because
a ceiling that is a hard crash at 130,000 rows is not an architecture problem
and should not have waited for one.

So the real position today: comfortable to about 100,000 rows, degrading
after that, and previously **failing outright** past ~130,000.

## The options

### A. Translate DAX to SQL

Compile the AST to SQL and let Postgres execute it.

Rejected. Not because it is hard, though it is — `CALCULATE`, row context and
context transition do not map onto SQL in a way that preserves them — but
because of what it would cost in the one thing this project has that is worth
protecting.

This engine's credibility rests on **Power BI parity sheets**: 90 external
answers across five sheets, each case chosen because the reading was a
judgement call. `SAMEPERIODLASTYEAR` maps 29 Feb to 28 Feb. `DATEADD` clamps
31 Mar to 29 Feb. `TOPN(5)` returns 6 on a tie. `DISTINCTCOUNT` counts blank
as a value. An empty CSV text field becomes BLANK here, deliberately, and that
divergence is pinned.

A SQL translation is a **second implementation of all of it**, which would
have to agree with the first forever. Any gap means the same question returns
different numbers depending on how big the dataset is — the worst possible
failure for a product whose entire pitch is that the numbers can be trusted.
And the disagreement would appear exactly where it is hardest to notice:
large datasets, where nobody can check the answer by hand.

### B. The same engine, server-side

Load rows from Postgres into the existing evaluator in a Node process.

- **One** semantics. The parity sheets keep their meaning without being
  re-run.
- Lifts the ceiling that actually bites: a browser tab shares memory with the
  UI and blocks it while computing; a server process has more room and no UI
  to freeze.
- Still bounded by RAM. Does not reach tens of millions of rows.

### C. B, plus pushdown where it is provably equivalent

Push to SQL only the operations whose SQL meaning is unarguable:

- `WHERE` for a simple equality or range filter on a stored column
- selecting only the columns a query mentions
- `COUNT`

then evaluate the DAX in memory over what comes back. A filtered question on
a large table loads thousands of rows instead of millions, and the DAX
semantics never leave the one implementation that was verified.

Anything subtle — anything involving filter context, time intelligence,
ranking, or a blank — stays in the engine. The rule is that pushdown must be
a **row-selection** decision, never a **value** decision.

## Decided

**C, arrived at by shipping B first.** B is the correctness-preserving step
and is useful on its own; C is an optimisation on top of it that can be added
one predicate at a time, each with a test that the pushed and unpushed paths
return the same answer.

## What that requires, in order

1. **Share the engine.** `src/lib/dax`, `src/lib/semantic` and `src/lib/nlq`
   are TypeScript compiled into the frontend bundle; the backend is plain
   CommonJS with no build step. The engine needs to be built to CJS and
   imported by the backend — *the same source*, not a copy. A copy would
   reintroduce the two-implementations problem that option A was rejected for,
   with none of A's benefits.
2. **`/api/v1/analytics`.** Takes a dataset id and a DAX expression, loads the
   rows, evaluates, returns the result in the v1 envelope. Owner-scoped like
   every dataset route.
3. **A parity test across the boundary.** The same expression against the same
   data, in the browser engine and through the endpoint, asserted equal. This
   is the test that makes the one-implementation claim checkable rather than
   aspirational.
4. **Then** pushdown, predicate by predicate.

## What to do before any of it

Nothing in Phase 5 is visible to a user until the frontend stores and reloads
datasets. Today a refresh loses the upload. Persistence is built, tested and
unused: wiring it up is a smaller job than server-side compute and is the one
a pilot user would notice.

Compute is the right next *architectural* step. Reload is the right next
*product* step.
