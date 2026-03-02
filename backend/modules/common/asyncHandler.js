const { sendError } = require('./apiResponse');

function asyncHandler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      return sendError(res, error);
    }
  };
}

module.exports = { asyncHandler };
