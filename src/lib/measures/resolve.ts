import { columnRef, tableRef } from '../dax/printer';
import { tokeniseColumnName } from '../semantic/roles';
import type { SemanticColumn, SemanticModel, SemanticTable } from '../semantic/types';
import type {
  MeasureSlot,
  MeasureTemplate,
  ResolvedMeasure,
  SlotBinding,
} from './types';

/**
 * Bind measure templates to the columns a model actually has.
 *
 * Every slot is filled from a SINGLE table. Letting revenue come from one
 * table and cost from another would produce a gross margin from two
 * unrelated grains and no warning that it happened - the number would look
 * ordinary and mean nothing.
 *
 * Role is a hard filter and name is only a tie-break. A column called
 * "Total Revenue" that the model reads as a key is still not summable, and
 * offering to sum it is the classic way a BI tool announces it has not
 * understood the data.
 */

/** Below this, the columns fit badly enough that the measure is not offered. */
const MINIMUM_SCORE = 0;

const PREFER_BONUS = 12;
const AVOID_PENALTY = 20;
const FACT_TABLE_BONUS = 4;
/** Prefers matching on the whole name beats matching one token of many. */
const EXACT_NAME_BONUS = 6;

const rolesOf = (slot: MeasureSlot): string[] =>
  Array.isArray(slot.role) ? slot.role : [slot.role];

const qualifies = (slot: MeasureSlot, column: SemanticColumn): boolean => {
  if (!rolesOf(slot).includes(column.role)) return false;
  if (slot.dataType && column.dataType !== slot.dataType) return false;
  return true;
};

/**
 * How well a qualifying column matches the slot's wording.
 *
 * Only ever ranks columns that already passed `qualifies`, so a flattering
 * name cannot promote a column the model says is the wrong kind.
 */
const scoreName = (slot: MeasureSlot, column: SemanticColumn, table: SemanticTable): number => {
  const tokens = new Set(tokeniseColumnName(column.name));
  const whole = column.name.toLowerCase().replace(/[\s_\-./]+/g, '');
  let score = 0;

  for (const word of slot.prefers ?? []) {
    const wanted = word.toLowerCase();
    if (tokens.has(wanted)) score += PREFER_BONUS;
    if (whole === wanted.replace(/\s+/g, '')) score += EXACT_NAME_BONUS;
  }

  for (const word of slot.avoids ?? []) {
    if (tokens.has(word.toLowerCase())) score -= AVOID_PENALTY;
  }

  // A measure over the fact table is almost always what was meant.
  if (table.role === 'fact') score += FACT_TABLE_BONUS;

  // More distinct values means more to say. Breaks ties between two
  // otherwise equal numeric columns without ever outweighing a name match.
  score += Math.min(3, Math.floor(Math.log10(Math.max(column.uniqueCount, 1))));

  return score;
};

const reasonFor = (slot: MeasureSlot, column: SemanticColumn): string => {
  const matched = (slot.prefers ?? []).filter(word =>
    tokeniseColumnName(column.name).includes(word.toLowerCase())
  );
  const named = matched.length > 0 ? ` Its name mentions ${matched.join(', ')}.` : '';
  return `${column.table}[${column.name}] is the ${slot.describes}. ${column.roleReason}${named}`;
};

/** The best column in one table for one slot, or null if none qualifies. */
const bestForSlot = (
  slot: MeasureSlot,
  table: SemanticTable
): SlotBinding | null => {
  const candidates = table.columns
    .filter(column => qualifies(slot, column))
    .map(column => ({ column, score: scoreName(slot, column, table) }))
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  if (!best) return null;
  return { slot, column: best.column, score: best.score, reason: reasonFor(slot, best.column) };
};

interface CalendarBinding {
  table: string;
  column: string;
  /** A year column, when the calendar has one. Null disqualifies {calendar:year}. */
  yearColumn: string | null;
}

/** The date column of the model's calendar, when the table is joined to it. */
const calendarFor = (
  model: SemanticModel,
  table: SemanticTable
): CalendarBinding | null => {
  if (!model.dateTableName) return null;
  const calendar = model.tables.find(candidate => candidate.name === model.dateTableName);
  const dateColumn = calendar?.columns.find(candidate => candidate.dataType === 'date');
  if (!calendar || !dateColumn) return null;

  // Without an active join the calendar's filter never reaches these rows, so
  // TOTALYTD would return the grand total wearing a year-to-date label.
  const joined = model.relationships.some(
    relationship =>
      relationship.isActive &&
      relationship.to.table === calendar.name &&
      relationship.from.table === table.name
  );
  if (!joined) return null;

  const yearColumn = calendar.columns.find(
    candidate => candidate.name.toLowerCase() === 'year' && candidate.dataType === 'number'
  );
  return {
    table: calendar.name,
    column: dateColumn.name,
    yearColumn: yearColumn?.name ?? null,
  };
};

