import { describe, it, expect } from 'vitest';
import { makeDataset } from './fixtures';
import {
  buildSemanticModel,
  findColumn,
  findTable,
  relationshipsFrom,
} from '../semantic/model';
import type { Dataset } from '../types';
import { columnRef, tableRef } from '../dax/printer';

/** Customers: one row per customer, so CustomerID is a genuine key. */
const customers = (): Dataset =>
  makeDataset(
    [
      { CustomerID: 'C1', Name: 'Ama', Region: 'Greater Accra' },
      { CustomerID: 'C2', Name: 'Kofi', Region: 'Ashanti' },
      { CustomerID: 'C3', Name: 'Yaa', Region: 'Greater Accra' },
    ],
    [
      { name: 'CustomerID', type: 'string' },
      { name: 'Name', type: 'string' },
      { name: 'Region', type: 'string' },
    ],
    { id: 'ds-customers', name: 'Customers' }
  );

/** Sales: many rows per customer, so CustomerID repeats. */
const sales = (): Dataset =>
  makeDataset(
    [
      { OrderID: 'O1', CustomerID: 'C1', Amount: 100, OrderDate: '2024-01-15' },
      { OrderID: 'O2', CustomerID: 'C1', Amount: 250, OrderDate: '2024-02-20' },
      { OrderID: 'O3', CustomerID: 'C2', Amount: 75, OrderDate: '2024-03-05' },
      { OrderID: 'O4', CustomerID: 'C3', Amount: 400, OrderDate: '2024-03-28' },
    ],
    [
      { name: 'OrderID', type: 'string' },
      { name: 'CustomerID', type: 'string' },
      { name: 'Amount', type: 'number' },
      { name: 'OrderDate', type: 'date' },
    ],
    { id: 'ds-sales', name: 'Sales' }
  );

describe('buildSemanticModel: tables and columns', () => {
  it('names tables after their datasets', () => {
    const model = buildSemanticModel([sales(), customers()]);
    expect(findTable(model, 'Sales')).toBeDefined();
    expect(findTable(model, 'Customers')).toBeDefined();
  });

  it('resolves table names case-insensitively, as DAX does', () => {
    const model = buildSemanticModel([sales()]);
    expect(findTable(model, 'sales')?.name).toBe('Sales');
    expect(findTable(model, 'SALES')?.name).toBe('Sales');
  });

  it('assigns a role and a reason to every column', () => {
    const model = buildSemanticModel([sales(), customers()]);
    for (const table of model.tables) {
      for (const column of table.columns) {
        expect(column.role, `${table.name}[${column.name}]`).toBeTruthy();
        expect(column.roleReason.length).toBeGreaterThan(20);
      }
    }
  });

  it('classifies the obvious columns correctly', () => {
    const model = buildSemanticModel([sales(), customers()]);
    const role = (table: string, column: string) => {
      const found = findColumn(model, table, column);
      return found.ok ? found.value.role : `unresolved: ${found.error}`;
    };

    expect(role('Sales', 'Amount')).toBe('measure');
    expect(role('Sales', 'CustomerID')).toBe('foreignKey');
    expect(role('Sales', 'OrderDate')).toBe('date');
    expect(role('Customers', 'CustomerID')).toBe('key');
    expect(role('Customers', 'Region')).toBe('dimension');
  });

  it('renames a duplicate table rather than losing one', () => {
    const first = makeDataset([{ A: 1 }], [{ name: 'A', type: 'number' }], {
      id: 'ds-1',
      name: 'Sales',
    });
    const second = makeDataset([{ B: 2 }], [{ name: 'B', type: 'number' }], {
      id: 'ds-2',
      name: 'Sales',
    });
    const model = buildSemanticModel([first, second]);

    expect(model.tables).toHaveLength(2);
    expect(model.tables.map(t => t.name)).toEqual(['Sales', 'Sales 2']);
    expect(model.warnings.some(w => w.code === 'duplicate_table_name')).toBe(true);
  });

  it('warns about an empty table instead of silently producing blanks', () => {
    const empty = makeDataset([], [{ name: 'Amount', type: 'number' }], {
      id: 'ds-empty',
      name: 'Empty',
    });
    const model = buildSemanticModel([empty]);
    expect(model.warnings.some(w => w.code === 'empty_table')).toBe(true);
  });
});

