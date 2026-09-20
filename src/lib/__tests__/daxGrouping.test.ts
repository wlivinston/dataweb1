import { describe, it, expect } from 'vitest';
import { makeDataset } from './fixtures';
import { buildSemanticModel } from '../semantic/model';
import { runDax } from '../dax/run';
import type { SemanticModel } from '../semantic/types';

/**
 * Grouping: VALUES of a single column, and ADDCOLUMNS over it.
 *
 * These are the first functions that produce a table whose columns belong to
 * no model table, which is what the DaxDerivedTable representation was added
 * for. The interesting behaviour is not the shape but the context
 * transition: a derived row has no row of Sales to pin, so each column that
 * still knows its origin narrows that column instead.
 *
 * Not yet checked against Power BI. Every external answer so far has been a
 * scalar, and the numbers here are argued from the fixture rather than
 * confirmed from outside - which is the position the DAX engine was in
 * before the parity sheet found two bugs in it.
 */

const sales = (): SemanticModel =>
  buildSemanticModel([
    makeDataset(
      [
        { Region: 'North', Channel: 'Web', Amount: 10 },
        { Region: 'South', Channel: 'Web', Amount: 20 },
        { Region: 'North', Channel: 'Shop', Amount: 30 },
        { Region: 'South', Channel: 'Shop', Amount: null },
      ],
      [
        { name: 'Region', type: 'string' },
        { name: 'Channel', type: 'string' },
        { name: 'Amount', type: 'number' },
      ],
      { id: 'ds-sales', name: 'Sales' }
    ),
  ]);

const value = (dax: string, model = sales()) => {
  const result = runDax(dax, model);
  if (!result.ok) throw new Error(`${dax}\n  refused: ${result.message}`);
  return result.value;
};

const refusal = (dax: string, model = sales()) => {
  const result = runDax(dax, model);
  if (result.ok) throw new Error(`${dax}\n  unexpectedly answered ${result.value}`);
  return result.message;
};

// ============================================================
// VALUES of one column
// ============================================================

describe('VALUES over a single column', () => {
  it('returns one row per distinct value, not one per source row', () => {
    // Four rows, two regions.
    expect(value('COUNTROWS(VALUES(Sales[Region]))')).toBe(2);
    expect(value('COUNTROWS(Sales)')).toBe(4);
  });

  it('yields the values themselves, readable as the origin column', () => {
    expect(value('CONCATENATEX(VALUES(Sales[Region]), Sales[Region], ", ")')).toBe(
      'North, South'
    );
  });

  it('counts a blank as a value, as DISTINCTCOUNT does', () => {
    const model = buildSemanticModel([
      makeDataset(
        [{ Tag: 'a' }, { Tag: null }, { Tag: 'a' }],
        [{ name: 'Tag', type: 'string' }],
        { id: 'ds-t', name: 'Tags' }
      ),
    ]);
    // Power BI confirmed DISTINCTCOUNT counts BLANK as a value; VALUES has
    // to agree with it or the two disagree about the same question.
    expect(value('COUNTROWS(VALUES(Tags[Tag]))', model)).toBe(2);
    expect(value('DISTINCTCOUNT(Tags[Tag])', model)).toBe(2);
  });

  it('treats values that differ only in case as one, as a filter does', () => {
    const model = buildSemanticModel([
      makeDataset(
        [{ City: 'Accra' }, { City: 'ACCRA' }, { City: 'Kumasi' }],
        [{ name: 'City', type: 'string' }],
        { id: 'ds-c', name: 'Places' }
      ),
    ]);
    // DAX is not case-sensitive, so grouping by City must produce the same
    // number of groups a filter on City would distinguish.
    expect(value('COUNTROWS(VALUES(Places[City]))', model)).toBe(2);
  });

  it('respects the surrounding filter context', () => {
    expect(
      value('CALCULATE(COUNTROWS(VALUES(Sales[Region])), Sales[Channel] = "Web")')
    ).toBe(2);
    expect(
      value('CALCULATE(COUNTROWS(VALUES(Sales[Region])), Sales[Region] = "North")')
    ).toBe(1);
  });
});

// ============================================================
// The point of the exercise: a figure per group
// ============================================================

describe('context transition over a derived row', () => {
  it('gives each group its own total, not the grand total', () => {
    // North is 10 + 30, South is 20 + blank. If the transition failed, every
    // group would see 60 and the sum would be 120 - the same failure
    // context transition was introduced to stop for SUMX.
    expect(value('SUMX(VALUES(Sales[Region]), CALCULATE(SUM(Sales[Amount])))')).toBe(60);
    expect(value('MAXX(VALUES(Sales[Region]), CALCULATE(SUM(Sales[Amount])))')).toBe(40);
    expect(value('MINX(VALUES(Sales[Region]), CALCULATE(SUM(Sales[Amount])))')).toBe(20);
  });

  it('excludes blanks inside each group, as the aggregation does everywhere', () => {
    // South has one amount and one blank, so its average is 20, not 10.
    expect(value('MINX(VALUES(Sales[Region]), CALCULATE(AVERAGE(Sales[Amount])))')).toBe(20);
  });

  it('groups by the column asked for, not whichever was handiest', () => {
    // By channel: Web is 10 + 20, Shop is 30 + blank.
    expect(value('MAXX(VALUES(Sales[Channel]), CALCULATE(SUM(Sales[Amount])))')).toBe(30);
  });

  it('still sums to the whole when every group is included', () => {
    const whole = value('SUM(Sales[Amount])');
    for (const column of ['Region', 'Channel']) {
      expect(
        value(`SUMX(VALUES(Sales[${column}]), CALCULATE(SUM(Sales[Amount])))`),
        column
      ).toBe(whole);
    }
  });
});

