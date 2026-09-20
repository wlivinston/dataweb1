import { describe, it, expect } from 'vitest';
import { makeDataset, seededRandom } from './fixtures';
import { buildSemanticModel } from '../semantic/model';
import { runDax } from '../dax/run';
import { columnRef, tableRef } from '../dax/printer';
import type { Dataset } from '../types';
import type { SemanticModel } from '../semantic/types';

/**
 * Laws the engine must obey, checked over randomly generated models.
 *
 * Every other test in this suite asserts a number I worked out by hand,
 * which means the suite only covers cases I thought of. The three filter
 * bugs found during this phase were all found that way, and all three were
 * in code that passed its own tests - so the ones I did not think to write
 * are the ones still in there.
 *
 * These tests assert nothing about any particular number. They assert
 * relationships that have to hold whatever the data is: that filter
 * arguments commute, that a total equals the sum of its parts, that ALL
 * really removes everything. Two of the three bugs would have been caught
 * mechanically here.
 *
 * What this CANNOT catch is a consistently wrong reading of DAX. If my
 * SAMEPERIODLASTYEAR is off by a day in the same direction everywhere, every
 * law below still holds. That needs Power BI, and remains open.
 */

// ============================================================
// Scenario generation
// ============================================================

interface Scenario {
  seed: number;
  model: SemanticModel;
  /** Fact table name. */
  fact: string;
  /** Dimension table name. */
  dim: string;
  amount: string;
  qty: string;
  /** Low-cardinality column ON THE FACT, never blank, safe to partition by. */
  channel: string;
  /** The fact's date column. */
  date: string;
  /** Shared key. */
  key: string;
  /** An attribute that exists only on the dimension. */
  segment: string;
  /** Values actually present, for building filters that match something. */
  channels: string[];
  segments: string[];
  years: number[];
  rows: Record<string, unknown>[];
  dimRows: Record<string, unknown>[];
}

const CHANNELS = ['Retail', 'Wholesale', 'Online', 'Direct', 'Partner'];
const SEGMENTS = ['SME', 'Enterprise', 'Public'];

const pad2 = (n: number) => String(n).padStart(2, '0');

const generateScenario = (seed: number): Scenario => {
  const rng = seededRandom(seed);
  const pick = <T,>(items: T[]): T => items[Math.floor(rng() * items.length)];

  const channels = CHANNELS.slice(0, 2 + Math.floor(rng() * 3));
  const customerCount = 3 + Math.floor(rng() * 6);
  const rowCount = 12 + Math.floor(rng() * 40);

  // Two or three whole years, so the time-intelligence laws have a previous
  // year to compare against.
  const firstYear = 2021 + Math.floor(rng() * 2);
  const yearSpan = 2 + Math.floor(rng() * 2);
  const years = Array.from({ length: yearSpan }, (_, i) => firstYear + i);

  const dimRows = Array.from({ length: customerCount }, (_, i) => ({
    CustomerID: `C${i + 1}`,
    CustomerName: `Customer ${i + 1}`,
    Segment: SEGMENTS[i % SEGMENTS.length],
  }));

  const rows = Array.from({ length: rowCount }, (_, i) => {
    const year = pick(years);
    const month = 1 + Math.floor(rng() * 12);
    // 28 keeps every month valid without a calendar lookup.
    const day = 1 + Math.floor(rng() * 28);

    // A tenth of rows carry a blank amount, so the laws are exercised against
    // blanks rather than only against complete data.
    const blankAmount = rng() < 0.1;

    return {
      OrderID: `O${i + 1}`,
      CustomerID: pick(dimRows).CustomerID,
      Channel: pick(channels),
      Amount: blankAmount ? null : Math.floor(rng() * 1000) + 1,
      Qty: Math.floor(rng() * 12) + 1,
      OrderDate: `${year}-${pad2(month)}-${pad2(day)}`,
    };
  });

  const fact: Dataset = makeDataset(
    rows,
    [
      { name: 'OrderID', type: 'string' },
      { name: 'CustomerID', type: 'string' },
      { name: 'Channel', type: 'string' },
      { name: 'Amount', type: 'number' },
      { name: 'Qty', type: 'number' },
      { name: 'OrderDate', type: 'date' },
    ],
    { id: `ds-fact-${seed}`, name: 'Orders' }
  );

  const dim: Dataset = makeDataset(
    dimRows,
    [
      { name: 'CustomerID', type: 'string' },
      { name: 'CustomerName', type: 'string' },
      { name: 'Segment', type: 'string' },
    ],
    { id: `ds-dim-${seed}`, name: 'Customers' }
  );

  return {
    seed,
    model: buildSemanticModel([fact, dim]),
    fact: 'Orders',
    dim: 'Customers',
    amount: 'Amount',
    qty: 'Qty',
    channel: 'Channel',
    date: 'OrderDate',
    key: 'CustomerID',
    segment: 'Segment',
    channels: [...new Set(rows.map(r => r.Channel as string))],
    segments: [...new Set(dimRows.map(r => r.Segment))],
    years,
    rows,
    dimRows,
  };
};

