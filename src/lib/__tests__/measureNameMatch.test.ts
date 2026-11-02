import { describe, it, expect } from 'vitest';
import { makeDataset } from './fixtures';
import { buildSemanticModel } from '../semantic/model';
import { resolveMeasures, MEASURE_LIBRARY } from '../measures';

/**
 * A business measure needs a column that is that kind of figure.
 *
 * On a study of participants the library offered "Total Revenue 10,308" (the
 * sum of age), "Average Order Value", "Units Sold" and "Total Cost" from the
 * same column, and "Customer Count" from participant ids - because names only
 * ranked candidates and any numeric column qualified.
 */

const names = (rows: Record<string, unknown>[], specs: Parameters<typeof makeDataset>[1]) =>
  resolveMeasures(buildSemanticModel([makeDataset(rows, specs, { id: 'ds', name: 'T' })]), MEASURE_LIBRARY)
    .map(m => m.template.name)
    .sort();

describe('business measures need a matching column', () => {
  it('a participants table gets no revenue, order, cost, unit or customer measures', () => {
    const offered = names(
      Array.from({ length: 30 }, (_, i) => ({
        participant_id: `P${i}`,
        age: 20 + i,
        baseline_score: 40 + (i % 7),
      })),
      [
        { name: 'participant_id', type: 'string' },
        { name: 'age', type: 'number' },
        { name: 'baseline_score', type: 'number' },
      ]
    );
    expect(offered).toEqual(['Completeness %', 'Record Count']);
  });

  it('a sales table still gets them', () => {
    const offered = names(
      Array.from({ length: 30 }, (_, i) => ({
        OrderID: `O${i}`,
        CustomerID: `C${i % 9}`,
        Revenue: 100 + i,
        Quantity: 1 + (i % 4),
      })),
      [
        { name: 'OrderID', type: 'string' },
        { name: 'CustomerID', type: 'string' },
        { name: 'Revenue', type: 'number' },
        { name: 'Quantity', type: 'number' },
      ]
    );
    for (const wanted of ['Total Revenue', 'Order Count', 'Average Order Value', 'Customer Count', 'Units Sold']) {
      expect(offered).toContain(wanted);
    }
  });
});
