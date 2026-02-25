class ApiError extends Error {
  constructor(statusCode, code, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = Number.isInteger(statusCode) ? statusCode : 500;
    this.code = String(code || 'INTERNAL_ERROR');
    this.details = details;
  }

  static badRequest(message, details = null, code = 'BAD_REQUEST') {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(message = 'Authentication required', details = null, code = 'UNAUTHORIZED') {
    return new ApiError(401, code, message, details);
  }

  static forbidden(message = 'Forbidden', details = null, code = 'FORBIDDEN') {
    return new ApiError(403, code, message, details);
  }

  static notFound(message = 'Resource not found', details = null, code = 'NOT_FOUND') {
    return new ApiError(404, code, message, details);
  }

  static conflict(message = 'Conflict', details = null, code = 'CONFLICT') {
    return new ApiError(409, code, message, details);
  }

  static payloadTooLarge(message = 'Payload too large', details = null, code = 'PAYLOAD_TOO_LARGE') {
    return new ApiError(413, code, message, details);
  }

  static unprocessable(message = 'Unprocessable entity', details = null, code = 'UNPROCESSABLE_ENTITY') {
    return new ApiError(422, code, message, details);
  }

  static tooManyRequests(message = 'Too many requests', details = null, code = 'TOO_MANY_REQUESTS') {
    return new ApiError(429, code, message, details);
  }
}

function isApiError(error) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      Number.isInteger(error.statusCode) &&
      typeof error.code === 'string'
  );
}

module.exports = {
  ApiError,
  isApiError,
};