/** Twenty-four scenarios: enough shape variety, still under a second. */
const SCENARIOS = Array.from({ length: 24 }, (_, i) => generateScenario(i + 1));

// ============================================================
// Helpers
// ============================================================

const value = (formula: string, scenario: Scenario): number | string | boolean | null => {
  const outcome = runDax(formula, scenario.model);
  if (!outcome.ok) {
    throw new Error(`seed ${scenario.seed}: ${formula}\n  -> ${outcome.message}`);
  }
  return outcome.value;
};

const num = (formula: string, scenario: Scenario): number => {
  const result = value(formula, scenario);
  // BLANK behaves as zero in arithmetic, which is what every law below
  // compares against.
  return result === null ? 0 : Number(result);
};

/** Asserts two expressions agree, naming both when they do not. */
const same = (left: string, right: string, scenario: Scenario): void => {
  const a = num(left, scenario);
  const b = num(right, scenario);
  expect(
    Math.abs(a - b) < 1e-9,
    `seed ${scenario.seed}\n  ${left} = ${a}\n  ${right} = ${b}`
  ).toBe(true);
};

const quote = (text: string) => `"${text.replace(/"/g, '""')}"`;

const forEachScenario = (assertion: (scenario: Scenario) => void): void => {
  for (const scenario of SCENARIOS) assertion(scenario);
};

// ============================================================
// The generator itself has to be sound, or every law below is vacuous
// ============================================================

describe('generated scenarios', () => {
  it('orient the relationship fact -> dimension', () => {
    forEachScenario(scenario => {
      const relationship = scenario.model.relationships.find(
        r => r.from.table === scenario.fact && r.to.table === scenario.dim
      );
      expect(relationship, `seed ${scenario.seed} has no Orders -> Customers join`).toBeDefined();
      expect(relationship!.isActive).toBe(true);
    });
  });

  it('build a calendar joined to the fact', () => {
    forEachScenario(scenario => {
      expect(scenario.model.dateTableName, `seed ${scenario.seed}`).toBeTruthy();
      const joined = scenario.model.relationships.some(
        r => r.isActive && r.to.table === scenario.model.dateTableName && r.from.table === scenario.fact
      );
      expect(joined, `seed ${scenario.seed} fact is not joined to the calendar`).toBe(true);
    });
  });

  it('actually contain the blanks and the spread the laws need', () => {
    const anyBlank = SCENARIOS.some(s => s.rows.some(r => r.Amount === null));
    const allMultiChannel = SCENARIOS.every(s => s.channels.length >= 2);
    const allMultiYear = SCENARIOS.every(s => s.years.length >= 2);
    expect(anyBlank).toBe(true);
    expect(allMultiChannel).toBe(true);
    expect(allMultiYear).toBe(true);
  });
});

// ============================================================
// Filter composition
// ============================================================

