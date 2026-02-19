// ML Engine - Client-Side Machine Learning Pipeline for DataAfrik
// Runs entirely in the browser. No backend required.

import { Dataset } from './types';
import { multipleRegression, kMeansClustering } from './advancedStatistics';

// ============================================================
// Types
// ============================================================

export type MLProblemType = 'regression' | 'classification' | 'clustering';

export type MLAlgorithm =
  | 'linear_regression'
  | 'logistic_regression'
  | 'decision_tree'
  | 'random_forest'
  | 'k_means';

export type PreprocessingStrategy =
  | 'mean_imputation'
  | 'median_imputation'
  | 'mode_imputation'
  | 'drop_rows';

export type ScalingMethod = 'none' | 'min_max' | 'z_score';

export type MLPipelineStep =
  | 'problem_definition'
  | 'preprocessing'
  | 'feature_engineering'
  | 'model_training'
  | 'evaluation'
  | 'deployment';

export interface MLProblemDetection {
  problemType: MLProblemType;
  confidence: number;
  reasoning: string;
  suggestedTarget: string | null;
  suggestedFeatures: string[];
  targetCardinality: number;
  numericFeatureCount: number;
  categoricalFeatureCount: number;
}

export interface ColumnPreprocessingInfo {
  column: string;
  missingBefore: number;
  missingAfter: number;
  strategy: PreprocessingStrategy | 'none';
}

export interface PreprocessingReport {
  totalRows: number;
  cleanedRows: number;
  droppedRows: number;
  imputedCells: number;
  outlierCount: number;
  scalingApplied: ScalingMethod;
  encodedColumns: string[];
  columnStats: ColumnPreprocessingInfo[];
  sampledFrom?: number;
}

export interface FeatureImportanceItem {
  feature: string;
  importance: number;
  correlationWithTarget: number;
  isSelected: boolean;
}

export interface FeatureEngineeringResult {
  featureImportance: FeatureImportanceItem[];
  correlationMatrix: { col1: string; col2: string; r: number }[];
  highCorrelationPairs: { col1: string; col2: string; r: number }[];
  recommendedFeatures: string[];
  droppedFeatures: string[];
  dimensionalityNote: string;
}

export interface ModelTrainingConfig {
  algorithm: MLAlgorithm;
  targetColumn: string;
  featureColumns: string[];
  trainTestSplit: number;
  hyperparameters: Record<string, number | string>;
}

export interface ClassificationMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  confusionMatrix: number[][];
  classLabels: string[];
}

export interface RegressionMetrics {
  rmse: number;
  mae: number;
  rSquared: number;
  adjustedRSquared: number;
  mape: number;
}

export interface ClusteringMetrics {
  silhouetteScore: number;
  optimalK: number;
  inertia: number;
  daviesBouldinIndex: number;
}

export type TreeProblemType = 'regression' | 'classification';

export interface DecisionTreeNode {
  isLeaf: boolean;
  prediction: number;
  samples: number;
  impurity: number;
  depth: number;
  feature?: string;
  threshold?: number;
  left?: DecisionTreeNode;
  right?: DecisionTreeNode;
  classCounts?: number[];
}

export interface ModelResult {
  algorithm: MLAlgorithm;
  algorithmLabel: string;
  problemType: MLProblemType;
  trainingDurationMs: number;
  trainRows: number;
  testRows: number;
  regressionMetrics?: RegressionMetrics;
  classificationMetrics?: ClassificationMetrics;
  clusteringMetrics?: ClusteringMetrics;
  coefficients?: Record<string, number>;
  intercept?: number;
  featureImportance: FeatureImportanceItem[];
  equation?: string;
  interpretation: string;
  isTopModel: boolean;
  centroids?: number[][];
  clusterAssignments?: number[];
  tree?: DecisionTreeNode;
  forest?: DecisionTreeNode[];
  classValues?: number[];
}

export interface ModelComparisonResult {
  results: ModelResult[];
  bestModel: ModelResult;
  rankingMetric: string;
  trainingComplete: boolean;
}

export interface PredictionRequest {
  featureValues: Record<string, number | string>;
  model: ModelResult;
  featureColumns: string[];
  targetColumn: string;
}

export interface PredictionResult {
  predictedValue: number | string;
  confidence: number;
  confidenceInterval?: { lower: number; upper: number };
  featureContributions: { feature: string; contribution: number; direction: 'positive' | 'negative' }[];
  explanation: string;
}

export interface DeploymentGuidance {
  recommendedPlatform: string;
  exportFormat: 'json_config';
  exportedModelConfig: Record<string, unknown>;
  apiEndpointTemplate: string;
  monitoringRecommendations: string[];
  retrainingTriggers: string[];
  estimatedInferenceMs: number;
}

export interface ProcessedDataset {
  data: Record<string, number>[];
  columns: string[];
  targetColumn: string;
  featureColumns: string[];
  scalingParams: Record<string, { mean: number; std: number; min: number; max: number }>;
  labelMappings: Record<string, Record<string, number>>;
  reverseLabelMappings: Record<string, Record<number, string>>;
}

export interface MLPipelineState {
  currentStep: MLPipelineStep;
  problemDetection: MLProblemDetection | null;
  preprocessingReport: PreprocessingReport | null;
  featureEngineering: FeatureEngineeringResult | null;
  modelComparison: ModelComparisonResult | null;
  selectedModel: ModelResult | null;
  deploymentGuidance: DeploymentGuidance | null;
  isRunning: boolean;
  progress: number;
  progressMessage: string;
  cleanedDataset: ProcessedDataset | null;
}

// ============================================================
// Utilities
// ============================================================

const yieldToBrowser = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 0));

const pearsonR = (xs: number[], ys: number[]): number => {
  const n = xs.length;
  if (n < 2) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
};

const mean = (arr: number[]): number =>
  arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

const median = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const stdDev = (arr: number[]): number => {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
};

const mode = (arr: (string | number)[]): string | number => {
  const freq: Record<string, number> = {};
  for (const v of arr) freq[String(v)] = (freq[String(v)] || 0) + 1;
  let best = arr[0];
  let bestCount = 0;
  for (const [k, count] of Object.entries(freq)) {
    if (count > bestCount) { bestCount = count; best = k; }
  }
  return best;
};

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));

// ============================================================
// A. Problem Detection
// ============================================================

export const detectMLProblem = (dataset: Dataset): MLProblemDetection => {
  try {
    const rows = dataset.data;
    const columns = dataset.columns;
    const n = rows.length;

    if (n < 5 || columns.length < 2) {
      return {
        problemType: 'clustering',
        confidence: 0.3,
        reasoning: 'Dataset too small for meaningful ML problem detection.',
        suggestedTarget: null,
        suggestedFeatures: columns.map(c => c.name),
        targetCardinality: 0,
        numericFeatureCount: 0,
        categoricalFeatureCount: 0,
      };
    }

    let bestScore = -Infinity;
    let bestTarget: string | null = null;
    let bestType: MLProblemType = 'clustering';
    let bestCardinality = 0;

    for (const col of columns) {
      const values = rows.map(r => r[col.name]).filter(v => v !== null && v !== undefined && v !== '');
      if (values.length === 0) continue;
      const uniqueVals = new Set(values.map(v => String(v)));
      const cardinality = uniqueVals.size;

      // Skip ID-like columns
      if (cardinality === n) continue;
      // Skip constants
      if (cardinality === 1) continue;

      const numericVals = values.map(v => Number(v)).filter(v => !isNaN(v));
      const isNumeric = numericVals.length >= values.length * 0.85;

      let score = 0;
      let candidateType: MLProblemType;

      if (isNumeric && cardinality > 20) {
        // Good regression target
        score = 100 - Math.abs(cardinality - Math.sqrt(n) * 10) / n * 100;
        score = Math.max(0, score);
        candidateType = 'regression';
      } else if (cardinality >= 2 && cardinality <= 20) {
        // Good classification target
        score = 90 - cardinality * 2;
        candidateType = 'classification';
      } else {
        continue;
      }

      if (score > bestScore) {
        bestScore = score;
        bestTarget = col.name;
        bestType = candidateType;
        bestCardinality = cardinality;
      }
    }

    if (!bestTarget) {
      const numCols = columns.filter(c => {
        const vals = rows.slice(0, 10).map(r => Number(r[c.name])).filter(v => !isNaN(v));
        return vals.length >= 5;
      });
      return {
        problemType: 'clustering',
        confidence: 0.6,
        reasoning: 'No clear target column found. Clustering will group similar rows together.',
        suggestedTarget: null,
        suggestedFeatures: numCols.map(c => c.name),
        targetCardinality: 0,
        numericFeatureCount: numCols.length,
        categoricalFeatureCount: columns.length - numCols.length,
      };
    }

    const numericCols = columns.filter(c => {
      if (c.name === bestTarget) return false;
      const vals = rows.slice(0, 20).map(r => Number(r[c.name])).filter(v => !isNaN(v));
      return vals.length >= 10;
    });
    const categoricalCols = columns.filter(c => c.name !== bestTarget && !numericCols.includes(c));

    const confidence = Math.min(0.95, Math.max(0.5, bestScore / 100));
    const reasoning = bestType === 'regression'
      ? `Column "${bestTarget}" has ${bestCardinality} unique numeric values - ideal for regression to predict continuous outcomes.`
      : `Column "${bestTarget}" has ${bestCardinality} distinct categories - suitable for classification to predict discrete labels.`;

    return {
      problemType: bestType,
      confidence,
      reasoning,
      suggestedTarget: bestTarget,
      suggestedFeatures: numericCols.map(c => c.name),
      targetCardinality: bestCardinality,
      numericFeatureCount: numericCols.length,
      categoricalFeatureCount: categoricalCols.length,
    };
  } catch {
    return {
      problemType: 'clustering',
      confidence: 0.3,
      reasoning: 'Error during problem detection. Defaulting to clustering.',
      suggestedTarget: null,
      suggestedFeatures: [],
      targetCardinality: 0,
      numericFeatureCount: 0,
      categoricalFeatureCount: 0,
    };
  }
};

