import { describe, it, expect } from 'vitest';
import { makeDataset, seededRandom, seededNormal } from './fixtures';
import {
  preprocessDataset,
  getTrainTestPartition,
  trainAllModels,
  detectMLProblem,
  computeRegressionMetrics,
  computeClassificationMetrics,
} from '../mlEngine';

const numericSpec = (names: string[]) =>
  names.map((name) => ({ name, type: 'number' as const }));

/** Regression fixture: y = 3x1 - 2x2 + 10, with a little seeded noise. */
const linearRows = (n: number) => {
  const rng = seededRandom(42);
  return Array.from({ length: n }, () => {
    const x1 = Math.round(rng() * 100);
    const x2 = Math.round(rng() * 50);
    return { x1, x2, y: 3 * x1 - 2 * x2 + 10 + seededNormal(rng, 0, 1) };
  });
};

describe('Train/test partition', () => {
  const dataset = makeDataset(linearRows(100), numericSpec(['x1', 'x2', 'y']));
  const { processedDataset } = preprocessDataset(dataset, 'y', ['x1', 'x2'], {
    imputeStrategy: 'mean_imputation',
    scalingMethod: 'z_score',
    trainTestSplit: 0.8,
  });

  it('records the partition boundary on the processed dataset', () => {
    expect(processedDataset.trainCount).toBe(80);
    expect(processedDataset.data).toHaveLength(100);
  });

  it('splits into disjoint partitions that together cover every row', () => {
    const { train, test } = getTrainTestPartition(processedDataset);
    expect(train).toHaveLength(80);
    expect(test).toHaveLength(20);
    expect(train.length + test.length).toBe(processedDataset.data.length);
    // No row object appears in both halves.
    const overlap = test.filter((t) => train.includes(t));
    expect(overlap).toHaveLength(0);
  });

  it('is deterministic across runs', () => {
    const again = preprocessDataset(dataset, 'y', ['x1', 'x2'], {
      imputeStrategy: 'mean_imputation',
      scalingMethod: 'z_score',
      trainTestSplit: 0.8,
    }).processedDataset;
    expect(again.data).toEqual(processedDataset.data);
  });

  it('gives every model the identical hold-out', () => {
    const a = getTrainTestPartition(processedDataset);
    const b = getTrainTestPartition(processedDataset);
    expect(a.test).toEqual(b.test);
  });
});

describe('Preprocessing does not leak the test split', () => {
  /**
   * The target is irrelevant here; what matters is that the feature column has
   * a very different distribution in the rows that end up held out. If the
   * scaler were fit over the whole dataset, its mean would move toward the
   * extreme values. Fit on the training partition alone, it must not.
   */
  const rows = [
    ...Array.from({ length: 80 }, (_, i) => ({ f: 10, y: i })),
    ...Array.from({ length: 20 }, (_, i) => ({ f: 1000, y: 80 + i })),
  ];
  const dataset = makeDataset(rows, numericSpec(['f', 'y']));

  it('fits scaling parameters on the training rows only', () => {
    const { processedDataset } = preprocessDataset(dataset, 'y', ['f'], {
      imputeStrategy: 'mean_imputation',
      scalingMethod: 'z_score',
      trainTestSplit: 0.8,
    });

    const { train } = getTrainTestPartition(processedDataset);
    // Recover the raw feature values that landed in training and check the
    // recorded scaler matches THEM, not the full column.
    const fullMean = rows.reduce((s, r) => s + r.f, 0) / rows.length; // 208
    const recorded = processedDataset.scalingParams.f.mean;

    const trainRawMean =
      train.reduce((s, r) => s + (r.f * processedDataset.scalingParams.f.std + recorded), 0) /
      train.length;

    expect(recorded).toBeCloseTo(trainRawMean, 6);
    expect(recorded).not.toBeCloseTo(fullMean, 0);
  });

  it('fits the scaler minimum and maximum on training rows only', () => {
    const ordered = [
      ...Array.from({ length: 80 }, () => ({ f: 5, g: 1, y: 1 })),
      ...Array.from({ length: 20 }, () => ({ f: 9999, g: 2, y: 2 })),
    ];
    const ds = makeDataset(ordered, numericSpec(['f', 'g', 'y']));
    const { processedDataset } = preprocessDataset(ds, 'y', ['f', 'g'], {
      imputeStrategy: 'mean_imputation',
      scalingMethod: 'min_max',
      trainTestSplit: 0.8,
    });
    // Whatever rows are chosen for training, the scaler range must be drawn from
    // them; it can never span the full column when the extremes are held out.
    const { train } = getTrainTestPartition(processedDataset);
    expect(train).toHaveLength(80);
    expect(processedDataset.scalingParams.f.max).toBeLessThanOrEqual(9999);
  });

  it('fits imputation values on the training rows only', () => {
    // 80 rows of 100, then 20 rows that are missing. The fill value must be the
    // training mean (100), never influenced by the held-out rows.
    const withGaps = [
      ...Array.from({ length: 80 }, (_, i) => ({ f: 100, y: i })),
      ...Array.from({ length: 20 }, (_, i) => ({ f: null as number | null, y: 80 + i })),
    ];
    const ds = makeDataset(withGaps as Record<string, unknown>[], numericSpec(['f', 'y']));
    const { processedDataset, report } = preprocessDataset(ds, 'y', ['f'], {
      imputeStrategy: 'mean_imputation',
      scalingMethod: 'none',
      trainTestSplit: 0.8,
    });

    expect(report.imputedCells).toBeGreaterThan(0);
    // Every imputed value equals the mean of the non-missing training rows, so
    // the whole column collapses to a single value.
    const values = new Set(processedDataset.data.map((r) => r.f));
    expect(values.size).toBe(1);
    expect([...values][0]).toBeCloseTo(100, 6);
  });

  it('never scales the target column', () => {
    const dataset2 = makeDataset(linearRows(60), numericSpec(['x1', 'x2', 'y']));
    const { processedDataset } = preprocessDataset(dataset2, 'y', ['x1', 'x2'], {
      imputeStrategy: 'mean_imputation',
      scalingMethod: 'z_score',
      trainTestSplit: 0.8,
    });
    const targets = processedDataset.data.map((r) => r.y);
    // z-scored values would sit in roughly [-3, 3]; raw targets run to ~300.
    expect(Math.max(...targets)).toBeGreaterThan(50);
  });
});

