const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { success, asyncHandler } = require('../utils/http');

const router = express.Router();

router.get('/control-logs', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const params = [];
  let where = '';

  if (req.user.role !== 'admin') {
    where = 'WHERE c.customer_id = ?';
    params.push(req.user.customer_id);
  }

  params.push(limit);

  const rows = await db.query(
    `SELECT cl.*, c.controller_name, c.customer_id
       FROM control_logs cl
       JOIN controllers c ON c.id = cl.controller_id
       ${where}
      ORDER BY cl.id DESC
      LIMIT ?`,
    params
  );

  return success(res, rows);
}));

router.get('/event-logs', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const params = [];
  let where = '';

  if (req.user.role !== 'admin') {
    where = 'WHERE c.customer_id = ?';
    params.push(req.user.customer_id);
  }

  params.push(limit);

  const rows = await db.query(
    `SELECT e.*, c.controller_name, c.customer_id
       FROM event_logs e
       JOIN controllers c ON c.id = e.controller_id
       ${where}
      ORDER BY e.id DESC
      LIMIT ?`,
    params
  );

  return success(res, rows);
}));

router.get('/dashboard/summary', requireAuth, asyncHandler(async (req, res) => {
  const params = [];
  let where = '';

  if (req.user.role !== 'admin') {
    where = 'WHERE customer_id = ?';
    params.push(req.user.customer_id);
  }

  const rows = await db.query(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) AS online_count,
        SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) AS offline_count,
        SUM(CASE WHEN status = 'warning' THEN 1 ELSE 0 END) AS warning_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
        SUM(CASE WHEN heater_on = 1 THEN 1 ELSE 0 END) AS heater_on_count,
        SUM(CASE WHEN snow_detected = 1 THEN 1 ELSE 0 END) AS snow_detected_count
      FROM controllers
      ${where}`,
    params
  );

  return success(res, rows[0] || {});
}));

module.exports = router;
