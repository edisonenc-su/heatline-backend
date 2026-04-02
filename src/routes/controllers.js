const express = require('express');
const env = require('../config/env');
const db = require('../config/db');
const { requireAuth, requireAdmin, requireDeviceToken, canAccessCustomer } = require('../middleware/auth');
const { success, fail, asyncHandler } = require('../utils/http');

const router = express.Router();

function normalizeController(row) {
  if (!row) return null;
  return {
    id: row.id,
    customer_id: row.customer_id,
    controller_name: row.controller_name,
    serial_no: row.serial_no,
    install_address: row.install_address,
    install_location: row.install_location,
    latitude: row.latitude !== null ? Number(row.latitude) : null,
    longitude: row.longitude !== null ? Number(row.longitude) : null,
    installed_at: row.installed_at,
    as_expire_at: row.as_expire_at,
    status: row.status,
    snow_detected: Boolean(row.snow_detected),
    heater_on: Boolean(row.heater_on),
    temperature: row.temperature !== null ? Number(row.temperature) : null,
    humidity: row.humidity !== null ? Number(row.humidity) : null,
    heater_mode: row.heater_mode,
    snow_threshold: row.snow_threshold !== null ? Number(row.snow_threshold) : null,
    camera_url: row.camera_url,
    device_api_base: row.device_api_base,
    allow_customer_control: Boolean(row.allow_customer_control),
    last_seen_at: row.last_seen_at,
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    customer_name: row.customer_name || undefined
  };
}

function normalizeEvent(row) {
  return {
    id: row.id,
    controller_id: row.controller_id,
    event_type: row.event_type,
    message: row.message,
    severity: row.severity,
    payload_json: row.payload_json,
    created_at: row.created_at
  };
}

function normalizeControlLog(row) {
  return {
    id: row.id,
    controller_id: row.controller_id,
    user_id: row.user_id,
    user_name: row.user_name,
    command_type: row.command_type,
    command_value: row.command_value,
    result: row.result,
    note: row.note,
    requested_at: row.requested_at,
    finished_at: row.finished_at,
    created_at: row.created_at
  };
}

