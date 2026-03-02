// backend/middleware/requestId.js
const { randomUUID } = require('crypto');

/**
 * Attaches a unique request ID to every incoming request.
 * - Reuses the `X-Request-Id` header when supplied by an upstream proxy.
 * - Generates a new UUID v4 otherwise.
 * - Exposes the ID as `req.id` and echoes it back via the `X-Request-Id` response header.
 */
function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = requestId;
