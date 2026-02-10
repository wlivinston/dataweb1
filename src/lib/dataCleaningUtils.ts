// Data Cleaning Utilities
import { Dataset, ColumnInfo } from './types';

export type CleaningOperation =
  | 'removeDuplicates'
  | 'removeMissingRows'
  | 'fillMissingWithDefault'
  | 'fillMissingWithMean'
  | 'fillMissingWithMedian'
  | 'trimWhitespace'
  | 'removeOutliers'
  | 'capOutliersToBounds'
  | 'standardizeText'
  | 'convertToLowerCase'
  | 'convertToUpperCase'
  | 'removeSpecialCharacters'
  | 'removeEmptyRows'
  | 'removeEmptyColumns';

export interface CleaningResult {
  dataset: Dataset;
  operationsPerformed: string[];
  rowsRemoved: number;
  rowsAdded: number;
  statistics: {
    before: {
      rowCount: number;
      nullCount: number;
      duplicateCount: number;
    };
    after: {
      rowCount: number;
      nullCount: number;
      duplicateCount: number;
    };
  };
}

/**
 * Remove duplicate rows from dataset
 */
export const removeDuplicates = (dataset: Dataset): CleaningResult => {
  const originalRowCount = dataset.rowCount;
  const seen = new Set<string>();
  const cleanedData: any[] = [];
  let duplicateCount = 0;

  dataset.data.forEach(row => {
    const key = JSON.stringify(row);
    if (!seen.has(key)) {
      seen.add(key);
      cleanedData.push(row);
    } else {
      duplicateCount++;
    }
  });

  return {
    dataset: {
      ...dataset,
      data: cleanedData,
      rowCount: cleanedData.length,
      updatedAt: new Date()
    },
    operationsPerformed: ['Remove Duplicates'],
    rowsRemoved: duplicateCount,
    rowsAdded: 0,
    statistics: {
      before: {
        rowCount: originalRowCount,
        nullCount: dataset.columns.reduce((sum, col) => sum + col.nullCount, 0),
        duplicateCount
      },
      after: {
        rowCount: cleanedData.length,
        nullCount: dataset.columns.reduce((sum, col) => sum + col.nullCount, 0),
        duplicateCount: 0
      }
    }
  };
};

/**
 * Remove rows with missing values
 */
export const removeMissingRows = (dataset: Dataset, columns?: string[]): CleaningResult => {
  const originalRowCount = dataset.rowCount;
  const targetColumns = columns || dataset.columns.map(col => col.name);
  
  const cleanedData = dataset.data.filter(row => {
    return targetColumns.every(col => {
      const value = row[col];
      return value !== null && value !== undefined && value !== '';
    });
  });

  const rowsRemoved = originalRowCount - cleanedData.length;

  // Recalculate null counts
  const updatedColumns = dataset.columns.map(col => {
    const nonNullValues = cleanedData.filter(row => {
      const val = row[col.name];
      return val !== null && val !== undefined && val !== '';
    });
    return {
      ...col,
      nullCount: cleanedData.length - nonNullValues.length,
      uniqueCount: new Set(nonNullValues.map(v => String(v))).size
    };
  });

  return {
    dataset: {
      ...dataset,
      data: cleanedData,
      rowCount: cleanedData.length,
      columns: updatedColumns,
      updatedAt: new Date()
    },
    operationsPerformed: [`Remove Missing Rows${columns ? ` (${columns.join(', ')})` : ''}`],
    rowsRemoved,
    rowsAdded: 0,
    statistics: {
      before: {
        rowCount: originalRowCount,
        nullCount: dataset.columns.reduce((sum, col) => sum + col.nullCount, 0),
        duplicateCount: 0
      },
      after: {
        rowCount: cleanedData.length,
        nullCount: updatedColumns.reduce((sum, col) => sum + col.nullCount, 0),
        duplicateCount: 0
      }
    }
  };
};

/**
 * Fill missing values with default
 */