describe('law: CALCULATE filter arguments commute', () => {
  it('holds for two column filters', () => {
    // This is the bug found by hand in 278e3a7: filters were applied one
    // after another, so a later argument wiped an earlier one and the answer
    // depended on the order they were written in.
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const channel = columnRef(scenario.fact, scenario.channel);
      const qty = columnRef(scenario.fact, scenario.qty);
      const c = quote(scenario.channels[0]);

      same(
        `CALCULATE(SUM(${amount}), ${channel} = ${c}, ${qty} > 3)`,
        `CALCULATE(SUM(${amount}), ${qty} > 3, ${channel} = ${c})`,
        scenario
      );
    });
  });

  it('holds when one filter crosses a relationship', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const channel = columnRef(scenario.fact, scenario.channel);
      const segment = columnRef(scenario.dim, scenario.segment);
      const c = quote(scenario.channels[0]);
      const s = quote(scenario.segments[0]);

      same(
        `CALCULATE(SUM(${amount}), ${channel} = ${c}, ${segment} = ${s})`,
        `CALCULATE(SUM(${amount}), ${segment} = ${s}, ${channel} = ${c})`,
        scenario
      );
    });
  });

  it('holds when a table-valued filter is mixed with a column filter', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const channel = columnRef(scenario.fact, scenario.channel);
      const dateColumn = columnRef(scenario.model.dateTableName!, 'Date');
      const c = quote(scenario.channels[0]);

      same(
        `CALCULATE(SUM(${amount}), ${channel} = ${c}, DATESYTD(${dateColumn}))`,
        `CALCULATE(SUM(${amount}), DATESYTD(${dateColumn}), ${channel} = ${c})`,
        scenario
      );
    });
  });

  it('holds when both filters touch the SAME table', () => {
    // The case above puts the two filters on different tables, where each
    // one's clear cannot reach the other's column - so it passes even when
    // filters are applied strictly in sequence. Reintroducing that bug
    // proved it: the law was right and my instance of it was too weak.
    //
    // Same table is where it bites. This is the shape of the original
    // failure in 278e3a7, where DATESYTD wiped a Year filter written before
    // it and CALCULATE(x, Date[Year] = 1999, DATESYTD(...)) returned the
    // whole of the current year instead of nothing.
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const calendar = scenario.model.dateTableName!;
      const dateColumn = columnRef(calendar, 'Date');
      const yearColumn = columnRef(calendar, 'Year');
      const year = scenario.years[0];

      same(
        `CALCULATE(SUM(${amount}), ${yearColumn} = ${year}, DATESYTD(${dateColumn}))`,
        `CALCULATE(SUM(${amount}), DATESYTD(${dateColumn}), ${yearColumn} = ${year})`,
        scenario
      );
    });
  });

  it('holds for two filters on the same column', () => {
    // Both must survive and be ANDed. If the second clears the first, the
    // two orderings keep different halves of the range.
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const qty = columnRef(scenario.fact, scenario.qty);

      same(
        `CALCULATE(SUM(${amount}), ${qty} > 3, ${qty} < 10)`,
        `CALCULATE(SUM(${amount}), ${qty} < 10, ${qty} > 3)`,
        scenario
      );
    });
  });

  it('keeps both of two filters on the same column, not just one', () => {
    // Commutativity alone would still pass if BOTH orderings dropped the
    // same filter. This pins the result against an independent count.
    forEachScenario(scenario => {
      const table = tableRef(scenario.fact);
      const qty = columnRef(scenario.fact, scenario.qty);
      const expected = scenario.rows.filter(
        row => (row.Qty as number) > 3 && (row.Qty as number) < 10
      ).length;

      const actual = num(`CALCULATE(COUNTROWS(${table}), ${qty} > 3, ${qty} < 10)`, scenario);
      expect(actual, `seed ${scenario.seed}`).toBe(expected);
    });
  });
});

