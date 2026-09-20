import { describe, it, expect } from 'vitest';
import { makeDataset } from './fixtures';
import { buildSemanticModel } from '../semantic/model';
import { runDax } from '../dax/run';
import { answerQuestion, suggestQuestions } from '../nlq';
import { loadOrders } from './fixtures/powerbi/load';
import type { SemanticModel } from '../semantic/types';
import type { Dataset } from '../types';

/**
 * Questions answered through the DAX engine.
 *
 * The arithmetic is not tested here, because none happens here - every
 * answer comes from an engine already checked against Power BI. What is
 * tested is the reading: whether "average revenue" becomes
 * AVERAGE(Orders[Revenue]) rather than something else, and whether a
 * question that cannot be read is refused rather than guessed at.
 */

const ordersModel = (): SemanticModel => buildSemanticModel([loadOrders()]);

const withBlank = (): Dataset =>
  makeDataset(
    [{ Amount: 10 }, { Amount: 20 }, { Amount: null }, { Amount: 30 }],
    [{ name: 'Amount', type: 'number' }],
    { id: 'ds-blank', name: 'Sales' }
  );

/** A single-figure answer, failing loudly on a refusal or a table. */
const answered = (question: string, model: SemanticModel) => {
  const result = answerQuestion(question, model);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  if (result.shape !== 'scalar') {
    throw new Error(`expected one figure, got a table of ${result.rows.length} rows`);
  }
  return result;
};

/** A table answer. */
const grouped = (question: string, model: SemanticModel) => {
  const result = answerQuestion(question, model);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  if (result.shape !== 'table') throw new Error(`expected a table, got ${result.formatted}`);
  return result;
};

const refused = (question: string, model: SemanticModel) => {
  const result = answerQuestion(question, model);
  if (result.ok) {
    throw new Error(
      `answered via ${result.dax}: ${result.shape === 'scalar' ? result.formatted : `${result.rows.length} rows`}`
    );
  }
  return result;
};

// ============================================================
// The bug this replaces
// ============================================================

describe('the blank that broke the old engine', () => {
  it('excludes blanks from an average, as DAX does', () => {
    // The old engine read Number(null) as 0, kept it past an isNaN filter,
    // and divided 60 by 4 to get 15. The truth is 60 / 3.
    const model = buildSemanticModel([withBlank()]);
    const result = answered('what is the average Amount', model);
    expect(result.value).toBe(20);
    expect(result.dax).toBe('AVERAGE(Sales[Amount])');
  });

  it('says out loud that it left the blank out', () => {
    const model = buildSemanticModel([withBlank()]);
    const result = answered('average Amount', model);
    expect(result.interpretation).toContain('1 blank row is left out');
  });

  it('still agrees with the engine on a sum, where blanks do not matter', () => {
    const model = buildSemanticModel([withBlank()]);
    expect(answered('total Amount', model).value).toBe(60);
  });

  it('carries no confidence score at all', () => {
    // The old engine reported 0.95 on every answer, including the wrong
    // ones. A constant measures nothing.
    const model = buildSemanticModel([withBlank()]);
    expect(answered('total Amount', model)).not.toHaveProperty('confidence');
  });
});

// ============================================================
// Every answer is the engine's answer
// ============================================================

describe('answers come from the DAX engine, not from here', () => {
  const questions = [
    'what is the total Revenue',
    'average Revenue',
    'what is the highest Cost',
    'lowest Quantity',
    'how many rows are there',
    'how many different CustomerID',
  ];

  for (const question of questions) {
    it(`"${question}" matches running its own DAX directly`, () => {
      const model = ordersModel();
      const result = answered(question, model);
      const direct = runDax(result.dax, model);
      expect(direct.ok).toBe(true);
      if (direct.ok) expect(result.value).toBe(direct.value);
    });
  }

  it('reports the exact text it ran, so the answer can be checked', () => {
    const result = answered('total Revenue', ordersModel());
    expect(result.dax).toBe('SUM(Orders[Revenue])');
    expect(result.value).toBe(2100);
  });
});

// ============================================================
// Reading the question
// ============================================================

