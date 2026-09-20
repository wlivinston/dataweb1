import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ColumnInfo, DataType, Dataset } from '../../../types';

/**
 * Load one of this folder's CSV fixtures the way the upload pipeline would.
 *
 * Shared so the parity sheet and the measure sheet read their data
 * identically. If they parsed differently, a disagreement with Power BI
 * could come from the import rather than from the DAX, and the comparison
 * would be measuring the wrong thing.
 */

export const FIXTURE_DIR = __dirname;

export const loadCsvDataset = (
  file: string,
  options: { id: string; name: string; types: Record<string, DataType> }
): Dataset => {
  const text = readFileSync(join(FIXTURE_DIR, file), 'utf8').trim();
  const [header, ...lines] = text.split(/\r?\n/);
  const names = header.split(',');

  const rows = lines.map(line => {
    const cells = line.split(',');
    const row: Record<string, unknown> = {};
    names.forEach((name, index) => {
      const cell = cells[index] ?? '';
      // An empty cell is a blank, not a zero and not an empty string - the
      // distinction the whole engine is built to preserve.
      if (cell === '') row[name] = null;
      else if (options.types[name] === 'number') row[name] = Number(cell);
      else row[name] = cell;
    });
    return row;
  });

  const columns: ColumnInfo[] = names.map(name => {
    const values = rows.map(row => row[name]);
    const present = values.filter(value => value !== null && value !== undefined && value !== '');
    return {
      name,
      type: options.types[name],
      sampleValues: present.slice(0, 5),
      nullCount: values.length - present.length,
      uniqueCount: new Set(present.map(value => String(value))).size,
    };
  });

  return {
    id: options.id,
    name: options.name,
    description: `Power BI fixture: ${file}`,
    columns,
    rowCount: rows.length,
    dataTypes: options.types,
    data: rows,
  };
};

/** The measure-library fixture: revenue and cost on one grain, two years. */
export const loadOrders = (): Dataset =>
  loadCsvDataset('orders.csv', {
    id: 'ds-powerbi-orders',
    name: 'Orders',
    types: {
      OrderID: 'string',
      CustomerID: 'string',
      ProductID: 'string',
      Revenue: 'number',
      Cost: 'number',
      Quantity: 'number',
      OrderDate: 'date',
    },
  });