describe('law: applying the same filter twice changes nothing', () => {
  it('holds for a column filter', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const channel = columnRef(scenario.fact, scenario.channel);
      const c = quote(scenario.channels[0]);

      same(
        `CALCULATE(SUM(${amount}), ${channel} = ${c})`,
        `CALCULATE(CALCULATE(SUM(${amount}), ${channel} = ${c}), ${channel} = ${c})`,
        scenario
      );
    });
  });
});

// ============================================================
// Partition additivity
// ============================================================

describe('law: a total equals the sum of its parts', () => {
  it('holds across a column on the fact', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const channel = columnRef(scenario.fact, scenario.channel);

      const whole = num(`SUM(${amount})`, scenario);
      const parts = scenario.channels.reduce(
        (total, c) =>
          total + num(`CALCULATE(SUM(${amount}), ${channel} = ${quote(c)})`, scenario),
        0
      );

      expect(parts, `seed ${scenario.seed}: whole ${whole}, parts ${parts}`).toBeCloseTo(whole, 9);
    });
  });

  it('holds across a column on the dimension, through the relationship', () => {
    // Propagation: a filter on Customers must reach Orders and must partition
    // it exactly. If the join leaks, the parts over- or under-count.
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const segment = columnRef(scenario.dim, scenario.segment);

      const whole = num(`SUM(${amount})`, scenario);
      const parts = scenario.segments.reduce(
        (total, s) =>
          total + num(`CALCULATE(SUM(${amount}), ${segment} = ${quote(s)})`, scenario),
        0
      );

      expect(parts, `seed ${scenario.seed}: whole ${whole}, parts ${parts}`).toBeCloseTo(whole, 9);
    });
  });

  it('holds across years, through the generated calendar', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const year = columnRef(scenario.model.dateTableName!, 'Year');

      const whole = num(`SUM(${amount})`, scenario);
      const parts = scenario.years.reduce(
        (total, y) => total + num(`CALCULATE(SUM(${amount}), ${year} = ${y})`, scenario),
        0
      );

      expect(parts, `seed ${scenario.seed}: whole ${whole}, parts ${parts}`).toBeCloseTo(whole, 9);
    });
  });

  it('holds for COUNTROWS as well as SUM', () => {
    forEachScenario(scenario => {
      const table = tableRef(scenario.fact);
      const channel = columnRef(scenario.fact, scenario.channel);

      const whole = num(`COUNTROWS(${table})`, scenario);
      const parts = scenario.channels.reduce(
        (total, c) =>
          total + num(`CALCULATE(COUNTROWS(${table}), ${channel} = ${quote(c)})`, scenario),
        0
      );

      expect(parts, `seed ${scenario.seed}`).toBe(whole);
      expect(whole).toBe(scenario.rows.length);
    });
  });
});

// ============================================================
// ALL
// ============================================================

describe('law: ALL removes every filter on its table', () => {
  it('restores the unfiltered total from inside a filter', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const table = tableRef(scenario.fact);
      const channel = columnRef(scenario.fact, scenario.channel);
      const c = quote(scenario.channels[0]);

      same(
        `CALCULATE(CALCULATE(SUM(${amount}), ALL(${table})), ${channel} = ${c})`,
        `SUM(${amount})`,
        scenario
      );
    });
  });

  it('restores it from inside a filter that arrived across a relationship', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const table = tableRef(scenario.fact);
      const segment = columnRef(scenario.dim, scenario.segment);
      const s = quote(scenario.segments[0]);

      same(
        `CALCULATE(CALCULATE(SUM(${amount}), ALL(${table}), ALL(${tableRef(scenario.dim)})), ${segment} = ${s})`,
        `SUM(${amount})`,
        scenario
      );
    });
  });
});

// ============================================================
// Context transition
// ============================================================

