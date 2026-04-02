const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { success, fail, asyncHandler } = require('../utils/http');
const { requireAuth, signUserToken } = require('../middleware/auth');

const router = express.Router();

function normalizeUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    customer_id: row.customer_id,
    full_name: row.full_name,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return fail(res, 400, 'username 과 password 가 필요합니다.', 'VALIDATION_ERROR');
  }

  const rows = await db.query(
    `SELECT id, username, password_hash, role, customer_id, full_name, is_active, created_at, updated_at
     FROM users
     WHERE username = ?
     LIMIT 1`,
    [username]
  );

  const user = rows[0];
  if (!user || !user.is_active) {
    return fail(res, 401, '아이디 또는 비밀번호가 올바르지 않습니다.', 'LOGIN_FAILED');
  }

  const matched = await bcrypt.compare(password, user.password_hash);
  if (!matched) {
    return fail(res, 401, '아이디 또는 비밀번호가 올바르지 않습니다.', 'LOGIN_FAILED');
  }

  const token = signUserToken(user);
  const safeUser = normalizeUserRow(user);

  return success(res, {
    token,
    user: safeUser,
    session: {
      user_id: safeUser.id,
      username: safeUser.username,
      role: safeUser.role,
      customer_id: safeUser.customer_id,
      full_name: safeUser.full_name
    }
  });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const rows = await db.query(
    `SELECT id, username, role, customer_id, full_name, is_active, created_at, updated_at
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [req.user.user_id]
  );

  const user = normalizeUserRow(rows[0]);
  if (!user) {
    return fail(res, 404, '사용자를 찾을 수 없습니다.', 'USER_NOT_FOUND');
  }

  return success(res, user);
}));

module.exports = router;
