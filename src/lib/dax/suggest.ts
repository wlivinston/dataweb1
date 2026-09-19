import { columnRef, tableRef } from './printer';
import type { DAXCalculation } from '../types';
import type { SemanticColumn, SemanticModel, SemanticTable } from '../semantic/types';

/**
 * Propose DAX calculations for a model.
 *
 * Two things changed from the version this replaces. The formulas are built
 * with the printer's quoting rules and carry a table qualifier, so they are
 * real DAX that the engine can actually run - the old `SUM(Amount)` and
 * `COUNTROWS(Table)` parse as nothing at all. And the choice of what to offer
 * comes from the column's inferred role rather than its storage type, so a
 * numeric CustomerID gets a distinct count instead of a sum.
 *
 * That second point is the whole reason roles exist. "Sum of Order ID" is the
 * classic way a BI tool announces it does not understand the data.
 */

/** Per table, so one wide dataset cannot crowd out the others. */
const MAX_MEASURE_COLUMNS = 8;
const MAX_DIMENSION_COLUMNS = 4;

/** Offered for a column whose role says it is genuinely aggregatable. */
const NUMERIC_AGGREGATIONS: {
  fn: string;
  label: (column: string) => string;
  describe: (column: string, table: string) => string;
  confidence: number;
}[] = [
  {
    fn: 'SUM',
    label: column => `Total ${column}`,
    describe: (column, table) => `Sum of ${column} across ${table}.`,
    confidence: 0.9,
  },
  {
    fn: 'AVERAGE',
    label: column => `Average ${column}`,
    describe: (column, table) => `Mean ${column} across ${table}, ignoring blanks.`,
    confidence: 0.8,
  },
  {
    fn: 'MIN',
    label: column => `Lowest ${column}`,
    describe: (column, table) => `Smallest ${column} in ${table}.`,
    confidence: 0.6,
  },
  {
    fn: 'MAX',
    label: column => `Highest ${column}`,
    describe: (column, table) => `Largest ${column} in ${table}.`,
    confidence: 0.6,
  },
];

/**
 * A stable id, so re-running the suggestions does not duplicate a card or
 * make React remount every one of them.
 */
const idFor = (parts: string[]): string =>
  parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const suggestForMeasureColumn = (
  table: SemanticTable,
  column: SemanticColumn
): DAXCalculation[] =>
  NUMERIC_AGGREGATIONS.map(aggregation => ({
    id: idFor([aggregation.fn, table.name, column.name]),
    name: aggregation.label(column.name),
    formula: `${aggregation.fn}(${columnRef(table.name, column.name)})`,
    description: aggregation.describe(column.name, table.name),
    category: 'aggregation' as const,
    applicable: true,
    confidence: aggregation.confidence,
  }));

const suggestForKeyColumn = (
  table: SemanticTable,
  column: SemanticColumn
): DAXCalculation[] => [
  {
    id: idFor(['distinct', table.name, column.name]),
    name: `Distinct ${column.name}`,
    formula: `DISTINCTCOUNT(${columnRef(table.name, column.name)})`,
    description:
      `How many different values of ${column.name} appear in ${table.name}. ` +
      `${column.name} identifies a row rather than measuring one, so it is counted, not summed.`,
    category: 'aggregation' as const,
    applicable: true,
    confidence: 0.85,
  },
];

const suggestForDimensionColumn = (
  table: SemanticTable,
  column: SemanticColumn
): DAXCalculation[] => [
  {
    id: idFor(['distinct', table.name, column.name]),
    name: `Distinct ${column.name}`,
    formula: `DISTINCTCOUNT(${columnRef(table.name, column.name)})`,
    description: `How many different values of ${column.name} appear in ${table.name}.`,
    category: 'aggregation' as const,
    applicable: true,
    confidence: 0.7,
  },
];

/**
 * Date calculations.
 *
 * The version this replaces offered `YEAR(SomeDate)` and returned the sorted
 * list of distinct years, which is not what YEAR does - YEAR takes one date
 * and returns one number. What that card was reaching for is the span the
 * data covers, so that is what is offered instead, as three honest measures.
 */