async function loadControllerOrFail(id) {
  const rows = await db.query(
    `SELECT c.*, cu.company_name AS customer_name
       FROM controllers c
       JOIN customers cu ON cu.id = c.customer_id
      WHERE c.id = ?
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function ensureControllerAccess(req, res, next) {
  const id = Number(req.params.id);
  const row = await loadControllerOrFail(id);
  if (!row) return fail(res, 404, '장비를 찾을 수 없습니다.', 'CONTROLLER_NOT_FOUND');
  if (!canAccessCustomer(req.user, row.customer_id)) {
    return fail(res, 403, '이 장비에 접근할 권한이 없습니다.', 'FORBIDDEN');
  }
  req.controller = row;
  next();
}

async function ensureControllerControl(req, res, next) {
  const row = req.controller;
  if (req.user.role === 'admin') return next();
  if (String(req.user.customer_id || '') === String(row.customer_id) && row.allow_customer_control) return next();
  return fail(res, 403, '이 장비를 제어할 권한이 없습니다.', 'FORBIDDEN');
}

async function proxyCommandToDevice(controller, body, authUser) {
  if (!env.autoProxyDeviceCommands || !controller.device_api_base) {
    return { proxied: false, status: 'queued', message: '장비 프록시가 비활성화되어 명령을 중앙 서버에만 기록했습니다.' };
  }

  const url = `${String(controller.device_api_base).replace(/\/+$/, '')}/commands`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Role': authUser.role,
      'X-User-Id': String(authUser.user_id),
      'X-User-Name': authUser.full_name || authUser.username || 'unknown',
      'X-Customer-Id': String(authUser.customer_id || ''),
      'X-Controller-Serial': controller.serial_no || ''
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(env.requestTimeoutMs)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) {
    const msg = data?.error?.message || data?.message || `장비 프록시 오류 (${response.status})`;
    throw new Error(msg);
  }

  return {
    proxied: true,
    status: 'success',
    message: data?.meta?.message || '장비 서버에 명령을 전달했습니다.',
    device_response: data
  };
}

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { status, customer_id, q } = req.query;
  const where = [];
  const params = [];

  if (req.user.role !== 'admin') {
    where.push('c.customer_id = ?');
    params.push(req.user.customer_id);
  } else if (customer_id) {
    where.push('c.customer_id = ?');
    params.push(customer_id);
  }

  if (status) {
    where.push('c.status = ?');
    params.push(status);
  }

  if (q) {
    where.push('(c.controller_name LIKE ? OR c.serial_no LIKE ? OR c.install_address LIKE ? OR c.install_location LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const rows = await db.query(
    `SELECT c.*, cu.company_name AS customer_name
       FROM controllers c
       JOIN customers cu ON cu.id = c.customer_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.id DESC`,
    params
  );

  return success(res, rows.map(normalizeController));
}));

router.post('/', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const {
    customer_id,
    controller_name,
    serial_no,
    install_address,
    install_location,
    latitude = null,
    longitude = null,
    status = 'offline',
    snow_detected = false,
    heater_on = false,
    temperature = null,
    humidity = null,
    heater_mode = 'auto',
    snow_threshold = 0.8,
    camera_url = null,
    device_api_base,
    allow_customer_control = true,
    as_expire_at = null,
    note = ''
  } = req.body || {};

  if (!customer_id || !controller_name || !serial_no || !install_address || !install_location || !device_api_base) {
    return fail(res, 400, '필수 항목이 누락되었습니다.', 'VALIDATION_ERROR');
  }

  const dup = await db.query(`SELECT id FROM controllers WHERE serial_no = ? LIMIT 1`, [serial_no]);
  if (dup[0]) {
    return fail(res, 409, '이미 등록된 시리얼 번호입니다.', 'DUPLICATE_SERIAL');
  }

  const result = await db.query(
    `INSERT INTO controllers (
      customer_id, controller_name, serial_no, install_address, install_location,
      latitude, longitude, installed_at, as_expire_at,
      status, snow_detected, heater_on, temperature, humidity,
      heater_mode, snow_threshold, camera_url, device_api_base,
      allow_customer_control, last_seen_at, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      customer_id, controller_name, serial_no, install_address, install_location,
      latitude, longitude, as_expire_at,
      status, snow_detected ? 1 : 0, heater_on ? 1 : 0, temperature, humidity,
      heater_mode, snow_threshold, camera_url, device_api_base,
      allow_customer_control ? 1 : 0, note
    ]
  );

  const created = await loadControllerOrFail(result.insertId);
  return success(res, normalizeController(created), {}, 201);
}));

router.get('/:id', requireAuth, ensureControllerAccess, asyncHandler(async (req, res) => {
  return success(res, normalizeController(req.controller));
}));

router.put('/:id', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const {
    customer_id,
    controller_name,
    serial_no,
    install_address,
    install_location,
    latitude = null,
    longitude = null,
    as_expire_at = null,
    camera_url = null,
    device_api_base,
    heater_mode = 'auto',
    snow_threshold = 0.8,
    allow_customer_control = true,
    note = ''
  } = req.body || {};

  if (!customer_id || !controller_name || !serial_no || !install_address || !install_location || !device_api_base) {
    return fail(res, 400, '필수 항목이 누락되었습니다.', 'VALIDATION_ERROR');
  }

  await db.query(
    `UPDATE controllers
        SET customer_id = ?, controller_name = ?, serial_no = ?, install_address = ?, install_location = ?,
            latitude = ?, longitude = ?, as_expire_at = ?, camera_url = ?, device_api_base = ?,
            heater_mode = ?, snow_threshold = ?, allow_customer_control = ?, note = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [customer_id, controller_name, serial_no, install_address, install_location, latitude, longitude, as_expire_at, camera_url, device_api_base, heater_mode, snow_threshold, allow_customer_control ? 1 : 0, note, id]
  );

  const updated = await loadControllerOrFail(id);
  if (!updated) return fail(res, 404, '장비를 찾을 수 없습니다.', 'CONTROLLER_NOT_FOUND');
  return success(res, normalizeController(updated));
}));

router.put('/:id/status', requireDeviceToken, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const {
    status = 'online',
    snow_detected = false,
    heater_on = false,
    temperature = null,
    humidity = null,
    heater_mode = 'auto',
    snow_threshold = 0.8,
    camera_url = null,
    device_api_base = null,
    last_seen_at = new Date().toISOString()
  } = req.body || {};

  await db.query(
    `UPDATE controllers
        SET status = ?, snow_detected = ?, heater_on = ?, temperature = ?, humidity = ?,
            heater_mode = ?, snow_threshold = ?, camera_url = COALESCE(?, camera_url),
            device_api_base = COALESCE(?, device_api_base), last_seen_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [status, snow_detected ? 1 : 0, heater_on ? 1 : 0, temperature, humidity, heater_mode, snow_threshold, camera_url, device_api_base, last_seen_at, id]
  );

  const row = await loadControllerOrFail(id);
  if (!row) return fail(res, 404, '장비를 찾을 수 없습니다.', 'CONTROLLER_NOT_FOUND');

  return success(res, normalizeController(row));
}));

