// A stored dataset (metadata + rows from the backend) as the engine's Dataset.
//
// Pure, with no browser dependencies, so the browser and the server engine
// (src/lib/engine) share the one function. If they each rebuilt a Dataset
// their own way, the same stored data could produce a different model - and a
// different answer - depending on where the question was asked.

import type { ColumnInfo, Dataset, DataType } from './types';

/** What the server knows about a stored dataset, without its rows. */
export interface StoredDataset {
  id: string;
  name: string;
  sourceName: string | null;
  status: 'building' | 'ready';
  rowCount: number;
  columns: Array<{ name: string; type: DataType }>;
  byteSize: number;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * A stored dataset as the app's own Dataset, statistics and all.
 *
 * analyzeColumn is the same function the upload path uses, so a reloaded
 * dataset is described by exactly the code that described it the first time -
 * rather than by stored statistics that could have been computed by an older
 * version of that code.
 */
export const toDataset = (
  stored: StoredDataset,
  rows: Record<string, unknown>[],
  analyzeColumn: (name: string, values: unknown[]) => ColumnInfo
): Dataset => {
  const columns = stored.columns.map(column => {
    const analysed = analyzeColumn(
      column.name,
      rows.map(row => row[column.name])
    );
    // The stored type wins. It was decided when the file was parsed, with the
    // original cell types visible; re-detecting from JSON round-tripped values
    // could quietly reclassify a column - a date column read back as text
    // loses every time-intelligence question the user could ask of it.
    return { ...analysed, type: column.type };
  });

  return {
    id: stored.id,
    name: stored.name,
    description: stored.sourceName ? `Stored: ${stored.sourceName}` : 'Stored dataset',
    columns,
    rowCount: rows.length,
    dataTypes: Object.fromEntries(stored.columns.map(column => [column.name, column.type])),
    data: rows,
    createdAt: stored.createdAt ? new Date(stored.createdAt) : undefined,
    updatedAt: stored.updatedAt ? new Date(stored.updatedAt) : undefined,
  };
};
