// What the All Visualizations panel shows, and in what order.
//
// Kept out of the components so the rules can be tested without a DOM.

import type { Visualization } from '@/lib/types';
import type { SupportedVisualizationType } from '@/lib/visualizationRenderer';

/** Types any chart can be switched to: they all read the same category/value rows. */
export const SWITCHABLE_CHART_TYPES: readonly SupportedVisualizationType[] = [
  'bar',
  'line',
  'area',
  'pie',
  'scatter',
  'table',
];

/**
 * The picker's choices for a chart that was generated as `ownType`.
 *
 * The picker used to offer only the six switchable types. A heatmap, histogram,
 * box plot, radar, treemap, donut or stacked bar then had a value the picker
 * did not list, so the dropdown rendered EMPTY - and once switched away, there
 * was no way back to the chart the data was shaped for. The chart's own type
 * always comes first.
 */
export const chartTypeOptions = (ownType: SupportedVisualizationType): SupportedVisualizationType[] =>
  SWITCHABLE_CHART_TYPES.includes(ownType)
    ? [...SWITCHABLE_CHART_TYPES]
    : [ownType, ...SWITCHABLE_CHART_TYPES];

/**
 * Charts for the active dataset first, every other dataset's after, each group
 * in its generated order.
 *
 * The panel renders only the first 20 charts. They were in upload order, so
 * with several datasets the first file's charts filled every slot: a user
 * looking at "participants" saw twenty charts about code carts and none about
 * participants, beside KPI tiles that were about participants.
 */
export const orderForActiveDataset = (
  visualizations: readonly Visualization[],
  activeDatasetId: string | null | undefined
): Visualization[] => {
  if (!activeDatasetId) return [...visualizations];
  const active = visualizations.filter(v => v.datasetId === activeDatasetId);
  const rest = visualizations.filter(v => v.datasetId !== activeDatasetId);
  return [...active, ...rest];
};