describe('reading the question', () => {
  it('reads a total', () => {
    expect(answered('what is the total Cost', ordersModel()).dax).toBe('SUM(Orders[Cost])');
  });

  it('reads an average under several names', () => {
    const model = ordersModel();
    for (const phrasing of ['average Revenue', 'mean Revenue', 'avg Revenue']) {
      expect(answered(phrasing, model).dax, phrasing).toBe('AVERAGE(Orders[Revenue])');
    }
  });

  it('reads smallest and largest', () => {
    const model = ordersModel();
    expect(answered('lowest Cost', model).dax).toBe('MIN(Orders[Cost])');
    expect(answered('highest Cost', model).dax).toBe('MAX(Orders[Cost])');
  });

  it('prefers the longer phrase, so "how many distinct" is not "how many"', () => {
    const model = ordersModel();
    // Both land on DISTINCTCOUNT here, but via different phrases - the test
    // is that the longer one is consumed, leaving "CustomerID" as the
    // subject rather than "distinct CustomerID".
    expect(answered('how many distinct CustomerID', model).dax).toBe(
      'DISTINCTCOUNT(Orders[CustomerID])'
    );
  });

  it('does not find "count" inside another word', () => {
    // "counterparty" contains "count". Matching it would read this as a
    // count of something unnamed.
    const dataset = makeDataset(
      [{ Counterparty: 'A', Amount: 1 }],
      [
        { name: 'Counterparty', type: 'string' },
        { name: 'Amount', type: 'number' },
      ],
      { id: 'ds-c', name: 'Trades' }
    );
    const result = answerQuestion('total Counterparty', buildSemanticModel([dataset]));
    // Refused because Counterparty is text - not because it was read as a count.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('does not hold numbers');
  });

  it('counts entities rather than rows when a column identifies one', () => {
    // Customers has one row per customer, so CustomerID is a genuine key
    // and "how many customers" has exactly one honest answer.
    const dataset = makeDataset(
      [
        { CustomerID: 'C1', Region: 'North' },
        { CustomerID: 'C2', Region: 'South' },
        { CustomerID: 'C3', Region: 'North' },
      ],
      [
        { name: 'CustomerID', type: 'string' },
        { name: 'Region', type: 'string' },
      ],
      { id: 'ds-cust', name: 'Customers' }
    );
    const result = answered('how many customers', buildSemanticModel([dataset]));
    expect(result.dax).toBe('DISTINCTCOUNT(Customers[CustomerID])');
    expect(result.value).toBe(3);
    expect(result.interpretation).toContain('counts each one once');
  });

  it('refuses "how many orders" when nothing identifies one order', () => {
    // O1 is on two rows, so OrderID is not a key. COUNTROWS says 6 and
    // counting distinct orders says 5 - two honest readings with different
    // answers. Picking one silently is how a figure ends up off by one
    // forever, so the question goes back to the asker.
    const result = refused('how many orders', ordersModel());
    expect(result.reason).toContain('No column identifies one row of Orders');
    expect(result.reason).toContain('how many rows in Orders');
  });

  it('counts rows when the question says rows', () => {
    const result = answered('how many rows are there', ordersModel());
    expect(result.dax).toBe('COUNTROWS(Orders)');
    expect(result.value).toBe(6);
  });
});

// ============================================================
// Refusing
// ============================================================

