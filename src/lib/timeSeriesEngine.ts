// Time Series Engine - Automatic date detection, decomposition, forecasting, and growth analysis
// Brings Power BI-level time intelligence to the DataAfrik platform

import {
  Dataset,
  ColumnInfo,
  DateHierarchy,
  TimeSeriesResult,
  TimeSeriesPoint,
  DateTableInfo,
  GrowthRate,
  AggregatedTimeSeries
} from './types';
import { minOf, maxOf } from './dataUtils';
import { cellNumber } from '@/lib/dax/value';

// ============================================================
// Date Detection & Classification
// ============================================================

/**
 * Try to parse a value as a Date. Returns null if not parseable.
 */
const parseLocalDate = (value: any): Date | null => {
  if (value == null || value === '') return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;

  const str = String(value).trim();
  // Quick reject: pure numbers that aren't year-like
  if (/^\d+$/.test(str) && (str.length < 4 || str.length > 8)) return null;

  const d = new Date(str);
  if (!isNaN(d.getTime()) && d.getFullYear() >= 1900 && d.getFullYear() <= 2100) {
    return d;
  }

  // Try common formats: DD/MM/YYYY, DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1]);
    const month = parseInt(dmyMatch[2]) - 1;
    const year = parseInt(dmyMatch[3]) + (dmyMatch[3].length === 2 ? 2000 : 0);
    const parsed = new Date(year, month, day);
    if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 1900) return parsed;
  }

  return null;
};
/**
 * A value as a calendar date: midnight UTC, read back with UTC getters.
 *
 * The engine's convention (semantic/dates.ts). This file used to mix local
 * and UTC readings: `new Date('2026-02-01')` is UTC midnight, but months were
 * bucketed with local getters, so anywhere behind UTC 1 February landed in
 * January; days were keyed with toISOString (UTC), so a locally-parsed date
 * landed on the previous day anywhere ahead of UTC.
 */
const tryParseDate = (value: any): Date | null => {
  const local = parseLocalDate(value);
  if (!local) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    // Date-only ISO text is already parsed as UTC midnight.
    return local;
  }
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
};


/**
 * Detect date columns in a dataset and classify them
 */
export const detectDateColumns = (dataset: Dataset): DateTableInfo[] => {
  const results: DateTableInfo[] = [];

  for (const col of dataset.columns) {
    // Check columns already typed as 'date' or string columns that might be dates
    if (col.type !== 'date' && col.type !== 'string') continue;

    const dates: Date[] = [];
    let parseable = 0;

    for (const row of dataset.data) {
      const parsed = tryParseDate(row[col.name]);
      if (parsed) {
        dates.push(parsed);
        parseable++;
      }
    }

    const parseRate = parseable / Math.max(dataset.rowCount, 1);
    if (parseRate < 0.7 || dates.length < 3) continue;

    // Sort dates
    dates.sort((a, b) => a.getTime() - b.getTime());

    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];

    // Determine frequency by analyzing time deltas
    const frequency = detectFrequency(dates);

    // Calculate coverage
    const { gaps, coverage } = calculateCoverage(dates, frequency);

    const uniqueDates = new Set(dates.map(d => d.toISOString().split('T')[0])).size;

    const isDateTable = coverage > 0.6 && frequency !== 'irregular';

    results.push({
      datasetId: dataset.id,
      datasetName: dataset.name,
      columnName: col.name,
      isDateTable,
      frequency,
      dateRange: { min: minDate, max: maxDate },
      gaps,
      coverage,
      totalDates: dates.length,
      uniqueDates
    });
  }

  return results;
};

/**
 * Detect the frequency of a sorted date array
 */
