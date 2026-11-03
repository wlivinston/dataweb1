const crypto = require('node:crypto');

const KEY_A = crypto.randomBytes(32).toString('base64');
const KEY_B = crypto.randomBytes(32).toString('base64');
// Read when the modules first load.
process.env.DATASET_STORAGE_MODE = 'memory';
process.env.FIELD_ENCRYPTION_KEYS = `a:${KEY_A}`;
process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID = 'a';

const fieldCrypto = require('../modules/security/fieldCrypto');
const service = require('../modules/datasets/datasets.service');
const repository = require('../modules/datasets/datasets.repository');
const analytics = require('../modules/analytics/analytics.service');

/**
 * Sensitive fields are encrypted before they reach the database, decrypted
 * for their owner and for questions, and never stored in clear - not even
 * when the uploader forgot to mark them, and not when no key is configured.
 */

const SSN = '123-45-6789';
const OWNER = 'owner-1';

beforeEach(() => {
  repository.__resetMemoryStore();
  analytics.__resetModelCache();
});

describe('fieldCrypto', () => {
  test('round-trips values with their types, and leaves blanks blank', () => {
    for (const value of [SSN, 42, 0.5, 'Ghana Card GHA-123', true]) {
      expect(fieldCrypto.decryptValue(fieldCrypto.encryptValue(value))).toEqual(value);
    }
    expect([null, undefined, ''].map(fieldCrypto.encryptValue)).toEqual([null, undefined, '']);
  });

  test('ciphertext reveals nothing and differs every time', () => {
    const one = fieldCrypto.encryptValue(SSN);
    const two = fieldCrypto.encryptValue(SSN);
    expect(one).toMatch(/^enc:v1:a:/);
    expect(one).not.toContain('6789');
    expect(one).not.toBe(two);
  });

  test('a value altered in the database fails to decrypt rather than reading as something else', () => {
    const stored = fieldCrypto.encryptValue(SSN);
    const parts = stored.split(':');
    const body = Buffer.from(parts[5], 'base64url');
    body[0] ^= 1;
    parts[5] = body.toString('base64url');
    expect(() => fieldCrypto.decryptValue(parts.join(':'))).toThrow();
  });

  test('keys rotate: old values still decrypt after a new key becomes active', () => {
    const old = fieldCrypto.encryptValue(SSN);
    jest.isolateModules(() => {
      process.env.FIELD_ENCRYPTION_KEYS = `b:${KEY_B},a:${KEY_A}`;
      process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID = 'b';
      const rotated = require('../modules/security/fieldCrypto');
      expect(rotated.decryptValue(old)).toBe(SSN);
      expect(rotated.encryptValue(SSN)).toMatch(/^enc:v1:b:/);
    });
    process.env.FIELD_ENCRYPTION_KEYS = `a:${KEY_A}`;
    process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID = 'a';
  });

  test.each([
    ['SSN', true], ['Social Security Number', true], ['taxpayer_id', true], ['Tax ID', true],
    ['BankAccountNumber', true], ['Routing Number', true], ['IBAN', true], ['Ghana Card', true],
    ['date_of_birth', true], ['BVN', true], ['Passport No', true],
    ['Region', false], ['Amount', false], ['Tinted Glass', false], ['Destination', false], ['Accounts', false],
  ])('treats a column named "%s" as sensitive: %s', (name, expected) => {
    expect(fieldCrypto.looksSensitive(name)).toBe(expected);
  });
});

async function storeEmployees(columns) {
  const dataset = await service.createDataset({ ownerId: OWNER, name: 'Staff', sourceName: 'staff.csv', columns });
  await service.appendRows({
    ownerId: OWNER, datasetId: dataset.id, startIndex: 0,
    rows: [
      { Name: 'Ama', SSN, Salary: 5000, Notes: 'private' },
      { Name: 'Kofi', SSN: '987-65-4321', Salary: 7000, Notes: '' },
      { Name: 'Esi', SSN: null, Salary: 6000, Notes: 'also private' },
    ],
  });
  await service.completeDataset({ ownerId: OWNER, datasetId: dataset.id, expectedRowCount: 3 });
  return dataset.id;
}

const COLUMNS = [
  { name: 'Name', type: 'string' },
  { name: 'SSN', type: 'string' }, // not marked - recognised by name
  { name: 'Salary', type: 'number' },
  { name: 'Notes', type: 'string', sensitive: true }, // marked by the uploader
];

describe('stored datasets', () => {
  test('an SSN column is encrypted even though the uploader did not mark it', async () => {
    const id = await storeEmployees(COLUMNS);
    const header = await service.getDataset(id, OWNER);
    expect(header.columns.filter((c) => c.sensitive).map((c) => c.name)).toEqual(['SSN', 'Notes']);

    // What the database holds:
    const raw = await repository.getDatasetRows(id, { offset: 0, limit: 10 });
    expect(JSON.stringify(raw)).not.toContain('6789');
    expect(JSON.stringify(raw)).not.toContain('private');
    expect(raw[0].SSN).toMatch(/^enc:v1:/);
    expect(raw[0]).toMatchObject({ Name: 'Ama', Salary: 5000 }); // ordinary columns stay readable to Postgres
    expect([raw[1].Notes, raw[2].SSN]).toEqual(['', null]); // blank stays blank
  });

  test('the owner reads the values back', async () => {
    const id = await storeEmployees(COLUMNS);
    const { rows } = await service.getDatasetRows(id, OWNER);
    expect(rows.map((r) => r.SSN)).toEqual([SSN, '987-65-4321', null]);
    expect(rows[0].Notes).toBe('private');
  });

  test('server questions are answered over the values, not the ciphertext', async () => {
    const id = await storeEmployees(COLUMNS);
    const distinct = await analytics.query({ ownerId: OWNER, datasetIds: [id], expression: 'DISTINCTCOUNT(Staff[SSN])' });
    // Two distinct SSNs and one blank: DAX counts blank as a value -> 3.
    expect(distinct.data.value).toBe(3);
    const lookup = await analytics.query({
      ownerId: OWNER, datasetIds: [id], expression: `CALCULATE(SUM(Staff[Salary]), Staff[SSN] = "${SSN}")`,
    });
    expect(lookup.data.value).toBe(5000);
  });

  test('fails closed: with no key configured, a sensitive dataset is refused, not stored in clear', async () => {
    const saved = process.env.FIELD_ENCRYPTION_KEYS;
    delete process.env.FIELD_ENCRYPTION_KEYS;
    delete process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID;
    try {
      await jest.isolateModulesAsync(async () => {
        const unkeyed = require('../modules/datasets/datasets.service');
        await expect(unkeyed.createDataset({ ownerId: OWNER, name: 'Staff', columns: COLUMNS }))
          .rejects.toMatchObject({ statusCode: 503, code: 'ENCRYPTION_UNAVAILABLE' });
        await expect(unkeyed.createDataset({ ownerId: OWNER, name: 'Sales', columns: [{ name: 'Amount', type: 'number' }] }))
          .resolves.toMatchObject({ name: 'Sales' });
      });
    } finally {
      process.env.FIELD_ENCRYPTION_KEYS = saved;
      process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID = 'a';
    }
  });
});
