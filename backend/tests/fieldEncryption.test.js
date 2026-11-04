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

/**
 * How the keys are read from the environment. A key the server cannot use
 * used to be skipped without a word, so a value pasted without "a:" looked
 * set in Vercel and still refused every sensitive upload.
 */
describe('reading the key settings', () => {
  const withEnv = (keys, active) => {
    const saved = [process.env.FIELD_ENCRYPTION_KEYS, process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID];
    if (keys === undefined) delete process.env.FIELD_ENCRYPTION_KEYS; else process.env.FIELD_ENCRYPTION_KEYS = keys;
    if (active === undefined) delete process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID; else process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID = active;
    let loaded;
    jest.isolateModules(() => { loaded = require('../modules/security/fieldCrypto'); });
    [process.env.FIELD_ENCRYPTION_KEYS, process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID] = saved;
    return loaded;
  };

  test.each([
    ['the documented form', `a:${KEY_A}`, 'a'],
    ['quotes around both values', `"a:${KEY_A}"`, '"a"'],
    ['a key pasted without "a:"', KEY_A, 'a'],
    ['a key pasted without "a:" and no active id', KEY_A, undefined],
    ['spaces around the parts', ` a : ${KEY_A} `, ' a '],
  ])('%s works, and round-trips', (_, keys, active) => {
    const loaded = withEnv(keys, active);
    expect(loaded.configurationProblems()).toEqual([]);
    expect(loaded.isConfigured()).toBe(true);
    expect(loaded.decryptValue(loaded.encryptValue('111-22-3333'))).toBe('111-22-3333');
  });

  test('a key saved in the documented form still decrypts after it is re-entered without "a:"', () => {
    const stored = withEnv(`a:${KEY_A}`, 'a').encryptValue('111-22-3333');
    expect(withEnv(KEY_A, undefined).decryptValue(stored)).toBe('111-22-3333');
  });

  test.each([
    ['nothing set', undefined, undefined, 'FIELD_ENCRYPTION_KEYS is not set'],
    ['a short key', `a:${crypto.randomBytes(16).toString('base64')}`, 'a', 'is 16 bytes, not 32'],
    ['the active id naming no key', `a:${KEY_A}`, 'b', 'FIELD_ENCRYPTION_ACTIVE_KEY_ID is "b", but the keys present are: a'],
    ['an entry with an empty key', 'a:', 'a', 'is not in the form'],
  ])('%s is refused with a reason that names the setting', (_, keys, active, reason) => {
    const loaded = withEnv(keys, active);
    expect(loaded.isConfigured()).toBe(false);
    expect(loaded.configurationProblems().join(' | ')).toContain(reason);
  });

  test('the reason never contains key material', () => {
    const short = crypto.randomBytes(16).toString('base64');
    const loaded = withEnv(`a:${short}`, 'a');
    expect(loaded.configurationProblems().join(' ')).not.toContain(short);
  });

  test('the refusal of a sensitive upload says which setting is wrong', async () => {
    const saved = [process.env.FIELD_ENCRYPTION_KEYS, process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID];
    process.env.FIELD_ENCRYPTION_KEYS = `a:${KEY_A}`;
    process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID = 'b';
    try {
      await jest.isolateModulesAsync(async () => {
        const misconfigured = require('../modules/datasets/datasets.service');
        await expect(misconfigured.createDataset({ ownerId: 'u-1', name: 'Staff', columns: [{ name: 'SSN', type: 'string' }] }))
          .rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('FIELD_ENCRYPTION_ACTIVE_KEY_ID is "b"') });
      });
    } finally {
      [process.env.FIELD_ENCRYPTION_KEYS, process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID] = saved;
    }
  });
});