const detectFrequency = (dates: Date[]): DateTableInfo['frequency'] => {
  if (dates.length < 2) return 'irregular';

  // Calculate deltas in days
  const deltas: number[] = [];
  for (let i = 1; i < Math.min(dates.length, 200); i++) {
    const diff = (dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24);
    if (diff > 0) deltas.push(Math.round(diff));
  }

  if (deltas.length === 0) return 'irregular';

  // Find mode of deltas
  const counts: Record<number, number> = {};
  deltas.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
  const modeDelta = parseInt(
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
  );

  // Median delta
  const sortedDeltas = [...deltas].sort((a, b) => a - b);
  const medianDelta = sortedDeltas[Math.floor(sortedDeltas.length / 2)];

  if (medianDelta <= 1) return 'daily';
  if (medianDelta >= 5 && medianDelta <= 9) return 'weekly';
  if (medianDelta >= 27 && medianDelta <= 33) return 'monthly';
  if (medianDelta >= 85 && medianDelta <= 100) return 'quarterly';
  if (medianDelta >= 350 && medianDelta <= 380) return 'yearly';
  return 'irregular';
};

/**
 * Calculate how complete a date range is
 */
const calculateCoverage = (dates: Date[], frequency: DateTableInfo['frequency']): { gaps: number; coverage: number } => {
  if (dates.length < 2 || frequency === 'irregular') {
    return { gaps: 0, coverage: 0.5 };
  }

  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  const uniqueDates = new Set(dates.map(d => d.toISOString().split('T')[0]));

  let expectedCount: number;
  const diffDays = (maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24);

  switch (frequency) {
    case 'daily': expectedCount = Math.max(1, Math.round(diffDays)); break;
    case 'weekly': expectedCount = Math.max(1, Math.round(diffDays / 7)); break;
    case 'monthly': expectedCount = Math.max(1, Math.round(diffDays / 30.44)); break;
    case 'quarterly': expectedCount = Math.max(1, Math.round(diffDays / 91.31)); break;
    case 'yearly': expectedCount = Math.max(1, Math.round(diffDays / 365.25)); break;
    default: expectedCount = uniqueDates.size;
  }

  const coverage = Math.min(1, uniqueDates.size / Math.max(expectedCount, 1));
  const gaps = Math.max(0, expectedCount - uniqueDates.size);

  return { gaps, coverage };
};

// ============================================================
// Date Hierarchy
// ============================================================

/**
 * Build a date hierarchy for each date
 */
export const buildDateHierarchy = (dates: Date[]): DateHierarchy[] => {
  return dates.map(date => {
    const d = new Date(date);
    const month = d.getUTCMonth() + 1;
    const dayOfYear = Math.floor(
      (d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / (1000 * 60 * 60 * 24)
    );

    return {
      year: d.getUTCFullYear(),
      quarter: Math.ceil(month / 3),
      month,
      week: Math.ceil(dayOfYear / 7),
      dayOfWeek: d.getUTCDay(),
      dayOfMonth: d.getUTCDate(),
      date: d
    };
  });
};

// ============================================================
// Moving Averages
// ============================================================

/**
 * Calculate moving averages
 */
export const movingAverage = (
  values: number[],
  window: number,
  type: 'SMA' | 'EMA' | 'WMA' = 'SMA'
): number[] => {
  if (values.length === 0 || window < 1) return [];

  const safeWindow = Math.min(window, values.length);

  switch (type) {
    case 'SMA':
      return calculateSMA(values, safeWindow);
    case 'EMA':
      return calculateEMA(values, safeWindow);
    case 'WMA':
      return calculateWMA(values, safeWindow);
    default:
      return calculateSMA(values, safeWindow);
  }
};

const calculateSMA = (values: number[], window: number): number[] => {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) {
      // Partial window at the start
      const slice = values.slice(0, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / slice.length);
    } else {
      const slice = values.slice(i - window + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / window);
    }
  }
  return result;
};

const calculateEMA = (values: number[], window: number): number[] => {
  const alpha = 2 / (window + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(alpha * values[i] + (1 - alpha) * result[i - 1]);
  }
  return result;
};

const calculateWMA = (values: number[], window: number): number[] => {
  const result: number[] = [];
  const weightSum = (window * (window + 1)) / 2;

  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) {
      const actualWindow = i + 1;
      const localWeightSum = (actualWindow * (actualWindow + 1)) / 2;
      let sum = 0;
      for (let j = 0; j <= i; j++) {
        sum += values[j] * (j + 1);
      }
      result.push(sum / localWeightSum);
    } else {
      let sum = 0;
      for (let j = 0; j < window; j++) {
        sum += values[i - window + 1 + j] * (j + 1);
      }
      result.push(sum / weightSum);
    }
  }
  return result;
};

