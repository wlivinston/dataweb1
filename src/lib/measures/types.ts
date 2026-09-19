import type { ColumnRole, SemanticColumn, SemanticModel } from '../semantic/types';
import type { DataType } from '../types';
import type { DaxScalar } from '../dax/value';

/**
 * A named business measure, described once and bound to whatever model is
 * loaded.
 *
 * The roadmap called for each template to carry portable DAX *and* a native
 * executable implementation. That was written before the DAX engine existed.
 * Keeping both would mean every measure has two implementations that can
 * disagree - which is precisely what produced the timezone bug in
 * kpiFormulaEngine, where a second copy of TOTALYTD quietly counted
 * 1 January in the wrong year for two years.
 *
 * So there is one implementation: the DAX. It runs through the engine, and
 * the same text is what exports to Power BI. If the two ever disagree it is
 * because Power BI and this engine disagree, which the parity sheet exists
 * to catch.
 */

export type MeasurePack = 'sales' | 'finance' | 'customer' | 'inventory' | 'operations';

export type MeasureFormat = 'number' | 'integer' | 'currency' | 'percent' | 'ratio';

/**
 * A column the template needs, and how to recognise a good candidate.
 *
 * `role` is the hard filter - a measure that sums money must not be offered
 * a customer id, whatever it is called. `prefers` only ranks among columns
 * that already qualify, so a bad name can cost a column its place but a good
 * name can never promote one that does not fit.
 */
export interface MeasureSlot {
  /** Name used in the template's DAX, as {slot}. */
  name: string;
  /** What the column must be. Any one of these qualifies. */
  role: ColumnRole | ColumnRole[];
  dataType?: DataType;
  /** Words that make a qualifying column a better fit. */
  prefers?: string[];
  /** Words that make a qualifying column a worse fit. */
  avoids?: string[];
  /** When true the measure is still offered if nothing fills this. */
  optional?: boolean;
  /** Shown when explaining which column was chosen and why. */
  describes: string;
}

export interface InterpretContext {
  /** The value, already rendered for display. */
  formatted: string;
  /** Which column filled each slot. */
  bindings: Record<string, SemanticColumn>;
  model: SemanticModel;
  /** The table the measure was bound to. */
  table: string;
}

export interface MeasureTemplate {
  id: string;
  name: string;
  pack: MeasurePack;
  description: string;
  /**
   * DAX with {slot} placeholders. {slot} becomes a quoted column reference,
   * {slot:table} its table, and {calendar} the model's date column.
   */
  dax: string;
  slots: MeasureSlot[];
  /** Needs the bound table to be joined to a date table. */
  needsCalendar?: boolean;
  format: MeasureFormat;
  /**
   * Turn the value into a sentence someone can act on.
   *
   * Never mentions a currency: the model does not carry one, and a figure
   * labelled with the wrong symbol is worse than an unlabelled one - the
   * same reason FORMAT refuses "Currency".
   */
  interpret: (value: DaxScalar, context: InterpretContext) => string;
}

/** One column chosen for one slot, with why it was chosen. */
export interface SlotBinding {
  slot: MeasureSlot;
  column: SemanticColumn;
  score: number;
  /** Plain-language justification, shown in the UI. */
  reason: string;
}

/**
 * A template bound to real columns.
 *
 * `dax` is complete, runnable, and exportable to Power BI unchanged - it is
 * not a preview of what would be generated later.
 */
export interface ResolvedMeasure {
  template: MeasureTemplate;
  /** Includes the bound column names, so two bindings stay distinguishable. */
  id: string;
  name: string;
  table: string;
  dax: string;
  bindings: SlotBinding[];
  /** Sum of slot scores. Higher means the columns fit the template better. */
  score: number;
}

/** A resolved measure plus what it evaluated to. */
export interface MeasureResult {
  measure: ResolvedMeasure;
  /** Absent when evaluation failed. */
  value?: DaxScalar;
  formatted?: string;
  interpretation?: string;
  /** Why there is no value. Mutually exclusive with `value`. */
  error?: string;
}