router.post('/:id/heartbeat', requireDeviceToken, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  await db.query(
    `UPDATE controllers
        SET last_seen_at = CURRENT_TIMESTAMP,
            status = COALESCE(?, status),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [req.body?.status || 'online', id]
  );
  return success(res, { controller_id: id, last_seen_at: new Date().toISOString() });
}));

router.post('/:id/events', requireDeviceToken, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { event_type, message = '', severity = 'info', payload = null } = req.body || {};
  if (!event_type) {
    return fail(res, 400, 'event_type 이 필요합니다.', 'VALIDATION_ERROR');
  }

  const result = await db.query(
    `INSERT INTO event_logs (controller_id, event_type, message, severity, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
    [id, event_type, message, severity, payload ? JSON.stringify(payload) : null]
  );

  const rows = await db.query(`SELECT * FROM event_logs WHERE id = ? LIMIT 1`, [result.insertId]);
  return success(res, normalizeEvent(rows[0]), {}, 201);
}));

router.get('/:id/events', requireAuth, ensureControllerAccess, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const limit = Math.min(Number(req.query.limit || 10), 100);
  const rows = await db.query(
    `SELECT *
       FROM event_logs
      WHERE controller_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    [id, limit]
  );
  return success(res, { items: rows.map(normalizeEvent) });
}));

router.get('/:id/control-logs', requireAuth, ensureControllerAccess, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const limit = Math.min(Number(req.query.limit || 10), 100);
  const rows = await db.query(
    `SELECT *
       FROM control_logs
      WHERE controller_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    [id, limit]
  );
  return success(res, { items: rows.map(normalizeControlLog) });
}));

router.post('/:id/commands', requireAuth, ensureControllerAccess, ensureControllerControl, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { command_type, command_value = null, reason = '', requested_by = null } = req.body || {};

  if (!command_type) {
    return fail(res, 400, 'command_type 이 필요합니다.', 'VALIDATION_ERROR');
  }

  const controller = req.controller;
  const requestedUserId = requested_by?.user_id || req.user.user_id;
  const requestedUserName = requested_by?.user_name || req.user.full_name || req.user.username;

  const cmdInsert = await db.query(
    `INSERT INTO commands (
      controller_id, command_type, command_value, reason,
      requested_by_user_id, requested_by_user_name, status, response_message
    ) VALUES (?, ?, ?, ?, ?, ?, 'queued', '명령이 등록되었습니다.')`,
    [id, command_type, command_value === null ? null : String(command_value), reason, requestedUserId, requestedUserName]
  );

  let proxyResult;
  try {
    proxyResult = await proxyCommandToDevice(controller, { command_type, command_value, reason, requested_by }, req.user);
    await db.query(
      `UPDATE commands
          SET status = ?, response_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [proxyResult.status, proxyResult.message, cmdInsert.insertId]
    );

    await db.query(
      `INSERT INTO control_logs (
        controller_id, user_id, user_name, command_type, command_value, result, note, requested_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, requestedUserId, requestedUserName, command_type, command_value === null ? null : String(command_value), 'success', proxyResult.message]
    );
  } catch (error) {
    await db.query(
      `UPDATE commands
          SET status = 'failed', response_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [error.message, cmdInsert.insertId]
    );

    await db.query(
      `INSERT INTO control_logs (
        controller_id, user_id, user_name, command_type, command_value, result, note, requested_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, requestedUserId, requestedUserName, command_type, command_value === null ? null : String(command_value), 'failed', error.message]
    );

    return fail(res, 502, `장비 명령 전달 실패: ${error.message}`, 'DEVICE_PROXY_FAILED');
  }

  const rows = await db.query(`SELECT * FROM commands WHERE id = ? LIMIT 1`, [cmdInsert.insertId]);
  return success(res, rows[0], { message: proxyResult.message }, 201);
}));

module.exports = router;
