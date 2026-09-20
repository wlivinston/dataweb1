import { runDax, formatDaxValue } from '../dax/run';
import { MEASURE_LIBRARY } from './library';
import { resolveMeasures, type ResolveOptions } from './resolve';
import type { SemanticModel, SemanticColumn, SemanticMeasure } from '../semantic/types';
import type { DaxScalar } from '../dax/value';
import type {
  MeasureFormat,
  MeasureResult,
  MeasureTemplate,
  ResolvedMeasure,
} from './types';

export * from './types';
export { MEASURE_LIBRARY, templatesInPack } from './library';
export { resolveMeasures } from './resolve';

/**
 * Render a measure's value for display.
 *
 * Percentages are the only place this departs from the engine's own
 * formatting: DAX returns 0.423 where a reader expects 42.3%. No currency
 * symbol is ever added - the model does not know the currency, and the wrong
 * one is worse than none.
 */
export const formatMeasureValue = (value: DaxScalar, format: MeasureFormat): string => {
  if (value === null) return 'BLANK';
  if (typeof value !== 'number') return formatDaxValue(value);
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';

  switch (format) {
    case 'percent':
      return `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    case 'integer':
      return Math.round(value).toLocaleString();
    case 'ratio':
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    case 'currency':
    case 'number':
    default:
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
};

/** Which column ended up in each slot, for the interpretation to name. */
const bindingMap = (measure: ResolvedMeasure): Record<string, SemanticColumn> =>
  Object.fromEntries(measure.bindings.map(binding => [binding.slot.name, binding.column]));

/**
 * Run one resolved measure.
 *
 * Returns a value or a reason, never both and never neither. An
 * interpretation is only produced alongside a value: narrating a number that
 * does not exist is how a report ends up confidently describing nothing.
 */
export const evaluateMeasure = (
  measure: ResolvedMeasure,
  model: SemanticModel,
  options: { today?: Date } = {}
): MeasureResult => {
  const outcome = runDax(measure.dax, model, { today: options.today });
  if (!outcome.ok) {
    return { measure, error: outcome.message };
  }

  const formatted = formatMeasureValue(outcome.value, measure.template.format);
  return {
    measure,
    value: outcome.value,
    formatted,
    interpretation: measure.template.interpret(outcome.value, {
      formatted,
      bindings: bindingMap(measure),
      model,
      table: measure.table,
    }),
  };
};

export interface MeasureLibraryOptions extends ResolveOptions {
  /** Use a different set of templates, mainly for tests. */
  templates?: MeasureTemplate[];
}

/** Every measure this model supports, unevaluated. */
export const availableMeasures = (
  model: SemanticModel,
  options: MeasureLibraryOptions = {}
): ResolvedMeasure[] =>
  resolveMeasures(model, options.templates ?? MEASURE_LIBRARY, options);

/** Every measure this model supports, evaluated. */
export const runMeasureLibrary = (
  model: SemanticModel,
  options: MeasureLibraryOptions & { today?: Date } = {}
): MeasureResult[] =>
  availableMeasures(model, options).map(measure =>
    evaluateMeasure(measure, model, { today: options.today })
  );

/**
 * Turn resolved measures into model measures, so they can be referenced by
 * name from other DAX - `[Gross Margin %]` rather than the whole expression.
 */
export const asSemanticMeasures = (measures: ResolvedMeasure[]): SemanticMeasure[] =>
  measures.map(measure => ({
    name: measure.name,
    expression: measure.dax,
    description: measure.template.description,
    homeTable: measure.table,
    formatHint:
      measure.template.format === 'ratio'
        ? 'number'
        : (measure.template.format as SemanticMeasure['formatHint']),
  }));

/**
 * Export measures as a Power BI script.
 *
 * The DAX is the same text the engine ran, not a re-rendering of it - which
 * is the whole reason templates carry DAX rather than a native
 * implementation. What was verified here is what leaves here.
 */
export const toPowerBiScript = (measures: ResolvedMeasure[]): string => {
  if (measures.length === 0) return '// No measures matched this model.\n';

  const lines = measures.map(measure => {
    const slots = measure.bindings
      .map(binding => `//   ${binding.slot.name}: ${binding.column.table}[${binding.column.name}]`)
      .join('\n');
    return [
      `// ${measure.name} - ${measure.template.description}`,
      slots,
      `${measure.name} = ${measure.dax}`,
    ].join('\n');
  });

  return [
    '// Measures generated from the loaded model.',
    '// Paste each one into Power BI Desktop: Modeling > New measure.',
    '',
    lines.join('\n\n'),
    '',
  ].join('\n');
};