describe('refusing, with a reason', () => {
  it('refuses a question with no aggregation in it', () => {
    const result = refused('tell me about revenue', ordersModel());
    expect(result.reason).toContain('could not tell what to work out');
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('refuses a column that does not exist, naming what was asked for', () => {
    const result = refused('total Profit', ordersModel());
    expect(result.reason).toContain('"profit"');
  });

  it('refuses an ambiguous column rather than picking one', () => {
    // CustomerID lives in both tables. The old engine took the first.
    const orders = makeDataset(
      [{ CustomerID: 'C1', Amount: 5 }],
      [
        { name: 'CustomerID', type: 'string' },
        { name: 'Amount', type: 'number' },
      ],
      { id: 'ds-o', name: 'Orders' }
    );
    const customers = makeDataset(
      [{ CustomerID: 'C1', Region: 'North' }],
      [
        { name: 'CustomerID', type: 'string' },
        { name: 'Region', type: 'string' },
      ],
      { id: 'ds-c', name: 'Customers' }
    );
    const result = refused(
      'how many different CustomerID',
      buildSemanticModel([orders, customers])
    );
    expect(result.reason).toContain('could mean');
    expect(result.reason).toContain('Orders[CustomerID]');
    expect(result.reason).toContain('Customers[CustomerID]');
  });

  it('refuses to sum text, and says why the column is not summable', () => {
    const result = refused('total ProductID', ordersModel());
    expect(result.reason).toContain('does not hold numbers');
  });

  it('refuses to sum an identifier even when it is numeric', () => {
    // Summing invoice numbers produces a figure with no meaning.
    const dataset = makeDataset(
      [
        { InvoiceNo: 1001, Amount: 5 },
        { InvoiceNo: 1002, Amount: 6 },
      ],
      [
        { name: 'InvoiceNo', type: 'number' },
        { name: 'Amount', type: 'number' },
      ],
      { id: 'ds-i', name: 'Invoices' }
    );
    const result = refused('total InvoiceNo', buildSemanticModel([dataset]));
    expect(result.reason).toContain('identifies rows rather than measuring');
  });

  it('refuses when there is no data at all', () => {
    const result = answerQuestion('total Revenue', null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no data loaded');
  });

  it('offers only questions this model can actually answer', () => {
    const model = ordersModel();
    for (const suggestion of suggestQuestions(model)) {
      const result = answerQuestion(suggestion, model);
      expect(result.ok, `${suggestion}: ${result.ok ? '' : result.reason}`).toBe(true);
    }
  });
});

// ============================================================
// A figure per group
// ============================================================

const regional = (): SemanticModel =>
  buildSemanticModel([
    makeDataset(
      [
        { Region: 'North', Product: 'Widget', Amount: 100 },
        { Region: 'South', Product: 'Widget', Amount: 200 },
        { Region: 'North', Product: 'Gadget', Amount: 300 },
        { Region: null, Product: 'Widget', Amount: 50 },
      ],
      [
        { name: 'Region', type: 'string' },
        { name: 'Product', type: 'string' },
        { name: 'Amount', type: 'number' },
      ],
      { id: 'ds-regional', name: 'Sales' }
    ),
  ]);

describe('breaking a figure down by a column', () => {
  it('reads "<figure> by <column>", with the figure first', () => {
    const result = grouped('total Amount by Region', regional());
    expect(result.dax).toContain('VALUES(Sales[Region])');
    expect(result.dax).toContain('CALCULATE(SUM(Sales[Amount]))');
    expect(result.rows).toEqual([
      ['North', 400],
      ['South', 200],
      [null, 50],
    ]);
  });

  it('reads "top N <column> by <figure>", with the grouping first', () => {
    // The opposite word order, and the columns swap sides with it.
    const result = grouped('top 2 regions by Amount', regional());
    expect(result.dax).toContain('VALUES(Sales[Region])');
    expect(result.dax).toContain('SUM(Sales[Amount])');
    expect(result.rows).toEqual([
      ['North', 400],
      ['South', 200],
    ]);
  });

  it('matches a plural to a singular column name', () => {
    // "regions" has to find Region, or the commonest phrasing of a ranked
    // question never works.
    expect(grouped('top 1 regions by Amount', regional()).rows).toEqual([['North', 400]]);
  });

  it('ranks the other way for "bottom"', () => {
    expect(grouped('bottom 1 region by Amount', regional()).rows).toEqual([[null, 50]]);
  });

  it('keeps a blank group rather than dropping it', () => {
    // Power BI counts blank as a group. Dropping it here would make the
    // rows stop summing to the total, silently.
    const result = grouped('total Amount by Region', regional());
    const total = result.rows.reduce((sum, row) => sum + Number(row[1]), 0);
    expect(total).toBe(650);
    expect(result.rows.some(row => row[0] === null)).toBe(true);
  });

  it('carries lineage, so a label can be told from a figure', () => {
    const [group, measure] = grouped('total Amount by Region', regional()).columns;
    expect(group.origin).toEqual({ table: 'Sales', column: 'Region' });
    expect(measure.origin).toBeUndefined();
  });

  it('always ranks, even when nothing asked it to', () => {
    // An unranked result that hits the row cap shows an arbitrary slice,
    // and an arbitrary 500 rows looks exactly like the top 500.
    const result = grouped('total Amount by Region', regional());
    expect(result.dax.startsWith('TOPN(')).toBe(true);
    const amounts = result.rows.map(row => Number(row[1]));
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });

  it('names the computed column after what it computed', () => {
    expect(grouped('average Amount by Region', regional()).columns[1].name).toBe(
      'Average of Amount'
    );
  });

  it('agrees with the same grouping asked the other way round', () => {
    const one = grouped('total Amount by Product', regional());
    const other = grouped('top 10 products by Amount', regional());
    expect(other.rows).toEqual(one.rows);
  });
});

describe('refusing a grouping that would mean nothing', () => {
  it('refuses to group a column by itself', () => {
    expect(refused('total Region by Region', regional()).reason).toMatch(/by itself/);
  });

  it('refuses a grouping column that does not exist', () => {
    expect(refused('total Amount by Nonsense', regional()).reason).toMatch(/"nonsense"/);
  });

  it('refuses to average a column that holds text', () => {
    expect(refused('average Product by Region', regional()).reason).toMatch(
      /does not hold numbers/
    );
  });

  it('refuses to group one table by a column of another', () => {
    // Crossing a relationship needs the join followed. A figure per group
    // computed across an unrelated grain would look ordinary and mean
    // nothing.
    const customers = makeDataset(
      [{ CustomerID: 'C1', Tier: 'Gold' }],
      [
        { name: 'CustomerID', type: 'string' },
        { name: 'Tier', type: 'string' },
      ],
      { id: 'ds-cust2', name: 'Customers' }
    );
    const orders = makeDataset(
      [{ CustomerID: 'C1', Amount: 10 }],
      [
        { name: 'CustomerID', type: 'string' },
        { name: 'Amount', type: 'number' },
      ],
      { id: 'ds-ord2', name: 'Orders' }
    );
    const result = refused('total Amount by Tier', buildSemanticModel([orders, customers]));
    expect(result.reason).toMatch(/different tables/);
  });

  it('refuses a ranking that does not say what to rank by', () => {
    expect(refused('top 5 regions', regional()).reason).toMatch(/needs to say what to rank by/);
  });
});
