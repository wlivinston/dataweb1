import { describe, it, expect } from 'vitest';
import { makeDataset } from './fixtures';
import { buildSemanticModel } from '../semantic/model';
import { runDax, runDaxTable, DEFAULT_ROW_LIMIT } from '../dax/run';
import type { SemanticModel } from '../semantic/types';

/**
 * Tables reaching the outside of the engine.
 *
 * Every verified answer so far has been a scalar, including all 59 from
 * Power BI. A table has failure modes none of them touch: what the columns
 * are called, which of them came from the model, how many rows come back and
 * whether anyone is told some were left behind.
 */

const sales = (): SemanticModel =>
  buildSemanticModel([
    makeDataset(
      [
        { Region: 'North', Amount: 10 },
        { Region: 'South', Amount: 20 },
        { Region: 'North', Amount: 30 },
        { Region: null, Amount: 40 },
      ],
      [
        { name: 'Region', type: 'string' },
        { name: 'Amount', type: 'number' },
      ],
      { id: 'ds-sales', name: 'Sales' }
    ),
  ]);

const table = (dax: string, options = {}, model = sales()) => {
  const result = runDaxTable(dax, model, options);
  if (!result.ok) throw new Error(`${dax}\n  refused: ${result.message}`);
  return result;
};

const GROUPED =
  'ADDCOLUMNS(VALUES(Sales[Region]), "Total", CALCULATE(SUM(Sales[Amount])))';

// ============================================================
// The two entry points are mirrors
// ============================================================

describe('runDax and runDaxTable refuse each other\'s shapes', () => {
  it('runDax refuses a table, pointing at the aggregation', () => {
    const result = runDax(GROUPED, sales());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/returns a table/);
  });

  it('runDaxTable refuses a scalar, pointing at grouping', () => {
    const result = runDaxTable('SUM(Sales[Amount])', sales());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/single value rather than a table/);
  });

  it('reports a bad formula identically through either entry point', () => {
    const scalar = runDax('SUM(Sales[Nope])', sales());
    const asTable = runDaxTable('SUM(Sales[Nope])', sales());
    expect(scalar.ok).toBe(false);
    expect(asTable.ok).toBe(false);
    if (!scalar.ok && !asTable.ok) expect(asTable.message).toBe(scalar.message);
  });
});

// ============================================================
// A grouped table
// ============================================================

describe('a grouped table', () => {
  it('names its columns after the grouping column and the added one', () => {
    expect(table(GROUPED).columns.map(column => column.name)).toEqual(['Region', 'Total']);
  });

  it('keeps the lineage of the grouping column, and none for the computed one', () => {
    // A renderer needs this to tell a label apart from a figure, and an
    // export needs it to say where a value came from.
    const [region, total] = table(GROUPED).columns;
    expect(region.origin).toEqual({ table: 'Sales', column: 'Region' });
    expect(total.origin).toBeUndefined();
  });

  it('returns one row per group, with the group value beside its figure', () => {
    const result = table(GROUPED);
    expect(result.rows).toEqual([
      ['North', 40],
      ['South', 20],
      [null, 40],
    ]);
  });

  it('keeps a blank group as a blank rather than dropping or renaming it', () => {
    // Power BI counts blank as a group; a renderer can label it, but only
    // if the engine hands it over intact.
    const result = table(GROUPED);
    const blank = result.rows.find(row => row[0] === null);
    expect(blank).toBeDefined();
    expect(blank![1]).toBe(40);
  });
});

// ============================================================
// A table of model rows
// ============================================================

describe('a table of model rows', () => {
  it('materialises every column of the table, all with lineage', () => {
    const result = table('FILTER(Sales, Sales[Amount] > 15)');
    expect(result.columns.map(column => column.name)).toEqual(['Region', 'Amount']);
    for (const column of result.columns) {
      expect(column.origin, column.name).toBeDefined();
    }
  });

  it('returns the rows that survived the filter, with their real values', () => {
    const result = table('FILTER(Sales, Sales[Amount] > 15)');
    expect(result.rows).toEqual([
      ['South', 20],
      ['North', 30],
      [null, 40],
    ]);
  });
});

// ============================================================
// Not lying about how much there was
// ============================================================

describe('capping the rows', () => {
  it('reports the full count even when it returns fewer', () => {
    const result = table('Sales', { limit: 2 });
    expect(result.rows).toHaveLength(2);
    expect(result.totalRows).toBe(4);
    expect(result.truncated).toBe(true);
  });

  it('is not truncated when everything fits', () => {
    const result = table('Sales', { limit: 10 });
    expect(result.rows).toHaveLength(4);
    expect(result.totalRows).toBe(4);
    expect(result.truncated).toBe(false);
  });

  it('caps by default rather than handing over an unbounded table', () => {
    // A grouping over a high-cardinality column can be as long as the table.
    // Rendering all of it is a hang, not an answer.
    expect(DEFAULT_ROW_LIMIT).toBeGreaterThan(0);
    const rows = Array.from({ length: DEFAULT_ROW_LIMIT + 50 }, (_, index) => ({
      Id: `k${index}`,
      Amount: index,
    }));
    const model = buildSemanticModel([
      makeDataset(
        rows,
        [
          { name: 'Id', type: 'string' },
          { name: 'Amount', type: 'number' },
        ],
        { id: 'ds-big', name: 'Big' }
      ),
    ]);
    const result = table('VALUES(Big[Id])', {}, model);
    expect(result.rows).toHaveLength(DEFAULT_ROW_LIMIT);
    expect(result.totalRows).toBe(DEFAULT_ROW_LIMIT + 50);
    expect(result.truncated).toBe(true);
  });

  it('an empty table is empty rather than truncated', () => {
    const result = table('FILTER(Sales, Sales[Amount] > 1000)');
    expect(result.rows).toEqual([]);
    expect(result.totalRows).toBe(0);
    expect(result.truncated).toBe(false);
  });
});

// ============================================================
// Ranking, which is what "top 5 by revenue" needs
// ============================================================

describe('ranking a grouped table', () => {
  it('returns the largest group first', () => {
    const result = table(`TOPN(1, ${GROUPED}, [Total], DESC)`);
    expect(result.rows).toHaveLength(2); // North and the blank group tie at 40
    expect(result.rows.every(row => row[1] === 40)).toBe(true);
  });

  it('keeps every row tied with the last one included, as DAX does', () => {
    // Power BI confirmed TOPN(5) returns 6 rows on a tie. Asking for one of
    // two groups that both total 40 has to return both.
    const result = table(`TOPN(1, ${GROUPED}, [Total], DESC)`);
    expect(result.totalRows).toBe(2);
  });

  it('ranks the other way round on ASC', () => {
    const result = table(`TOPN(1, ${GROUPED}, [Total], ASC)`);
    expect(result.rows).toEqual([['South', 20]]);
  });

  it('returns everything when asked for more than there is', () => {
    expect(table(`TOPN(99, ${GROUPED}, [Total], DESC)`).rows).toHaveLength(3);
  });

  it('returns nothing when asked for none', () => {
    expect(table(`TOPN(0, ${GROUPED}, [Total], DESC)`).rows).toEqual([]);
  });
});