// ============================================================
// ADDCOLUMNS
// ============================================================

describe('ADDCOLUMNS', () => {
  const grouped =
    'ADDCOLUMNS(VALUES(Sales[Region]), "Total", CALCULATE(SUM(Sales[Amount])))';

  it('keeps one row per row of the table it was given', () => {
    expect(value(`COUNTROWS(${grouped})`)).toBe(2);
  });

  it('makes the added column readable by name', () => {
    expect(value(`SUMX(${grouped}, [Total])`)).toBe(60);
    expect(value(`MAXX(${grouped}, [Total])`)).toBe(40);
  });

  it('keeps the original columns alongside the added one', () => {
    expect(value(`CONCATENATEX(${grouped}, Sales[Region], ", ")`)).toBe('North, South');
  });

  it('adds more than one column at a time', () => {
    const two =
      'ADDCOLUMNS(VALUES(Sales[Region]), "Total", CALCULATE(SUM(Sales[Amount])), ' +
      '"Rows", CALCULATE(COUNTROWS(Sales)))';
    expect(value(`SUMX(${two}, [Total])`)).toBe(60);
    expect(value(`SUMX(${two}, [Rows])`)).toBe(4);
  });

  it('refuses a name the table already has', () => {
    expect(
      refusal('COUNTROWS(ADDCOLUMNS(VALUES(Sales[Region]), "Region", 1))')
    ).toMatch(/already has a column called "Region"/);
  });

  it('refuses a name without an expression, on arity', () => {
    // Caught by the signature check before evaluation, which is the right
    // place for it - the message names the function and the shortfall.
    expect(
      refusal('COUNTROWS(ADDCOLUMNS(VALUES(Sales[Region]), "Total"))')
    ).toMatch(/ADDCOLUMNS needs at least 3 arguments/);
  });

  it('refuses a trailing name that no expression pairs with', () => {
    // Four arguments clears the arity check but still does not pair up, so
    // this is the handler's own check rather than the signature's.
    expect(
      refusal('COUNTROWS(ADDCOLUMNS(VALUES(Sales[Region]), "A", 1, "B"))')
    ).toMatch(/does not pair up/);
  });

  it('refuses an added column that is itself a table', () => {
    expect(
      refusal('COUNTROWS(ADDCOLUMNS(VALUES(Sales[Region]), "Oops", ALL(Sales)))')
    ).toMatch(/single value/);
  });
});

// ============================================================
// Where a derived table is refused, and why
// ============================================================

describe('what a computed table cannot do yet', () => {
  it('cannot be used as a CALCULATE filter', () => {
    // This needs data lineage to be honoured on the filter path. The
    // lineage is recorded, but acting on it is separate work, and a filter
    // that silently narrowed nothing would be worse than a refusal.
    const message = refusal(
      'CALCULATE(SUM(Sales[Amount]), ADDCOLUMNS(VALUES(Sales[Region]), "X", 1))'
    );
    expect(message).toMatch(/cannot be used as a filter yet/);
  });

  it('cannot be narrowed by FILTER', () => {
    expect(
      refusal('COUNTROWS(FILTER(VALUES(Sales[Region]), Sales[Region] = "North"))')
    ).toMatch(/needs a table of rows from the model/);
  });

  it('says which functions build one, so the message is actionable', () => {
    const message = refusal('COUNTROWS(FILTER(VALUES(Sales[Region]), 1 = 1))');
    expect(message).toContain('ADDCOLUMNS');
    expect(message).toContain('VALUES of a single column');
  });
});

// ============================================================
// The validator has to agree with the evaluator
// ============================================================

describe('validating a name that ADDCOLUMNS brings into existence', () => {
  it('accepts [Total] when ADDCOLUMNS introduces it', () => {
    expect(
      value('SUMX(ADDCOLUMNS(VALUES(Sales[Region]), "Total", 1), [Total])')
    ).toBe(2);
  });

  it('still refuses a measure name nothing introduces', () => {
    expect(refusal('SUMX(VALUES(Sales[Region]), [Nonexistent])')).toMatch(
      /no measure called \[Nonexistent\]/
    );
  });

  it('still refuses a bare column reference written as a measure', () => {
    // [Amount] when Sales[Amount] was meant - the commonest mistake, and
    // the introduced-names pass must not start swallowing it.
    expect(refusal('SUMX(VALUES(Sales[Region]), [Amount])')).toMatch(
      /no measure called \[Amount\]/
    );
  });
});