// ============================================================
// B. Preprocessing
// ============================================================

export const preprocessDataset = (
  dataset: Dataset,
  targetColumn: string,
  featureColumns: string[],
  options: {
    imputeStrategy: PreprocessingStrategy;
    scalingMethod: ScalingMethod;
    trainTestSplit: number;
  }
): { processedDataset: ProcessedDataset; report: PreprocessingReport } => {
  const MAX_ROWS = 10000;
  let rows = dataset.data as Record<string, unknown>[];
  const sampledFrom = rows.length > MAX_ROWS ? rows.length : undefined;
  if (rows.length > MAX_ROWS) {
    // Random sample
    const step = Math.floor(rows.length / MAX_ROWS);
    rows = rows.filter((_, i) => i % step === 0).slice(0, MAX_ROWS);
  }

  const allCols = [targetColumn, ...featureColumns];
  const columnStats: ColumnPreprocessingInfo[] = [];
  const encodedColumns: string[] = [];
  const labelMappings: Record<string, Record<string, number>> = {};
  const reverseLabelMappings: Record<string, Record<number, string>> = {};
  let imputedCells = 0;
  let outlierCount = 0;

  // Step 1: Count missing per column
  const missingCounts: Record<string, number> = {};
  for (const col of allCols) {
    missingCounts[col] = rows.filter(r => r[col] === null || r[col] === undefined || r[col] === '').length;
  }

  // Step 2: Drop columns with >80% missing (only from features)
  const validFeatures = featureColumns.filter(col => missingCounts[col] / rows.length <= 0.8);

  // Step 3: For each column, impute missing values
  const cleanRows: Record<string, unknown>[] = rows.map(r => ({ ...r }));

  for (const col of [targetColumn, ...validFeatures]) {
    const nonMissing = rows
      .map(r => r[col])
      .filter(v => v !== null && v !== undefined && v !== '');

    const numericVals = nonMissing.map(v => Number(v)).filter(v => !isNaN(v));
    const isNumeric = numericVals.length >= nonMissing.length * 0.85;

    const missingBefore = missingCounts[col];
    let strategy: PreprocessingStrategy | 'none' = 'none';

    if (missingBefore > 0) {
      if (isNumeric) {
        const fillValue = options.imputeStrategy === 'median_imputation'
          ? median(numericVals)
          : mean(numericVals);
        strategy = options.imputeStrategy === 'median_imputation' ? 'median_imputation' : 'mean_imputation';
        for (const row of cleanRows) {
          if (row[col] === null || row[col] === undefined || row[col] === '') {
            row[col] = fillValue;
            imputedCells++;
          }
        }
      } else {
        const fillValue = mode(nonMissing as string[]);
        strategy = 'mode_imputation';
        for (const row of cleanRows) {
          if (row[col] === null || row[col] === undefined || row[col] === '') {
            row[col] = fillValue;
            imputedCells++;
          }
        }
      }
    }

    columnStats.push({ column: col, missingBefore, missingAfter: 0, strategy });
  }

  // Step 4: Drop rows that still have missing target value
  const preDropLength = cleanRows.length;
  const validRows = cleanRows.filter(r => {
    const v = r[targetColumn];
    return v !== null && v !== undefined && v !== '' && !isNaN(Number(v));
  });
  const droppedRows = preDropLength - validRows.length;

  // Step 5: Label-encode categorical feature columns
  for (const col of validFeatures) {
    const vals = validRows.map(r => r[col]);
    const numericVals = vals.map(v => Number(v)).filter(v => !isNaN(v));
    const isNumeric = numericVals.length >= vals.length * 0.85;

    if (!isNumeric) {
      const uniqueLabels = [...new Set(vals.map(v => String(v)))].sort();
      const mapping: Record<string, number> = {};
      const reverseMapping: Record<number, string> = {};
      uniqueLabels.forEach((label, idx) => {
        mapping[label] = idx;
        reverseMapping[idx] = label;
      });
      labelMappings[col] = mapping;
      reverseLabelMappings[col] = reverseMapping;
      encodedColumns.push(col);
    }
  }

  // Step 6: Build numeric dataset
  const scalingParams: Record<string, { mean: number; std: number; min: number; max: number }> = {};

  // Compute scaling params for all numeric cols
  const allNumericCols = [targetColumn, ...validFeatures];
  for (const col of allNumericCols) {
    const vals = validRows.map(r => {
      if (labelMappings[col]) return labelMappings[col][String(r[col])] ?? 0;
      return Number(r[col]);
    }).filter(v => !isNaN(v));

    const m = mean(vals);
    const s = stdDev(vals);
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    scalingParams[col] = { mean: m, std: s || 1, min: minVal, max: maxVal === minVal ? minVal + 1 : maxVal };
  }

  // Detect outliers via IQR on numeric features
  for (const col of validFeatures) {
    if (labelMappings[col]) continue;
    const vals = validRows.map(r => Number(r[col])).filter(v => !isNaN(v)).sort((a, b) => a - b);
    const q1 = vals[Math.floor(vals.length * 0.25)];
    const q3 = vals[Math.floor(vals.length * 0.75)];
    const iqr = q3 - q1;
    outlierCount += vals.filter(v => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr).length;
  }

  // Build final numeric data rows
  const numericData: Record<string, number>[] = validRows.map(r => {
    const row: Record<string, number> = {};
    for (const col of allNumericCols) {
      let val: number;
      if (labelMappings[col]) {
        val = labelMappings[col][String(r[col])] ?? 0;
      } else {
        val = Number(r[col]);
        if (isNaN(val)) val = scalingParams[col].mean;
      }

      // Apply scaling (to features only, not target)
      if (col !== targetColumn && options.scalingMethod !== 'none') {
        const { mean: m, std: s, min: mn, max: mx } = scalingParams[col];
        if (options.scalingMethod === 'z_score') {
          val = (val - m) / s;
        } else {
          val = (val - mn) / (mx - mn);
        }
      }
      row[col] = val;
    }
    return row;
  });

  const processedDataset: ProcessedDataset = {
    data: numericData,
    columns: allNumericCols,
    targetColumn,
    featureColumns: validFeatures,
    scalingParams,
    labelMappings,
    reverseLabelMappings,
  };

  const report: PreprocessingReport = {
    totalRows: rows.length,
    cleanedRows: numericData.length,
    droppedRows,
    imputedCells,
    outlierCount,
    scalingApplied: options.scalingMethod,
    encodedColumns,
    columnStats,
    sampledFrom,
  };

  return { processedDataset, report };
};

