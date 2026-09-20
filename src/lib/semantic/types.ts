import type { DataType } from '../types';
import type { DateFormat, DateFormatStatus } from './dates';
import type { FiscalConfig } from './dateTable';

/**
 * What a column is for, which decides what the product may offer to do with
 * it. The distinction that matters most is key versus measure: a numeric
 * CustomerID is not something anyone wants summed, and offering SUM of it is
 * the classic way a BI tool looks stupid.
 */
export type ColumnRole =
  /** Uniquely identifies a row in its own table. */
  | 'key'
  /** Points at another table's key. */
  | 'foreignKey'
  /** Numeric and meaningfully aggregatable. */
  | 'measure'
  /** Categorical, worth grouping by. */
  | 'dimension'
  | 'date'
  | 'flag'
  /** Free text: too varied to group by, not aggregatable. */
  | 'text';

export type Aggregation =
  | 'sum'
  | 'average'
  | 'min'
  | 'max'
  | 'count'
  | 'distinctCount'
  | 'none';

export type TableRole = 'fact' | 'dimension' | 'date' | 'bridge' | 'unknown';

export interface SemanticColumn {
  name: string;
  /** Owning table name, so a column can be passed around on its own. */
  table: string;
  dataType: DataType;
  role: ColumnRole;
  /** What an aggregation defaults to when the user does not say. */
  defaultAggregation: Aggregation;
  rowCount: number;
  uniqueCount: number;
  nullCount: number;
  /** How this column's values are read, for date columns only. */
  dateFormat?: DateFormat;
  /** Plain-language justification for `role`, shown in the UI. */
  roleReason: string;
}

export interface SemanticTable {
  name: string;
  /** Source dataset id, or a synthetic id for a generated table. */
  datasetId: string;
  role: TableRole;
  columns: SemanticColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  /** True for the date table the model builds itself. */
  isGenerated: boolean;
}

export interface ColumnPointer {
  table: string;
  column: string;
}

/**
 * A relationship, always oriented so filters flow from `to` into `from`.
 *
 * `to` is the one side: its key is unique, and it is the table a filter is
 * applied to. `from` is the many side, which receives the filter. Getting
 * this backwards silently returns unfiltered totals, so orientation is
 * measured from the data rather than taken on trust.
 */
export interface SemanticRelationship {
  id: string;
  /** Many side. Receives filters. */
  from: ColumnPointer;
  /** One side. Propagates filters. */
  to: ColumnPointer;
  cardinality: 'oneToMany' | 'oneToOne' | 'manyToMany';
  /** 'single' propagates one-to-many only; 'both' also propagates back. */
  crossFilter: 'single' | 'both';
  /**
   * Only active relationships propagate filters. A second path between the
   * same two tables is deactivated, mirroring Power BI, so results stay
   * deterministic.
   */
  isActive: boolean;
  confidence: number;
  /** Fraction of many-side values that find a match on the one side. */
  integrity: number;
}

export interface SemanticMeasure {
  name: string;
  /** DAX text. Parsed on demand rather than at model build time. */
  expression: string;
  description?: string;
  /** Table the measure is displayed under; does not affect evaluation. */
  homeTable?: string;
  formatHint?: 'number' | 'currency' | 'percent' | 'integer';
}

export type ModelWarningCode =
  | 'ambiguous_date_format'
  | 'inconsistent_date_format'
  | 'unparsed_dates'
  | 'no_date_column'
  | 'referential_integrity'
  | 'inactive_relationship'
  | 'many_to_many'
  | 'duplicate_table_name'
  | 'empty_table';

/**
 * Something the user needs to know about their model.
 *
 * These are not logged and forgotten - anything that changes what a number
 * means has to reach the person reading the number.
 */
export interface ModelWarning {
  code: ModelWarningCode;
  severity: 'info' | 'warning' | 'error';
  message: string;
  table?: string;
  column?: string;
  /** Present on date warnings, so the UI can offer to switch the reading. */
  dateStatus?: DateFormatStatus;
}

export interface SemanticModel {
  tables: SemanticTable[];
  relationships: SemanticRelationship[];
  measures: SemanticMeasure[];
  /** Name of the date table, generated or detected. Null if no dates exist. */
  dateTableName: string | null;
  fiscal: FiscalConfig;
  warnings: ModelWarning[];
}

/** A lookup that either succeeds or explains itself. */
export type Resolution<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