describe('law: context transition isolates exactly one row', () => {
  it('SUMX over a measure equals the plain aggregation', () => {
    // This is the bug found by hand in 1286782: the transition pinned the
    // iterated row but left the table's existing column filters in place to
    // intersect with it, so every row outside the outer filter went blank.
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const table = tableRef(scenario.fact);

      same(`SUMX(${table}, CALCULATE(SUM(${amount})))`, `SUM(${amount})`, scenario);
    });
  });

  it('still holds inside an outer filter', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const table = tableRef(scenario.fact);
      const channel = columnRef(scenario.fact, scenario.channel);
      const c = quote(scenario.channels[0]);

      same(
        `CALCULATE(SUMX(${table}, CALCULATE(SUM(${amount}))), ${channel} = ${c})`,
        `CALCULATE(SUM(${amount}), ${channel} = ${c})`,
        scenario
      );
    });
  });

  it('iterating ALL of a table ignores the outer filter entirely', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const table = tableRef(scenario.fact);
      const channel = columnRef(scenario.fact, scenario.channel);
      const c = quote(scenario.channels[0]);

      same(
        `CALCULATE(SUMX(ALL(${table}), CALCULATE(SUM(${amount}))), ${channel} = ${c})`,
        `SUM(${amount})`,
        scenario
      );
    });
  });
});

// ============================================================
// Time intelligence
// ============================================================

describe('law: year-to-date at the end of a year is the whole year', () => {
  it('holds for TOTALYTD', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const dateColumn = columnRef(scenario.model.dateTableName!, 'Date');
      const yearColumn = columnRef(scenario.model.dateTableName!, 'Year');

      for (const year of scenario.years) {
        same(
          `CALCULATE(TOTALYTD(SUM(${amount}), ${dateColumn}), ${dateColumn} = "${year}-12-31")`,
          `CALCULATE(SUM(${amount}), ${yearColumn} = ${year})`,
          scenario
        );
      }
    });
  });

  it('holds for DATESYTD used as a filter', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const dateColumn = columnRef(scenario.model.dateTableName!, 'Date');
      const yearColumn = columnRef(scenario.model.dateTableName!, 'Year');

      for (const year of scenario.years) {
        same(
          `CALCULATE(CALCULATE(SUM(${amount}), DATESYTD(${dateColumn})), ${dateColumn} = "${year}-12-31")`,
          `CALCULATE(SUM(${amount}), ${yearColumn} = ${year})`,
          scenario
        );
      }
    });
  });
});

describe('law: shifting a whole year back lands on the previous year', () => {
  it('holds for SAMEPERIODLASTYEAR', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const dateColumn = columnRef(scenario.model.dateTableName!, 'Date');
      const yearColumn = columnRef(scenario.model.dateTableName!, 'Year');

      for (const year of scenario.years.slice(1)) {
        same(
          `CALCULATE(CALCULATE(SUM(${amount}), SAMEPERIODLASTYEAR(${dateColumn})), ${yearColumn} = ${year})`,
          `CALCULATE(SUM(${amount}), ${yearColumn} = ${year - 1})`,
          scenario
        );
      }
    });
  });

  it('holds for DATEADD by one year', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const dateColumn = columnRef(scenario.model.dateTableName!, 'Date');
      const yearColumn = columnRef(scenario.model.dateTableName!, 'Year');

      for (const year of scenario.years.slice(1)) {
        same(
          `CALCULATE(CALCULATE(SUM(${amount}), DATEADD(${dateColumn}, -1, YEAR)), ${yearColumn} = ${year})`,
          `CALCULATE(SUM(${amount}), ${yearColumn} = ${year - 1})`,
          scenario
        );
      }
    });
  });
});

// ============================================================
// Aggregation consistency
// ============================================================

