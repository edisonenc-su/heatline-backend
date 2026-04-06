const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { fail } = require('../utils/http');

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

function getDeviceToken(req) {
  const headerToken = req.headers['x-device-token'];
  if (headerToken) return String(headerToken).trim();
  return getBearerToken(req);
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

function hashOpaqueToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function tokenHashMatches(token, storedHash) {
  if (!token || !storedHash) return false;
  const actual = Buffer.from(hashOpaqueToken(token));
  const expected = Buffer.from(String(storedHash));
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function issueOpaqueToken(prefix = 'hl') {
  return `${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
}

function requireDeviceToken(req, res, next) {
  const token = getDeviceToken(req);
  if (!token || token !== env.deviceSharedToken) {
    return fail(res, 401, '장비 인증 토큰이 올바르지 않습니다.', 'INVALID_DEVICE_TOKEN');
  }
  req.deviceAuth = { mode: 'shared' };
  return next();
}

function requireControllerDeviceAuth(loadControllerFn) {
  return async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return fail(res, 400, '유효한 장비 ID가 필요합니다.', 'VALIDATION_ERROR');
      }

      const controller = await loadControllerFn(id);
      if (!controller) {
        return fail(res, 404, '장비를 찾을 수 없습니다.', 'CONTROLLER_NOT_FOUND');
      }

      const token = getDeviceToken(req);
      if (!token) {
        return fail(res, 401, '장비 인증 토큰이 필요합니다.', 'UNAUTHORIZED');
      }

      if (controller.device_sync_token_hash && tokenHashMatches(token, controller.device_sync_token_hash)) {
        req.controller = controller;
        req.deviceAuth = { mode: 'controller', controller_id: controller.id };
        return next();
      }

      if (env.allowLegacySharedDeviceToken && env.deviceSharedToken && token === env.deviceSharedToken) {
        req.controller = controller;
        req.deviceAuth = { mode: 'shared', controller_id: controller.id };
        return next();
      }

      return fail(res, 401, '장비 인증 토큰이 올바르지 않습니다.', 'INVALID_DEVICE_TOKEN');
    } catch (error) {
      return next(error);
    }
  };
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
  requireControllerDeviceAuth,
  getDeviceToken,
  hashOpaqueToken,
  issueOpaqueToken,
  tokenHashMatches,
  canAccessCustomer
};