// ============================================================
// Time Series Decomposition
// ============================================================

/**
 * Classical additive decomposition: Value = Trend + Seasonal + Residual
 */
export const decompose = (
  values: number[],
  period: number
): { trend: number[]; seasonal: number[]; residual: number[] } => {
  if (values.length < period * 2) {
    // Not enough data for decomposition, return simple trend
    return {
      trend: calculateSMA(values, Math.max(3, Math.floor(values.length / 3))),
      seasonal: new Array(values.length).fill(0),
      residual: new Array(values.length).fill(0)
    };
  }

  // Step 1: Compute centered moving average as trend
  const trend = centeredMovingAverage(values, period);

  // Step 2: Detrend (remove trend)
  const detrended = values.map((v, i) => (trend[i] !== null ? v - trend[i]! : 0));

  // Step 3: Average seasonal component per position
  const seasonalPattern: number[] = new Array(period).fill(0);
  const seasonalCounts: number[] = new Array(period).fill(0);

  for (let i = 0; i < detrended.length; i++) {
    if (trend[i] !== null) {
      const pos = i % period;
      seasonalPattern[pos] += detrended[i];
      seasonalCounts[pos]++;
    }
  }

  for (let i = 0; i < period; i++) {
    seasonalPattern[i] = seasonalCounts[i] > 0 ? seasonalPattern[i] / seasonalCounts[i] : 0;
  }

  // Normalize seasonal so it sums to ~0
  const seasonalMean = seasonalPattern.reduce((a, b) => a + b, 0) / period;
  const normalizedSeasonal = seasonalPattern.map(s => s - seasonalMean);

  // Step 4: Extend seasonal pattern across full length
  const seasonal = values.map((_, i) => normalizedSeasonal[i % period]);

  // Step 5: Residual = Value - Trend - Seasonal
  const residual = values.map((v, i) => {
    const t = trend[i] !== null ? trend[i]! : v;
    return v - t - seasonal[i];
  });

  // Replace null trends with interpolated values
  const trendFilled = trend.map((t, i) => t !== null ? t : values[i] - seasonal[i]);

  return { trend: trendFilled, seasonal, residual };
};

const centeredMovingAverage = (values: number[], period: number): (number | null)[] => {
  const result: (number | null)[] = new Array(values.length).fill(null);
  const halfPeriod = Math.floor(period / 2);

  for (let i = halfPeriod; i < values.length - halfPeriod; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - halfPeriod; j <= i + halfPeriod; j++) {
      if (j >= 0 && j < values.length) {
        sum += values[j];
        count++;
      }
    }
    result[i] = count > 0 ? sum / count : null;
  }

  return result;
};

// ============================================================
// Seasonality Detection
// ============================================================

/**
 * Detect seasonality via autocorrelation
 */
export const detectSeasonality = (
  values: number[],
  maxPeriod: number = 52
): { period: number; strength: number } => {
  if (values.length < maxPeriod * 2) {
    maxPeriod = Math.floor(values.length / 2);
  }
  if (maxPeriod < 2) return { period: 0, strength: 0 };

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1 || 1);
  if (variance === 0) return { period: 0, strength: 0 };

  let bestPeriod = 0;
  let bestCorrelation = 0;

  for (let lag = 2; lag <= maxPeriod; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < values.length - lag; i++) {
      sum += (values[i] - mean) * (values[i + lag] - mean);
      count++;
    }
    const autocorr = count > 0 ? sum / (count * variance) : 0;

    if (autocorr > bestCorrelation) {
      bestCorrelation = autocorr;
      bestPeriod = lag;
    }
  }

  return { period: bestPeriod, strength: Math.max(0, Math.min(1, bestCorrelation)) };
};

// ============================================================
// Growth Rate Calculations
// ============================================================