// ============================================================
// C. Feature Engineering
// ============================================================

export const analyzeFeatures = (
  dataset: Dataset,
  targetColumn: string,
  featureColumns: string[],
  processedDataset?: ProcessedDataset
): FeatureEngineeringResult => {
  const rows = (processedDataset?.data ?? dataset.data) as Record<string, number>[];
  const targetVals = rows.map(r => Number(r[targetColumn])).filter(v => !isNaN(v));

  const featureImportance: FeatureImportanceItem[] = [];
  const correlationMatrix: { col1: string; col2: string; r: number }[] = [];

  for (const col of featureColumns) {
    const colVals = rows.map(r => Number(r[col])).filter((_, i) => !isNaN(Number(rows[i]?.[col])));
    const paired: [number, number][] = [];
    for (const row of rows) {
      const tv = Number(row[targetColumn]);
      const cv = Number(row[col]);
      if (!isNaN(tv) && !isNaN(cv)) paired.push([cv, tv]);
    }
    const r = paired.length >= 2 ? pearsonR(paired.map(p => p[0]), paired.map(p => p[1])) : 0;
    featureImportance.push({ feature: col, importance: Math.abs(r), correlationWithTarget: r, isSelected: true });
    void colVals;
  }

  // Normalise importance
  const maxImp = Math.max(...featureImportance.map(f => f.importance), 0.001);
  featureImportance.forEach(f => { f.importance = f.importance / maxImp; });
  featureImportance.sort((a, b) => b.importance - a.importance);

  // Pairwise correlation matrix
  const highCorrelationPairs: { col1: string; col2: string; r: number }[] = [];
  for (let i = 0; i < featureColumns.length; i++) {
    for (let j = i + 1; j < featureColumns.length; j++) {
      const col1 = featureColumns[i];
      const col2 = featureColumns[j];
      const paired: [number, number][] = [];
      for (const row of rows) {
        const v1 = Number(row[col1]);
        const v2 = Number(row[col2]);
        if (!isNaN(v1) && !isNaN(v2)) paired.push([v1, v2]);
      }
      const r = paired.length >= 2 ? pearsonR(paired.map(p => p[0]), paired.map(p => p[1])) : 0;
      correlationMatrix.push({ col1, col2, r });
      if (Math.abs(r) > 0.9) highCorrelationPairs.push({ col1, col2, r });
    }
  }

  // Recommend drops
  const droppedFeatures: string[] = [];
  for (const fi of featureImportance) {
    const colVals = rows.map(r => Number(r[fi.feature])).filter(v => !isNaN(v));
    const s = stdDev(colVals);
    if (s < 0.001) droppedFeatures.push(fi.feature);
  }

  const recommendedFeatures = featureImportance
    .filter(f => !droppedFeatures.includes(f.feature) && f.importance > 0.05)
    .map(f => f.feature);

  const note = featureColumns.length > 20
    ? `High dimensionality (${featureColumns.length} features). Consider reducing to top ${Math.min(15, recommendedFeatures.length)} features.`
    : `${featureColumns.length} features analysed. ${recommendedFeatures.length} recommended for training.`;

  return {
    featureImportance,
    correlationMatrix,
    highCorrelationPairs,
    recommendedFeatures,
    droppedFeatures,
    dimensionalityNote: note,
  };
};

// ============================================================
// D. Metrics
// ============================================================

export const computeRegressionMetrics = (
  predictions: number[],
  actuals: number[],
  numFeatures: number
): RegressionMetrics => {
  const n = predictions.length;
  if (n === 0) return { rmse: 0, mae: 0, rSquared: 0, adjustedRSquared: 0, mape: 0 };

  const errors = predictions.map((p, i) => p - actuals[i]);
  const rmse = Math.sqrt(mean(errors.map(e => e ** 2)));
  const mae = mean(errors.map(e => Math.abs(e)));
  const meanActual = mean(actuals);
  const ssTot = actuals.reduce((s, a) => s + (a - meanActual) ** 2, 0);
  const ssRes = errors.reduce((s, e) => s + e ** 2, 0);
  const rSquared = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  const adjustedRSquared = n > numFeatures + 1
    ? Math.max(0, 1 - (1 - rSquared) * (n - 1) / (n - numFeatures - 1))
    : rSquared;
  const nonZeroActuals = actuals.filter(a => Math.abs(a) > 0.001);
  const mape = nonZeroActuals.length > 0
    ? mean(predictions.filter((_, i) => Math.abs(actuals[i]) > 0.001)
        .map((p, i) => Math.abs((p - nonZeroActuals[i]) / nonZeroActuals[i]))) * 100
    : 0;

  return { rmse, mae, rSquared, adjustedRSquared, mape: Math.min(mape, 9999) };
};

export const computeClassificationMetrics = (
  predictions: number[],
  actuals: number[],
  classLabels: string[]
): ClassificationMetrics => {
  const nClasses = classLabels.length;
  const n = predictions.length;
  if (n === 0) return { accuracy: 0, precision: 0, recall: 0, f1: 0, confusionMatrix: [], classLabels };

  const cm: number[][] = Array.from({ length: nClasses }, () => Array(nClasses).fill(0));
  let correct = 0;
  for (let i = 0; i < n; i++) {
    const pred = Math.round(predictions[i]);
    const actual = Math.round(actuals[i]);
    if (pred >= 0 && pred < nClasses && actual >= 0 && actual < nClasses) {
      cm[actual][pred]++;
      if (pred === actual) correct++;
    }
  }

  const accuracy = correct / n;
  let totalPrecision = 0, totalRecall = 0, totalF1 = 0;
  for (let c = 0; c < nClasses; c++) {
    const tp = cm[c][c];
    const fp = cm.reduce((s, row) => s + row[c], 0) - tp;
    const fn = cm[c].reduce((s, v) => s + v, 0) - tp;
    const p = tp + fp === 0 ? 0 : tp / (tp + fp);
    const r = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f = p + r === 0 ? 0 : 2 * p * r / (p + r);
    totalPrecision += p;
    totalRecall += r;
    totalF1 += f;
  }

  return {
    accuracy,
    precision: totalPrecision / nClasses,
    recall: totalRecall / nClasses,
    f1: totalF1 / nClasses,
    confusionMatrix: cm,
    classLabels,
  };
};

// ============================================================
// E. Algorithm Trainers
// ============================================================

const splitData = (data: Record<string, number>[], splitRatio: number) => {
  const trainSize = Math.floor(data.length * splitRatio);
  // Shuffle deterministically
  const shuffled = [...data].sort((a, b) => {
    const hashA = Object.values(a).reduce((s, v) => s + v, 0);
    const hashB = Object.values(b).reduce((s, v) => s + v, 0);
    return hashA - hashB;
  });
  return { train: shuffled.slice(0, trainSize), test: shuffled.slice(trainSize) };
};

const datasetFromRows = (rows: Record<string, number>[], columns: string[], target: string, features: string[]): Dataset => ({
  id: 'ml-temp',
  name: 'ml-temp',
  description: '',
  columns: columns.map(c => ({
    name: c,
    type: 'number' as const,
    sampleValues: [],
    nullCount: 0,
    uniqueCount: 0,
  })),
  rowCount: rows.length,
  dataTypes: {},
  data: rows,
});

const trainLinearRegression = (
  processedDataset: ProcessedDataset,
  trainTestSplit: number
): ModelResult => {
  const start = Date.now();
  const { data, targetColumn, featureColumns } = processedDataset;
  const { train, test } = splitData(data, trainTestSplit);

  const trainDS = datasetFromRows(train, processedDataset.columns, targetColumn, featureColumns);
  const regResult = multipleRegression(trainDS, targetColumn, featureColumns);

  // Predict on test set
  const predictions = test.map(row => {
    let pred = regResult.intercept || 0;
    for (const col of featureColumns) {
      pred += (regResult.coefficients[col] || 0) * row[col];
    }
    return pred;
  });
  const actuals = test.map(r => r[targetColumn]);
  const metrics = computeRegressionMetrics(predictions, actuals, featureColumns.length);

  const importance = featureColumns.map(f => ({
    feature: f,
    importance: Math.abs(regResult.coefficients[f] || 0),
    correlationWithTarget: 0,
    isSelected: true,
  }));
  const maxImp = Math.max(...importance.map(i => i.importance), 0.001);
  importance.forEach(i => { i.importance = i.importance / maxImp; });

  return {
    algorithm: 'linear_regression',
    algorithmLabel: 'Linear Regression',
    problemType: 'regression',
    trainingDurationMs: Date.now() - start,
    trainRows: train.length,
    testRows: test.length,
    regressionMetrics: metrics,
    coefficients: regResult.coefficients,
    intercept: regResult.intercept,
    featureImportance: importance,
    equation: regResult.equation,
    interpretation: `Linear Regression achieved R2 = ${metrics.rSquared.toFixed(3)}, RMSE = ${metrics.rmse.toFixed(3)}.`,
    isTopModel: false,
  };
};