export const fillMissingWithDefault = (
  dataset: Dataset, 
  columnName: string, 
  defaultValue: any
): CleaningResult => {
  const column = dataset.columns.find(col => col.name === columnName);
  if (!column) {
    throw new Error(`Column ${columnName} not found`);
  }

  const originalNullCount = column.nullCount;
  const cleanedData = dataset.data.map(row => {
    const value = row[columnName];
    if (value === null || value === undefined || value === '') {
      return { ...row, [columnName]: defaultValue };
    }
    return row;
  });

  // Update column info
  const updatedColumns = dataset.columns.map(col => {
    if (col.name === columnName) {
      const nonNullValues = cleanedData.filter(row => {
        const val = row[col.name];
        return val !== null && val !== undefined && val !== '';
      });
      return {
        ...col,
        nullCount: cleanedData.length - nonNullValues.length,
        sampleValues: nonNullValues.slice(0, 5).map(row => row[col.name])
      };
    }
    return col;
  });

  return {
    dataset: {
      ...dataset,
      data: cleanedData,
      columns: updatedColumns,
      updatedAt: new Date()
    },
    operationsPerformed: [`Fill Missing Values: ${columnName} = ${defaultValue}`],
    rowsRemoved: 0,
    rowsAdded: 0,
    statistics: {
      before: {
        rowCount: dataset.rowCount,
        nullCount: originalNullCount,
        duplicateCount: 0
      },
      after: {
        rowCount: dataset.rowCount,
        nullCount: updatedColumns.find(col => col.name === columnName)?.nullCount || 0,
        duplicateCount: 0
      }
    }
  };
};

/**
 * Fill missing numeric values with mean
 */
export const fillMissingWithMean = (dataset: Dataset, columnName: string): CleaningResult => {
  const column = dataset.columns.find(col => col.name === columnName);
  if (!column || column.type !== 'number') {
    throw new Error(`Column ${columnName} not found or is not numeric`);
  }

  const numericValues = dataset.data
    .map(row => Number(row[columnName]))
    .filter(val => !isNaN(val) && val !== null && val !== undefined);
  
  const mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;

  return fillMissingWithDefault(dataset, columnName, mean);
};

/**
 * Fill missing numeric values with median
 */
export const fillMissingWithMedian = (dataset: Dataset, columnName: string): CleaningResult => {
  const column = dataset.columns.find(col => col.name === columnName);
  if (!column || column.type !== 'number') {
    throw new Error(`Column ${columnName} not found or is not numeric`);
  }

  const numericValues = dataset.data
    .map(row => Number(row[columnName]))
    .filter(val => !isNaN(val) && val !== null && val !== undefined)
    .sort((a, b) => a - b);
  
  const median = numericValues.length > 0
    ? numericValues.length % 2 === 0
      ? (numericValues[numericValues.length / 2 - 1] + numericValues[numericValues.length / 2]) / 2
      : numericValues[Math.floor(numericValues.length / 2)]
    : 0;

  return fillMissingWithDefault(dataset, columnName, median);
};

/**
 * Trim whitespace from string columns
 */
export const trimWhitespace = (dataset: Dataset, columns?: string[]): CleaningResult => {
  const targetColumns = columns || dataset.columns
    .filter(col => col.type === 'string')
    .map(col => col.name);

  const cleanedData = dataset.data.map(row => {
    const cleanedRow = { ...row };
    targetColumns.forEach(col => {
      if (typeof cleanedRow[col] === 'string') {
        cleanedRow[col] = cleanedRow[col].trim();
      }
    });
    return cleanedRow;
  });

  // Update column sample values
  const updatedColumns = dataset.columns.map(col => {
    if (targetColumns.includes(col.name)) {
      const sampleValues = cleanedData
        .slice(0, 5)
        .map(row => row[col.name])
        .filter(v => v !== null && v !== undefined && v !== '');
      return {
        ...col,
        sampleValues
      };
    }
    return col;
  });

  return {
    dataset: {
      ...dataset,
      data: cleanedData,
      columns: updatedColumns,
      updatedAt: new Date()
    },
    operationsPerformed: [`Trim Whitespace${columns ? ` (${columns.join(', ')})` : ''}`],
    rowsRemoved: 0,
    rowsAdded: 0,
    statistics: {
      before: {
        rowCount: dataset.rowCount,
        nullCount: dataset.columns.reduce((sum, col) => sum + col.nullCount, 0),
        duplicateCount: 0
      },
      after: {
        rowCount: dataset.rowCount,
        nullCount: dataset.columns.reduce((sum, col) => sum + col.nullCount, 0),
        duplicateCount: 0
      }
    }
  };
};

/**
 * Remove outliers using IQR method
 */
