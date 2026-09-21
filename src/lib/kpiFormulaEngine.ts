// Dynamic KPI Formula Engine - Power BI-like calculations
// Enhanced with Time Intelligence, CALCULATE, conditional, cross-table, and ranking functions
import React from 'react';
import { Dataset, ColumnInfo, Relationship, DAXFilterContext } from './types';
import { summariseDateColumn, parseDateValue } from './semantic/dates';
import { toDateKey } from './semantic/dateTable';
import { cellAsNumber } from './dax/value';

/**
 * The numbers in a column, with blanks left out.
 *
 * Every aggregation below used to do this inline, and all of them did it
 * wrong in the same way:
 *
 *   .map(row => Number(row[col]))
 *   .filter(v => !isNaN(v) && v !== null && v !== undefined)
 *
 * Number('') and Number(null) are both 0, so the blank was already a zero by
 * the time the null check ran - and that check was therefore testing a value
 * that could never be null. An empty cell became a real 0 and joined the data.
 *
 * AVERAGE divided by a count that included it (10, 20, blank, 30 averaged 15
 * rather than 20), MIN reported 0 for a column whose smallest value was 10,
 * and MEDIAN and STDDEV were shifted by a value nobody entered. Found on the
 * live site, not by a test.
 *
 * cellAsNumber is the DAX engine's own conversion, so the tiles and the DAX
 * that the Ask Data tab shows now agree about what an empty cell means.
 */
const numericColumnValues = (dataset: Dataset, columnName: string): number[] => {
  const values: number[] = [];
  for (const row of dataset.data) {
    const value = cellAsNumber(row[columnName]);
    if (value !== null) values.push(value);
  }
  return values;
};

export type KPIFormula = 
  | 'SUM' 
  | 'AVERAGE' 
  | 'COUNT' 
  | 'COUNTROWS' 
  | 'DISTINCTCOUNT' 
  | 'MIN' 
  | 'MAX' 
  | 'MEDIAN'
  | 'STDDEV'
  | 'PERCENTAGE'
  | 'RATIO';

export interface KPIDefinition {
  id: string;
  title: string;
  formula: KPIFormula;
  columnName?: string;
  columnName2?: string; // For RATIO calculations
  format?: 'number' | 'currency' | 'percentage' | 'decimal';
  icon?: string;
  color?: string;
  description?: string;
}

export interface KPICard {
  title: string;
  value: string;
  formattedValue: string;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon: React.ReactNode;
  color?: string;
  rawValue: number;
}

/**
 * Execute a KPI formula on a dataset
 */
export const executeKPIFormula = (
  dataset: Dataset,
  formula: KPIFormula,
  columnName?: string,
  columnName2?: string
): number => {
  if (!dataset || !dataset.data || dataset.data.length === 0) return 0;

  switch (formula) {
    case 'COUNTROWS':
      return dataset.rowCount;

    case 'COUNT':
      if (!columnName) return 0;
      const column = dataset.columns.find(col => col.name === columnName);
      if (!column) return 0;
      return dataset.data.filter(row => {
        const val = row[columnName];
        return val !== null && val !== undefined && val !== '';
      }).length;

    case 'DISTINCTCOUNT':
      if (!columnName) return 0;
      const distinctValues = new Set(
        dataset.data
          .map(row => row[columnName])
          .filter(v => v !== null && v !== undefined && v !== '')
          .map(v => String(v))
      );
      return distinctValues.size;

    case 'SUM':
      if (!columnName) return 0;
      const sumValues = numericColumnValues(dataset, columnName);
      return sumValues.reduce((a, b) => a + b, 0);

    case 'AVERAGE':
      if (!columnName) return 0;
      const avgValues = numericColumnValues(dataset, columnName);
      if (avgValues.length === 0) return 0;
      return avgValues.reduce((a, b) => a + b, 0) / avgValues.length;

    case 'MIN':
      if (!columnName) return 0;
      const minValues = numericColumnValues(dataset, columnName);
      if (minValues.length === 0) return 0;
      return Math.min(...minValues);

    case 'MAX':
      if (!columnName) return 0;
      const maxValues = numericColumnValues(dataset, columnName);
      if (maxValues.length === 0) return 0;
      return Math.max(...maxValues);

    case 'MEDIAN':
      if (!columnName) return 0;
      const medianValues = numericColumnValues(dataset, columnName).sort((a, b) => a - b);
      if (medianValues.length === 0) return 0;
      const mid = Math.floor(medianValues.length / 2);
      return medianValues.length % 2 === 0
        ? (medianValues[mid - 1] + medianValues[mid]) / 2
        : medianValues[mid];

    case 'STDDEV':
      if (!columnName) return 0;
      const stdValues = numericColumnValues(dataset, columnName);
      if (stdValues.length === 0) return 0;
      const mean = stdValues.reduce((a, b) => a + b, 0) / stdValues.length;
      const variance = stdValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / stdValues.length;
      return Math.sqrt(variance);

    case 'PERCENTAGE':
      if (!columnName) return 0;
      const total = dataset.rowCount;
      if (total === 0) return 0;
      const matchingRows = dataset.data.filter(row => {
        const val = row[columnName];
        return val !== null && val !== undefined && val !== '' && val !== false && val !== 0;
      }).length;
      return (matchingRows / total) * 100;

    case 'RATIO':
      if (!columnName || !columnName2) return 0;
      const val1 = executeKPIFormula(dataset, 'SUM', columnName);
      const val2 = executeKPIFormula(dataset, 'SUM', columnName2);
      if (val2 === 0) return 0;
      return val1 / val2;

    default:
      return 0;
  }
};

