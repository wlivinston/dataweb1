// Anomaly Fix Utilities - Actionable fixes for detected anomalies
import { Dataset } from './types';
import { AnomalyResult } from './aiInsightEngine';

export type AnomalyFixAction = 'removeRow' | 'capToBounds' | 'replaceWithMean' | 'replaceWithMedian';

export interface AnomalyFixResult {
  dataset: Dataset;
  fixedCount: number;
  action: AnomalyFixAction;
  description: string;
}

// --- Helpers ---

const computeColumnMean = (data: Record<string, any>[], columnName: string): number => {
  const values = data.map(r => Number(r[columnName])).filter(v => !isNaN(v));
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
};

const computeColumnMedian = (data: Record<string, any>[], columnName: string): number => {
  const values = data.map(r => Number(r[columnName])).filter(v => !isNaN(v)).sort((a, b) => a - b);
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[mid - 1] + values[mid]) / 2
    : values[mid];
};

const updateColumnStats = (dataset: Dataset, affectedColumns: string[]): Dataset => {
  const updatedColumns = dataset.columns.map(col => {
    if (!affectedColumns.includes(col.name) || col.type !== 'number') return col;
    const values = dataset.data.map(r => Number(r[col.name])).filter(v => !isNaN(v));
    if (values.length === 0) return col;
    return {
      ...col,
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((a, b) => a + b, 0) / values.length
    };
  });
  return { ...dataset, columns: updatedColumns };
};

const actionLabel = (action: AnomalyFixAction): string => {
  switch (action) {
    case 'removeRow': return 'Removed rows';
    case 'capToBounds': return 'Capped to bounds';
    case 'replaceWithMean': return 'Replaced with mean';
    case 'replaceWithMedian': return 'Replaced with median';
  }
};

// --- Single Anomaly Fix ---

export const fixSingleAnomaly = (
  dataset: Dataset,
  anomaly: AnomalyResult,
  action: AnomalyFixAction
): AnomalyFixResult => {
  const { column, rowIndex, expectedRange } = anomaly;

  switch (action) {
    case 'removeRow': {
      const newData = dataset.data.filter((_, idx) => idx !== rowIndex);
      const result: Dataset = {
        ...dataset,
        data: newData,
        rowCount: newData.length,
        updatedAt: new Date()
      };
      return {
        dataset: updateColumnStats(result, [column]),
        fixedCount: 1,
        action,
        description: `Removed row ${rowIndex + 1} (${column}: ${anomaly.value})`
      };
    }

    case 'capToBounds': {
      const val = Number(anomaly.value);
      const cappedValue = val < expectedRange.min ? expectedRange.min : expectedRange.max;
      const newData = dataset.data.map((row, idx) =>
        idx === rowIndex ? { ...row, [column]: cappedValue } : row
      );
      const result: Dataset = { ...dataset, data: newData, updatedAt: new Date() };
      return {
        dataset: updateColumnStats(result, [column]),
        fixedCount: 1,
        action,
        description: `Capped ${column} row ${rowIndex + 1}: ${anomaly.value} → ${cappedValue.toFixed(2)}`
      };
    }

    case 'replaceWithMean': {
      const mean = computeColumnMean(dataset.data, column);
      const newData = dataset.data.map((row, idx) =>
        idx === rowIndex ? { ...row, [column]: Math.round(mean * 100) / 100 } : row
      );
      const result: Dataset = { ...dataset, data: newData, updatedAt: new Date() };
      return {
        dataset: updateColumnStats(result, [column]),
        fixedCount: 1,
        action,
        description: `Replaced ${column} row ${rowIndex + 1}: ${anomaly.value} → ${mean.toFixed(2)} (mean)`
      };
    }

    case 'replaceWithMedian': {
      const median = computeColumnMedian(dataset.data, column);
      const newData = dataset.data.map((row, idx) =>
        idx === rowIndex ? { ...row, [column]: Math.round(median * 100) / 100 } : row
      );
      const result: Dataset = { ...dataset, data: newData, updatedAt: new Date() };
      return {
        dataset: updateColumnStats(result, [column]),
        fixedCount: 1,
        action,
        description: `Replaced ${column} row ${rowIndex + 1}: ${anomaly.value} → ${median.toFixed(2)} (median)`
      };
    }
  }
};

// --- Column-level Bulk Fix ---