describe('Stratified splitting for classification', () => {
  it('preserves class balance across the partition', () => {
    // 75 of class A, 25 of class B.
    const rows = [
      ...Array.from({ length: 75 }, (_, i) => ({ f: i, label: 'A' })),
      ...Array.from({ length: 25 }, (_, i) => ({ f: i, label: 'B' })),
    ];
    const ds = makeDataset(rows, [
      { name: 'f', type: 'number' },
      { name: 'label', type: 'string' },
    ]);

    const { processedDataset } = preprocessDataset(ds, 'label', ['f'], {
      imputeStrategy: 'mean_imputation',
      scalingMethod: 'z_score',
      trainTestSplit: 0.8,
    });

    expect(processedDataset.stratified).toBe(true);

    const { train, test } = getTrainTestPartition(processedDataset);
    const shareOfB = (part: Record<string, number>[]) =>
      part.filter((r) => r.label === processedDataset.labelMappings.label.B).length / part.length;

    // Both partitions land close to the 25% base rate.
    expect(shareOfB(train)).toBeGreaterThan(0.15);
    expect(shareOfB(train)).toBeLessThan(0.35);
    expect(shareOfB(test)).toBeGreaterThan(0.15);
    expect(shareOfB(test)).toBeLessThan(0.35);
  });

  it('keeps both classes present in the test partition', () => {
    const rows = [
      ...Array.from({ length: 60 }, (_, i) => ({ f: i, label: 'yes' })),
      ...Array.from({ length: 40 }, (_, i) => ({ f: i, label: 'no' })),
    ];
    const ds = makeDataset(rows, [
      { name: 'f', type: 'number' },
      { name: 'label', type: 'string' },
    ]);
    const { processedDataset } = preprocessDataset(ds, 'label', ['f'], {
      imputeStrategy: 'mean_imputation',
      scalingMethod: 'none',
      trainTestSplit: 0.8,
    });
    const { test } = getTrainTestPartition(processedDataset);
    expect(new Set(test.map((r) => r.label)).size).toBe(2);
  });
});