const suggestForDateColumn = (
  table: SemanticTable,
  column: SemanticColumn
): DAXCalculation[] => {
  const reference = columnRef(table.name, column.name);
  return [
    {
      id: idFor(['first', table.name, column.name]),
      name: `Earliest ${column.name}`,
      formula: `MIN(${reference})`,
      description: `The first ${column.name} in ${table.name}.`,
      category: 'time' as const,
      applicable: true,
      confidence: 0.8,
    },
    {
      id: idFor(['last', table.name, column.name]),
      name: `Latest ${column.name}`,
      formula: `MAX(${reference})`,
      description: `The most recent ${column.name} in ${table.name}.`,
      category: 'time' as const,
      applicable: true,
      confidence: 0.8,
    },
    {
      id: idFor(['years', table.name, column.name]),
      name: `Years covered by ${column.name}`,
      formula: `YEAR(MAX(${reference})) - YEAR(MIN(${reference})) + 1`,
      description: `How many calendar years ${column.name} spans in ${table.name}.`,
      category: 'time' as const,
      applicable: true,
      confidence: 0.7,
    },
  ];
};

/**
 * A running total, offered only when this table is actually joined to the
 * calendar.
 *
 * Without that join TOTALYTD still returns a number - it just quietly returns
 * the unfiltered total, because the calendar's filter never reaches the rows
 * being summed. A figure labelled "year to date" that is really the grand
 * total is precisely the failure mode this rewrite exists to remove, so the
 * suggestion is withheld rather than offered with a caveat.
 */
const suggestYearToDate = (
  model: SemanticModel,
  table: SemanticTable,
  column: SemanticColumn
): DAXCalculation[] => {
  if (!model.dateTableName) return [];
  const dateTable = model.tables.find(candidate => candidate.name === model.dateTableName);
  const dateColumn = dateTable?.columns.find(candidate => candidate.dataType === 'date');
  if (!dateTable || !dateColumn) return [];

  const joinedToCalendar = model.relationships.some(
    relationship =>
      relationship.isActive &&
      relationship.to.table === dateTable.name &&
      relationship.from.table === table.name
  );
  if (!joinedToCalendar) return [];

  return [
    {
      id: idFor(['ytd', table.name, column.name]),
      name: `${column.name} year to date`,
      formula: `TOTALYTD(SUM(${columnRef(table.name, column.name)}), ${columnRef(
        dateTable.name,
        dateColumn.name
      )})`,
      description: `${column.name} accumulated from the start of the year, using ${dateTable.name}.`,
      category: 'time' as const,
      applicable: true,
      confidence: 0.65,
    },
  ];
};

const rowCount = (table: SemanticTable): DAXCalculation => ({
  id: idFor(['rows', table.name]),
  name: `Rows in ${table.name}`,
  formula: `COUNTROWS(${tableRef(table.name)})`,
  description: `How many rows ${table.name} holds.`,
  category: 'aggregation' as const,
  applicable: true,
  confidence: 1,
});

/**
 * Columns worth measuring, best first.
 *
 * A wide table can carry dozens of numeric columns and suggesting four
 * aggregations of each buries the useful ones. Ordering by how much variation
 * a column actually has puts a constant or near-constant column last.
 */
const rankMeasureColumns = (table: SemanticTable): SemanticColumn[] =>
  table.columns
    .filter(column => column.role === 'measure')
    .sort((left, right) => right.uniqueCount - left.uniqueCount)
    .slice(0, MAX_MEASURE_COLUMNS);

const rankDimensionColumns = (table: SemanticTable): SemanticColumn[] =>
  table.columns
    .filter(column => column.role === 'dimension' || column.role === 'flag')
    // Fewest distinct values first: those are the ones worth grouping by.
    .sort((left, right) => left.uniqueCount - right.uniqueCount)
    .slice(0, MAX_DIMENSION_COLUMNS);

export interface SuggestOptions {
  /** Restrict to one table. Omitted, every table in the model is covered. */
  table?: string;
  /** Leave out the model's generated calendar, which has no measures. */
  includeGeneratedTables?: boolean;
}

export const suggestCalculations = (
  model: SemanticModel,
  options: SuggestOptions = {}
): DAXCalculation[] => {
  const calculations: DAXCalculation[] = [];

  const tables = model.tables.filter(table => {
    if (options.table && table.name !== options.table) return false;
    if (table.isGenerated && !options.includeGeneratedTables) return false;
    return true;
  });

  for (const table of tables) {
    if (table.rowCount === 0) continue;

    calculations.push(rowCount(table));

    for (const column of rankMeasureColumns(table)) {
      calculations.push(...suggestForMeasureColumn(table, column));
      calculations.push(...suggestYearToDate(model, table, column));
    }

    for (const column of table.columns) {
      if (column.role === 'key' || column.role === 'foreignKey') {
        calculations.push(...suggestForKeyColumn(table, column));
      } else if (column.role === 'date') {
        calculations.push(...suggestForDateColumn(table, column));
      }
    }

    for (const column of rankDimensionColumns(table)) {
      calculations.push(...suggestForDimensionColumn(table, column));
    }
  }

  return calculations;
};