/**
 * Format a KPI value based on format type
 */
export const formatKPIValue = (
  value: number,
  format: 'number' | 'currency' | 'percentage' | 'decimal' = 'number',
  decimals: number = 2
): string => {
  if (isNaN(value) || value === null || value === undefined) return '-';

  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }).format(value);

    case 'percentage':
      return `${value.toFixed(decimals)}%`;

    case 'decimal':
      return value.toFixed(decimals);

    case 'number':
    default:
      // Format large numbers with K, M suffixes
      if (Math.abs(value) >= 1000000) {
        return `${(value / 1000000).toFixed(decimals)}M`;
      } else if (Math.abs(value) >= 1000) {
        return `${(value / 1000).toFixed(decimals)}K`;
      }
      return value.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals
      });
  }
};

/**
 * Get appropriate icon for a KPI based on column name and formula
 */
export const getKPIIcon = (formula: KPIFormula, columnName?: string): string => {
  const name = (columnName || '').toLowerCase();
  
  // Cost/Money related
  if (name.includes('cost') || name.includes('price') || name.includes('revenue') || name.includes('amount') || name.includes('sales')) {
    return 'dollar-sign';
  }
  
  // Count related
  if (formula === 'COUNT' || formula === 'COUNTROWS' || formula === 'DISTINCTCOUNT') {
    return 'database';
  }
  
  // Percentage/Rate related
  if (name.includes('rate') || name.includes('percentage') || name.includes('ratio') || formula === 'PERCENTAGE') {
    return 'percent';
  }
  
  // Average related
  if (formula === 'AVERAGE' || name.includes('avg') || name.includes('average')) {
    return 'trending-up';
  }
  
  // Score/Outcome related
  if (name.includes('score') || name.includes('outcome') || name.includes('rating')) {
    return 'activity';
  }
  
  // Default icons by formula
  switch (formula) {
    case 'SUM': return 'plus-circle';
    case 'MIN': return 'arrow-down';
    case 'MAX': return 'arrow-up';
    case 'MEDIAN': return 'minus';
    default: return 'bar-chart-2';
  }
};

/**
 * Get appropriate color for a KPI
 */
export const getKPIColor = (index: number): string => {
  const colors = [
    'text-blue-500',
    'text-green-500',
    'text-purple-500',
    'text-orange-500',
    'text-red-500',
    'text-cyan-500'
  ];
  return colors[index % colors.length];
};

/**
 * Generate KPIs automatically from dataset (Power BI-like)
 */