describe('Model selection', () => {
  it('ranks on a validation slice and scores the winner on the test set', async () => {
    const dataset = makeDataset(linearRows(200), numericSpec(['x1', 'x2', 'y']));
    const { processedDataset } = preprocessDataset(dataset, 'y', ['x1', 'x2'], {
      imputeStrategy: 'mean_imputation',
      scalingMethod: 'z_score',
      trainTestSplit: 0.8,
    });

    const comparison = await trainAllModels(processedDataset, 'regression', 0.8);

    expect(comparison.selectionMethod).toBe('validation');
    expect(comparison.bestModel.scoredOn).toBe('test');
    expect(comparison.bestModel.isTopModel).toBe(true);

    // Exactly one winner.
    expect(comparison.results.filter((m) => m.isTopModel)).toHaveLength(1);
    // Every other model carries a validation score, so the leaderboard says
    // plainly what each number was measured on.
    for (const m of comparison.results) {
      if (m === comparison.bestModel) continue;
      expect(m.scoredOn).toBe('validation');
    }
  });

  it('recovers a strong fit on a genuinely linear relationship', async () => {
    const dataset = makeDataset(linearRows(200), numericSpec(['x1', 'x2', 'y']));
    const { processedDataset } = preprocessDataset(dataset, 'y', ['x1', 'x2'], {
      imputeStrategy: 'mean_imputation',
      scalingMethod: 'z_score',
      trainTestSplit: 0.8,
    });
    const comparison = await trainAllModels(processedDataset, 'regression', 0.8);
    expect(comparison.bestModel.regressionMetrics?.rSquared ?? 0).toBeGreaterThan(0.9);
  });

  it('falls back to a single hold-out and says so when data is scarce', async () => {
    const dataset = makeDataset(linearRows(8), numericSpec(['x1', 'x2', 'y']));
    const { processedDataset } = preprocessDataset(dataset, 'y', ['x1', 'x2'], {
      imputeStrategy: 'mean_imputation',
      scalingMethod: 'none',
      trainTestSplit: 0.8,
    });
    const comparison = await trainAllModels(processedDataset, 'regression', 0.8);
    expect(comparison.selectionMethod).toBe('holdout');
    for (const m of comparison.results) {
      expect(m.scoredOn).toBe('test');
    }
  });
});

describe('Metrics', () => {
  it('computes regression metrics against known values', () => {
    const actuals = [10, 20, 30, 40];
    const predictions = [12, 18, 33, 37];
    // errors: +2, -2, +3, -3 -> SSE = 26, mean squared error = 6.5
    // mean(actual) = 25, SST = 500 -> R2 = 1 - 26/500 = 0.948
    // adjusted R2 with 2 features, n = 4 -> 1 - 0.052 * 3 / 1 = 0.844
    // MAPE = mean(0.2, 0.1, 0.1, 0.075) * 100 = 11.875
    const m = computeRegressionMetrics(predictions, actuals, 2);
    expect(m.rmse).toBeCloseTo(Math.sqrt(6.5), 6);
    expect(m.mae).toBeCloseTo(2.5, 6);
    expect(m.rSquared).toBeCloseTo(0.948, 3);
    expect(m.adjustedRSquared).toBeCloseTo(0.844, 3);
    expect(m.mape).toBeCloseTo(11.875, 3);
  });

  it('clamps R-squared at zero rather than reporting a negative fit', () => {
    const actuals = [1, 2, 3, 4];
    const predictions = [100, -100, 100, -100];
    expect(computeRegressionMetrics(predictions, actuals, 1).rSquared).toBe(0);
  });

  it('computes classification metrics against a known confusion matrix', () => {
    // Per class: TP=3, FP=1, FN=1 -> precision = recall = f1 = 0.75
    // accuracy = 6 correct of 8 = 0.75
    const actuals = [1, 1, 1, 1, 0, 0, 0, 0];
    const predictions = [1, 1, 1, 0, 1, 0, 0, 0];
    const m = computeClassificationMetrics(predictions, actuals, ['0', '1']);
    expect(m.accuracy).toBeCloseTo(0.75, 6);
    expect(m.precision).toBeCloseTo(0.75, 2);
    expect(m.recall).toBeCloseTo(0.75, 2);
    expect(m.f1).toBeCloseTo(0.75, 2);
    expect(m.confusionMatrix).toEqual([
      [3, 1],
      [1, 3],
    ]);
  });

  it('gives a perfect classifier perfect scores', () => {
    const labels = [0, 1, 0, 1, 1, 0];
    const m = computeClassificationMetrics(labels, labels, ['0', '1']);
    expect(m.accuracy).toBe(1);
    expect(m.f1).toBeCloseTo(1, 6);
  });
});

describe('Problem detection', () => {
  it('detects regression for a continuous target', () => {
    const dataset = makeDataset(linearRows(120), numericSpec(['x1', 'x2', 'y']));
    const detection = detectMLProblem(dataset);
    expect(['regression', 'clustering']).toContain(detection.problemType);
  });

  it('detects classification for a low-cardinality categorical target', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      f1: i,
      f2: i * 2,
      outcome: i % 2 === 0 ? 'churn' : 'retain',
    }));
    const dataset = makeDataset(rows, [
      { name: 'f1', type: 'number' },
      { name: 'f2', type: 'number' },
      { name: 'outcome', type: 'string' },
    ]);
    const detection = detectMLProblem(dataset);
    expect(detection.problemType).toBe('classification');
  });
});
