// Dynamic KPI Formula Engine - Power BI-like calculations
// Enhanced with Time Intelligence, CALCULATE, conditional, cross-table, and ranking functions
import React from 'react';
import { Dataset, ColumnInfo, Relationship, DAXFilterContext } from './types';

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
      const sumValues = dataset.data
        .map(row => Number(row[columnName]))
        .filter(v => !isNaN(v) && v !== null && v !== undefined);
      return sumValues.reduce((a, b) => a + b, 0);

    case 'AVERAGE':
      if (!columnName) return 0;
      const avgValues = dataset.data
        .map(row => Number(row[columnName]))
        .filter(v => !isNaN(v) && v !== null && v !== undefined);
      if (avgValues.length === 0) return 0;
      return avgValues.reduce((a, b) => a + b, 0) / avgValues.length;

    case 'MIN':
      if (!columnName) return 0;
      const minValues = dataset.data
        .map(row => Number(row[columnName]))
        .filter(v => !isNaN(v) && v !== null && v !== undefined);
      if (minValues.length === 0) return 0;
      return Math.min(...minValues);

    case 'MAX':
      if (!columnName) return 0;
      const maxValues = dataset.data
        .map(row => Number(row[columnName]))
        .filter(v => !isNaN(v) && v !== null && v !== undefined);
      if (maxValues.length === 0) return 0;
      return Math.max(...maxValues);

    case 'MEDIAN':
      if (!columnName) return 0;
      const medianValues = dataset.data
        .map(row => Number(row[columnName]))
        .filter(v => !isNaN(v) && v !== null && v !== undefined)
        .sort((a, b) => a - b);
      if (medianValues.length === 0) return 0;
      const mid = Math.floor(medianValues.length / 2);
      return medianValues.length % 2 === 0
        ? (medianValues[mid - 1] + medianValues[mid]) / 2
        : medianValues[mid];

    case 'STDDEV':
      if (!columnName) return 0;
      const stdValues = dataset.data
        .map(row => Number(row[columnName]))
        .filter(v => !isNaN(v) && v !== null && v !== undefined);
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
 * Helper: parse a date value
 */
const tryParseDate = (value: any): Date | null => {
  if (value == null || value === '') return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const d = new Date(String(value));
  return !isNaN(d.getTime()) ? d : null;
};

// ============================================================
// Time Intelligence Functions
// ============================================================

/**
 * TOTALYTD: Year-to-Date total for a value column
 */
export const calculateTotalYTD = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string,
  referenceDate?: Date
): number => {
  const refDate = referenceDate || new Date();
  const currentYear = refDate.getFullYear();

  let total = 0;
  for (const row of dataset.data) {
    const date = tryParseDate(row[dateColumn]);
    if (!date) continue;
    if (date.getFullYear() === currentYear && date <= refDate) {
      const val = Number(row[valueColumn]);
      if (!isNaN(val)) total += val;
    }
  }
  return total;
};

/**
 * TOTALQTD: Quarter-to-Date total
 */
export const calculateTotalQTD = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string,
  referenceDate?: Date
): number => {
  const refDate = referenceDate || new Date();
  const currentYear = refDate.getFullYear();
  const currentQuarter = Math.ceil((refDate.getMonth() + 1) / 3);
  const quarterStartMonth = (currentQuarter - 1) * 3; // 0-indexed

  let total = 0;
  for (const row of dataset.data) {
    const date = tryParseDate(row[dateColumn]);
    if (!date) continue;
    if (
      date.getFullYear() === currentYear &&
      date.getMonth() >= quarterStartMonth &&
      date <= refDate
    ) {
      const val = Number(row[valueColumn]);
      if (!isNaN(val)) total += val;
    }
  }
  return total;
};

/**
 * TOTALMTD: Month-to-Date total
 */
export const calculateTotalMTD = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string,
  referenceDate?: Date
): number => {
  const refDate = referenceDate || new Date();
  const currentYear = refDate.getFullYear();
  const currentMonth = refDate.getMonth();

  let total = 0;
  for (const row of dataset.data) {
    const date = tryParseDate(row[dateColumn]);
    if (!date) continue;
    if (
      date.getFullYear() === currentYear &&
      date.getMonth() === currentMonth &&
      date <= refDate
    ) {
      const val = Number(row[valueColumn]);
      if (!isNaN(val)) total += val;
    }
  }
  return total;
};

/**
 * SAMEPERIODLASTYEAR: Calculate the same metric for the equivalent period last year
 */
export const calculateSamePeriodLastYear = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string,
  periodType: 'year' | 'quarter' | 'month' = 'year'
): number => {
  const now = new Date();
  const lastYear = now.getFullYear() - 1;
  const currentMonth = now.getMonth();
  const currentQuarter = Math.ceil((currentMonth + 1) / 3);

  let total = 0;
  for (const row of dataset.data) {
    const date = tryParseDate(row[dateColumn]);
    if (!date || date.getFullYear() !== lastYear) continue;

    let inPeriod = false;
    switch (periodType) {
      case 'year':
        inPeriod = true;
        break;
      case 'quarter':
        inPeriod = Math.ceil((date.getMonth() + 1) / 3) === currentQuarter;
        break;
      case 'month':
        inPeriod = date.getMonth() === currentMonth;
        break;
    }

    if (inPeriod) {
      const val = Number(row[valueColumn]);
      if (!isNaN(val)) total += val;
    }
  }
  return total;
};

/**
 * YoY Change: Year-over-Year absolute and percentage change
 */
