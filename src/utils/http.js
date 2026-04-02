function success(res, data = {}, meta = {}, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    meta: {
      server_time: new Date().toISOString(),
      ...meta
    }
  });
}

function fail(res, status, message, code = 'REQUEST_FAILED', extra = {}) {
  return res.status(status).json({
    success: false,
    error: {
      code,
      message,
      ...extra
    },
    meta: {
      server_time: new Date().toISOString()
    }
  });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  success,
  fail,
  asyncHandler
};