describe('buildSemanticModel: relationship orientation', () => {
  it('puts the many side on `from` and the unique side on `to`', () => {
    // The bug this replaces: autoDetectRelationships reports 'one-to-many'
    // for both directions, so a consumer cannot tell which end is the one.
    const model = buildSemanticModel([sales(), customers()]);
    const link = model.relationships.find(
      r => r.from.table === 'Sales' && r.to.table === 'Customers'
    );

    expect(link).toBeDefined();
    expect(link?.from.column).toBe('CustomerID');
    expect(link?.to.column).toBe('CustomerID');
    expect(link?.cardinality).toBe('oneToMany');
  });

  it('orients the same pair identically when the datasets are passed in reverse', () => {
    // Orientation must come from the data, not from argument order.
    const forward = buildSemanticModel([sales(), customers()]);
    const reverse = buildSemanticModel([customers(), sales()]);

    const pick = (model: ReturnType<typeof buildSemanticModel>) =>
      model.relationships
        .filter(r => r.to.table === 'Customers' || r.from.table === 'Customers')
        .map(r => `${r.from.table}.${r.from.column}->${r.to.table}.${r.to.column}`);

    expect(pick(forward)).toEqual(pick(reverse));
  });

  it('marks the many side as a fact table and the one side as a dimension', () => {
    const model = buildSemanticModel([sales(), customers()]);
    expect(findTable(model, 'Sales')?.role).toBe('fact');
    expect(findTable(model, 'Customers')?.role).toBe('dimension');
  });

  it('reports broken referential integrity rather than dropping rows quietly', () => {
    const orphaned = makeDataset(
      [
        { OrderID: 'O1', CustomerID: 'C1', Amount: 100 },
        { OrderID: 'O2', CustomerID: 'C1', Amount: 100 },
        { OrderID: 'O3', CustomerID: 'C2', Amount: 100 },
        { OrderID: 'O4', CustomerID: 'C9', Amount: 999 },
      ],
      [
        { name: 'OrderID', type: 'string' },
        { name: 'CustomerID', type: 'string' },
        { name: 'Amount', type: 'number' },
      ],
      { id: 'ds-sales', name: 'Sales' }
    );

    const model = buildSemanticModel([orphaned, customers()]);
    const warning = model.warnings.find(w => w.code === 'referential_integrity');

    expect(warning).toBeDefined();
    // C9 has no customer, so a report grouped by Region loses 999.
    expect(warning?.message).toMatch(/25% of Sales\[CustomerID\]/);
  });

  it('keeps only one active relationship between a pair of tables', () => {
    const model = buildSemanticModel([sales(), customers()]);
    const active = model.relationships.filter(
      r =>
        r.isActive &&
        [r.from.table, r.to.table].sort().join() === ['Sales', 'Customers'].sort().join()
    );
    expect(active).toHaveLength(1);
  });

  it('finds no relationships in a single-table model', () => {
    const model = buildSemanticModel([sales()]);
    const nonDate = model.relationships.filter(r => r.to.table !== model.dateTableName);
    expect(nonDate).toHaveLength(0);
  });
});

describe('buildSemanticModel: the generated date table', () => {
  it('generates a calendar covering the data', () => {
    const model = buildSemanticModel([sales()]);
    expect(model.dateTableName).toBe('Date');

    const dateTable = findTable(model, 'Date');
    expect(dateTable?.isGenerated).toBe(true);
    expect(dateTable?.role).toBe('date');
    // Padded to whole years, so a year-to-date filter has every month.
    expect(dateTable?.rows[0].Date).toBe('2024-01-01');
    expect(dateTable?.rows[dateTable.rows.length - 1].Date).toBe('2024-12-31');
  });

  it('joins the fact date column to the calendar, many side on the fact', () => {
    const model = buildSemanticModel([sales()]);
    const link = model.relationships.find(r => r.to.table === 'Date');

    expect(link?.from).toEqual({ table: 'Sales', column: 'OrderDate' });
    expect(link?.to.column).toBe('Date');
    expect(link?.isActive).toBe(true);
  });

  it('avoids colliding with a user table already called Date', () => {
    const userDate = makeDataset(
      [{ Label: 'FY start' }],
      [{ name: 'Label', type: 'string' }],
      { id: 'ds-date', name: 'Date' }
    );
    const model = buildSemanticModel([sales(), userDate]);
    expect(model.dateTableName).toBe('Calendar');
    expect(findTable(model, 'Date')?.isGenerated).toBe(false);
  });

  it('activates only one date relationship per table and explains the other', () => {
    const twoDates = makeDataset(
      [{ Amount: 10, OrderDate: '2024-01-15', ShipDate: '2024-01-20' }],
      [
        { name: 'Amount', type: 'number' },
        { name: 'OrderDate', type: 'date' },
        { name: 'ShipDate', type: 'date' },
      ],
      { id: 'ds-sales', name: 'Sales' }
    );
    const model = buildSemanticModel([twoDates]);
    const dateLinks = model.relationships.filter(r => r.to.table === 'Date');

    expect(dateLinks).toHaveLength(2);
    expect(dateLinks.filter(r => r.isActive)).toHaveLength(1);
    expect(model.warnings.some(w => w.message.includes('USERELATIONSHIP'))).toBe(true);
  });

  it('applies the fiscal configuration to the generated calendar', () => {
    const model = buildSemanticModel([sales()], {
      fiscal: { startMonth: 7, naming: 'endYear' },
    });
    const dateTable = findTable(model, 'Date');
    // Data runs Jan-Mar 2024, which is FY2024 under a July start.
    expect(dateTable?.rows[0].Date).toBe('2023-07-01');
    expect(dateTable?.rows[0].FiscalYear).toBe(2024);
  });

  it('says so when there is no date column at all', () => {
    const model = buildSemanticModel([customers()]);
    expect(model.dateTableName).toBeNull();
    expect(model.warnings.some(w => w.code === 'no_date_column')).toBe(true);
  });

  it('can be told not to generate a calendar', () => {
    const model = buildSemanticModel([sales()], { skipDateTable: true });
    expect(model.dateTableName).toBeNull();
    expect(model.tables.every(t => !t.isGenerated)).toBe(true);
  });
});