const trainLogisticRegression = (
  processedDataset: ProcessedDataset,
  trainTestSplit: number
): ModelResult => {
  const start = Date.now();
  const { data, targetColumn, featureColumns } = processedDataset;
  const { train, test } = splitData(data, trainTestSplit);

  // Get class labels
  const allTargets = data.map(r => r[targetColumn]);
  const uniqueClasses = [...new Set(allTargets.map(v => Math.round(v)))].sort((a, b) => a - b);
  const nClasses = Math.min(uniqueClasses.length, 10);
  const classMap: Record<number, number> = {};
  uniqueClasses.slice(0, nClasses).forEach((c, i) => { classMap[c] = i; });

  const nFeatures = featureColumns.length;
  const lr = 0.05;
  const maxIter = 300;

  // One-vs-rest logistic regression
  const allWeights: number[][] = [];
  const allBiases: number[] = [];

  for (let ci = 0; ci < nClasses; ci++) {
    const weights = new Array(nFeatures).fill(0);
    let bias = 0;

    const yBinary = train.map(r => Math.round(r[targetColumn]) === uniqueClasses[ci] ? 1 : 0);

    for (let iter = 0; iter < maxIter; iter++) {
      let dBias = 0;
      const dWeights = new Array(nFeatures).fill(0);

      for (let i = 0; i < train.length; i++) {
        const row = train[i];
        let z = bias;
        for (let j = 0; j < nFeatures; j++) {
          z += weights[j] * (row[featureColumns[j]] || 0);
        }
        const pred = sigmoid(z);
        const error = pred - yBinary[i];
        dBias += error;
        for (let j = 0; j < nFeatures; j++) {
          dWeights[j] += error * (row[featureColumns[j]] || 0);
        }
      }

      bias -= lr * dBias / train.length;
      for (let j = 0; j < nFeatures; j++) {
        weights[j] -= lr * dWeights[j] / train.length;
      }
    }

    allWeights.push(weights);
    allBiases.push(bias);
  }

  // Predict on test
  const predictions = test.map(row => {
    const scores = allWeights.map((w, ci) => {
      let z = allBiases[ci];
      for (let j = 0; j < nFeatures; j++) {
        z += w[j] * (row[featureColumns[j]] || 0);
      }
      return sigmoid(z);
    });
    const bestClass = scores.indexOf(Math.max(...scores));
    return uniqueClasses[bestClass];
  });
  const actuals = test.map(r => Math.round(r[targetColumn]));

  const reverseLM = processedDataset.reverseLabelMappings[targetColumn] || {};
  const classLabels = uniqueClasses.slice(0, nClasses).map(c =>
    reverseLM[c] !== undefined ? reverseLM[c] : String(c)
  );

  const metrics = computeClassificationMetrics(
    predictions.map(p => uniqueClasses.indexOf(p)),
    actuals.map(a => uniqueClasses.indexOf(a)),
    classLabels
  );

  const avgWeights = featureColumns.map((f, j) => ({
    feature: f,
    importance: Math.abs(mean(allWeights.map(w => w[j]))),
    correlationWithTarget: 0,
    isSelected: true,
  }));
  const maxImp = Math.max(...avgWeights.map(w => w.importance), 0.001);
  avgWeights.forEach(w => { w.importance = w.importance / maxImp; });

  const coefficients: Record<string, number> = {};
  featureColumns.forEach((f, j) => {
    coefficients[f] = mean(allWeights.map(w => w[j]));
  });

  return {
    algorithm: 'logistic_regression',
    algorithmLabel: 'Logistic Regression',
    problemType: 'classification',
    trainingDurationMs: Date.now() - start,
    trainRows: train.length,
    testRows: test.length,
    classificationMetrics: metrics,
    coefficients,
    intercept: mean(allBiases),
    featureImportance: avgWeights,
    interpretation: `Logistic Regression achieved accuracy = ${(metrics.accuracy * 100).toFixed(1)}%, F1 = ${metrics.f1.toFixed(3)}.`,
    isTopModel: false,
  };
};

const makeSeededRng = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

interface TreeSplit {
  feature: string;
  threshold: number;
  gain: number;
  leftIndices: number[];
  rightIndices: number[];
}

interface TreeBuildOptions {
  problemType: TreeProblemType;
  featureColumns: string[];
  targetValues: number[];
  maxDepth: number;
  minSamplesSplit: number;
  minSamplesLeaf: number;
  minGain: number;
  maxFeaturesPerSplit?: number;
  rng?: () => number;
  nClasses?: number;
}

const giniFromCounts = (counts: number[], total: number): number => {
  if (total <= 0) return 0;
  let sum = 0;
  for (const c of counts) {
    const p = c / total;
    sum += p * p;
  }
  return 1 - sum;
};

const sampleFeaturesForSplit = (
  featureColumns: string[],
  maxFeaturesPerSplit: number | undefined,
  rng?: () => number
): string[] => {
  if (!maxFeaturesPerSplit || maxFeaturesPerSplit >= featureColumns.length) {
    return featureColumns;
  }
  const random = rng ?? Math.random;
  const shuffled = [...featureColumns];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  return shuffled.slice(0, Math.max(1, maxFeaturesPerSplit));
};

const evaluateBestSplitForFeature = (
  rows: Record<string, number>[],
  indices: number[],
  targetValues: number[],
  parentImpurity: number,
  options: TreeBuildOptions,
  feature: string
): TreeSplit | null => {
  if (indices.length < options.minSamplesSplit) return null;

  const pairs = indices
    .map(idx => ({ idx, x: rows[idx][feature], y: targetValues[idx] }))
    .sort((a, b) => a.x - b.x);

  if (pairs.length < options.minSamplesSplit) return null;

  let bestThreshold = Number.NaN;
  let bestGain = 0;

  if (options.problemType === 'classification') {
    const nClasses = options.nClasses ?? 2;
    const totalCounts = Array(nClasses).fill(0);
    for (const p of pairs) totalCounts[p.y] = (totalCounts[p.y] || 0) + 1;
    const leftCounts = Array(nClasses).fill(0);

    for (let i = 0; i < pairs.length - 1; i++) {
      const cls = pairs[i].y;
      leftCounts[cls] = (leftCounts[cls] || 0) + 1;
      if (pairs[i].x === pairs[i + 1].x) continue;

      const leftN = i + 1;
      const rightN = pairs.length - leftN;
      if (leftN < options.minSamplesLeaf || rightN < options.minSamplesLeaf) continue;

      const rightCounts = totalCounts.map((c, ci) => c - leftCounts[ci]);
      const leftImpurity = giniFromCounts(leftCounts, leftN);
      const rightImpurity = giniFromCounts(rightCounts, rightN);
      const weightedImpurity = (leftImpurity * leftN + rightImpurity * rightN) / pairs.length;
      const gain = parentImpurity - weightedImpurity;

      if (gain > bestGain) {
        bestGain = gain;
        bestThreshold = (pairs[i].x + pairs[i + 1].x) / 2;
      }
    }
  } else {
    let totalSum = 0;
    let totalSumSq = 0;
    for (const p of pairs) {
      totalSum += p.y;
      totalSumSq += p.y * p.y;
    }
    let leftSum = 0;
    let leftSumSq = 0;

    for (let i = 0; i < pairs.length - 1; i++) {
      const y = pairs[i].y;
      leftSum += y;
      leftSumSq += y * y;
      if (pairs[i].x === pairs[i + 1].x) continue;

      const leftN = i + 1;
      const rightN = pairs.length - leftN;
      if (leftN < options.minSamplesLeaf || rightN < options.minSamplesLeaf) continue;

      const rightSum = totalSum - leftSum;
      const rightSumSq = totalSumSq - leftSumSq;
      const leftSse = Math.max(0, leftSumSq - (leftSum * leftSum) / leftN);
      const rightSse = Math.max(0, rightSumSq - (rightSum * rightSum) / rightN);
      const weightedImpurity = (leftSse + rightSse) / pairs.length;
      const gain = parentImpurity - weightedImpurity;

      if (gain > bestGain) {
        bestGain = gain;
        bestThreshold = (pairs[i].x + pairs[i + 1].x) / 2;
      }
    }
  }

  if (!Number.isFinite(bestThreshold) || bestGain <= options.minGain) {
    return null;
  }

  const leftIndices: number[] = [];
  const rightIndices: number[] = [];
  for (const idx of indices) {
    if (rows[idx][feature] <= bestThreshold) leftIndices.push(idx);
    else rightIndices.push(idx);
  }

  if (leftIndices.length < options.minSamplesLeaf || rightIndices.length < options.minSamplesLeaf) {
    return null;
  }

  return {
    feature,
    threshold: bestThreshold,
    gain: bestGain,
    leftIndices,
    rightIndices,
  };
};

