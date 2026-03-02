// backend/config/database.js
const { Pool } = require('pg');
const { supabase, hasServiceKey } = require('./supabase');
const logger = require('./logger');

const connectionString = (process.env.DATABASE_URL || '').trim();
const pgPool = connectionString ? new Pool({ connectionString }) : null;

function isSqlStatement(value) {
  return /^\s*(select|insert|update|delete|with|create|alter|drop|truncate)\b/i.test(value);
}

// Optional connectivity check; NEVER throws.
async function connectDB() {
  if (pgPool) {
    try {
      await pgPool.query('SELECT 1');
      logger.info('postgres connection ok');
      return;
    } catch (err) {
      logger.warn({ err: err.message }, 'postgres ping failed');
    }
  }

  if (!hasServiceKey || !supabase) {
    logger.warn('skipping supabase ping: env not configured');
    return;
  }

  try {
    const { data, error } = await supabase.from('blog_posts').select('id').limit(1);
    if (error) {
      logger.warn({ err: error.message }, 'supabase ping failed');
      return;
    }
    logger.info({ rows: data?.length || 0 }, 'supabase connection ok');
  } catch (err) {
    logger.warn({ err: err.message }, 'supabase ping threw');
  }
}

// Supports either SQL-style calls (query(sql, params)) or Supabase table/op calls.
async function query(sqlOrTable, paramsOrOp = []) {
  if (typeof sqlOrTable === 'string' && isSqlStatement(sqlOrTable)) {
    if (!pgPool) {
      throw new Error('DATABASE_URL not configured for SQL query mode.');
    }

    const start = Date.now();
    const result = await pgPool.query(sqlOrTable, Array.isArray(paramsOrOp) ? paramsOrOp : []);
    const ms = Date.now() - start;
    logger.debug({ mode: 'sql', ms, rows: result.rowCount || 0 }, 'query');
    return result;
  }

  if (!hasServiceKey || !supabase) {
    throw new Error('Supabase client not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).');
  }

  const table = sqlOrTable;
  const op = paramsOrOp || {};
  const start = Date.now();
  let req = supabase.from(table);

  try {
    switch (op.type) {
      case 'select': {
        req = req.select(op.select || '*');
        if (op.match) req = req.match(op.match);
        if (op.order) {
          const col = typeof op.order === 'string' ? op.order : op.order.column;
          const asc = typeof op.order === 'object' ? !!op.order.ascending : false;
          req = req.order(col, { ascending: asc });
        }
        if (op.range) req = req.range(op.range.from ?? 0, op.range.to ?? 999);
        break;
      }
      case 'insert':
        req = req.insert(op.data);
        break;
      case 'update':
        req = req.update(op.data).match(op.match || {});
        break;
      case 'delete':
        req = req.delete().match(op.match || {});
        break;
      default:
        throw new Error(`Unknown operation type: ${op.type}`);
    }

    const { data, error } = await req;
    const ms = Date.now() - start;
    logger.debug({ mode: 'supabase', table, type: op.type, ms, rows: Array.isArray(data) ? data.length : 0 }, 'query');
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    logger.error({ err: error.message }, 'query error');
    throw error;
  }
}

module.exports = { connectDB, query };