export const generateKPIs = (dataset: Dataset | null): KPIDefinition[] => {
  if (!dataset || !dataset.columns || dataset.columns.length === 0) {
    return [];
  }

  const kpis: KPIDefinition[] = [];
  const numericColumns = dataset.columns.filter(col => col.type === 'number');
  const stringColumns = dataset.columns.filter(col => col.type === 'string');
  const dateColumns = dataset.columns.filter(col => col.type === 'date');

  // Always add Total Records
  kpis.push({
    id: 'kpi-total-records',
    title: 'Total Records',
    formula: 'COUNTROWS',
    format: 'number',
    icon: 'database',
    color: 'text-blue-500'
  });

  // For each numeric column, create Sum, Average, and potentially other aggregations
  numericColumns.forEach((col, index) => {
    const colName = col.name;
    const cleanName = colName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    // Sum
    kpis.push({
      id: `kpi-sum-${colName}`,
      title: `Sum of ${cleanName}`,
      formula: 'SUM',
      columnName: colName,
      format: 'number',
      icon: getKPIIcon('SUM', colName),
      color: getKPIColor(kpis.length)
    });

    // Average
    kpis.push({
      id: `kpi-avg-${colName}`,
      title: colName.toLowerCase().includes('avg') || colName.toLowerCase().includes('average')
        ? cleanName
        : `Average ${cleanName}`,
      formula: 'AVERAGE',
      columnName: colName,
      format: 'decimal',
      icon: getKPIIcon('AVERAGE', colName),
      color: getKPIColor(kpis.length)
    });
  });

  // For string columns that look like categories, add Distinct Count
  stringColumns.slice(0, 2).forEach(col => {
    const colName = col.name;
    const cleanName = colName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    // Only add if unique count is reasonable (not too high)
    if (col.uniqueCount < dataset.rowCount * 0.5 && col.uniqueCount > 1) {
      kpis.push({
        id: `kpi-distinct-${colName}`,
        title: `Distinct ${cleanName}`,
        formula: 'DISTINCTCOUNT',
        columnName: colName,
        format: 'number',
        icon: getKPIIcon('DISTINCTCOUNT', colName),
        color: getKPIColor(kpis.length)
      });
    }
  });

  // Add percentage calculations for boolean-like columns
  stringColumns.forEach(col => {
    const colName = col.name.toLowerCase();
    if ((colName.includes('rate') || colName.includes('follow') || colName.includes('success')) 
        && col.uniqueCount <= 5) {
      const fullName = col.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      kpis.push({
        id: `kpi-percent-${col.name}`,
        title: fullName.includes('Rate') ? fullName : `${fullName} Rate`,
        formula: 'PERCENTAGE',
        columnName: col.name,
        format: 'percentage',
        icon: getKPIIcon('PERCENTAGE', col.name),
        color: getKPIColor(kpis.length)
      });
    }
  });

  // Limit to 6 KPIs for display (as shown in the image)
  return kpis.slice(0, 6);
};

/**
 * Render a KPI definition as a KPICard
 */
export const renderKPICard = (
  kpiDef: KPIDefinition,
  dataset: Dataset | null,
  icons: Record<string, React.ReactNode>
): KPICard | null => {
  if (!dataset) return null;

  const value = executeKPIFormula(dataset, kpiDef.formula, kpiDef.columnName, kpiDef.columnName2);
  const formattedValue = formatKPIValue(value, kpiDef.format, kpiDef.format === 'percentage' ? 2 : 2);
  const iconKey = kpiDef.icon || 'bar-chart-2';
  const icon = icons[iconKey] || icons['bar-chart-2'] || null;

  if (!icon) return null;

  return {
    title: kpiDef.title,
    value: formattedValue,
    formattedValue,
    rawValue: value,
    icon,
    color: kpiDef.color || 'text-gray-500',
    trend: 'neutral'
  };
};

// ============================================================
// Phase B: Enhanced DAX Functions
// ============================================================

/**
 * Read a date column once, as canonical yyyy-mm-dd keys.
 *
 * Everything below works on those strings rather than Date objects, so there
 * is no timezone in the arithmetic at all. That matters: the previous version
 * did `new Date(String(value))` and then read `.getFullYear()`, a LOCAL
 * getter. An ISO date parses as midnight UTC, which renders as the previous
 * day everywhere west of Greenwich - so a row dated 1 January was counted in
 * the wrong year, and "year to date" silently lost it.
 *
 * It also decided the reading per value rather than per column, so
 * "03/04/2024" was taken as 4 March on the American convention with no
 * warning. Here the format is inferred across the whole column, and a column
 * that genuinely cannot be read returns null rather than a number - the
 * caller has to say it does not know.
 */
export interface DateColumnKeys {
  /** One key per row, aligned with dataset.data. Null where unparseable. */
  keys: (string | null)[];
}

