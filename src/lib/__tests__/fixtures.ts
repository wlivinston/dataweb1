import type { ColumnInfo, DataType, Dataset } from '../types';

export interface ColumnSpec {
  name: string;
  type: DataType;
}

/**
 * Build a fully-formed Dataset from plain rows so tests exercise the same
 * shape the upload pipeline produces (columns, dataTypes, rowCount all
 * consistent) rather than a hand-stubbed partial object.
 */
export const makeDataset = (
  rows: Record<string, unknown>[],
  specs: ColumnSpec[],
  overrides: Partial<Dataset> = {}
): Dataset => {
  const columns: ColumnInfo[] = specs.map((spec) => {
    const values = rows.map((r) => r[spec.name]);
    const present = values.filter((v) => v !== null && v !== undefined && v !== '');
    const numeric = present.map((v) => Number(v)).filter((v) => !Number.isNaN(v));

    const info: ColumnInfo = {
      name: spec.name,
      type: spec.type,
      sampleValues: present.slice(0, 5),
      nullCount: values.length - present.length,
      uniqueCount: new Set(present.map((v) => String(v))).size,
    };

    if (spec.type === 'number' && numeric.length > 0) {
      info.min = Math.min(...numeric);
      info.max = Math.max(...numeric);
      info.mean = numeric.reduce((a, b) => a + b, 0) / numeric.length;
    }

    return info;
  });

  const dataTypes: Record<string, DataType> = {};
  for (const spec of specs) dataTypes[spec.name] = spec.type;

  return {
    id: 'test-dataset',
    name: 'Test Dataset',
    description: 'Fixture dataset',
    columns,
    rowCount: rows.length,
    dataTypes,
    data: rows,
    ...overrides,
  };
};

/**
 * Deterministic pseudo-random generator so fixtures are reproducible across
 * runs and machines. Mulberry32.
 */
export const seededRandom = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Box-Muller normal sample driven by a seeded uniform generator. */
export const seededNormal = (rng: () => number, mean = 0, sd = 1): number => {
  const u = Math.max(rng(), Number.EPSILON);
  const v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** ISO date strings at a fixed monthly cadence, for time-intelligence tests. */
export const monthlyDates = (count: number, startISO = '2023-01-15'): string[] => {
  const start = new Date(startISO);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, start.getUTCDate()));
    return d.toISOString().slice(0, 10);
  });
};
