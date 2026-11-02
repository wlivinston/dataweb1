import { describe, it, expect } from 'vitest';
import {
  chartTypeOptions,
  orderForActiveDataset,
  SWITCHABLE_CHART_TYPES,
} from '../visualizationDisplay';
import type { Visualization } from '../types';
import type { SupportedVisualizationType } from '../visualizationRenderer';

const viz = (id: string, datasetId: string): Visualization => ({
  id,
  title: id,
  type: 'bar',
  data: [],
  colors: [],
  gradient: '',
  daxCalculations: [],
  datasetId,
});

describe('the chart type picker', () => {
  // Every type the generator produces that the picker did not list rendered
  // as an empty dropdown on the live site.
  const generatedOnly: SupportedVisualizationType[] = [
    'heatmap', 'histogram', 'boxplot', 'radar', 'treemap', 'donut',
    'stacked_bar', 'pct_stacked_bar', 'bubble', 'pareto', 'funnel',
  ];

  it.each(generatedOnly)('lists a %s chart\'s own type, first', type => {
    const options = chartTypeOptions(type);
    expect(options[0]).toBe(type);
    expect(options).toEqual([type, ...SWITCHABLE_CHART_TYPES]);
  });

  it('does not repeat a switchable type', () => {
    expect(chartTypeOptions('pie')).toEqual([...SWITCHABLE_CHART_TYPES]);
  });
});

describe('which charts fill the first 20 slots', () => {
  // Upload order: 25 code-cart charts, then the participants charts.
  const carts = Array.from({ length: 25 }, (_, i) => viz(`cart-${i}`, 'carts'));
  const people = Array.from({ length: 5 }, (_, i) => viz(`people-${i}`, 'participants'));
  const all = [...carts, ...people];

  it('the active dataset\'s charts are shown, not crowded out by an earlier upload', () => {
    const shown = orderForActiveDataset(all, 'participants').slice(0, 20);
    expect(shown.slice(0, 5).map(v => v.id)).toEqual(people.map(v => v.id));
  });

  it('keeps every chart and each group in its generated order', () => {
    const ordered = orderForActiveDataset(all, 'participants');
    expect(ordered).toHaveLength(all.length);
    expect(ordered.slice(5).map(v => v.id)).toEqual(carts.map(v => v.id));
  });

  it('no active dataset leaves the order alone', () => {
    expect(orderForActiveDataset(all, null).map(v => v.id)).toEqual(all.map(v => v.id));
  });
});