/**
 * Calculate period-over-period growth rates
 */
export const calculateGrowthRates = (
  data: any[],
  dateColumn: string,
  valueColumn: string,
  frequency: DateTableInfo['frequency'],
  aggregation: 'sum' | 'average' = 'sum'
): GrowthRate[] => {
  if (data.length < 2) return [];

  // Aggregate by period
  const aggregated = aggregateByDatePeriod(data, dateColumn, valueColumn, frequency);
  const pick = (period: { sum: number; avg: number }) => (aggregation === 'sum' ? period.sum : period.avg);

  const rates: GrowthRate[] = [];
  for (let i = 1; i < aggregated.length; i++) {
    const current = pick(aggregated[i]);
    const previous = pick(aggregated[i - 1]);
    const absoluteChange = current - previous;
    const percentageChange = previous !== 0 ? (absoluteChange / Math.abs(previous)) * 100 : 0;

    rates.push({
      period: aggregated[i].period,
      currentValue: current,
      previousValue: previous,
      absoluteChange: Math.round(absoluteChange * 100) / 100,
      percentageChange: Math.round(percentageChange * 100) / 100
    });
  }

  return rates;
};

/**
 * Whether a column's values add up to something meaningful over a period.
 *
 * Money, quantities, counts and durations do: a day's revenue is the sum of
 * its sales. Ages, scores, ratings, rates and prices do not: the "total age"
 * of a day's enrolments only measures how many people enrolled. Those are
 * averaged instead. Decided from the name, and stated on screen, so a wrong
 * guess is visible rather than silent.
 */
const ADDITIVE_WORDS = [
  'amount', 'revenue', 'sales', 'sale', 'total', 'turnover', 'cost', 'costs', 'expense', 'expenses',
  'spend', 'profit', 'income', 'quantity', 'qty', 'units', 'count', 'volume', 'orders', 'visits',
  'minutes', 'hours', 'seconds', 'duration', 'days', 'held', 'pieces', 'calls', 'tickets',
];

export const isAdditiveColumn = (name: string): boolean => {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some(token => ADDITIVE_WORDS.includes(token));
};

// ============================================================
// Aggregation by Date Period
// ============================================================

/**
 * Aggregate data by date period (year, quarter, month, week)
 */
export const aggregateByDatePeriod = (
  data: any[],
  dateColumn: string,
  valueColumn: string,
  period: DateTableInfo['frequency'] | string
): AggregatedTimeSeries[] => {
  const buckets: Record<string, number[]> = {};

  for (const row of data) {
    const date = tryParseDate(row[dateColumn]);
    const value = cellNumber(row[valueColumn]);
    if (!date || isNaN(value)) continue;

    let key: string;
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;

    switch (period) {
      case 'yearly':
        key = `${y}`;
        break;
      case 'quarterly':
        key = `${y}-Q${Math.ceil(m / 3)}`;
        break;
      case 'monthly':
        key = `${y}-${String(m).padStart(2, '0')}`;
        break;
      case 'weekly': {
        const dayOfYear = Math.floor(
          (date.getTime() - Date.UTC(y, 0, 0)) / (1000 * 60 * 60 * 24)
        );
        const week = Math.ceil(dayOfYear / 7);
        key = `${y}-W${String(week).padStart(2, '0')}`;
        break;
      }
      case 'daily':
      default:
        key = date.toISOString().split('T')[0];
        break;
    }

    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(value);
  }

  return Object.entries(buckets)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, values]) => ({
      period,
      sum: values.reduce((a, b) => a + b, 0),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      count: values.length,
      min: minOf(values),
      max: maxOf(values)
    }));
};

// ============================================================
// Forecasting
// ============================================================

/**
 * Forecast future values using Holt's exponential smoothing or linear projection
 */
export const forecast = (
  values: number[],
  periods: number = 6,
  method: 'exponential' | 'linear' = 'exponential'
): TimeSeriesPoint[] => {
  if (values.length < 3) return [];

  if (method === 'exponential') {
    return holtForecast(values, periods);
  } else {
    return linearForecast(values, periods);
  }
};