export const removeOutliers = (dataset: Dataset, columnName: string): CleaningResult => {
  const column = dataset.columns.find(col => col.name === columnName);
  if (!column || column.type !== 'number') {
    throw new Error(`Column ${columnName} not found or is not numeric`);
  }

  const numericValues = dataset.data
    .map((row, index) => ({ value: Number(row[columnName]), index, row }))
    .filter(item => !isNaN(item.value) && item.value !== null && item.value !== undefined)
    .sort((a, b) => a.value - b.value);

  if (numericValues.length === 0) {
    return {
      dataset,
      operationsPerformed: [`Remove Outliers: ${columnName} (no valid values)`],
      rowsRemoved: 0,
      rowsAdded: 0,
      statistics: {
        before: {
          rowCount: dataset.rowCount,
          nullCount: 0,
          duplicateCount: 0
        },
        after: {
          rowCount: dataset.rowCount,
          nullCount: 0,
          duplicateCount: 0
        }
      }
    };
  }

  const q1Index = Math.floor(numericValues.length * 0.25);
  const q3Index = Math.floor(numericValues.length * 0.75);
  const q1 = numericValues[q1Index].value;
  const q3 = numericValues[q3Index].value;
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  const outlierIndices = new Set(
    numericValues
      .filter(item => item.value < lowerBound || item.value > upperBound)
      .map(item => item.index)
  );

  const originalRowCount = dataset.rowCount;
  const cleanedData = dataset.data.filter((_, index) => !outlierIndices.has(index));
  const rowsRemoved = originalRowCount - cleanedData.length;

  // Update column statistics
  const updatedColumns = dataset.columns.map(col => {
    if (col.name === columnName) {
      const values = cleanedData.map(row => Number(row[col.name])).filter(v => !isNaN(v));
      if (values.length > 0) {
        return {
          ...col,
          min: Math.min(...values),
          max: Math.max(...values),
          mean: values.reduce((a, b) => a + b, 0) / values.length
        };
      }
    }
    return col;
  });

  return {
    dataset: {
      ...dataset,
      data: cleanedData,
      rowCount: cleanedData.length,
      columns: updatedColumns,
      updatedAt: new Date()
    },
    operationsPerformed: [`Remove Outliers: ${columnName} (IQR method)`],
    rowsRemoved,
    rowsAdded: 0,
    statistics: {
      before: {
        rowCount: originalRowCount,
        nullCount: 0,
        duplicateCount: 0
      },
      after: {
        rowCount: cleanedData.length,
        nullCount: 0,
        duplicateCount: 0
      }
    }
  };
};

/**
 * Cap outliers to boundary values using IQR method (clamp instead of remove)
 */
export const capOutliersToBounds = (
  dataset: Dataset,
  columnName: string,
  bounds?: { min: number; max: number }
): CleaningResult => {
  const column = dataset.columns.find(col => col.name === columnName);
  if (!column || column.type !== 'number') {
    throw new Error(`Column ${columnName} not found or is not numeric`);
  }

  const numericValues = dataset.data
    .map(row => Number(row[columnName]))
    .filter(v => !isNaN(v) && v !== null && v !== undefined)
    .sort((a, b) => a - b);

  if (numericValues.length === 0) {
    return {
      dataset,
      operationsPerformed: [`Cap Outliers: ${columnName} (no valid values)`],
      rowsRemoved: 0,
      rowsAdded: 0,
      statistics: {
        before: { rowCount: dataset.rowCount, nullCount: 0, duplicateCount: 0 },
        after: { rowCount: dataset.rowCount, nullCount: 0, duplicateCount: 0 }
      }
    };
  }

  // Use provided bounds or compute IQR bounds
  let lowerBound: number;
  let upperBound: number;
  if (bounds) {
    lowerBound = bounds.min;
    upperBound = bounds.max;
  } else {
    const q1Index = Math.floor(numericValues.length * 0.25);
    const q3Index = Math.floor(numericValues.length * 0.75);
    const q1 = numericValues[q1Index];
    const q3 = numericValues[q3Index];
    const iqr = q3 - q1;
    lowerBound = q1 - 1.5 * iqr;
    upperBound = q3 + 1.5 * iqr;
  }

  let cappedCount = 0;
  const cappedData = dataset.data.map(row => {
    const val = Number(row[columnName]);
    if (!isNaN(val)) {
      if (val < lowerBound) {
        cappedCount++;
        return { ...row, [columnName]: lowerBound };
      }
      if (val > upperBound) {
        cappedCount++;
        return { ...row, [columnName]: upperBound };
      }
    }
    return row;
  });

  // Update column statistics
  const updatedColumns = dataset.columns.map(col => {
    if (col.name === columnName) {
      const values = cappedData.map(r => Number(r[col.name])).filter(v => !isNaN(v));
      if (values.length > 0) {
        return {
          ...col,
          min: Math.min(...values),
          max: Math.max(...values),
          mean: values.reduce((a, b) => a + b, 0) / values.length
        };
      }
    }
    return col;
  });

  return {
    dataset: {
      ...dataset,
      data: cappedData,
      rowCount: cappedData.length,
      columns: updatedColumns,
      updatedAt: new Date()
    },
    operationsPerformed: [`Cap Outliers: ${columnName} (clamped ${cappedCount} values to ${lowerBound.toFixed(2)} - ${upperBound.toFixed(2)})`],
    rowsRemoved: 0,
    rowsAdded: 0,
    statistics: {
      before: { rowCount: dataset.rowCount, nullCount: 0, duplicateCount: 0 },
      after: { rowCount: cappedData.length, nullCount: 0, duplicateCount: 0 }
    }
  };
};