const dateKeysFor = (dataset: Dataset, dateColumn: string): DateColumnKeys | null => {
  const values = dataset.data.map(row => row[dateColumn]);
  const summary = summariseDateColumn(values);
  // Ambiguous or inconsistent: refuse rather than pick a reading. Being wrong
  // by a month on every figure is worse than declining to answer.
  if (!summary.appliedFormat) return null;

  const format = summary.appliedFormat;
  return {
    keys: values.map(value => {
      const parsed = parseDateValue(value, format);
      return parsed ? toDateKey(parsed) : null;
    }),
  };
};

/**
 * The reference point as a calendar date.
 *
 * Read in UTC, to match both the date keys above and the DAX engine's
 * TODAY(). Within a few hours of midnight this can differ from the viewer's
 * wall-clock date; consistency with the rest of the arithmetic is worth more
 * than matching a local calendar that the stored dates do not use.
 */
const referenceKey = (referenceDate?: Date): string => toDateKey(referenceDate ?? new Date());

const yearOf = (key: string): number => Number(key.slice(0, 4));
const monthOf = (key: string): number => Number(key.slice(5, 7));
const quarterOf = (key: string): number => Math.ceil(monthOf(key) / 3);

const numberAt = (dataset: Dataset, index: number, valueColumn: string): number | null => {
  const value = Number(dataset.data[index][valueColumn]);
  return Number.isNaN(value) ? null : value;
};

/**
 * Sum the rows whose date key satisfies `keep`.
 *
 * Returns null when the date column cannot be read, so "I could not work this
 * out" never arrives disguised as zero.
 */
const sumWhere = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string,
  keep: (key: string) => boolean
): number | null => {
  const read = dateKeysFor(dataset, dateColumn);
  if (!read) return null;

  let total = 0;
  read.keys.forEach((key, index) => {
    if (key === null || !keep(key)) return;
    const value = numberAt(dataset, index, valueColumn);
    if (value !== null) total += value;
  });
  return total;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

const changeBetween = (
  current: number,
  previous: number
): { absolute: number; percentage: number } => {
  const absolute = current - previous;
  return {
    absolute: round2(absolute),
    percentage: previous !== 0 ? round2((absolute / Math.abs(previous)) * 100) : 0,
  };
};

// ============================================================
// Time Intelligence Functions
//
// Each returns null when the date column cannot be read. Callers must handle
// that rather than print the number anyway.
// ============================================================

/** TOTALYTD: the current year up to and including the reference date. */
export const calculateTotalYTD = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string,
  referenceDate?: Date
): number | null => {
  const reference = referenceKey(referenceDate);
  const year = yearOf(reference);
  return sumWhere(dataset, valueColumn, dateColumn, key => yearOf(key) === year && key <= reference);
};

/** TOTALQTD: the reference quarter up to and including the reference date. */
export const calculateTotalQTD = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string,
  referenceDate?: Date
): number | null => {
  const reference = referenceKey(referenceDate);
  const year = yearOf(reference);
  const quarter = quarterOf(reference);
  return sumWhere(
    dataset,
    valueColumn,
    dateColumn,
    key => yearOf(key) === year && quarterOf(key) === quarter && key <= reference
  );
};

/** TOTALMTD: the reference month up to and including the reference date. */
export const calculateTotalMTD = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string,
  referenceDate?: Date
): number | null => {
  const reference = referenceKey(referenceDate);
  const year = yearOf(reference);
  const month = monthOf(reference);
  return sumWhere(
    dataset,
    valueColumn,
    dateColumn,
    key => yearOf(key) === year && monthOf(key) === month && key <= reference
  );
};

/** SAMEPERIODLASTYEAR: the equivalent period one year earlier. */
export const calculateSamePeriodLastYear = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string,
  periodType: 'year' | 'quarter' | 'month' = 'year',
  referenceDate?: Date
): number | null => {
  const reference = referenceKey(referenceDate);
  const lastYear = yearOf(reference) - 1;
  const month = monthOf(reference);
  const quarter = quarterOf(reference);

  return sumWhere(dataset, valueColumn, dateColumn, key => {
    if (yearOf(key) !== lastYear) return false;
    if (periodType === 'quarter') return quarterOf(key) === quarter;
    if (periodType === 'month') return monthOf(key) === month;
    return true;
  });
};

