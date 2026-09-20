import type { Dataset, ColumnInfo } from '../types';
import { autoDetectRelationships, sampleForDetection } from '../smartDataConnector';
import { inferColumnRole } from './roles';
import { parseDateValue, summariseDateColumn, type DateFormat } from './dates';
import {
  DEFAULT_FISCAL,
  generateDateTable,
  toDateKey,
  type FiscalConfig,
} from './dateTable';
import type {
  ColumnPointer,
  ModelWarning,
  Resolution,
  SemanticColumn,
  SemanticMeasure,
  SemanticModel,
  SemanticRelationship,
  SemanticTable,
  TableRole,
} from './types';

/**
 * Build a semantic model from uploaded datasets.
 *
 * The model is what turns a pile of spreadsheets into something DAX can be
 * evaluated against: named tables, typed columns with roles, and oriented
 * relationships. It is a snapshot - rebuilt when the data changes, never
 * mutated in place.
 *
 * Relationship orientation is derived here rather than taken from
 * autoDetectRelationships, whose `type` field reports 'one-to-many' for both
 * directions without recording which side is the one. Filters propagate one
 * to many, so an inverted relationship silently returns unfiltered totals.
 */

export interface BuildModelOptions {
  fiscal?: Partial<FiscalConfig>;
  /**
   * Reading applied to date columns that are genuinely ambiguous. A warning
   * is always raised when this is used, so the user can correct it.
   */
  ambiguousDateFallback?: DateFormat;
  skipDateTable?: boolean;
  measures?: SemanticMeasure[];
}

/** Values are compared case-insensitively, as Power BI does for keys. */
export const keyOf = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length === 0 ? null : text.toLowerCase();
};

const distinctKeys = (rows: Record<string, unknown>[], column: string): Set<string> => {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row[column]);
    if (key !== null) seen.add(key);
  }
  return seen;
};

const countPresent = (rows: Record<string, unknown>[], column: string): number => {
  let count = 0;
  for (const row of rows) {
    if (keyOf(row[column]) !== null) count += 1;
  }
  return count;
};

/** Unique with no blanks: the column can identify every row in its table. */
const isUniqueKey = (rows: Record<string, unknown>[], column: string): boolean => {
  if (rows.length === 0) return false;
  const present = countPresent(rows, column);
  if (present !== rows.length) return false;
  return distinctKeys(rows, column).size === rows.length;
};

const MAX_DETECTION_ROWS = 5000;

/**
 * Data-file extensions stripped from a table name.
 *
 * Deliberately a fixed list rather than "any trailing dot-suffix": a table
 * legitimately called `Q1.2024` must keep its year.
 */
const FILE_EXTENSIONS = /\.(csv|tsv|txt|json|xlsx|xlsm|xlsb|xls|parquet)(?=$|\s)/gi;

/**
 * The name of the table, which is not the same thing as the name of the file
 * it arrived in.
 *
 * Power BI names a table after the file's stem: load orders.csv and the
 * table is `orders`. Carrying the extension through meant every exported
 * measure said 'orders.csv'[Revenue] against a model where the table is
 * called orders - mismatched by construction, for every CSV anyone exports.
 * The dot also forced quoting that the bare stem does not need.
 *
 * The dataset keeps its own name for display. "Dataset orders.csv contains 6
 * rows" is true and worth saying; what was wrong was one string serving as
 * both the label a person reads and the identifier DAX resolves.
 */
const tableNameFor = (datasetName: string | undefined, fallback: string): string => {
  const trimmed = datasetName?.trim();
  if (!trimmed) return fallback;
  // An Excel sheet arrives as `book.xlsx - Sheet1`, so the extension is not
  // always at the end of the string.
  const stripped = trimmed.replace(FILE_EXTENSIONS, '').trim();
  return stripped || trimmed;
};

const uniqueTableName = (desired: string, taken: Set<string>): string => {
  const lower = desired.toLowerCase();
  if (!taken.has(lower)) return desired;
  let suffix = 2;
  while (taken.has(`${desired} ${suffix}`.toLowerCase())) suffix += 1;
  return `${desired} ${suffix}`;
};

interface PreparedTable {
  name: string;
  datasetId: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  columnInfo: ColumnInfo[];
  /** Date columns, with the reading applied to each. */
  dateFormats: Map<string, DateFormat>;
  dateRange: { min: Date | null; max: Date | null };
}