describe('buildSemanticModel: date normalisation', () => {
  it('rewrites date columns to canonical keys without touching the source', () => {
    const source = makeDataset(
      [{ Amount: 10, OrderDate: '15/03/2024' }, { Amount: 20, OrderDate: '01/02/2024' }],
      [
        { name: 'Amount', type: 'number' },
        { name: 'OrderDate', type: 'date' },
      ],
      { id: 'ds-sales', name: 'Sales' }
    );
    const model = buildSemanticModel([source]);
    const table = findTable(model, 'Sales');

    expect(table?.rows.map(r => r.OrderDate)).toEqual(['2024-03-15', '2024-02-01']);
    // The dataset the caller handed us is unchanged.
    expect(source.data[0].OrderDate).toBe('15/03/2024');
  });

  it('records the reading applied to each date column', () => {
    const source = makeDataset(
      [{ OrderDate: '15/03/2024' }],
      [{ name: 'OrderDate', type: 'date' }],
      { id: 'ds-sales', name: 'Sales' }
    );
    const model = buildSemanticModel([source]);
    const column = findColumn(model, 'Sales', 'OrderDate');
    expect(column.ok && column.value.dateFormat).toBe('dayFirst');
  });

  it('refuses an ambiguous date column rather than guessing a calendar', () => {
    const source = makeDataset(
      [{ OrderDate: '03/04/2024' }, { OrderDate: '01/02/2024' }],
      [{ name: 'OrderDate', type: 'date' }],
      { id: 'ds-sales', name: 'Sales' }
    );
    const model = buildSemanticModel([source]);

    const warning = model.warnings.find(w => w.code === 'ambiguous_date_format');
    expect(warning?.severity).toBe('error');
    expect(model.dateTableName).toBeNull();
  });

  it('accepts an ambiguous column under an explicit fallback, and still warns', () => {
    const source = makeDataset(
      [{ OrderDate: '03/04/2024' }, { OrderDate: '01/02/2024' }],
      [{ name: 'OrderDate', type: 'date' }],
      { id: 'ds-sales', name: 'Sales' }
    );
    const model = buildSemanticModel([source], { ambiguousDateFallback: 'dayFirst' });

    expect(findTable(model, 'Sales')?.rows[0].OrderDate).toBe('2024-04-03');
    const warning = model.warnings.find(w => w.code === 'ambiguous_date_format');
    expect(warning?.severity).toBe('warning');
    expect(warning?.message).toMatch(/day-first/);
  });

  it('reports values that are not dates at all', () => {
    const source = makeDataset(
      [{ OrderDate: '2024-01-15' }, { OrderDate: 'pending' }],
      [{ name: 'OrderDate', type: 'date' }],
      { id: 'ds-sales', name: 'Sales' }
    );
    const model = buildSemanticModel([source]);
    expect(model.warnings.some(w => w.code === 'unparsed_dates')).toBe(true);
    expect(findTable(model, 'Sales')?.rows[1].OrderDate).toBeNull();
  });
});

