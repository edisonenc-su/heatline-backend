const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { fail } = require('../utils/http');

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

function signUserToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      user_id: user.id,
      username: user.username,
      role: user.role,
      customer_id: user.customer_id || null,
      full_name: user.full_name || null
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return fail(res, 401, '인증 토큰이 필요합니다.', 'UNAUTHORIZED');
  }

  try {
    req.user = jwt.verify(token, env.jwtSecret);
    return next();
  } catch (error) {
    return fail(res, 401, '유효하지 않은 토큰입니다.', 'INVALID_TOKEN');
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return fail(res, 401, '인증 정보가 없습니다.', 'UNAUTHORIZED');
  }
  if (req.user.role !== 'admin') {
    return fail(res, 403, '관리자 권한이 필요합니다.', 'FORBIDDEN');
  }
  return next();
}

function requireDeviceToken(req, res, next) {
  const token = req.headers['x-device-token'];
  if (!token || token !== env.deviceSharedToken) {
    return fail(res, 401, '장비 인증 토큰이 올바르지 않습니다.', 'INVALID_DEVICE_TOKEN');
  }
  return next();
}

function canAccessCustomer(user, customerId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return String(user.customer_id || '') === String(customerId || '');
}

module.exports = {
  signUserToken,
  requireAuth,
  requireAdmin,
  requireDeviceToken,
  canAccessCustomer
};