export const fixAnomaliesInColumn = (
  dataset: Dataset,
  anomalies: AnomalyResult[],
  action: AnomalyFixAction
): AnomalyFixResult => {
  if (anomalies.length === 0) {
    return { dataset, fixedCount: 0, action, description: 'No anomalies to fix' };
  }

  const column = anomalies[0].column;
  const rowIndices = new Set(anomalies.map(a => a.rowIndex));

  switch (action) {
    case 'removeRow': {
      const newData = dataset.data.filter((_, idx) => !rowIndices.has(idx));
      const result: Dataset = {
        ...dataset,
        data: newData,
        rowCount: newData.length,
        updatedAt: new Date()
      };
      return {
        dataset: updateColumnStats(result, [column]),
        fixedCount: rowIndices.size,
        action,
        description: `Removed ${rowIndices.size} rows with anomalies in ${column}`
      };
    }

    case 'capToBounds': {
      const newData = dataset.data.map((row, idx) => {
        if (!rowIndices.has(idx)) return row;
        const anomaly = anomalies.find(a => a.rowIndex === idx);
        if (!anomaly) return row;
        const val = Number(row[column]);
        if (isNaN(val)) return row;
        const capped = val < anomaly.expectedRange.min
          ? anomaly.expectedRange.min
          : val > anomaly.expectedRange.max
            ? anomaly.expectedRange.max
            : val;
        return { ...row, [column]: capped };
      });
      const result: Dataset = { ...dataset, data: newData, updatedAt: new Date() };
      return {
        dataset: updateColumnStats(result, [column]),
        fixedCount: rowIndices.size,
        action,
        description: `Capped ${rowIndices.size} anomalies in ${column} to expected bounds`
      };
    }

    case 'replaceWithMean': {
      const mean = computeColumnMean(dataset.data, column);
      const rounded = Math.round(mean * 100) / 100;
      const newData = dataset.data.map((row, idx) =>
        rowIndices.has(idx) ? { ...row, [column]: rounded } : row
      );
      const result: Dataset = { ...dataset, data: newData, updatedAt: new Date() };
      return {
        dataset: updateColumnStats(result, [column]),
        fixedCount: rowIndices.size,
        action,
        description: `Replaced ${rowIndices.size} anomalies in ${column} with mean (${mean.toFixed(2)})`
      };
    }

    case 'replaceWithMedian': {
      const median = computeColumnMedian(dataset.data, column);
      const rounded = Math.round(median * 100) / 100;
      const newData = dataset.data.map((row, idx) =>
        rowIndices.has(idx) ? { ...row, [column]: rounded } : row
      );
      const result: Dataset = { ...dataset, data: newData, updatedAt: new Date() };
      return {
        dataset: updateColumnStats(result, [column]),
        fixedCount: rowIndices.size,
        action,
        description: `Replaced ${rowIndices.size} anomalies in ${column} with median (${median.toFixed(2)})`
      };
    }
  }
};

// --- Global Fix All ---

export const fixAllAnomalies = (
  dataset: Dataset,
  anomalies: AnomalyResult[],
  action: AnomalyFixAction
): AnomalyFixResult => {
  if (anomalies.length === 0) {
    return { dataset, fixedCount: 0, action, description: 'No anomalies to fix' };
  }

  // Group anomalies by column
  const byColumn: Record<string, AnomalyResult[]> = {};
  for (const a of anomalies) {
    if (!byColumn[a.column]) byColumn[a.column] = [];
    byColumn[a.column].push(a);
  }

  const columnNames = Object.keys(byColumn);

  if (action === 'removeRow') {
    // Deduplicate row indices across all columns (a row may have anomalies in multiple columns)
    const allRowIndices = new Set(anomalies.map(a => a.rowIndex));
    const newData = dataset.data.filter((_, idx) => !allRowIndices.has(idx));
    const result: Dataset = {
      ...dataset,
      data: newData,
      rowCount: newData.length,
      updatedAt: new Date()
    };
    return {
      dataset: updateColumnStats(result, columnNames),
      fixedCount: allRowIndices.size,
      action,
      description: `Removed ${allRowIndices.size} rows with anomalies across ${columnNames.length} column${columnNames.length > 1 ? 's' : ''}`
    };
  }

  // For non-removal actions: apply per-column replacements on a single cloned dataset
  let newData = dataset.data.map(row => ({ ...row }));
  let totalFixed = 0;

  for (const [col, colAnomalies] of Object.entries(byColumn)) {
    const rowIndices = new Set(colAnomalies.map(a => a.rowIndex));

    if (action === 'capToBounds') {
      for (const anomaly of colAnomalies) {
        const idx = anomaly.rowIndex;
        if (idx >= 0 && idx < newData.length) {
          const val = Number(newData[idx][col]);
          if (!isNaN(val)) {
            newData[idx][col] = val < anomaly.expectedRange.min
              ? anomaly.expectedRange.min
              : val > anomaly.expectedRange.max
                ? anomaly.expectedRange.max
                : val;
          }
        }
      }
      totalFixed += rowIndices.size;
    } else if (action === 'replaceWithMean') {
      // Compute mean from original data (before modifications to this column)
      const mean = computeColumnMean(dataset.data, col);
      const rounded = Math.round(mean * 100) / 100;
      for (const idx of rowIndices) {
        if (idx >= 0 && idx < newData.length) {
          newData[idx][col] = rounded;
        }
      }
      totalFixed += rowIndices.size;
    } else if (action === 'replaceWithMedian') {
      const median = computeColumnMedian(dataset.data, col);
      const rounded = Math.round(median * 100) / 100;
      for (const idx of rowIndices) {
        if (idx >= 0 && idx < newData.length) {
          newData[idx][col] = rounded;
        }
      }
      totalFixed += rowIndices.size;
    }
  }

  const result: Dataset = { ...dataset, data: newData, updatedAt: new Date() };
  return {
    dataset: updateColumnStats(result, columnNames),
    fixedCount: totalFixed,
    action,
    description: `${actionLabel(action)}: ${totalFixed} anomalies across ${columnNames.length} column${columnNames.length > 1 ? 's' : ''}`
  };
};