const buildCanonicalTree = (
  rows: Record<string, number>[],
  options: TreeBuildOptions,
  featureGain: Record<string, number>,
  indices: number[],
  depth: number
): DecisionTreeNode => {
  const samples = indices.length;
  if (samples === 0) {
    return { isLeaf: true, prediction: 0, samples: 0, impurity: 0, depth };
  }

  const targetValues = options.targetValues;
  let impurity = 0;
  let prediction = 0;
  let classCounts: number[] | undefined;

  if (options.problemType === 'classification') {
    const nClasses = options.nClasses ?? 2;
    classCounts = Array(nClasses).fill(0);
    for (const idx of indices) {
      const cls = targetValues[idx];
      classCounts[cls] = (classCounts[cls] || 0) + 1;
    }
    impurity = giniFromCounts(classCounts, samples);
    prediction = classCounts.indexOf(Math.max(...classCounts));
  } else {
    let sum = 0;
    let sumSq = 0;
    for (const idx of indices) {
      const y = targetValues[idx];
      sum += y;
      sumSq += y * y;
    }
    prediction = sum / samples;
    const sse = Math.max(0, sumSq - (sum * sum) / samples);
    impurity = sse / samples;
  }

  const shouldStop =
    depth >= options.maxDepth ||
    samples < options.minSamplesSplit ||
    impurity <= 1e-12 ||
    (options.problemType === 'classification' && !!classCounts && Math.max(...classCounts) === samples);

  if (shouldStop) {
    return {
      isLeaf: true,
      prediction,
      samples,
      impurity,
      depth,
      classCounts,
    };
  }

  const candidateFeatures = sampleFeaturesForSplit(
    options.featureColumns,
    options.maxFeaturesPerSplit,
    options.rng
  );

  let bestSplit: TreeSplit | null = null;
  for (const feature of candidateFeatures) {
    const split = evaluateBestSplitForFeature(rows, indices, targetValues, impurity, options, feature);
    if (split && (!bestSplit || split.gain > bestSplit.gain)) {
      bestSplit = split;
    }
  }

  if (!bestSplit) {
    return {
      isLeaf: true,
      prediction,
      samples,
      impurity,
      depth,
      classCounts,
    };
  }

  featureGain[bestSplit.feature] = (featureGain[bestSplit.feature] || 0) + bestSplit.gain;

  const leftNode = buildCanonicalTree(rows, options, featureGain, bestSplit.leftIndices, depth + 1);
  const rightNode = buildCanonicalTree(rows, options, featureGain, bestSplit.rightIndices, depth + 1);

  return {
    isLeaf: false,
    prediction,
    samples,
    impurity,
    depth,
    feature: bestSplit.feature,
    threshold: bestSplit.threshold,
    left: leftNode,
    right: rightNode,
    classCounts,
  };
};

const getTreeStats = (node: DecisionTreeNode): { maxDepth: number; leafCount: number } => {
  if (node.isLeaf) {
    return { maxDepth: node.depth, leafCount: 1 };
  }
  const leftStats = node.left ? getTreeStats(node.left) : { maxDepth: node.depth, leafCount: 0 };
  const rightStats = node.right ? getTreeStats(node.right) : { maxDepth: node.depth, leafCount: 0 };
  return {
    maxDepth: Math.max(node.depth, leftStats.maxDepth, rightStats.maxDepth),
    leafCount: leftStats.leafCount + rightStats.leafCount,
  };
};

const featureImportanceFromGain = (
  featureColumns: string[],
  featureGain: Record<string, number>
): FeatureImportanceItem[] => {
  const maxGain = Math.max(...featureColumns.map(f => featureGain[f] || 0), 0.001);
  return featureColumns.map(feature => ({
    feature,
    importance: (featureGain[feature] || 0) / maxGain,
    correlationWithTarget: 0,
    isSelected: (featureGain[feature] || 0) > 0,
  }));
};

interface TreePredictionDetail {
  prediction: number;
  leafSamples: number;
  classCounts?: number[];
  pathLength: number;
  contributions: Record<string, number>;
}

const predictWithTreeDetail = (
  tree: DecisionTreeNode,
  inputs: Record<string, number>
): TreePredictionDetail => {
  const contributions: Record<string, number> = {};
  let current = tree;
  let pathLength = 0;

  while (!current.isLeaf && current.feature && Number.isFinite(current.threshold)) {
    const feature = current.feature;
    const threshold = current.threshold as number;
    const value = inputs[feature] ?? 0;
    contributions[feature] = (contributions[feature] || 0) + Math.abs(value - threshold);
    const goLeft = value <= threshold;
    const next = goLeft ? current.left : current.right;
    if (!next) break;
    current = next;
    pathLength++;
  }

  return {
    prediction: current.prediction,
    leafSamples: current.samples,
    classCounts: current.classCounts,
    pathLength,
    contributions,
  };
};

const toContributionArray = (
  featureColumns: string[],
  contributionsMap: Record<string, number>
): { feature: string; contribution: number; direction: 'positive' | 'negative' }[] => {
  return featureColumns.map(feature => ({
    feature,
    contribution: contributionsMap[feature] || 0,
    direction: 'positive',
  }));
};

