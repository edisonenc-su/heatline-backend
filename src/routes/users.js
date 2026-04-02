const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { success, fail, asyncHandler } = require('../utils/http');

const router = express.Router();

function normalizeUser(row) {
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

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = await db.query(
      `SELECT id, username, role, customer_id, full_name, is_active, created_at, updated_at
       FROM users
       ORDER BY id DESC`
    );
  } else {
    rows = await db.query(
      `SELECT id, username, role, customer_id, full_name, is_active, created_at, updated_at
       FROM users
       WHERE id = ?`,
      [req.user.user_id]
    );
  }

  return success(res, rows.map(normalizeUser));
}));

router.post('/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { username, password, role, customer_id = null, full_name = null, is_active = true } = req.body || {};

  if (!username || !password || !role) {
    return fail(res, 400, 'username, password, role 이 필요합니다.', 'VALIDATION_ERROR');
  }

  if (!['admin', 'customer'].includes(role)) {
    return fail(res, 400, 'role 은 admin 또는 customer 이어야 합니다.', 'VALIDATION_ERROR');
  }

  if (role === 'customer' && !customer_id) {
    return fail(res, 400, 'customer 사용자에는 customer_id 가 필요합니다.', 'VALIDATION_ERROR');
  }

  const exists = await db.query(`SELECT id FROM users WHERE username = ? LIMIT 1`, [username]);
  if (exists[0]) {
    return fail(res, 409, '이미 존재하는 사용자명입니다.', 'DUPLICATE_USERNAME');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await db.query(
    `INSERT INTO users (username, password_hash, role, customer_id, full_name, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [username, passwordHash, role, customer_id, full_name, is_active ? 1 : 0]
  );

  const rows = await db.query(
    `SELECT id, username, role, customer_id, full_name, is_active, created_at, updated_at
     FROM users
     WHERE id = ? LIMIT 1`,
    [result.insertId]
  );

  return success(res, normalizeUser(rows[0]), {}, 201);
}));

router.put('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { password, role, customer_id = null, full_name = null, is_active = true } = req.body || {};

  if (!['admin', 'customer'].includes(role)) {
    return fail(res, 400, 'role 은 admin 또는 customer 이어야 합니다.', 'VALIDATION_ERROR');
  }

  let passwordClause = '';
  const params = [role, customer_id, full_name, is_active ? 1 : 0];

  if (password) {
    const passwordHash = await bcrypt.hash(password, 10);
    passwordClause = ', password_hash = ?';
    params.push(passwordHash);
  }

  params.push(id);

  await db.query(
    `UPDATE users
        SET role = ?,
            customer_id = ?,
            full_name = ?,
            is_active = ?
            ${passwordClause},
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    params
  );

  const rows = await db.query(
    `SELECT id, username, role, customer_id, full_name, is_active, created_at, updated_at
     FROM users
     WHERE id = ? LIMIT 1`,
    [id]
  );

  if (!rows[0]) return fail(res, 404, '사용자를 찾을 수 없습니다.', 'USER_NOT_FOUND');
  return success(res, normalizeUser(rows[0]));
}));

module.exports = router;