// --- Description helpers for confirmation dialog ---

export const getFixDescription = (
  action: AnomalyFixAction,
  scope: 'single' | 'column' | 'all',
  anomaly?: AnomalyResult,
  anomalies?: AnomalyResult[],
  columnName?: string,
  dataset?: Dataset
): string => {
  const count = anomalies?.length || 1;

  switch (action) {
    case 'removeRow':
      if (scope === 'single' && anomaly) {
        return `This will permanently remove row ${anomaly.rowIndex + 1} from the dataset. The value ${anomaly.value} in column "${anomaly.column}" is outside the expected range (${anomaly.expectedRange.min.toFixed(2)} - ${anomaly.expectedRange.max.toFixed(2)}).`;
      }
      if (scope === 'column') {
        const uniqueRows = new Set(anomalies?.map(a => a.rowIndex)).size;
        return `This will remove ${uniqueRows} row${uniqueRows > 1 ? 's' : ''} containing anomalies in column "${columnName}".`;
      }
      const allUniqueRows = new Set(anomalies?.map(a => a.rowIndex)).size;
      return `This will remove ${allUniqueRows} row${allUniqueRows > 1 ? 's' : ''} containing anomalies across all columns.`;

    case 'capToBounds':
      if (scope === 'single' && anomaly) {
        const cappedVal = Number(anomaly.value) < anomaly.expectedRange.min
          ? anomaly.expectedRange.min
          : anomaly.expectedRange.max;
        return `The value ${anomaly.value} in "${anomaly.column}" (row ${anomaly.rowIndex + 1}) will be changed to ${cappedVal.toFixed(2)} (nearest boundary).`;
      }
      return `${count} anomalous value${count > 1 ? 's' : ''} ${scope === 'column' ? `in "${columnName}"` : 'across all columns'} will be clamped to their expected range boundaries.`;

    case 'replaceWithMean':
      if (scope === 'single' && anomaly && dataset) {
        const mean = computeColumnMean(dataset.data, anomaly.column);
        return `The value ${anomaly.value} in "${anomaly.column}" (row ${anomaly.rowIndex + 1}) will be replaced with the column mean (${mean.toFixed(2)}).`;
      }
      return `${count} anomalous value${count > 1 ? 's' : ''} ${scope === 'column' ? `in "${columnName}"` : 'across all columns'} will be replaced with their respective column means.`;

    case 'replaceWithMedian':
      if (scope === 'single' && anomaly && dataset) {
        const median = computeColumnMedian(dataset.data, anomaly.column);
        return `The value ${anomaly.value} in "${anomaly.column}" (row ${anomaly.rowIndex + 1}) will be replaced with the column median (${median.toFixed(2)}).`;
      }
      return `${count} anomalous value${count > 1 ? 's' : ''} ${scope === 'column' ? `in "${columnName}"` : 'across all columns'} will be replaced with their respective column medians.`;
  }
};