const trainDecisionTree = (
  processedDataset: ProcessedDataset,
  trainTestSplit: number,
  problemType: MLProblemType
): ModelResult => {
  const start = Date.now();
  const { data, targetColumn, featureColumns } = processedDataset;
  const { train, test } = splitData(data, trainTestSplit);
  const featureGain: Record<string, number> = {};
  featureColumns.forEach(f => { featureGain[f] = 0; });

  const baseMaxDepth = Math.min(12, Math.max(4, Math.round(Math.log2(Math.max(2, train.length)))));
  const minSamplesSplit = Math.max(8, Math.floor(Math.sqrt(Math.max(4, train.length)) / 2));
  const minSamplesLeaf = Math.max(3, Math.floor(minSamplesSplit / 3));

  if (problemType === 'classification') {
    const classValues = [...new Set(data.map(r => Math.round(r[targetColumn])))]
      .sort((a, b) => a - b)
      .slice(0, 20);
    const classIndexByValue: Record<number, number> = {};
    classValues.forEach((v, i) => { classIndexByValue[v] = i; });
    const nClasses = classValues.length;

    const trainTargets = train.map(r => classIndexByValue[Math.round(r[targetColumn])] ?? 0);
    const options: TreeBuildOptions = {
      problemType: 'classification',
      featureColumns,
      targetValues: trainTargets,
      maxDepth: baseMaxDepth,
      minSamplesSplit,
      minSamplesLeaf,
      minGain: 1e-7,
      nClasses,
    };

    const trainIndices = train.map((_, i) => i);
    const tree = buildCanonicalTree(train, options, featureGain, trainIndices, 0);

    const predictions = test.map(row => Math.round(predictWithTreeDetail(tree, row).prediction));
    const actualIndices = test.map(row => classIndexByValue[Math.round(row[targetColumn])] ?? 0);
    const reverseLM = processedDataset.reverseLabelMappings[targetColumn] || {};
    const classLabels = classValues.map(v => reverseLM[v] !== undefined ? reverseLM[v] : String(v));
    const metrics = computeClassificationMetrics(predictions, actualIndices, classLabels);
    const treeStats = getTreeStats(tree);

    return {
      algorithm: 'decision_tree',
      algorithmLabel: 'Decision Tree',
      problemType: 'classification',
      trainingDurationMs: Date.now() - start,
      trainRows: train.length,
      testRows: test.length,
      classificationMetrics: metrics,
      featureImportance: featureImportanceFromGain(featureColumns, featureGain),
      interpretation: `Decision Tree (CART) depth ${treeStats.maxDepth} with ${treeStats.leafCount} leaves achieved accuracy ${(metrics.accuracy * 100).toFixed(1)}% and F1 ${metrics.f1.toFixed(3)}.`,
      isTopModel: false,
      tree,
      classValues,
    };
  }

  const trainTargets = train.map(r => r[targetColumn]);
  const options: TreeBuildOptions = {
    problemType: 'regression',
    featureColumns,
    targetValues: trainTargets,
    maxDepth: baseMaxDepth,
    minSamplesSplit,
    minSamplesLeaf,
    minGain: 1e-8,
  };
  const trainIndices = train.map((_, i) => i);
  const tree = buildCanonicalTree(train, options, featureGain, trainIndices, 0);
  const predictions = test.map(row => predictWithTreeDetail(tree, row).prediction);
  const actuals = test.map(row => row[targetColumn]);
  const metrics = computeRegressionMetrics(predictions, actuals, featureColumns.length);
  const treeStats = getTreeStats(tree);

  return {
    algorithm: 'decision_tree',
    algorithmLabel: 'Decision Tree',
    problemType: 'regression',
    trainingDurationMs: Date.now() - start,
    trainRows: train.length,
    testRows: test.length,
    regressionMetrics: metrics,
    featureImportance: featureImportanceFromGain(featureColumns, featureGain),
    interpretation: `Decision Tree (CART) depth ${treeStats.maxDepth} with ${treeStats.leafCount} leaves achieved R² ${metrics.rSquared.toFixed(3)} and RMSE ${metrics.rmse.toFixed(3)}.`,
    isTopModel: false,
    tree,
  };
};

const trainRandomForest = (
  processedDataset: ProcessedDataset,
  trainTestSplit: number,
  problemType: MLProblemType
): ModelResult => {
  const start = Date.now();
  const { data, targetColumn, featureColumns } = processedDataset;
  const { train, test } = splitData(data, trainTestSplit);
  const nTrees = train.length > 3000 ? 9 : 11;
  const forest: DecisionTreeNode[] = [];
  const cumulativeGain: Record<string, number> = {};
  featureColumns.forEach(f => { cumulativeGain[f] = 0; });

  const baseMaxDepth = Math.min(12, Math.max(5, Math.round(Math.log2(Math.max(2, train.length)))));
  const minSamplesSplit = Math.max(8, Math.floor(Math.sqrt(Math.max(4, train.length)) / 2));
  const minSamplesLeaf = Math.max(3, Math.floor(minSamplesSplit / 3));
  const perSplitFeatureCount = problemType === 'classification'
    ? Math.max(1, Math.floor(Math.sqrt(Math.max(1, featureColumns.length))))
    : Math.max(1, Math.floor(featureColumns.length / 3));

  if (problemType === 'classification') {
    const classValues = [...new Set(data.map(r => Math.round(r[targetColumn])))]
      .sort((a, b) => a - b)
      .slice(0, 20);
    const classIndexByValue: Record<number, number> = {};
    classValues.forEach((v, i) => { classIndexByValue[v] = i; });
    const nClasses = classValues.length;

    for (let t = 0; t < nTrees; t++) {
      const rng = makeSeededRng(20260219 + t * 97);
      const bootstrapRows: Record<string, number>[] = [];
      const bootstrapTargets: number[] = [];

      for (let i = 0; i < train.length; i++) {
        const sampleIndex = Math.floor(rng() * train.length);
        const row = train[sampleIndex];
        bootstrapRows.push(row);
        bootstrapTargets.push(classIndexByValue[Math.round(row[targetColumn])] ?? 0);
      }

      const treeGain: Record<string, number> = {};
      featureColumns.forEach(f => { treeGain[f] = 0; });
      const options: TreeBuildOptions = {
        problemType: 'classification',
        featureColumns,
        targetValues: bootstrapTargets,
        maxDepth: baseMaxDepth,
        minSamplesSplit,
        minSamplesLeaf,
        minGain: 1e-7,
        maxFeaturesPerSplit: perSplitFeatureCount,
        rng,
        nClasses,
      };
      const treeIndices = bootstrapRows.map((_, i) => i);
      const tree = buildCanonicalTree(bootstrapRows, options, treeGain, treeIndices, 0);
      forest.push(tree);
      featureColumns.forEach(f => { cumulativeGain[f] += treeGain[f] || 0; });
    }

    const predictions = test.map(row => {
      const votes = Array(classValues.length).fill(0);
      for (const tree of forest) {
        const cls = Math.max(0, Math.min(classValues.length - 1, Math.round(predictWithTreeDetail(tree, row).prediction)));
        votes[cls]++;
      }
      return votes.indexOf(Math.max(...votes));
    });
    const actualIndices = test.map(row => classIndexByValue[Math.round(row[targetColumn])] ?? 0);
    const reverseLM = processedDataset.reverseLabelMappings[targetColumn] || {};
    const classLabels = classValues.map(v => reverseLM[v] !== undefined ? reverseLM[v] : String(v));
    const metrics = computeClassificationMetrics(predictions, actualIndices, classLabels);

    return {
      algorithm: 'random_forest',
      algorithmLabel: 'Random Forest',
      problemType: 'classification',
      trainingDurationMs: Date.now() - start,
      trainRows: train.length,
      testRows: test.length,
      classificationMetrics: metrics,
      featureImportance: featureImportanceFromGain(featureColumns, cumulativeGain),
      interpretation: `Random Forest (CART, ${nTrees} trees) achieved accuracy ${(metrics.accuracy * 100).toFixed(1)}% and F1 ${metrics.f1.toFixed(3)}.`,
      isTopModel: false,
      forest,
      classValues,
    };
  }

  for (let t = 0; t < nTrees; t++) {
    const rng = makeSeededRng(20260219 + t * 97);
    const bootstrapRows: Record<string, number>[] = [];
    const bootstrapTargets: number[] = [];

    for (let i = 0; i < train.length; i++) {
      const sampleIndex = Math.floor(rng() * train.length);
      const row = train[sampleIndex];
      bootstrapRows.push(row);
      bootstrapTargets.push(row[targetColumn]);
    }

    const treeGain: Record<string, number> = {};
    featureColumns.forEach(f => { treeGain[f] = 0; });
    const options: TreeBuildOptions = {
      problemType: 'regression',
      featureColumns,
      targetValues: bootstrapTargets,
      maxDepth: baseMaxDepth,
      minSamplesSplit,
      minSamplesLeaf,
      minGain: 1e-8,
      maxFeaturesPerSplit: perSplitFeatureCount,
      rng,
    };
    const treeIndices = bootstrapRows.map((_, i) => i);
    const tree = buildCanonicalTree(bootstrapRows, options, treeGain, treeIndices, 0);
    forest.push(tree);
    featureColumns.forEach(f => { cumulativeGain[f] += treeGain[f] || 0; });
  }

  const predictions = test.map(row => mean(forest.map(tree => predictWithTreeDetail(tree, row).prediction)));
  const actuals = test.map(row => row[targetColumn]);
  const metrics = computeRegressionMetrics(predictions, actuals, featureColumns.length);

  return {
    algorithm: 'random_forest',
    algorithmLabel: 'Random Forest',
    problemType: 'regression',
    trainingDurationMs: Date.now() - start,
    trainRows: train.length,
    testRows: test.length,
    regressionMetrics: metrics,
    featureImportance: featureImportanceFromGain(featureColumns, cumulativeGain),
    interpretation: `Random Forest (CART, ${nTrees} trees) achieved R² ${metrics.rSquared.toFixed(3)} and RMSE ${metrics.rmse.toFixed(3)}.`,
    isTopModel: false,
    forest,
  };
};

