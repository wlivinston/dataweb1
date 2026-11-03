const path = require('node:path');

// Real Postgres. Must be set before the repository is required.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.env.AUDIT_STORAGE_MODE = 'database';

const repository = require('../modules/audit/audit.repository');
const { query, closePool } = require('../config/database');

/**
 * The audit trail is append-only in the database itself: a trigger rejects
 * UPDATE and DELETE, so neither a bug nor a stolen application credential can
 * rewrite who did what. Skipped, loudly, without DATABASE_URL.
 */

const hasDatabase = Boolean(String(process.env.DATABASE_URL || '').trim());
const describeDurable = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  // eslint-disable-next-line no-console
  console.warn('\n  DATABASE_URL is not set - the durable audit tests were SKIPPED.\n');
}

const ACTOR = `test-actor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describeDurable('audit_events in Postgres', () => {
  afterAll(async () => {
    await closePool();
  });

  test('stores and lists events for an actor', async () => {
    expect(await repository.storageMode()).toBe('database');
    await repository.append({ actorId: ACTOR, action: 'dataset.read', targetType: 'dataset', targetId: 'd1', outcome: 'ok', details: { n: 1 } });
    const [event] = await repository.listForActor(ACTOR, 5);
    expect(event).toMatchObject({ actorId: ACTOR, action: 'dataset.read', targetId: 'd1', outcome: 'ok', details: { n: 1 } });
  });

  test('refuses UPDATE', async () => {
    await expect(query("UPDATE audit_events SET outcome = 'ok' WHERE actor_id = $1", [ACTOR])).rejects.toThrow(/append-only/);
  });

  test('refuses DELETE', async () => {
    await expect(query('DELETE FROM audit_events WHERE actor_id = $1', [ACTOR])).rejects.toThrow(/append-only/);
  });

  test('refuses TRUNCATE', async () => {
    await expect(query('TRUNCATE audit_events', [])).rejects.toThrow(/append-only/);
  });
});
