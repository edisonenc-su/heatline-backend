const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin, canAccessCustomer } = require('../middleware/auth');
const { success, fail, asyncHandler } = require('../utils/http');

const router = express.Router();

function normalizeCustomer(row) {
  return {
    id: row.id,
    company_name: row.company_name,
    contact_name: row.contact_name,
    contact_phone: row.contact_phone,
    contact_email: row.contact_email,
    address: row.address,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = await db.query(`SELECT * FROM customers ORDER BY id DESC`);
  } else {
    rows = await db.query(`SELECT * FROM customers WHERE id = ? ORDER BY id DESC`, [req.user.customer_id]);
  }
  return success(res, rows.map(normalizeCustomer));
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessCustomer(req.user, id)) {
    return fail(res, 403, '이 고객사에 접근할 권한이 없습니다.', 'FORBIDDEN');
  }

  const rows = await db.query(`SELECT * FROM customers WHERE id = ? LIMIT 1`, [id]);
  const row = rows[0];
  if (!row) return fail(res, 404, '고객사를 찾을 수 없습니다.', 'CUSTOMER_NOT_FOUND');
  return success(res, normalizeCustomer(row));
}));

router.post('/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const { company_name, contact_name = null, contact_phone = null, contact_email = null, address = null, is_active = true } = req.body || {};

  if (!company_name) {
    return fail(res, 400, 'company_name 이 필요합니다.', 'VALIDATION_ERROR');
  }

  const result = await db.query(
    `INSERT INTO customers (company_name, contact_name, contact_phone, contact_email, address, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [company_name, contact_name, contact_phone, contact_email, address, is_active ? 1 : 0]
  );

  const rows = await db.query(`SELECT * FROM customers WHERE id = ? LIMIT 1`, [result.insertId]);
  return success(res, normalizeCustomer(rows[0]), {}, 201);
}));

router.put('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { company_name, contact_name = null, contact_phone = null, contact_email = null, address = null, is_active = true } = req.body || {};

  if (!company_name) {
    return fail(res, 400, 'company_name 이 필요합니다.', 'VALIDATION_ERROR');
  }

  await db.query(
    `UPDATE customers
        SET company_name = ?,
            contact_name = ?,
            contact_phone = ?,
            contact_email = ?,
            address = ?,
            is_active = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [company_name, contact_name, contact_phone, contact_email, address, is_active ? 1 : 0, id]
  );

  const rows = await db.query(`SELECT * FROM customers WHERE id = ? LIMIT 1`, [id]);
  if (!rows[0]) return fail(res, 404, '고객사를 찾을 수 없습니다.', 'CUSTOMER_NOT_FOUND');
  return success(res, normalizeCustomer(rows[0]));
}));

router.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.query(`SELECT * FROM customers WHERE id = ? LIMIT 1`, [id]);
  const row = rows[0];
  if (!row) return fail(res, 404, '고객사를 찾을 수 없습니다.', 'CUSTOMER_NOT_FOUND');

  const controllerCountRows = await db.query(
    `SELECT COUNT(*) AS count FROM controllers WHERE customer_id = ?`,
    [id]
  );
  const controllerCount = Number(controllerCountRows[0]?.count || 0);
  if (controllerCount > 0) {
    return fail(
      res,
      409,
      `이 고객사에 연결된 장비 ${controllerCount}대를 먼저 삭제하거나 다른 고객사로 이동해주세요.`,
      'CUSTOMER_HAS_CONTROLLERS'
    );
  }

  const userCountRows = await db.query(
    `SELECT COUNT(*) AS count FROM users WHERE customer_id = ?`,
    [id]
  );
  const userCount = Number(userCountRows[0]?.count || 0);

  if (userCount > 0) {
    await db.query(
      `UPDATE users
          SET customer_id = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE customer_id = ?`,
      [id]
    );
  }

  await db.query(`DELETE FROM customers WHERE id = ?`, [id]);
  return success(res, {
    id,
    deleted: true,
    company_name: row.company_name,
    detached_user_count: userCount
  }, {
    message: userCount > 0
      ? `고객사를 삭제했고 연결된 사용자 ${userCount}명의 고객사 연결을 자동 해제했습니다.`
      : '고객사를 삭제했습니다.'
  });
}));

module.exports = router;