const trainKMeansModel = (
  processedDataset: ProcessedDataset
): ModelResult => {
  const start = Date.now();
  const { data, featureColumns } = processedDataset;

  const clusterDS = datasetFromRows(data, processedDataset.columns, processedDataset.targetColumn, featureColumns);
  const k = Math.min(5, Math.max(2, Math.floor(Math.sqrt(data.length / 2))));

  const result = kMeansClustering(clusterDS, k);

  // Compute inertia
  const inertia = result.clusters.reduce((sum, cluster) => {
    return sum + cluster.points.reduce((s, point) => {
      return s + featureColumns.reduce((d, col) => d + (point[col] - cluster.centroid[col]) ** 2, 0);
    }, 0);
  }, 0);

  // Silhouette score estimation
  const silhouette = result.silhouetteScore || Math.max(0, 1 - inertia / (data.length * featureColumns.length));

  const importance = featureColumns.map(f => ({
    feature: f,
    importance: 1 / featureColumns.length,
    correlationWithTarget: 0,
    isSelected: true,
  }));

  return {
    algorithm: 'k_means',
    algorithmLabel: 'K-Means Clustering',
    problemType: 'clustering',
    trainingDurationMs: Date.now() - start,
    trainRows: data.length,
    testRows: 0,
    clusteringMetrics: {
      silhouetteScore: silhouette,
      optimalK: k,
      inertia,
      daviesBouldinIndex: Math.max(0, 1 - silhouette),
    },
    featureImportance: importance,
    centroids: result.clusters.map(c => featureColumns.map(f => c.centroid[f] || 0)),
    clusterAssignments: data.map((row, i) => {
      let bestCluster = 0;
      let bestDist = Infinity;
      result.clusters.forEach((cluster, ci) => {
        const dist = featureColumns.reduce((d, f) => d + (row[f] - cluster.centroid[f]) ** 2, 0);
        if (dist < bestDist) { bestDist = dist; bestCluster = ci; }
      });
      return bestCluster;
      void i;
    }),
    interpretation: `K-Means found ${k} natural clusters with silhouette score ${silhouette.toFixed(3)}.`,
    isTopModel: false,
  };
};

// ============================================================
// F. Train All Models
// ============================================================

export const trainAllModels = async (
  processedDataset: ProcessedDataset,
  problemType: MLProblemType,
  trainTestSplit: number,
  onProgress?: (progress: number, message: string) => void
): Promise<ModelComparisonResult> => {
  const results: ModelResult[] = [];

  if (problemType === 'clustering') {
    onProgress?.(10, 'Training K-Means Clustering...');
    await yieldToBrowser();
    const km = trainKMeansModel(processedDataset);
    results.push(km);
    onProgress?.(100, 'Clustering complete.');

    km.isTopModel = true;
    return { results, bestModel: km, rankingMetric: 'Silhouette Score', trainingComplete: true };
  }

  const steps = problemType === 'regression' ? 3 : 3;
  let step = 0;

  // Linear Regression / Logistic Regression
  onProgress?.(10, problemType === 'regression' ? 'Training Linear Regression...' : 'Training Logistic Regression...');
  await yieldToBrowser();
  const model1 = problemType === 'regression'
    ? trainLinearRegression(processedDataset, trainTestSplit)
    : trainLogisticRegression(processedDataset, trainTestSplit);
  results.push(model1);
  step++;
  onProgress?.(Math.round((step / steps) * 80 + 10), 'Training Decision Tree...');
  await yieldToBrowser();

  // Decision Tree
  const dt = trainDecisionTree(processedDataset, trainTestSplit, problemType);
  results.push(dt);
  step++;
  onProgress?.(Math.round((step / steps) * 80 + 10), 'Training Random Forest...');
  await yieldToBrowser();

  // Random Forest
  const rf = trainRandomForest(processedDataset, trainTestSplit, problemType);
  results.push(rf);
  step++;
  onProgress?.(95, 'Selecting best model...');
  await yieldToBrowser();

  // Select best model
  let bestModel = results[0];
  if (problemType === 'regression') {
    bestModel = results.reduce((best, m) =>
      (m.regressionMetrics?.rSquared || 0) > (best.regressionMetrics?.rSquared || 0) ? m : best
    );
  } else {
    bestModel = results.reduce((best, m) =>
      (m.classificationMetrics?.f1 || 0) > (best.classificationMetrics?.f1 || 0) ? m : best
    );
  }
  bestModel.isTopModel = true;

  onProgress?.(100, 'Training complete!');
  const rankingMetric = problemType === 'regression' ? 'R2' : 'F1 Score';
  return { results, bestModel, rankingMetric, trainingComplete: true };
};

// ============================================================
// G. Prediction
// ============================================================