/**
 * Substitute the bound columns into the template's DAX.
 *
 * References are built with the printer's quoting rules, so a table called
 * `Q1 Sales` or a column called `Margin [%]` produces text that parses.
 */
const PLACEHOLDER = /\{([A-Za-z0-9_]+)(?::(table|year))?\}/g;

const fillTemplate = (
  template: MeasureTemplate,
  bindings: SlotBinding[],
  calendar: CalendarBinding | null
): string => {
  const bySlot = new Map(bindings.map(binding => [binding.slot.name, binding.column]));

  return template.dax.replace(PLACEHOLDER, (_whole, slotName: string, qualifier?: string) => {
    if (slotName === 'calendar') {
      if (!calendar) throw new Error(`${template.id} used {calendar} without one bound.`);
      if (qualifier === 'table') return tableRef(calendar.table);
      if (qualifier === 'year') {
        if (!calendar.yearColumn) {
          throw new Error(`${template.id} used {calendar:year} without a year column.`);
        }
        return columnRef(calendar.table, calendar.yearColumn);
      }
      return columnRef(calendar.table, calendar.column);
    }

    const column = bySlot.get(slotName);
    if (!column) throw new Error(`${template.id} has no slot called "${slotName}".`);
    return qualifier === 'table' ? tableRef(column.table) : columnRef(column.table, column.name);
  });
};

/** Distinguishes two bindings of the same template to different columns. */
const idFor = (template: MeasureTemplate, bindings: SlotBinding[], table: string): string =>
  [template.id, table, ...bindings.map(binding => binding.column.name)]
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export interface ResolveOptions {
  /** Restrict to these packs. Omitted, every pack is considered. */
  packs?: MeasureTemplate['pack'][];
  /** Restrict to one table. */
  table?: string;
  /** At most this many per template, best first. Defaults to 1. */
  perTemplate?: number;
}

/** Bind one template against one table, or return null if it does not fit. */
const resolveAgainst = (
  template: MeasureTemplate,
  model: SemanticModel,
  table: SemanticTable
): ResolvedMeasure | null => {
  if (table.rowCount === 0) return null;

  const calendar = calendarFor(model, table);
  if (template.needsCalendar && !calendar) return null;
  // A template that anchors itself to a year needs a year column to anchor
  // on. Without one it would have to fall back to something vaguer, and a
  // vaguer comparison period is the whole problem these measures have.
  if (template.dax.includes('{calendar:year}') && !calendar?.yearColumn) return null;

  const bindings: SlotBinding[] = [];
  for (const slot of template.slots) {
    const binding = bestForSlot(slot, table);
    if (!binding) {
      if (slot.optional) continue;
      return null;
    }
    bindings.push(binding);
  }

  // Two slots resolving to the same column means the template asked for two
  // different things and got one. Revenue per customer over
  // DIVIDE(SUM(x), DISTINCTCOUNT(x)) is not a measure of anything.
  const used = new Set(bindings.map(binding => binding.column.name.toLowerCase()));
  if (used.size !== bindings.length) return null;

  const score = bindings.reduce((total, binding) => total + binding.score, 0);
  if (score < MINIMUM_SCORE) return null;

  return {
    template,
    id: idFor(template, bindings, table.name),
    name: template.name,
    table: table.name,
    dax: fillTemplate(template, bindings, calendar),
    bindings,
    score,
  };
};

/**
 * Every measure the model can support, best fit first.
 *
 * A template that cannot be filled is simply absent. Offering a measure that
 * has nothing sensible to bind to, and letting it fail when someone runs it,
 * moves the disappointment later without removing it.
 */
export const resolveMeasures = (
  model: SemanticModel,
  templates: MeasureTemplate[],
  options: ResolveOptions = {}
): ResolvedMeasure[] => {
  const perTemplate = options.perTemplate ?? 1;
  const tables = model.tables.filter(table => {
    if (table.isGenerated) return false;
    if (options.table && table.name !== options.table) return false;
    return true;
  });

  const resolved: ResolvedMeasure[] = [];

  for (const template of templates) {
    if (options.packs && !options.packs.includes(template.pack)) continue;

    const matches = tables
      .map(table => resolveAgainst(template, model, table))
      .filter((match): match is ResolvedMeasure => match !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, perTemplate);

    resolved.push(...matches);
  }

  return resolved.sort((left, right) => right.score - left.score);
};