/**
 * Holt's double exponential smoothing (level + trend)
 */
const holtForecast = (values: number[], periods: number): TimeSeriesPoint[] => {
  const alpha = 0.3; // Level smoothing
  const beta = 0.1;  // Trend smoothing

  // Initialize
  let level = values[0];
  let trend = values.length > 1 ? values[1] - values[0] : 0;

  // Fit the model
  const fitted: number[] = [level];
  const errors: number[] = [];

  for (let i = 1; i < values.length; i++) {
    const prevLevel = level;
    level = alpha * values[i] + (1 - alpha) * (prevLevel + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    fitted.push(level + trend);
    errors.push(values[i] - fitted[i]);
  }

  // Standard error for confidence bands
  const mse = errors.length > 0
    ? errors.reduce((sum, e) => sum + e * e, 0) / errors.length
    : 0;
  const stderr = Math.sqrt(mse);

  // Generate forecasts
  const results: TimeSeriesPoint[] = [];
  for (let i = 1; i <= periods; i++) {
    const forecastValue = level + trend * i;
    const confidenceWidth = 1.96 * stderr * Math.sqrt(i); // Wider CI for further ahead

    results.push({
      date: `+${i}`,
      value: Math.round(forecastValue * 100) / 100,
      lower: Math.round((forecastValue - confidenceWidth) * 100) / 100,
      upper: Math.round((forecastValue + confidenceWidth) * 100) / 100
    });
  }

  return results;
};

/**
 * Linear projection forecast
 */
const linearForecast = (values: number[], periods: number): TimeSeriesPoint[] => {
  const n = values.length;
  const x = Array.from({ length: n }, (_, i) => i);

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((total, xi, i) => total + xi * values[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX ** 2);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate standard error
  const predictions = x.map(xi => slope * xi + intercept);
  const residuals = values.map((y, i) => y - predictions[i]);
  const sse = residuals.reduce((sum, r) => sum + r * r, 0);
  const stderr = Math.sqrt(sse / Math.max(1, n - 2));

  const results: TimeSeriesPoint[] = [];
  for (let i = 1; i <= periods; i++) {
    const xi = n - 1 + i;
    const forecastValue = slope * xi + intercept;
    const confidenceWidth = 1.96 * stderr * Math.sqrt(1 + 1 / n + ((xi - sumX / n) ** 2) / (sumX2 - sumX ** 2 / n));

    results.push({
      date: `+${i}`,
      value: Math.round(forecastValue * 100) / 100,
      lower: Math.round((forecastValue - confidenceWidth) * 100) / 100,
      upper: Math.round((forecastValue + confidenceWidth) * 100) / 100
    });
  }

  return results;
};

// ============================================================
// Full Time Series Analysis
// ============================================================

/**
 * Run complete time series analysis on a dataset
 */
export const runTimeSeriesAnalysis = (
  dataset: Dataset,
  dateColumnName: string,
  valueColumnName: string,
  frequency?: DateTableInfo['frequency']
): TimeSeriesResult | null => {
  // Collect and sort date-value pairs
  const pairs: { date: Date; value: number }[] = [];

  for (const row of dataset.data) {
    const date = tryParseDate(row[dateColumnName]);
    const value = cellNumber(row[valueColumnName]);
    if (date && !isNaN(value)) {
      pairs.push({ date, value });
    }
  }

  if (pairs.length < 5) return null;

  // Sort by date
  pairs.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Aggregate if needed (duplicate dates)
  const aggregated = new Map<string, { sum: number; count: number }>();
  for (const p of pairs) {
    const key = p.date.toISOString().split('T')[0];
    const existing = aggregated.get(key) || { sum: 0, count: 0 };
    existing.sum += p.value;
    existing.count++;
    aggregated.set(key, existing);
  }

  const sortedKeys = [...aggregated.keys()].sort();
  const aggregation: 'sum' | 'average' = isAdditiveColumn(valueColumnName) ? 'sum' : 'average';
  const values = sortedKeys.map(k => {
    const bucket = aggregated.get(k)!;
    return aggregation === 'sum' ? bucket.sum : bucket.sum / bucket.count;
  });
  const dates = sortedKeys;

  if (values.length < 5) return null;

  // Detect frequency if not provided
  const rawFreq = frequency || detectFrequency(sortedKeys.map(k => new Date(k)));
  const detectedFreq: TimeSeriesResult['frequency'] = rawFreq === 'irregular' ? 'daily' : rawFreq;

  // Determine decomposition period
  let period: number;
  switch (detectedFreq) {
    case 'daily': period = 7; break;       // Weekly seasonality
    case 'weekly': period = 52; break;     // Yearly seasonality
    case 'monthly': period = 12; break;    // Yearly seasonality
    case 'quarterly': period = 4; break;   // Yearly seasonality
    case 'yearly': period = 1; break;
    default: period = Math.min(12, Math.floor(values.length / 3));
  }

  // Decompose
  const { trend, seasonal, residual } = decompose(values, Math.max(2, period));

  // Moving average
  const ma = calculateSMA(values, Math.min(Math.max(3, period), Math.floor(values.length / 2)));

  // Seasonality strength
  const { strength: seasonalityStrength } = detectSeasonality(values, Math.min(period * 2, Math.floor(values.length / 2)));

  // Growth rates
  const growthRates = calculateGrowthRates(
    dataset.data,
    dateColumnName,
    valueColumnName,
    detectedFreq,
    aggregation
  );

  // Forecast
  const forecastPeriods = Math.min(6, Math.floor(values.length / 3));
  // A series that has never gone below zero (ages, scores, sales) cannot be
  // forecast to: the interval used to reach -700 for an age.
  const nonNegative = values.every(v => v >= 0);
  const forecastResult = forecast(values, forecastPeriods, 'exponential').map(point =>
    nonNegative
      ? { ...point, value: Math.max(0, point.value), lower: point.lower === undefined ? undefined : Math.max(0, point.lower) }
      : point
  );

  // Label forecast dates based on last actual date
  const lastDate = new Date(sortedKeys[sortedKeys.length - 1]);
  const labeledForecast = forecastResult.map((f, i) => {
    const futureDate = new Date(lastDate);
    switch (detectedFreq) {
      case 'daily': futureDate.setUTCDate(futureDate.getUTCDate() + (i + 1)); break;
      case 'weekly': futureDate.setUTCDate(futureDate.getUTCDate() + (i + 1) * 7); break;
      case 'monthly': futureDate.setUTCMonth(futureDate.getUTCMonth() + (i + 1)); break;
      case 'quarterly': futureDate.setUTCMonth(futureDate.getUTCMonth() + (i + 1) * 3); break;
      case 'yearly': futureDate.setUTCFullYear(futureDate.getUTCFullYear() + (i + 1)); break;
    }
    return { ...f, date: futureDate.toISOString().split('T')[0] };
  });

  return {
    column: valueColumnName,
    dateColumn: dateColumnName,
    frequency: detectedFreq,
    trend,
    seasonal,
    residual,
    movingAverage: ma,
    forecast: labeledForecast,
    growthRates,
    seasonalityStrength,
    decompositionDates: dates,
    aggregation,
  };
};

/**
 * Auto-detect and run time series for all viable column pairs
 */
export const autoDetectTimeSeries = (dataset: Dataset): TimeSeriesResult[] => {
  const dateInfos = detectDateColumns(dataset);
  const results: TimeSeriesResult[] = [];

  // Find date columns
  const viableDateCols = dateInfos.filter(d => d.isDateTable || d.coverage > 0.5);
  if (viableDateCols.length === 0) return [];

  const numericColumns = dataset.columns.filter(c => c.type === 'number');
  const dateCol = viableDateCols[0]; // Use best date column

  // Run time series for each numeric column (limit to first 5 for performance)
  for (const numCol of numericColumns.slice(0, 5)) {
    const result = runTimeSeriesAnalysis(dataset, dateCol.columnName, numCol.name, dateCol.frequency);
    if (result) {
      results.push(result);
    }
  }

  return results;
};
