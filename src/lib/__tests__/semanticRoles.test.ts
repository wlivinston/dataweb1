import { describe, it, expect } from 'vitest';
import {
  inferColumnRole,
  looksLikeIdentifier,
  tokeniseColumnName,
  type ColumnRoleInput,
} from '../semantic/roles';

const column = (overrides: Partial<ColumnRoleInput>): ColumnRoleInput => ({
  name: 'Value',
  dataType: 'number',
  rowCount: 100,
  uniqueCount: 40,
  nullCount: 0,
  ...overrides,
});

describe('tokeniseColumnName', () => {
  it('splits camelCase, snake_case and spaces the same way', () => {
    expect(tokeniseColumnName('CustomerID')).toEqual(['customer', 'id']);
    expect(tokeniseColumnName('customer_id')).toEqual(['customer', 'id']);
    expect(tokeniseColumnName('Customer Id')).toEqual(['customer', 'id']);
    expect(tokeniseColumnName('customer-id')).toEqual(['customer', 'id']);
  });

  it('keeps an all-caps acronym whole', () => {
    expect(tokeniseColumnName('SKU')).toEqual(['sku']);
  });
});

describe('looksLikeIdentifier', () => {
  it('recognises common identifier endings', () => {
    for (const name of [
      'CustomerID', 'customer_id', 'Order No', 'ProductCode', 'InvoiceNumber',
      'SKU', 'AccountRef', 'item_key',
    ]) {
      expect(looksLikeIdentifier(name), name).toBe(true);
    }
  });

  it('does not mistake ordinary column names for identifiers', () => {
    for (const name of [
      'Amount', 'Revenue', 'Postcode', 'Region', 'Quantity', 'UnitPrice',
      'Description', 'Nodes', 'Income',
    ]) {
      expect(looksLikeIdentifier(name), name).toBe(false);
    }
  });

  it('treats a bare leading Id as an identifier but not a long phrase', () => {
    expect(looksLikeIdentifier('ID')).toBe(true);
    expect(looksLikeIdentifier('Id Number')).toBe(true);
    expect(looksLikeIdentifier('Key Account Manager')).toBe(false);
  });
});