/**
 * Copy rows and rewrite date columns to canonical yyyy-mm-dd keys.
 *
 * Normalising once here means every downstream join, grouping and comparison
 * works on a single representation, and keys sort lexically. The source
 * dataset is left untouched. Rows are only copied when there is something to
 * rewrite.
 */
const prepareTable = (
  dataset: Dataset,
  name: string,
  options: BuildModelOptions,
  warnings: ModelWarning[]
): PreparedTable => {
  const dateFormats = new Map<string, DateFormat>();
  let min: Date | null = null;
  let max: Date | null = null;

  const declaredDateColumns = dataset.columns.filter(c => c.type === 'date');

  for (const column of declaredDateColumns) {
    const values = dataset.data.map(row => row[column.name]);
    const summary = summariseDateColumn(values, options.ambiguousDateFallback);

    if (!summary.appliedFormat) {
      warnings.push({
        code:
          summary.inference.status === 'inconsistent'
            ? 'inconsistent_date_format'
            : 'ambiguous_date_format',
        severity: 'error',
        table: name,
        column: column.name,
        dateStatus: summary.inference.status,
        message:
          summary.inference.status === 'inconsistent'
            ? `"${column.name}" in ${name} mixes date formats (${summary.inference.example}). Time intelligence is disabled for it until the column is cleaned.`
            : `"${column.name}" in ${name} could be read day-first or month-first and nothing in the data settles it (e.g. ${summary.inference.example}). Choose a reading before relying on any monthly figure.`,
      });
      continue;
    }

    if (summary.inference.status === 'ambiguous') {
      warnings.push({
        code: 'ambiguous_date_format',
        severity: 'warning',
        table: name,
        column: column.name,
        dateStatus: 'ambiguous',
        message: `"${column.name}" in ${name} is ambiguous (e.g. ${summary.inference.example}); it is being read ${
          summary.appliedFormat === 'dayFirst' ? 'day-first' : 'month-first'
        }. Check this before trusting any monthly total.`,
      });
    }

    if (summary.failed > 0) {
      warnings.push({
        code: 'unparsed_dates',
        severity: 'warning',
        table: name,
        column: column.name,
        message: `${summary.failed} of ${summary.failed + summary.parsed} values in "${column.name}" are not valid dates and are excluded from time intelligence.`,
      });
    }

    dateFormats.set(column.name, summary.appliedFormat);
    if (summary.min && (!min || summary.min < min)) min = summary.min;
    if (summary.max && (!max || summary.max > max)) max = summary.max;
  }

  let rows: Record<string, unknown>[] = dataset.data as Record<string, unknown>[];

  if (dateFormats.size > 0) {
    rows = dataset.data.map((row: Record<string, unknown>) => {
      const copy: Record<string, unknown> = { ...row };
      for (const [columnName, format] of dateFormats) {
        const parsed = parseDateValue(row[columnName], format);
        copy[columnName] = parsed ? toDateKey(parsed) : null;
      }
      return copy;
    });
  }

  return {
    name,
    datasetId: dataset.id,
    rows,
    rowCount: rows.length,
    columnInfo: dataset.columns,
    dateFormats,
    dateRange: { min, max },
  };
};

interface OrientedCandidate {
  from: ColumnPointer;
  to: ColumnPointer;
  cardinality: SemanticRelationship['cardinality'];
  confidence: number;
  integrity: number;
}

/**
 * Decide which side of a candidate pair is the "one" side.
 *
 * Measured from the data: a column that is unique and never blank can be the
 * one side; a column with repeats cannot. When both qualify the relationship
 * is one-to-one and filtering may flow in either direction.
 */
