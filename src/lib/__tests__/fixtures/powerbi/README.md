# Checking this engine against Power BI

## What this is for

Everything else in this test suite is checked against *my* reading of DAX.
The invariant harness (`daxInvariants.test.ts`) closed the mechanical half of
that — filter arguments commute, totals equal the sum of their parts, `ALL`
really removes everything. But no property test can catch a reading that is
wrong *consistently*. If `SAMEPERIODLASTYEAR` is off by a day in the same
direction everywhere, every law still holds and every oracle agrees, because
they are all computed from the same misunderstanding.

The only fix is a second opinion from the thing we are imitating.

So: 23 expressions, each chosen because my answer is a **judgement call**
rather than a derivation, and each written so that different readings give
**different numbers**. Leap days, month-end clamping, fiscal year ends, how
blanks compare. You read the numbers off Power BI; the test suite diffs them
against mine automatically.

## Time required

About 25 minutes, all mechanical. You never have to decide anything — just
read numbers off a screen.

## What you need

Power BI Desktop. It is free, and it runs on Windows — which you are on.
Nothing else.

---

## Step 1 — load the data

1. Open Power BI Desktop → **Get data** → **Text/CSV**
2. Choose `sales.csv` from this folder
3. **Load**

Then check the import, because everything below depends on it:

- In the **Data** view, `Date` must be a **Date** column, not text. If it is
  text, change the type — and if it offers a locale, pick one that reads
  `2023-01-31` as **31 January 2023**.
- `Amount` must be a **Whole number** or **Decimal number**.
- Row `O16` must have an **empty** Amount, not a zero.
- Row `O15` must have an **empty** Region, not the word "null".

The table must be named **`Sales`**.

## Step 2 — add a date table

Time intelligence needs a proper calendar. **Modeling** → **New table**, then
paste exactly this:

```
Date = CALENDAR(DATE(2023, 1, 1), DATE(2024, 12, 31))
```

Then:

1. Select the new `Date` table → **Table tools** → **Mark as date table**,
   with `Date` as the date column.
2. In **Model** view, drag `Sales[Date]` onto `Date[Date]` to create the
   relationship. It should come out **many-to-one**, single direction, with
   `Date` on the one side.

The table must be named **`Date`** — the expressions reference `'Date'[Date]`.

## Step 3 — read off the numbers

Open `expected.ts` in this folder. Each entry has a `dax:` field.

For each one:

1. **Modeling** → **New measure**
2. Paste the expression, prefixed with a name — e.g. for `setup-total`:
   ```
   setup_total = SUM(Sales[Amount])
   ```
3. Drop the measure onto a **Card** visual on a blank page
4. Write what the card shows into that entry's `expected:` field

Every expression carries its own filter inside `CALCULATE`, so **you never
need a slicer, and nothing else may be filtering the page**. A blank card on
a blank page is the whole setup. If you add a slicer or a filter, the numbers
will be wrong and the comparison is worthless.

### Writing the answers

| What the card shows | Write |
|---|---|
| A number | the number, unquoted: `7600` |
| A number with separators | digits only: `447.0588` not `"447.06"` |
| Nothing at all (empty card) | `'BLANK'` |
| An error, or "Infinity" | `'ERROR'` or `'Infinity'` — as a quoted string |
| `YES` / `NO` from an IF | `'YES'` / `'NO'` |

Do not round. If the card shows `447.06`, widen the card or increase decimal
places until you can see more digits — the comparison allows a small
tolerance, but a value rounded to 2 places on a large number can disagree.

If something behaves oddly, put a line in the `note:` field. Those are as
useful to me as the numbers.

### Partial is fine

The test skips any entry still set to `null` and runs the ones that are
filled in. **Ten answers is worth having.** You do not have to finish the
sheet, and you can stop and come back.

## Step 4 — hand it back

Save `expected.ts` and tell me. I will run:

```bash
npx vitest run src/lib/__tests__/powerbiParity.test.ts
```

Any disagreement shows the expression, Power BI's answer, and mine, side by
side. Then we work out which of us is right — it will not automatically be
Power BI, but where we differ, Power BI is the one your users expect.

---

## The cross-table sheet (`crosstable-script.dax`)

Added 2026-10-01. Every other sheet here asks **one** table a question. This
one asks two, because "total Revenue by Country" — where Revenue is in
`Orders` and Country is in `Customers` — was refused by the product until
that date and is now answered.

It needs a different setup from the rest:

1. **Get data → Text/CSV** → `orders.csv` → **Load**
2. **Get data → Text/CSV** → `customers.csv` → **Load**
3. **Model** view. Power BI usually detects the join on its own. If it has
   not, drag `Orders[CustomerID]` onto `Customers[CustomerID]`. Check the
   relationship reads **Many to one (\*:1)** with **Single** cross-filter
   direction — not Both. Several cases on the sheet are about exactly that
   setting, and Both changes half the answers.
4. **Modeling → New table**, paste `crosstable-script.dax`, put `Case` and
   `Answer` into a Table visual.

**Read row 01 first.** `canary-the-join-exists` returns **1200** when the
relationship is there and **2100** when it is not — and 2100 looks every bit
as much like an answer, so a missing join produces a full sheet of
plausible, worthless numbers.

The case that matters most is
`grouping-the-wrong-way-round-gives-every-group-the-same-figure`. It should
return the **same figure three times** (`P1=3500>P2=3500>P3=3500`). That is
not a bug — it is the evidence that questions asked in that direction are
meaningless, which is why the product refuses them. If Power BI returns three
*different* figures there, it follows the join in a direction this engine does
not, and the refusal is wrong rather than protective. That one row is worth
more than the rest of the sheet.

Fill the answers into `crosstable-expected.ts` and run:

```bash
npx vitest run src/lib/__tests__/crossTableParity.test.ts
```

Until then that test reports `0 of 11 answered`, and the cross-table grouping
in the product is verified by hand-computation only — **not** against Power
BI.

---

## If you would rather use your own measures

Same idea, less setup for you and more for me. Send:

1. **The data** — a CSV export of the table(s) the measure runs over. It can
   be a small slice; it just has to be the exact rows the number came from.
2. **The measure text**, copied verbatim out of Power BI.
3. **The number**, and **what was filtering it** when you read it — which
   slicers were set, and to what. This is the part that is usually missing,
   and without it the number cannot be checked against anything.

Three or four measures is plenty, and the time-intelligence ones are worth
far more than the aggregations — I am not going to get `SUM` wrong.

## What this still will not cover

Anything neither of us thought to probe. The sheet targets the places I know
I made a judgement call; it cannot cover the places where I did not realise
there was a call to make. That gap closes slowly, by running real measures
through the engine and noticing when a number looks wrong.