describe('law: the aggregations agree with each other', () => {
  it('MIN <= AVERAGE <= MAX', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const min = num(`MIN(${amount})`, scenario);
      const average = num(`AVERAGE(${amount})`, scenario);
      const max = num(`MAX(${amount})`, scenario);
      expect(min, `seed ${scenario.seed}`).toBeLessThanOrEqual(average);
      expect(average, `seed ${scenario.seed}`).toBeLessThanOrEqual(max);
    });
  });

  it('AVERAGE equals SUM over COUNT, counting only non-blank values', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      same(`AVERAGE(${amount})`, `DIVIDE(SUM(${amount}), COUNT(${amount}))`, scenario);
    });
  });

  it('COUNT ignores blanks and COUNTROWS does not', () => {
    forEachScenario(scenario => {
      const amount = columnRef(scenario.fact, scenario.amount);
      const table = tableRef(scenario.fact);
      const present = scenario.rows.filter(r => r.Amount !== null).length;
      expect(num(`COUNT(${amount})`, scenario), `seed ${scenario.seed}`).toBe(present);
      expect(num(`COUNTROWS(${table})`, scenario), `seed ${scenario.seed}`).toBe(
        scenario.rows.length
      );
    });
  });

  it('DISTINCTCOUNT of the key never exceeds the row count', () => {
    forEachScenario(scenario => {
      const key = columnRef(scenario.fact, scenario.key);
      const distinct = num(`DISTINCTCOUNT(${key})`, scenario);
      expect(distinct).toBeGreaterThan(0);
      expect(distinct).toBeLessThanOrEqual(scenario.rows.length);
    });
  });
});

// ============================================================
// An independent oracle, computed in plain JavaScript
//
// The laws above are the engine checked against itself, so a mistake shared
// by both sides survives them. These compute the answer from the raw rows
// with no filter-context machinery involved at all.
// ============================================================

describe('oracle: simple aggregations computed directly from the rows', () => {
  it('matches the unfiltered total', () => {
    forEachScenario(scenario => {
      const expected = scenario.rows.reduce<number>(
        (total, row) => total + (row.Amount === null ? 0 : (row.Amount as number)),
        0
      );
      expect(
        num(`SUM(${columnRef(scenario.fact, scenario.amount)})`, scenario),
        `seed ${scenario.seed}`
      ).toBe(expected);
    });
  });

  it('matches a total filtered on the fact', () => {
    forEachScenario(scenario => {
      const channel = scenario.channels[0];
      const expected = scenario.rows
        .filter(row => row.Channel === channel)
        .reduce<number>((total, row) => total + (row.Amount === null ? 0 : (row.Amount as number)), 0);

      const formula = `CALCULATE(SUM(${columnRef(scenario.fact, scenario.amount)}), ${columnRef(
        scenario.fact,
        scenario.channel
      )} = ${quote(channel)})`;
      expect(num(formula, scenario), `seed ${scenario.seed}`).toBe(expected);
    });
  });

  it('matches a total filtered through the relationship', () => {
    forEachScenario(scenario => {
      const segment = scenario.segments[0];
      const customers = new Set(
        scenario.dimRows.filter(row => row.Segment === segment).map(row => row.CustomerID)
      );
      const expected = scenario.rows
        .filter(row => customers.has(row.CustomerID as string))
        .reduce<number>((total, row) => total + (row.Amount === null ? 0 : (row.Amount as number)), 0);

      const formula = `CALCULATE(SUM(${columnRef(scenario.fact, scenario.amount)}), ${columnRef(
        scenario.dim,
        scenario.segment
      )} = ${quote(segment)})`;
      expect(num(formula, scenario), `seed ${scenario.seed}`).toBe(expected);
    });
  });

  it('matches a total filtered by year through the calendar', () => {
    forEachScenario(scenario => {
      const year = scenario.years[0];
      const expected = scenario.rows
        .filter(row => String(row.OrderDate).startsWith(`${year}-`))
        .reduce<number>((total, row) => total + (row.Amount === null ? 0 : (row.Amount as number)), 0);

      const formula = `CALCULATE(SUM(${columnRef(scenario.fact, scenario.amount)}), ${columnRef(
        scenario.model.dateTableName!,
        'Year'
      )} = ${year})`;
      expect(num(formula, scenario), `seed ${scenario.seed}`).toBe(expected);
    });
  });
});