const orientCandidate = (
  left: { table: PreparedTable; column: string },
  right: { table: PreparedTable; column: string },
  confidence: number
): OrientedCandidate | null => {
  const leftUnique = isUniqueKey(left.table.rows, left.column);
  const rightUnique = isUniqueKey(right.table.rows, right.column);

  const integrityOf = (
    many: { table: PreparedTable; column: string },
    one: { table: PreparedTable; column: string }
  ): number => {
    const oneSide = distinctKeys(one.table.rows, one.column);
    let matched = 0;
    let present = 0;
    for (const row of many.table.rows) {
      const key = keyOf(row[many.column]);
      if (key === null) continue;
      present += 1;
      if (oneSide.has(key)) matched += 1;
    }
    return present === 0 ? 0 : matched / present;
  };

  const pointer = (side: { table: PreparedTable; column: string }): ColumnPointer => ({
    table: side.table.name,
    column: side.column,
  });

  if (rightUnique && !leftUnique) {
    return {
      from: pointer(left),
      to: pointer(right),
      cardinality: 'oneToMany',
      confidence,
      integrity: integrityOf(left, right),
    };
  }

  if (leftUnique && !rightUnique) {
    return {
      from: pointer(right),
      to: pointer(left),
      cardinality: 'oneToMany',
      confidence,
      integrity: integrityOf(right, left),
    };
  }

  if (leftUnique && rightUnique) {
    // Either direction is valid; orient from the larger table for stability.
    const leftIsLarger = left.table.rowCount >= right.table.rowCount;
    const many = leftIsLarger ? left : right;
    const one = leftIsLarger ? right : left;
    return {
      from: pointer(many),
      to: pointer(one),
      cardinality: 'oneToOne',
      confidence,
      integrity: integrityOf(many, one),
    };
  }

  // Neither side is unique. Power BI would need a bridge table; we record it
  // so the user can see why filters are not propagating.
  return {
    from: pointer(left),
    to: pointer(right),
    cardinality: 'manyToMany',
    confidence,
    integrity: integrityOf(left, right),
  };
};

const MIN_INTEGRITY = 0.5;

const detectRelationships = (
  prepared: PreparedTable[],
  datasets: Dataset[],
  warnings: ModelWarning[]
): SemanticRelationship[] => {
  if (prepared.length < 2) return [];

  const byDatasetId = new Map(prepared.map(table => [table.datasetId, table]));
  // Detection runs on a sample; orientation and integrity are then measured
  // on the full rows, where a duplicate key actually shows up.
  const sampled = datasets.map(dataset => sampleForDetection(dataset, MAX_DETECTION_ROWS));
  const candidates = autoDetectRelationships(sampled);

  const oriented: SemanticRelationship[] = [];

  for (const candidate of candidates) {
    const fromTable = byDatasetId.get(candidate.fromDataset);
    const toTable = byDatasetId.get(candidate.toDataset);
    if (!fromTable || !toTable) continue;

    const result = orientCandidate(
      { table: fromTable, column: candidate.fromColumn },
      { table: toTable, column: candidate.toColumn },
      candidate.confidence
    );
    if (!result) continue;

    if (result.integrity < MIN_INTEGRITY) {
      // Too few keys match for this to be a real relationship.
      continue;
    }

    oriented.push({
      id: `${result.from.table}.${result.from.column}->${result.to.table}.${result.to.column}`,
      from: result.from,
      to: result.to,
      cardinality: result.cardinality,
      crossFilter: result.cardinality === 'oneToOne' ? 'both' : 'single',
      isActive: true,
      confidence: result.confidence,
      integrity: result.integrity,
    });
  }

  // Only one active path may join a given pair of tables, or a filter could
  // reach the same row by two routes and the answer would depend on which
  // was taken. Keep the strongest, deactivate the rest.
  const activePairs = new Set<string>();
  const deduped = oriented
    .slice()
    .sort((a, b) => b.confidence - a.confidence || b.integrity - a.integrity);

  for (const relationship of deduped) {
    const pair = [relationship.from.table, relationship.to.table].sort().join('<->');
    if (activePairs.has(pair)) {
      relationship.isActive = false;
      warnings.push({
        code: 'inactive_relationship',
        severity: 'info',
        table: relationship.from.table,
        column: relationship.from.column,
        message: `${relationship.from.table}[${relationship.from.column}] also matches ${relationship.to.table}[${relationship.to.column}], but another relationship already joins these tables. This one is inactive.`,
      });
      continue;
    }
    activePairs.add(pair);

    if (relationship.cardinality === 'manyToMany') {
      warnings.push({
        code: 'many_to_many',
        severity: 'warning',
        table: relationship.from.table,
        column: relationship.from.column,
        message: `${relationship.from.table}[${relationship.from.column}] and ${relationship.to.table}[${relationship.to.column}] both contain repeated values. Totals across this join can double-count.`,
      });
    }

    if (relationship.integrity < 1) {
      const missing = Math.round((1 - relationship.integrity) * 100);
      warnings.push({
        code: 'referential_integrity',
        severity: 'warning',
        table: relationship.from.table,
        column: relationship.from.column,
        message: `${missing}% of ${relationship.from.table}[${relationship.from.column}] values have no match in ${relationship.to.table}[${relationship.to.column}]. Those rows drop out of any figure grouped by ${relationship.to.table}.`,
      });
    }
  }

  return deduped;
};