/** Year-over-year change between the reference year and the one before it. */
export const calculateYoYChange = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string,
  referenceDate?: Date
): { absolute: number; percentage: number; currentYear: number; previousYear: number } | null => {
  const reference = referenceKey(referenceDate);
  const year = yearOf(reference);

  const current = sumWhere(dataset, valueColumn, dateColumn, key => yearOf(key) === year);
  const previous = sumWhere(dataset, valueColumn, dateColumn, key => yearOf(key) === year - 1);
  if (current === null || previous === null) return null;

  return {
    ...changeBetween(current, previous),
    currentYear: round2(current),
    previousYear: round2(previous),
  };
};

/**
 * Compare the last two periods that actually carry data.
 *
 * Deliberately NOT the last two calendar periods: a gap would otherwise
 * compare against an empty period and report a 100% collapse.
 */
const changeOverLastTwoPeriods = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string,
  periodKey: (key: string) => string
): { absolute: number; percentage: number } | null => {
  const read = dateKeysFor(dataset, dateColumn);
  if (!read) return null;

  const periods = new Map<string, number>();
  read.keys.forEach((key, index) => {
    if (key === null) return;
    const value = numberAt(dataset, index, valueColumn);
    if (value === null) return;
    const period = periodKey(key);
    periods.set(period, (periods.get(period) ?? 0) + value);
  });

  const sorted = [...periods.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  if (sorted.length < 2) return { absolute: 0, percentage: 0 };

  return changeBetween(sorted[sorted.length - 1][1], sorted[sorted.length - 2][1]);
};

/** Quarter-over-quarter change across the last two quarters holding data. */
export const calculateQoQChange = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string
): { absolute: number; percentage: number } | null =>
  changeOverLastTwoPeriods(
    dataset,
    valueColumn,
    dateColumn,
    key => `${yearOf(key)}-Q${quarterOf(key)}`
  );

/** Month-over-month change across the last two months holding data. */
export const calculateMoMChange = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string
): { absolute: number; percentage: number } | null =>
  changeOverLastTwoPeriods(dataset, valueColumn, dateColumn, key => key.slice(0, 7));

/**
 * Cumulative sum, in date order when a date column is given.
 *
 * Sorting on the canonical keys means it sorts lexically, which for
 * yyyy-mm-dd is chronological. Rows whose date cannot be read sort last
 * rather than being dropped, so the totals still add up to the full sum.
 */
export const calculateRunningTotal = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn?: string
): number[] => {
  let order = dataset.data.map((_, index) => index);

  if (dateColumn) {
    const read = dateKeysFor(dataset, dateColumn);
    if (read) {
      order = order.sort((left, right) => {
        const a = read.keys[left];
        const b = read.keys[right];
        if (a === null && b === null) return left - right;
        if (a === null) return 1;
        if (b === null) return -1;
        return a === b ? left - right : a.localeCompare(b);
      });
    }
  }

  const result: number[] = [];
  let cumulative = 0;
  for (const index of order) {
    const value = numberAt(dataset, index, valueColumn);
    if (value !== null) cumulative += value;
    result.push(round2(cumulative));
  }
  return result;
};

// ============================================================
// CALCULATE: Context-Filtered Calculations
// ============================================================

/**
 * CALCULATE: Execute a formula with filter context (Power BI CALCULATE equivalent)
 */
export const calculateWithContext = (
  dataset: Dataset,
  formula: KPIFormula,
  column: string,
  filters: DAXFilterContext[]
): number => {
  // Apply all filters to create a filtered dataset
  let filteredData = [...dataset.data];

  for (const filter of filters) {
    filteredData = filteredData.filter(row => {
      const cellValue = row[filter.column];

      switch (filter.operator) {
        case '=': return String(cellValue).toLowerCase() === String(filter.value).toLowerCase();
        case '!=': return String(cellValue).toLowerCase() !== String(filter.value).toLowerCase();
        case '>': return Number(cellValue) > Number(filter.value);
        case '<': return Number(cellValue) < Number(filter.value);
        case '>=': return Number(cellValue) >= Number(filter.value);
        case '<=': return Number(cellValue) <= Number(filter.value);
        case 'IN': return Array.isArray(filter.value) && filter.value.includes(String(cellValue));
        case 'NOT IN': return Array.isArray(filter.value) && !filter.value.includes(String(cellValue));
        default: return true;
      }
    });
  }

  // Create a temporary filtered dataset
  const filteredDataset: Dataset = {
    ...dataset,
    data: filteredData,
    rowCount: filteredData.length
  };

  return executeKPIFormula(filteredDataset, formula, column);
};

