const { isApiError } = require('./apiError');

function sendSuccess(res, { status = 200, data = null, meta = undefined } = {}) {
  const payload = {
    success: true,
    data,
  };

  if (meta !== undefined) {
    payload.meta = meta;
  }

  return res.status(status).json(payload);
}

function toErrorPayload(error) {
  if (isApiError(error)) {
    return {
      statusCode: error.statusCode,
      body: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details || undefined,
        },
      },
    };
  }

  const message =
    process.env.NODE_ENV === 'development'
      ? String(error?.message || 'Unexpected error')
      : 'Internal server error';

  return {
    statusCode: 500,
    body: {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message,
      },
    },
  };
}

function sendError(res, error) {
  const payload = toErrorPayload(error);
  return res.status(payload.statusCode).json(payload.body);
}

module.exports = {
  sendSuccess,
  sendError,
  toErrorPayload,
};