describe('findColumn', () => {
  it('resolves a qualified reference', () => {
    const model = buildSemanticModel([sales(), customers()]);
    const found = findColumn(model, 'Sales', 'Amount');
    expect(found.ok && found.value.table).toBe('Sales');
  });

  it('resolves an unqualified reference when the name is unique', () => {
    const model = buildSemanticModel([sales(), customers()]);
    const found = findColumn(model, undefined, 'Region');
    expect(found.ok && found.value.table).toBe('Customers');
  });

  it('refuses an ambiguous unqualified reference instead of picking one', () => {
    // CustomerID exists in both tables. Choosing silently would answer from
    // the wrong table.
    const model = buildSemanticModel([sales(), customers()]);
    const found = findColumn(model, undefined, 'CustomerID');

    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.error).toMatch(/ambiguous/);
      expect(found.error).toMatch(/Sales\[CustomerID\]/);
      expect(found.error).toMatch(/Customers\[CustomerID\]/);
    }
  });

  it('names the available tables when the table is wrong', () => {
    const model = buildSemanticModel([sales()]);
    const found = findColumn(model, 'Slaes', 'Amount');
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.error).toMatch(/no table called "Slaes".*Available: Sales/);
  });

  it('names the available columns when the column is wrong', () => {
    const model = buildSemanticModel([sales()]);
    const found = findColumn(model, 'Sales', 'Amonut');
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.error).toMatch(/no column called "Amonut".*Amount/);
  });
});

describe('relationshipsFrom', () => {
  it('propagates out of the one side', () => {
    const model = buildSemanticModel([sales(), customers()]);
    const outgoing = relationshipsFrom(model, 'Customers');
    expect(outgoing.map(r => r.from.table)).toContain('Sales');
  });

  it('does not propagate back out of the many side by default', () => {
    const model = buildSemanticModel([sales(), customers()]);
    const outgoing = relationshipsFrom(model, 'Sales');
    expect(outgoing.some(r => r.to.table === 'Customers')).toBe(false);
  });
});

// ============================================================
// Table names are identifiers, not filenames
// ============================================================

describe('buildSemanticModel: naming a table after its file', () => {
  const named = (name: string): Dataset =>
    makeDataset([{ Amount: 1 }], [{ name: 'Amount', type: 'number' }], {
      id: `ds-${name}`,
      name,
    });

  const tableNames = (...names: string[]): string[] =>
    buildSemanticModel(names.map(named)).tables.map(table => table.name);

  it('drops the extension, as Power BI does on import', () => {
    // Load orders.csv into Power BI and the table is called orders. Exporting
    // 'orders.csv'[Amount] against that model never resolved.
    expect(tableNames('orders.csv')).toContain('orders');
  });

  it('drops it from an Excel sheet name too, where it sits mid-string', () => {
    expect(tableNames('sales.xlsx - Q1')).toContain('sales - Q1');
  });

  it('handles the other formats the uploader accepts', () => {
    expect(tableNames('a.json')).toContain('a');
    expect(tableNames('b.tsv')).toContain('b');
    expect(tableNames('c.XLSX')).toContain('c');
  });

  it('leaves a dot that is not a file extension alone', () => {
    // A quarter, not a filename. Stripping any trailing dot-suffix would
    // silently rename this table to Q1.
    expect(tableNames('Q1.2024')).toContain('Q1.2024');
  });

  it('leaves a name with no extension alone', () => {
    expect(tableNames('Sales')).toContain('Sales');
  });

  it('does not strip its way to an empty name', () => {
    expect(tableNames('.csv')).toContain('.csv');
  });

  it('still separates two files whose stems now collide', () => {
    // orders.csv and orders.xlsx are different filenames that become the
    // same table name. The collision is new, created by the stripping.
    const model = buildSemanticModel([named('orders.csv'), named('orders.xlsx')]);
    expect(model.tables.map(table => table.name)).toEqual(['orders', 'orders 2']);
    const warning = model.warnings.find(w => w.code === 'duplicate_table_name');
    expect(warning?.message).toContain('Two tables would be called "orders"');
  });

  it('emits a bare reference for a stripped name, with no quoting', () => {
    // The point of the exercise: the dot was the only reason this needed
    // quotes, and quoting is what made the exported text unpasteable.
    const model = buildSemanticModel([named('orders.csv')]);
    const table = model.tables.find(t => t.name === 'orders')!;
    expect(tableRef(table.name)).toBe('orders');
    expect(columnRef(table.name, 'Amount')).toBe('orders[Amount]');
  });
});