export const makePrediction = (
  request: PredictionRequest,
  processedDataset: ProcessedDataset
): PredictionResult => {
  const { featureValues, model, featureColumns, targetColumn } = request;
  const { labelMappings, scalingParams, reverseLabelMappings } = processedDataset;

  // Convert inputs to numeric (apply same scaling as training)
  const numericInputs: Record<string, number> = {};
  for (const col of featureColumns) {
    let val: number;
    const rawVal = featureValues[col];
    if (labelMappings[col]) {
      val = labelMappings[col][String(rawVal)] ?? 0;
    } else {
      val = Number(rawVal) || 0;
    }

    const sp = scalingParams[col];
    if (sp && processedDataset.data.length > 0) {
      const sampleVal = processedDataset.data[0][col];
      const originalScale = sp.min + sampleVal * (sp.max - sp.min);
      const isMinMax = Math.abs(originalScale - sp.mean) < Math.abs(processedDataset.data[0][col] - sp.mean);
      if (isMinMax) {
        val = (val - sp.min) / (sp.max - sp.min);
      } else {
        val = (val - sp.mean) / sp.std;
      }
    }

    numericInputs[col] = val;
  }

  if (model.algorithm === 'k_means' && model.centroids) {
    let bestCluster = 0;
    let bestDist = Infinity;
    model.centroids.forEach((centroid, ci) => {
      const dist = featureColumns.reduce((d, f, j) => d + (numericInputs[f] - centroid[j]) ** 2, 0);
      if (dist < bestDist) { bestDist = dist; bestCluster = ci; }
    });
    return {
      predictedValue: `Cluster ${bestCluster + 1}`,
      confidence: Math.max(0.4, 1 - bestDist / 10),
      featureContributions: featureColumns.map(f => ({
        feature: f, contribution: Math.abs(numericInputs[f]), direction: 'positive' as const
      })),
      explanation: `This data point is most similar to Cluster ${bestCluster + 1} based on the feature distances.`,
    };
  }

  const topFromContrib = (items: { feature: string; contribution: number; direction: 'positive' | 'negative' }[]) => {
    return [...items].sort((a, b) => b.contribution - a.contribution)[0];
  };

  if (model.algorithm === 'decision_tree' && model.tree) {
    const detail = predictWithTreeDetail(model.tree, numericInputs);
    const featureContributions = toContributionArray(featureColumns, detail.contributions);

    if (model.problemType === 'classification') {
      const classCounts = detail.classCounts ?? [];
      const voteTotal = classCounts.reduce((s, v) => s + v, 0);
      const classIdx = Math.max(0, Math.round(detail.prediction));
      const classValue = model.classValues?.[classIdx] ?? classIdx;
      const label = reverseLabelMappings[targetColumn]?.[classValue] ?? String(classValue);
      const confidence = voteTotal > 0 ? Math.max(...classCounts) / voteTotal : 0.6;
      const topContributor = topFromContrib(featureContributions);

      return {
        predictedValue: label,
        confidence: Math.max(0.35, Math.min(0.99, confidence)),
        featureContributions,
        explanation: topContributor
          ? `Decision Tree path was driven mostly by "${topContributor.feature}".`
          : `Prediction made using ${model.algorithmLabel}.`,
      };
    }

    const predictedValue = detail.prediction;
    const rmse = model.regressionMetrics?.rmse ?? 0;
    const margin = rmse > 0 ? 1.96 * rmse : 0;
    const sampleFactor = Math.min(1, detail.leafSamples / Math.max(20, model.trainRows * 0.2));
    const rmseFactor = rmse > 0 ? Math.max(0.4, Math.min(0.95, 1 / (1 + rmse))) : 0.8;
    const confidence = Math.max(0.35, Math.min(0.97, 0.65 * sampleFactor + 0.35 * rmseFactor));
    const topContributor = topFromContrib(featureContributions);

    return {
      predictedValue,
      confidence,
      confidenceInterval: margin > 0 ? { lower: predictedValue - margin, upper: predictedValue + margin } : undefined,
      featureContributions,
      explanation: topContributor
        ? `Decision Tree path was driven mostly by "${topContributor.feature}". Model: ${model.algorithmLabel}.`
        : `Prediction made using ${model.algorithmLabel}.`,
    };
  }

  if (model.algorithm === 'random_forest' && model.forest && model.forest.length > 0) {
    const details = model.forest.map(tree => predictWithTreeDetail(tree, numericInputs));
    const contributionsMap: Record<string, number> = {};
    featureColumns.forEach(f => { contributionsMap[f] = 0; });
    details.forEach(d => {
      featureColumns.forEach(f => {
        contributionsMap[f] += d.contributions[f] || 0;
      });
    });
    featureColumns.forEach(f => {
      contributionsMap[f] = contributionsMap[f] / model.forest!.length;
    });
    const featureContributions = toContributionArray(featureColumns, contributionsMap);

    if (model.problemType === 'classification') {
      const classCount = Math.max(2, model.classValues?.length || 2);
      const votes = Array(classCount).fill(0);
      details.forEach(d => {
        const idx = Math.max(0, Math.min(classCount - 1, Math.round(d.prediction)));
        votes[idx]++;
      });
      const winningIdx = votes.indexOf(Math.max(...votes));
      const confidence = votes[winningIdx] / model.forest.length;
      const classValue = model.classValues?.[winningIdx] ?? winningIdx;
      const label = reverseLabelMappings[targetColumn]?.[classValue] ?? String(classValue);
      const topContributor = topFromContrib(featureContributions);

      return {
        predictedValue: label,
        confidence: Math.max(0.35, Math.min(0.99, confidence)),
        featureContributions,
        explanation: topContributor
          ? `Random Forest vote was influenced most by "${topContributor.feature}".`
          : `Prediction made using ${model.algorithmLabel}.`,
      };
    }

    const preds = details.map(d => d.prediction);
    const predictedValue = mean(preds);
    const predStd = Math.sqrt(mean(preds.map(p => (p - predictedValue) ** 2)));
    const rmse = model.regressionMetrics?.rmse ?? predStd;
    const margin = 1.96 * Math.max(predStd, rmse);
    const uncertainty = predStd + rmse;
    const confidence = Math.max(0.35, Math.min(0.97, 1 / (1 + uncertainty)));
    const topContributor = topFromContrib(featureContributions);

    return {
      predictedValue,
      confidence,
      confidenceInterval: { lower: predictedValue - margin, upper: predictedValue + margin },
      featureContributions,
      explanation: topContributor
        ? `Random Forest prediction was influenced most by "${topContributor.feature}". Model: ${model.algorithmLabel}.`
        : `Prediction made using ${model.algorithmLabel}.`,
    };
  }

  // Linear/Logistic fallback
  let rawPrediction = model.intercept || 0;
  const contributions: { feature: string; contribution: number; direction: 'positive' | 'negative' }[] = [];
  for (const col of featureColumns) {
    const coef = model.coefficients?.[col] || 0;
    const contribution = coef * numericInputs[col];
    rawPrediction += contribution;
    contributions.push({
      feature: col,
      contribution: Math.abs(contribution),
      direction: contribution >= 0 ? 'positive' : 'negative',
    });
  }

  let predictedValue: number | string = rawPrediction;
  let confidence = 0.7;

  if (model.problemType === 'classification') {
    const classProb = sigmoid(rawPrediction);
    const classIdx = classProb > 0.5 ? 1 : 0;
    confidence = Math.abs(classProb - 0.5) * 2;
    const rlm = reverseLabelMappings[targetColumn] || {};
    predictedValue = rlm[classIdx] !== undefined ? rlm[classIdx] : (classIdx === 1 ? 'Yes' : 'No');
  } else {
    const sp = scalingParams[targetColumn];
    if (sp && rawPrediction !== 0) {
      const residualStd = sp.std * 0.2;
      confidence = Math.max(0.3, Math.min(0.99, 1 - residualStd / (sp.std + 0.001)));
      predictedValue = rawPrediction;
    }
  }

  const sp = scalingParams[targetColumn];
  const ci = sp ? {
    lower: Number(predictedValue) - 1.96 * sp.std * 0.2,
    upper: Number(predictedValue) + 1.96 * sp.std * 0.2,
  } : undefined;

  const topContributor = topFromContrib(contributions);

  return {
    predictedValue,
    confidence,
    confidenceInterval: model.problemType === 'regression' ? ci : undefined,
    featureContributions: contributions,
    explanation: topContributor
      ? `The most influential feature is "${topContributor.feature}" with a ${topContributor.direction} contribution. Model: ${model.algorithmLabel}.`
      : `Prediction made using ${model.algorithmLabel}.`,
  };
};

// ============================================================
// H. Deployment Guidance
// ============================================================

export const generateDeploymentGuidance = (
  model: ModelResult,
  processedDataset: ProcessedDataset
): DeploymentGuidance => {
  const { targetColumn, featureColumns, scalingParams, labelMappings } = processedDataset;

  const exportedModelConfig: Record<string, unknown> = {
    model_type: model.algorithmLabel,
    version: '1.0.0',
    created_at: new Date().toISOString(),
    target_column: targetColumn,
    feature_columns: featureColumns,
    problem_type: model.problemType,
    preprocessing: {
      scaling: processedDataset.scalingParams[featureColumns[0]] ? 'z_score' : 'none',
      scaling_params: scalingParams,
      label_mappings: labelMappings,
    },
    parameters: {
      intercept: model.intercept ?? null,
      coefficients: model.coefficients ?? null,
      centroids: model.centroids ?? null,
      tree: model.tree ?? null,
      forest: model.forest ?? null,
      class_values: model.classValues ?? null,
    },
    performance: model.regressionMetrics
      ? { r_squared: model.regressionMetrics.rSquared, rmse: model.regressionMetrics.rmse }
      : model.classificationMetrics
        ? { accuracy: model.classificationMetrics.accuracy, f1: model.classificationMetrics.f1 }
        : { silhouette: model.clusteringMetrics?.silhouetteScore },
    api_endpoint: '/api/v1/predict',
  };

  const nRows = processedDataset.data.length;

  const monitoring: string[] = [
    'Track prediction distribution drift weekly using a statistical test (e.g. KS test).',
    'Monitor input feature distributions against training baseline.',
    `Set alert if prediction accuracy drops below ${model.regressionMetrics ? `RMSE > ${(model.regressionMetrics.rmse * 1.5).toFixed(2)}` : '85% accuracy'}.`,
    'Log all predictions with timestamps for audit trail.',
    'Review model performance monthly against new ground-truth labels.',
  ];

  const retraining: string[] = [
    `Retrain when dataset grows by 20% (currently ${nRows} rows -> next at ${Math.round(nRows * 1.2)} rows).`,
    'Retrain quarterly regardless of drift for freshness.',
    'Retrain immediately if prediction confidence drops below 60% on average.',
    'Retrain when new features or data sources become available.',
  ];

  const apiTemplate = `POST /api/v1/predict
Content-Type: application/json

Request:
{
  "model_id": "${model.algorithm}_v1",
  "features": {
${featureColumns.slice(0, 5).map(f => `    "${f}": <value>`).join(',\n')}${featureColumns.length > 5 ? '\n    ...' : ''}
  }
}

Response:
{
  "prediction": <value>,
  "confidence": <0-1>,
  "model": "${model.algorithmLabel}",
  "timestamp": "<ISO datetime>"
}`;

  return {
    recommendedPlatform: nRows > 5000 ? 'Cloud API (AWS Lambda / Google Cloud Run)' : 'Static Web App with WASM runtime',
    exportFormat: 'json_config',
    exportedModelConfig,
    apiEndpointTemplate: apiTemplate,
    monitoringRecommendations: monitoring,
    retrainingTriggers: retraining,
    estimatedInferenceMs: model.algorithm === 'random_forest' ? 40 : model.algorithm === 'decision_tree' ? 12 : 5,
  };
};