// ============================================================
// Conditional Functions
// ============================================================

/**
 * IF: Row-by-row conditional evaluation
 */
export const calculateIF = (
  dataset: Dataset,
  conditionColumn: string,
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=',
  threshold: any,
  trueValue: any,
  falseValue: any
): any[] => {
  return dataset.data.map(row => {
    const cellValue = row[conditionColumn];
    let condition = false;

    switch (operator) {
      case '=': condition = String(cellValue) === String(threshold); break;
      case '!=': condition = String(cellValue) !== String(threshold); break;
      case '>': condition = Number(cellValue) > Number(threshold); break;
      case '<': condition = Number(cellValue) < Number(threshold); break;
      case '>=': condition = Number(cellValue) >= Number(threshold); break;
      case '<=': condition = Number(cellValue) <= Number(threshold); break;
    }

    return condition ? trueValue : falseValue;
  });
};

/**
 * SWITCH: Multi-condition evaluation
 */
export const calculateSWITCH = (
  dataset: Dataset,
  column: string,
  cases: { value: any; result: any }[],
  defaultResult: any
): any[] => {
  return dataset.data.map(row => {
    const cellValue = String(row[column]);
    const matchedCase = cases.find(c => String(c.value) === cellValue);
    return matchedCase ? matchedCase.result : defaultResult;
  });
};

// ============================================================
// Cross-Table Functions
// ============================================================

/**
 * RELATED: Lookup values from a related table via relationship
 */
export const calculateRELATED = (
  sourceDataset: Dataset,
  relatedDataset: Dataset,
  sourceColumn: string,
  relatedKeyColumn: string,
  relatedValueColumn: string
): any[] => {
  // Build lookup map from related dataset
  const lookupMap = new Map<string, any>();
  for (const row of relatedDataset.data) {
    const key = String(row[relatedKeyColumn]).toLowerCase();
    if (!lookupMap.has(key)) {
      lookupMap.set(key, row[relatedValueColumn]);
    }
  }

  // Map source dataset
  return sourceDataset.data.map(row => {
    const key = String(row[sourceColumn]).toLowerCase();
    return lookupMap.get(key) ?? null;
  });
};

/**
 * LOOKUPVALUE: Explicit lookup without pre-defined relationship
 */
export const calculateLOOKUPVALUE = (
  resultDataset: Dataset,
  resultColumn: string,
  searchColumn: string,
  searchValue: any
): any => {
  const row = resultDataset.data.find(
    r => String(r[searchColumn]).toLowerCase() === String(searchValue).toLowerCase()
  );
  return row ? row[resultColumn] : null;
};

// ============================================================
// Ranking
// ============================================================

/**
 * RANKX: Rank values in a column
 */
export const calculateRANKX = (
  dataset: Dataset,
  column: string,
  order: 'ASC' | 'DESC' = 'DESC'
): number[] => {
  const indexed = dataset.data.map((row, i) => ({
    index: i,
    value: Number(row[column]) || 0
  }));

  // Sort by value
  const sorted = [...indexed].sort((a, b) =>
    order === 'DESC' ? b.value - a.value : a.value - b.value
  );

  // Assign ranks with tie handling
  const ranks = new Array(dataset.data.length);
  let currentRank = 1;

  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].value !== sorted[i - 1].value) {
      currentRank = i + 1;
    }
    ranks[sorted[i].index] = currentRank;
  }

  return ranks;
};

// ============================================================
// Enhanced KPI Generation (with Time Intelligence)
// ============================================================

/**
 * Deleted: generateEnhancedKPIs.
 *
 * It produced "YTD <column>" and "YoY Change" tiles whose `formula` was a
 * plain 'SUM' and 'PERCENTAGE', with a comment saying they would be
 * "overridden by enhanced execution". No such execution existed, so a tile
 * labelled year-to-date would have shown the all-time total. Nothing called
 * it, so nobody ever saw that - but it was a trap for whoever wired it up.
 *
 * Time-intelligence tiles belong on the DAX engine in src/lib/dax, where
 * TOTALYTD and SAMEPERIODLASTYEAR are implemented and tested, rather than on
 * a second implementation here.
 */

