const { validationResult } = require('express-validator');
const { ApiError } = require('./apiError');

function assertValidRequest(req) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return;

  const details = errors.array().map((entry) => ({
    field: entry.path,
    message: entry.msg,
  }));
  throw ApiError.unprocessable('Request validation failed', details, 'VALIDATION_ERROR');
}

module.exports = {
  assertValidRequest,
};
