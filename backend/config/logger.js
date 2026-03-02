// backend/config/logger.js
const pino = require('pino');

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').trim().toLowerCase();
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

const logger = pino({
  level: LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(IS_PROD
    ? {}
    : {
        transport: {
          target: 'pino/file',
          options: { destination: 1 }, // stdout
        },
      }),
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  base: { pid: process.pid, env: NODE_ENV },
  serializers: {
    err: pino.stdSerializers.err,
    req(req) {
      return {
        method: req.method,
        url: req.url || req.originalUrl,
        remoteAddress: req.ip,
        requestId: req.id,
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
});

module.exports = logger;