describe('inferColumnRole', () => {
  it('never offers to sum a numeric identifier', () => {
    // The failure this whole function exists to prevent.
    const verdict = inferColumnRole(
      column({ name: 'CustomerID', dataType: 'number', uniqueCount: 100, nullCount: 0 })
    );
    expect(verdict.role).toBe('key');
    expect(verdict.defaultAggregation).not.toBe('sum');
  });

  it('treats a repeating numeric identifier as a foreign key', () => {
    const verdict = inferColumnRole(
      column({ name: 'CustomerID', dataType: 'number', uniqueCount: 12 })
    );
    expect(verdict.role).toBe('foreignKey');
    expect(verdict.defaultAggregation).toBe('distinctCount');
  });

  it('treats a plain numeric column as a measure', () => {
    const verdict = inferColumnRole(column({ name: 'Amount', dataType: 'number' }));
    expect(verdict.role).toBe('measure');
    expect(verdict.defaultAggregation).toBe('sum');
  });

  it('does not demote an amount just because it is whole and nearly unique', () => {
    // Whole cedis, almost no repeats. Shape alone would call this an
    // identifier; the name says otherwise and the name wins.
    const values = Array.from({ length: 100 }, (_, i) => 1000 + i * 7);
    const verdict = inferColumnRole(
      column({ name: 'Amount', dataType: 'number', uniqueCount: 100, values })
    );
    expect(verdict.role).toBe('measure');
  });

  it('demotes a plainly named numeric column only once a relationship confirms it', () => {
    const values = Array.from({ length: 100 }, (_, i) => 5000 + i);
    const asMeasure = inferColumnRole(
      column({ name: 'Account', dataType: 'number', uniqueCount: 100, values })
    );
    expect(asMeasure.role).toBe('measure');

    const asKey = inferColumnRole(
      column({ name: 'Account', dataType: 'number', uniqueCount: 100, values }),
      { participatesInRelationship: true }
    );
    expect(asKey.role).toBe('key');
  });

  it('does not demote a decimal column even when it joins to something', () => {
    // Money joins by accident all the time; fractional values are not keys.
    const values = Array.from({ length: 100 }, (_, i) => 1000.5 + i);
    const verdict = inferColumnRole(
      column({ name: 'Price', dataType: 'number', uniqueCount: 100, values }),
      { participatesInRelationship: true }
    );
    expect(verdict.role).toBe('measure');
  });

  it('marks date columns for time intelligence rather than aggregation', () => {
    const verdict = inferColumnRole(column({ name: 'OrderDate', dataType: 'date' }));
    expect(verdict.role).toBe('date');
    expect(verdict.defaultAggregation).toBe('none');
  });

  it('marks a date column as a date even when named like an identifier', () => {
    // Type evidence beats name evidence here: "Date Ref" still holds dates.
    const verdict = inferColumnRole(column({ name: 'Date Ref', dataType: 'date' }));
    expect(verdict.role).toBe('date');
  });

  it('marks booleans as flags', () => {
    const verdict = inferColumnRole(column({ name: 'IsPaid', dataType: 'boolean' }));
    expect(verdict.role).toBe('flag');
  });

  it('treats repeating text as a dimension worth grouping by', () => {
    const verdict = inferColumnRole(
      column({ name: 'Region', dataType: 'string', uniqueCount: 5 })
    );
    expect(verdict.role).toBe('dimension');
  });

  it('treats long, mostly distinct text as free text, not a dimension', () => {
    // Grouping by this would produce one row per record.
    const values = Array.from(
      { length: 100 },
      (_, i) => `Customer complaint number ${i} regarding a delayed delivery`
    );
    const verdict = inferColumnRole(
      column({ name: 'Comments', dataType: 'string', uniqueCount: 100, values })
    );
    expect(verdict.role).toBe('text');
  });

  it('treats short unique text as a key, not free text', () => {
    const values = Array.from({ length: 100 }, (_, i) => `INV-${1000 + i}`);
    const verdict = inferColumnRole(
      column({ name: 'Invoice', dataType: 'string', uniqueCount: 100, values })
    );
    expect(verdict.role).toBe('key');
  });

  it('does not call a column with blanks a key even when values are distinct', () => {
    // A nullable column cannot identify every row.
    const verdict = inferColumnRole(
      column({ name: 'CustomerID', dataType: 'string', uniqueCount: 99, nullCount: 1 })
    );
    expect(verdict.role).toBe('foreignKey');
  });

  it('gives a reason for every verdict', () => {
    const inputs: ColumnRoleInput[] = [
      column({ name: 'CustomerID', dataType: 'number', uniqueCount: 100 }),
      column({ name: 'Amount', dataType: 'number' }),
      column({ name: 'OrderDate', dataType: 'date' }),
      column({ name: 'IsPaid', dataType: 'boolean' }),
      column({ name: 'Region', dataType: 'string', uniqueCount: 5 }),
    ];
    for (const input of inputs) {
      const verdict = inferColumnRole(input);
      expect(verdict.reason.length, input.name).toBeGreaterThan(20);
    }
  });

  it('survives an empty table without calling anything a key', () => {
    const verdict = inferColumnRole(
      column({ name: 'CustomerID', dataType: 'string', rowCount: 0, uniqueCount: 0 })
    );
    expect(verdict.role).toBe('foreignKey');
  });

  it('works without values, falling back to counts alone', () => {
    const verdict = inferColumnRole(
      column({ name: 'Notes', dataType: 'string', uniqueCount: 100, values: undefined })
    );
    // No length evidence, so it cannot be classified as free text.
    expect(verdict.role).toBe('dimension');
  });
});