const tableRoleFor = (
  prepared: PreparedTable,
  relationships: SemanticRelationship[]
): TableRole => {
  const isOneSide = relationships.some(r => r.to.table === prepared.name);
  const isManySide = relationships.some(r => r.from.table === prepared.name);

  if (isManySide && !isOneSide) return 'fact';
  if (isOneSide && !isManySide) return 'dimension';
  if (isOneSide && isManySide) return 'bridge';
  return 'unknown';
};

const DATE_TABLE_PREFERRED_NAMES = ['Date', 'Calendar', 'Date Table'];

export const buildSemanticModel = (
  datasets: Dataset[],
  options: BuildModelOptions = {}
): SemanticModel => {
  const warnings: ModelWarning[] = [];
  const fiscal: FiscalConfig = {
    startMonth: options.fiscal?.startMonth ?? DEFAULT_FISCAL.startMonth,
    naming: options.fiscal?.naming ?? DEFAULT_FISCAL.naming,
  };

  const takenNames = new Set<string>();
  const prepared: PreparedTable[] = [];

  for (const dataset of datasets) {
    const desired = tableNameFor(dataset.name, `Table ${prepared.length + 1}`);
    const name = uniqueTableName(desired, takenNames);
    if (name !== desired) {
      warnings.push({
        code: 'duplicate_table_name',
        severity: 'info',
        table: name,
        // Not "two datasets are called X" any more: orders.csv and
        // orders.xlsx are different names that become the same table.
        message: `Two tables would be called "${desired}". This one is referred to as "${name}".`,
      });
    }
    takenNames.add(name.toLowerCase());

    if (dataset.data.length === 0) {
      warnings.push({
        code: 'empty_table',
        severity: 'warning',
        table: name,
        message: `"${name}" has no rows. Measures over it return blank.`,
      });
    }

    prepared.push(prepareTable(dataset, name, options, warnings));
  }

  const relationships = detectRelationships(prepared, datasets, warnings);

  // Which columns take part in a relationship, table -> columns, lower-cased.
  const relatedColumns = new Map<string, Set<string>>();
  const noteRelated = (table: string, column: string): void => {
    const key = table.toLowerCase();
    const columns = relatedColumns.get(key) ?? new Set<string>();
    columns.add(column.toLowerCase());
    relatedColumns.set(key, columns);
  };
  for (const relationship of relationships) {
    noteRelated(relationship.from.table, relationship.from.column);
    noteRelated(relationship.to.table, relationship.to.column);
  }

  const tables: SemanticTable[] = prepared.map(table => {
    const columns: SemanticColumn[] = table.columnInfo.map(info => {
      const isDate = table.dateFormats.has(info.name);
      const verdict = inferColumnRole(
        {
          name: info.name,
          dataType: isDate ? 'date' : info.type,
          rowCount: table.rowCount,
          uniqueCount: info.uniqueCount,
          nullCount: info.nullCount,
          values: table.rows.map(row => row[info.name]),
        },
        {
          participatesInRelationship:
            relatedColumns.get(table.name.toLowerCase())?.has(info.name.toLowerCase()) ?? false,
        }
      );

      return {
        name: info.name,
        table: table.name,
        dataType: isDate ? 'date' : info.type,
        role: verdict.role,
        defaultAggregation: verdict.defaultAggregation,
        rowCount: table.rowCount,
        uniqueCount: info.uniqueCount,
        nullCount: info.nullCount,
        dateFormat: table.dateFormats.get(info.name),
        roleReason: verdict.reason,
      };
    });

    return {
      name: table.name,
      datasetId: table.datasetId,
      role: tableRoleFor(table, relationships),
      columns,
      rows: table.rows,
      rowCount: table.rowCount,
      isGenerated: false,
    };
  });

  let dateTableName: string | null = null;

  const anyDates = prepared.some(table => table.dateRange.min && table.dateRange.max);
  if (!anyDates) {
    warnings.push({
      code: 'no_date_column',
      severity: 'info',
      message:
        'No usable date column was found, so time intelligence (year to date, same period last year) is unavailable.',
    });
  } else if (!options.skipDateTable) {
    let min: Date | null = null;
    let max: Date | null = null;
    for (const table of prepared) {
      if (table.dateRange.min && (!min || table.dateRange.min < min)) min = table.dateRange.min;
      if (table.dateRange.max && (!max || table.dateRange.max > max)) max = table.dateRange.max;
    }

    if (min && max) {
      const name =
        DATE_TABLE_PREFERRED_NAMES.find(candidate => !takenNames.has(candidate.toLowerCase())) ??
        uniqueTableName('Date Table', takenNames);
      takenNames.add(name.toLowerCase());

      const rows = generateDateTable(min, max, { fiscal, padToFullYears: true });
      const first = rows[0];

      tables.push({
        name,
        datasetId: `generated:${name}`,
        role: 'date',
        rows: rows as unknown as Record<string, unknown>[],
        rowCount: rows.length,
        isGenerated: true,
        columns: Object.keys(first).map(columnName => {
          const isKey = columnName === 'Date';
          const value = first[columnName];
          return {
            name: columnName,
            table: name,
            dataType:
              isKey
                ? 'date'
                : typeof value === 'number'
                  ? 'number'
                  : typeof value === 'boolean'
                    ? 'boolean'
                    : 'string',
            role: isKey ? 'date' : typeof value === 'boolean' ? 'flag' : 'dimension',
            defaultAggregation: isKey ? 'none' : 'distinctCount',
            rowCount: rows.length,
            uniqueCount: new Set(rows.map(r => r[columnName])).size,
            nullCount: 0,
            roleReason: isKey
              ? 'The date key of the generated calendar.'
              : 'A generated calendar attribute, for grouping and filtering.',
          };
        }),
      });

      // Join every date column to the calendar. Only one per table may be
      // active, matching Power BI: a second active path would make the
      // answer depend on which route a filter took.
      const activeByTable = new Set<string>();
      for (const table of prepared) {
        for (const columnName of table.dateFormats.keys()) {
          const isFirst = !activeByTable.has(table.name);
          activeByTable.add(table.name);
          relationships.push({
            id: `${table.name}.${columnName}->${name}.Date`,
            from: { table: table.name, column: columnName },
            to: { table: name, column: 'Date' },
            cardinality: 'oneToMany',
            crossFilter: 'single',
            isActive: isFirst,
            confidence: 1,
            integrity: 1,
          });
          if (!isFirst) {
            warnings.push({
              code: 'inactive_relationship',
              severity: 'info',
              table: table.name,
              column: columnName,
              message: `"${columnName}" is also a date, but ${table.name} is already joined to ${name} on another column. Use USERELATIONSHIP to report by "${columnName}".`,
            });
          }
        }
      }

      dateTableName = name;
    }
  }

  return {
    tables,
    relationships,
    measures: options.measures ?? [],
    dateTableName,
    fiscal,
    warnings,
  };
};