export const calculateYoYChange = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string
): { absolute: number; percentage: number; currentYear: number; previousYear: number } => {
  const now = new Date();
  const currentYear = now.getFullYear();

  let currentTotal = 0;
  let previousTotal = 0;

  for (const row of dataset.data) {
    const date = tryParseDate(row[dateColumn]);
    if (!date) continue;
    const val = Number(row[valueColumn]);
    if (isNaN(val)) continue;

    if (date.getFullYear() === currentYear) currentTotal += val;
    else if (date.getFullYear() === currentYear - 1) previousTotal += val;
  }

  const absolute = currentTotal - previousTotal;
  const percentage = previousTotal !== 0 ? (absolute / Math.abs(previousTotal)) * 100 : 0;

  return {
    absolute: Math.round(absolute * 100) / 100,
    percentage: Math.round(percentage * 100) / 100,
    currentYear: Math.round(currentTotal * 100) / 100,
    previousYear: Math.round(previousTotal * 100) / 100
  };
};

/**
 * QoQ Change: Quarter-over-Quarter change
 */
export const calculateQoQChange = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string
): { absolute: number; percentage: number } => {
  const periods: Record<string, number> = {};

  for (const row of dataset.data) {
    const date = tryParseDate(row[dateColumn]);
    if (!date) continue;
    const val = Number(row[valueColumn]);
    if (isNaN(val)) continue;

    const key = `${date.getFullYear()}-Q${Math.ceil((date.getMonth() + 1) / 3)}`;
    periods[key] = (periods[key] || 0) + val;
  }

  const sortedPeriods = Object.entries(periods).sort((a, b) => a[0].localeCompare(b[0]));
  if (sortedPeriods.length < 2) return { absolute: 0, percentage: 0 };

  const current = sortedPeriods[sortedPeriods.length - 1][1];
  const previous = sortedPeriods[sortedPeriods.length - 2][1];
  const absolute = current - previous;
  const percentage = previous !== 0 ? (absolute / Math.abs(previous)) * 100 : 0;

  return { absolute: Math.round(absolute * 100) / 100, percentage: Math.round(percentage * 100) / 100 };
};

/**
 * MoM Change: Month-over-Month change
 */
export const calculateMoMChange = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn: string
): { absolute: number; percentage: number } => {
  const periods: Record<string, number> = {};

  for (const row of dataset.data) {
    const date = tryParseDate(row[dateColumn]);
    if (!date) continue;
    const val = Number(row[valueColumn]);
    if (isNaN(val)) continue;

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    periods[key] = (periods[key] || 0) + val;
  }

  const sortedPeriods = Object.entries(periods).sort((a, b) => a[0].localeCompare(b[0]));
  if (sortedPeriods.length < 2) return { absolute: 0, percentage: 0 };

  const current = sortedPeriods[sortedPeriods.length - 1][1];
  const previous = sortedPeriods[sortedPeriods.length - 2][1];
  const absolute = current - previous;
  const percentage = previous !== 0 ? (absolute / Math.abs(previous)) * 100 : 0;

  return { absolute: Math.round(absolute * 100) / 100, percentage: Math.round(percentage * 100) / 100 };
};

/**
 * Running Total / Cumulative Sum
 */
export const calculateRunningTotal = (
  dataset: Dataset,
  valueColumn: string,
  dateColumn?: string
): number[] => {
  let data = [...dataset.data];

  // Sort by date if date column provided
  if (dateColumn) {
    data = data.sort((a, b) => {
      const da = tryParseDate(a[dateColumn]);
      const db = tryParseDate(b[dateColumn]);
      if (!da || !db) return 0;
      return da.getTime() - db.getTime();
    });
  }

  const result: number[] = [];
  let cumulative = 0;

  for (const row of data) {
    const val = Number(row[valueColumn]);
    if (!isNaN(val)) {
      cumulative += val;
    }
    result.push(Math.round(cumulative * 100) / 100);
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
 * Generate enhanced KPIs including time intelligence when date columns are present
 */
export const generateEnhancedKPIs = (dataset: Dataset | null): KPIDefinition[] => {
  // Start with base KPIs
  const baseKPIs = generateKPIs(dataset);
  if (!dataset) return baseKPIs;

  const dateColumns = dataset.columns.filter(col => col.type === 'date');
  const numericColumns = dataset.columns.filter(col => col.type === 'number');

  if (dateColumns.length === 0 || numericColumns.length === 0) {
    return baseKPIs;
  }

  const dateCol = dateColumns[0];
  const primaryNumCol = numericColumns[0];
  const cleanName = primaryNumCol.name.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());

  // Add time intelligence KPIs
  const timeKPIs: KPIDefinition[] = [];

  // YTD
  timeKPIs.push({
    id: `kpi-ytd-${primaryNumCol.name}`,
    title: `YTD ${cleanName}`,
    formula: 'SUM', // Will be overridden by enhanced execution
    columnName: primaryNumCol.name,
    columnName2: dateCol.name,
    format: 'number',
    icon: 'calendar',
    color: 'text-indigo-500',
    description: `Year-to-date total of ${cleanName}`
  });

  // YoY Change
  timeKPIs.push({
    id: `kpi-yoy-${primaryNumCol.name}`,
    title: `YoY Change`,
    formula: 'PERCENTAGE',
    columnName: primaryNumCol.name,
    columnName2: dateCol.name,
    format: 'percentage',
    icon: 'trending-up',
    color: 'text-emerald-500',
    description: `Year-over-year change in ${cleanName}`
  });

  // Combine: show up to 8 KPIs (6 base + 2 time intelligence)
  return [...baseKPIs.slice(0, 6), ...timeKPIs.slice(0, 2)];
};
