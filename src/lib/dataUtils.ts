// Shared data utilities for parsing, analyzing, and manipulating data
import { ColumnInfo, DataType, Dataset } from './types';

/**
 * Detect data type from a value
 */
export const detectDataType = (value: any): DataType => {
  if (value === null || value === undefined || value === '') return 'string';
  
  // Check for boolean
  if (typeof value === 'boolean') return 'boolean';
  if (['true', 'false', 'yes', 'no', '1', '0'].includes(String(value).toLowerCase())) {
    return 'boolean';
  }
  
  // Check for number
  if (typeof value === 'number') return 'number';
  if (!isNaN(Number(value)) && value !== '') return 'number';
  
  // Check for date
  const dateValue = new Date(value);
  if (!isNaN(dateValue.getTime()) && String(value).match(/^\d{4}-\d{2}-\d{2}/)) {
    return 'date';
  }
  
  return 'string';
};

/**
 * Analyze a column from dataset values
 */
export const analyzeColumn = (columnName: string, values: any[]): ColumnInfo => {
  const nonNullValues = values.filter(v => v !== null && v !== undefined && v !== '');
  const dataType = detectDataTypeFromValues(values);
  
  const columnInfo: ColumnInfo = {
    name: columnName,
    type: dataType,
    sampleValues: nonNullValues.slice(0, 5),
    nullCount: values.length - nonNullValues.length,
    uniqueCount: new Set(nonNullValues.map(v => String(v))).size
  };

  // Add statistical info for numeric columns
  if (dataType === 'number') {
    const numericValues = nonNullValues.map(v => Number(v)).filter(v => !isNaN(v));
    if (numericValues.length > 0) {
      columnInfo.min = numericValues.reduce((min, val) => val < min ? val : min, numericValues[0]);
      columnInfo.max = numericValues.reduce((max, val) => val > max ? val : max, numericValues[0]);
      columnInfo.mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
    }
  }

  return columnInfo;
};

/**
 * Detect data type from an array of values
 */
export const detectDataTypeFromValues = (values: any[]): DataType => {
  const nonNullValues = values.filter(v => v !== null && v !== undefined && v !== '');
  if (nonNullValues.length === 0) return 'string';
  
  // Check for numbers
  const numericValues = nonNullValues.filter(v => !isNaN(Number(v)) && v !== '');
  if (numericValues.length / nonNullValues.length > 0.8) return 'number';
  
  // Check for dates
  const dateValues = nonNullValues.filter(v => {
    const date = new Date(v);
    return !isNaN(date.getTime());
  });
  if (dateValues.length / nonNullValues.length > 0.8) return 'date';
  
  // Check for booleans
  const booleanValues = nonNullValues.filter(v => 
    ['true', 'false', 'yes', 'no', '1', '0'].includes(String(v).toLowerCase())
  );
  if (booleanValues.length / nonNullValues.length > 0.8) return 'boolean';
  
  return 'string';
};

/**
 * Validate a value against column constraints
 */
export const validateValue = (value: any, column: ColumnInfo): { valid: boolean; error?: string } => {
  if (column.isRequired && (value === null || value === undefined || value === '')) {
    return { valid: false, error: `${column.name} is required` };
  }

  if (value === null || value === undefined || value === '') {
    return { valid: true }; // Allow null/empty if not required
  }

  // Type validation
  if (column.type === 'number') {
    const numValue = Number(value);
    if (isNaN(numValue)) {
      return { valid: false, error: `${column.name} must be a number` };
    }
    if (column.validation?.min !== undefined && numValue < column.validation.min) {
      return { valid: false, error: `${column.name} must be at least ${column.validation.min}` };
    }
    if (column.validation?.max !== undefined && numValue > column.validation.max) {
      return { valid: false, error: `${column.name} must be at most ${column.validation.max}` };
    }
  }

  if (column.type === 'date') {
    const dateValue = new Date(value);
    if (isNaN(dateValue.getTime())) {
      return { valid: false, error: `${column.name} must be a valid date` };
    }
  }

  if (column.type === 'boolean') {
    const boolValue = String(value).toLowerCase();
    if (!['true', 'false', 'yes', 'no', '1', '0'].includes(boolValue)) {
      return { valid: false, error: `${column.name} must be a boolean value` };
    }
  }

  // Pattern validation
  if (column.validation?.pattern) {
    const regex = new RegExp(column.validation.pattern);
    if (!regex.test(String(value))) {
      return { valid: false, error: `${column.name} does not match the required pattern` };
    }
  }

  // Custom validation
  if (column.validation?.custom) {
    if (!column.validation.custom(value)) {
      return { valid: false, error: `${column.name} failed custom validation` };
    }
  }

  return { valid: true };
};

/**
 * Create a new empty observation with default values
 */
export const createEmptyObservation = (columns: ColumnInfo[]): any => {
  const observation: any = {};
  columns.forEach(col => {
    if (col.defaultValue !== undefined) {
      observation[col.name] = col.defaultValue;
    } else {
      switch (col.type) {
        case 'number':
          observation[col.name] = 0;
          break;
        case 'boolean':
          observation[col.name] = false;
          break;
        case 'date':
          observation[col.name] = new Date().toISOString().split('T')[0];
          break;
        default:
          observation[col.name] = '';
      }
    }
  });
  return observation;
};

/**
 * Update dataset statistics after data changes
 */
export const updateDatasetStats = (dataset: Dataset): Dataset => {
  const updatedColumns = dataset.columns.map(col => {
    const values = dataset.data.map(row => row[col.name]);
    return analyzeColumn(col.name, values);
  });

  return {
    ...dataset,
    columns: updatedColumns,
    rowCount: dataset.data.length,
    dataTypes: Object.fromEntries(updatedColumns.map(col => [col.name, col.type])),
    updatedAt: new Date()
  };
};

/**
 * Generate insights from dataset
 */
export const generateInsights = (dataset: Dataset): any[] => {
  const insights: any[] = [];

  // Check for missing data
  dataset.columns.forEach(col => {
    const nullPercentage = (col.nullCount / dataset.rowCount) * 100;
    if (nullPercentage > 20) {
      insights.push({
        type: 'anomaly',
        title: `High Missing Data in ${col.name}`,
        description: `${nullPercentage.toFixed(1)}% of values are missing in ${col.name}`,
        severity: nullPercentage > 50 ? 'high' : 'medium',
        column: col.name
      });
    }
  });

  // Check for correlations (simple version)
  const numericColumns = dataset.columns.filter(col => col.type === 'number');
  if (numericColumns.length >= 2) {
    insights.push({
      type: 'recommendation',
      title: 'Multiple Numeric Columns Detected',
      description: `Consider creating scatter plots to explore relationships between ${numericColumns.length} numeric columns`,
      columns: numericColumns.map(col => col.name)
    });
  }

  return insights;
};