// ============================================================
// Resolution
// ============================================================

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export const findTable = (model: SemanticModel, name: string): SemanticTable | undefined =>
  model.tables.find(table => sameName(table.name, name));

export const findMeasure = (model: SemanticModel, name: string): SemanticMeasure | undefined =>
  model.measures.find(measure => sameName(measure.name, name));

/**
 * Resolve a column reference.
 *
 * When no table is given the name must be unique across the model. An
 * ambiguous reference is an error rather than a first match, because picking
 * one silently would produce a number from the wrong table.
 */
export const findColumn = (
  model: SemanticModel,
  table: string | undefined,
  column: string
): Resolution<SemanticColumn> => {
  if (table) {
    const owner = findTable(model, table);
    if (!owner) {
      const names = model.tables.map(t => t.name).join(', ');
      return { ok: false, error: `There is no table called "${table}". Available: ${names}.` };
    }
    const found = owner.columns.find(c => sameName(c.name, column));
    if (!found) {
      const names = owner.columns.map(c => c.name).join(', ');
      return {
        ok: false,
        error: `"${owner.name}" has no column called "${column}". Available: ${names}.`,
      };
    }
    return { ok: true, value: found };
  }

  const matches = model.tables.flatMap(t => t.columns.filter(c => sameName(c.name, column)));

  if (matches.length === 0) {
    return { ok: false, error: `No table has a column called "${column}".` };
  }
  if (matches.length > 1) {
    const owners = matches.map(c => `${c.table}[${c.name}]`).join(', ');
    return {
      ok: false,
      error: `"${column}" is ambiguous - it exists in ${matches.length} tables (${owners}). Qualify it with a table name.`,
    };
  }
  return { ok: true, value: matches[0] };
};

/** Active relationships that propagate a filter out of `table`. */
export const relationshipsFrom = (
  model: SemanticModel,
  table: string
): SemanticRelationship[] =>
  model.relationships.filter(
    relationship =>
      relationship.isActive &&
      (sameName(relationship.to.table, table) ||
        (relationship.crossFilter === 'both' && sameName(relationship.from.table, table)))
  );
