// Statistical Description Utilities (similar to pandas .describe())
import { Dataset, ColumnInfo } from './types';
import { cellNumber } from '@/lib/dax/value';

export interface ColumnStatistics {
  columnName: string;
  type: 'number' | 'string' | 'date' | 'boolean';
  // Common statistics
  count: number;
  nonNullCount: number;
  nullCount: number;
  
  // Numeric statistics
  mean?: number;
  std?: number;
  min?: number;
  q1?: number;  // 25th percentile
  median?: number;  // 50th percentile
  q3?: number;  // 75th percentile
  max?: number;
  
  // Categorical statistics
  unique?: number;
  top?: any;  // Most frequent value
  freq?: number;  // Frequency of top value
}

/**
 * Calculate quartiles (percentiles) for a sorted array
 */
const calculatePercentile = (sortedValues: number[], percentile: number): number => {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  
  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
};

/**
 * Calculate standard deviation
 */
const calculateStdDev = (values: number[], mean: number): number => {
  if (values.length === 0) return 0;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (values.length - 1 || 1);
  return Math.sqrt(variance);
};

/** Blank: missing, empty, or only spaces. */
const isBlank = (value: unknown): boolean =>
  value === null || value === undefined || String(value).trim() === '';

/** How the engine compares values (semantic keyOf): trimmed, case-insensitive. */
const valueKey = (value: unknown): string => String(value).trim().toLowerCase();

/**
 * Get most frequent value and its frequency
 */
const getMostFrequent = (values: any[]): { value: any; frequency: number } => {
  // Counted per value as the engine groups them (trimmed, case-insensitive),
  // shown in the first spelling seen.
  const frequencyMap = new Map<string, number>();
  const labels = new Map<string, string>();

  values.forEach(val => {
    const key = valueKey(val);
    if (!labels.has(key)) labels.set(key, String(val).trim());
    frequencyMap.set(key, (frequencyMap.get(key) || 0) + 1);
  });

  let maxFreq = 0;
  let mostFrequent: any = null;

  frequencyMap.forEach((freq, key) => {
    if (freq > maxFreq) {
      maxFreq = freq;
      mostFrequent = labels.get(key);
    }
  });
  
  return { value: mostFrequent, frequency: maxFreq };
};

/**
 * Calculate comprehensive statistics for a numeric column
 */
const calculateNumericStatistics = (
  columnName: string,
  values: any[],
  type: 'number' | 'string' | 'date' | 'boolean'
): ColumnStatistics => {
  // In a numeric column, a cell that is not a number ("NA", "-") is missing:
  // it is left out of every statistic below, so it is counted as missing too.
  // It used to be counted as present - "0 nulls" beside a mean of fewer rows.
  const numericValues = values
    .map(v => cellNumber(v))
    .filter(v => !isNaN(v))
    .sort((a, b) => a - b);

  const count = values.length;
  const nonNullCount = numericValues.length;
  const nullCount = count - nonNullCount;
  
  if (numericValues.length === 0) {
    return {
      columnName,
      type,
      count,
      nonNullCount,
      nullCount
    };
  }
  
  const mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
  const std = calculateStdDev(numericValues, mean);
  const min = numericValues[0];
  const q1 = calculatePercentile(numericValues, 25);
  const median = calculatePercentile(numericValues, 50);
  const q3 = calculatePercentile(numericValues, 75);
  const max = numericValues[numericValues.length - 1];
  
  return {
    columnName,
    type,
    count,
    nonNullCount,
    nullCount,
    mean,
    std,
    min,
    q1,
    median,
    q3,
    max
  };
};

/**
 * Calculate statistics for a categorical column
 */
const calculateCategoricalStatistics = (
  columnName: string,
  values: any[],
  type: 'number' | 'string' | 'date' | 'boolean'
): ColumnStatistics => {
  const nonNullValues = values.filter(v => !isBlank(v));
  // " student " and "Student" are one value, as the engine and Ask Data see it.
  const uniqueValues = new Set(nonNullValues.map(valueKey));
  const { value: top, frequency: freq } = getMostFrequent(nonNullValues);
  
  return {
    columnName,
    type,
    count: values.length,
    nonNullCount: nonNullValues.length,
    nullCount: values.length - nonNullValues.length,
    unique: uniqueValues.size,
    top,
    freq
  };
};

/**
 * Generate comprehensive statistical description for all columns in a dataset
 * Similar to pandas DataFrame.describe()
 */
export const describeDataset = (dataset: Dataset): ColumnStatistics[] => {
  return dataset.columns.map(column => {
    const values = dataset.data.map(row => row[column.name]);
    const columnType = column.type;
    
    if (columnType === 'number') {
      return calculateNumericStatistics(column.name, values, columnType);
    } else {
      return calculateCategoricalStatistics(column.name, values, columnType);
    }
  });
};

/**
 * Format a number for display
 */
export const formatNumber = (value: number | undefined, decimals: number = 2): string => {
  if (value === undefined || value === null || isNaN(value)) return '-';
  return value.toFixed(decimals);
};

/**
 * Format a large number with commas
 */
export const formatLargeNumber = (value: number | undefined): string => {
  if (value === undefined || value === null || isNaN(value)) return '-';
  return value.toLocaleString();
};