/**
 * Standardize text (convert to lowercase)
 */
export const convertToLowerCase = (dataset: Dataset, columnName: string): CleaningResult => {
  return standardizeText(dataset, columnName, 'lowercase');
};

/**
 * Standardize text (convert to uppercase)
 */
export const convertToUpperCase = (dataset: Dataset, columnName: string): CleaningResult => {
  return standardizeText(dataset, columnName, 'uppercase');
};

/**
 * Standardize text in a column
 */
export const standardizeText = (
  dataset: Dataset, 
  columnName: string, 
  caseType: 'lowercase' | 'uppercase' | 'titlecase' = 'lowercase'
): CleaningResult => {
  const column = dataset.columns.find(col => col.name === columnName);
  if (!column || column.type !== 'string') {
    throw new Error(`Column ${columnName} not found or is not a string`);
  }

  const cleanedData = dataset.data.map(row => {
    const value = row[columnName];
    if (typeof value === 'string') {
      let transformed: string;
      switch (caseType) {
        case 'lowercase':
          transformed = value.toLowerCase();
          break;
        case 'uppercase':
          transformed = value.toUpperCase();
          break;
        case 'titlecase':
          transformed = value.replace(/\w\S*/g, (txt) => 
            txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
          );
          break;
        default:
          transformed = value;
      }
      return { ...row, [columnName]: transformed };
    }
    return row;
  });

  // Update column sample values
  const updatedColumns = dataset.columns.map(col => {
    if (col.name === columnName) {
      const sampleValues = cleanedData
        .slice(0, 5)
        .map(row => row[col.name])
        .filter(v => v !== null && v !== undefined && v !== '');
      return {
        ...col,
        sampleValues
      };
    }
    return col;
  });

  return {
    dataset: {
      ...dataset,
      data: cleanedData,
      columns: updatedColumns,
      updatedAt: new Date()
    },
    operationsPerformed: [`Standardize Text: ${columnName} (${caseType})`],
    rowsRemoved: 0,
    rowsAdded: 0,
    statistics: {
      before: {
        rowCount: dataset.rowCount,
        nullCount: 0,
        duplicateCount: 0
      },
      after: {
        rowCount: dataset.rowCount,
        nullCount: 0,
        duplicateCount: 0
      }
    }
  };
};

/**
 * Remove special characters from string columns
 */
export const removeSpecialCharacters = (
  dataset: Dataset, 
  columnName: string, 
  keepPattern: string = '[^a-zA-Z0-9\\s]'
): CleaningResult => {
  const column = dataset.columns.find(col => col.name === columnName);
  if (!column || column.type !== 'string') {
    throw new Error(`Column ${columnName} not found or is not a string`);
  }

  const regex = new RegExp(keepPattern, 'g');
  const cleanedData = dataset.data.map(row => {
    const value = row[columnName];
    if (typeof value === 'string') {
      return { ...row, [columnName]: value.replace(regex, '') };
    }
    return row;
  });

  // Update column sample values
  const updatedColumns = dataset.columns.map(col => {
    if (col.name === columnName) {
      const sampleValues = cleanedData
        .slice(0, 5)
        .map(row => row[col.name])
        .filter(v => v !== null && v !== undefined && v !== '');
      return {
        ...col,
        sampleValues
      };
    }
    return col;
  });

  return {
    dataset: {
      ...dataset,
      data: cleanedData,
      columns: updatedColumns,
      updatedAt: new Date()
    },
    operationsPerformed: [`Remove Special Characters: ${columnName}`],
    rowsRemoved: 0,
    rowsAdded: 0,
    statistics: {
      before: {
        rowCount: dataset.rowCount,
        nullCount: 0,
        duplicateCount: 0
      },
      after: {
        rowCount: dataset.rowCount,
        nullCount: 0,
        duplicateCount: 0
      }
    }
  };
};

