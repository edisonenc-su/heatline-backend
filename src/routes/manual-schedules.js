const express = require('express');
const db = require('../config/db');
const env = require('../config/env');
const {
  requireAuth,
  canAccessCustomer
} = require('../middleware/auth');
const { success, fail, asyncHandler } = require('../utils/http');

const router = express.Router();

function normalizeDaysOfWeek(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => a - b);
  }

  return String(value || '')
    .split(',')
    .map((v) => Number(String(v).trim()))
    .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => a - b);
}

function normalizeSchedule(row) {
  if (!row) return null;
  const days = normalizeDaysOfWeek(row.days_of_week);
  return {
    id: row.id,
    controller_id: row.controller_id,
    name: row.name,
    schedule_type: row.schedule_type,
    enabled: Boolean(row.enabled),
    days_of_week: days,
    start_time: row.start_time,
    end_time: row.end_time,
    once_started_at: row.once_started_at,
    once_ended_at: row.once_ended_at,
    preheat_minutes: Number(row.preheat_minutes || 0),
    priority: Number(row.priority || 50),
    offline_enabled: Boolean(row.offline_enabled),
    min_temperature: row.min_temperature !== null ? Number(row.min_temperature) : null,
    max_temperature: row.max_temperature !== null ? Number(row.max_temperature) : null,
    source: row.source || 'central',
    note: row.note || '',
    last_synced_at: row.last_synced_at,
    created_at: row.created_at,
    updated_at: row.updated_at
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

function validateSchedulePayload(payload = {}) {
  const scheduleType = String(payload.schedule_type || '').trim().toLowerCase();
  if (!payload.name || !scheduleType) {
    return 'name, schedule_type 은 필수입니다.';
  }

  if (!['weekly', 'once'].includes(scheduleType)) {
    return 'schedule_type 은 weekly 또는 once 여야 합니다.';
  }

  if (scheduleType === 'weekly') {
    const days = normalizeDaysOfWeek(payload.days_of_week);
    if (!days.length) return 'weekly 스케줄은 days_of_week 가 필요합니다.';
    if (!payload.start_time || !payload.end_time) return 'weekly 스케줄은 start_time, end_time 이 필요합니다.';
  }

  if (scheduleType === 'once') {
    if (!payload.once_started_at || !payload.once_ended_at) {
      return 'once 스케줄은 once_started_at, once_ended_at 이 필요합니다.';
    }
    if (new Date(payload.once_started_at).toString() === 'Invalid Date' || new Date(payload.once_ended_at).toString() === 'Invalid Date') {
      return 'once 스케줄 일시 형식이 올바르지 않습니다.';
    }
  }

  return null;
}

async function loadManualSchedules(controllerId) {
  const rows = await db.query(
    `SELECT *
       FROM manual_schedules
      WHERE controller_id = ?
      ORDER BY priority DESC, id ASC`,
    [controllerId]
  );
  return rows.map(normalizeSchedule);
}

function buildSyncPayload(schedules = []) {
  return schedules.map((item) => ({
    id: item.id,
    name: item.name,
    schedule_type: item.schedule_type,
    enabled: item.enabled,
    days_of_week: item.days_of_week,
    start_time: item.start_time,
    end_time: item.end_time,
    once_started_at: item.once_started_at,
    once_ended_at: item.once_ended_at,
    preheat_minutes: item.preheat_minutes,
    priority: item.priority,
    offline_enabled: item.offline_enabled,
    min_temperature: item.min_temperature,
    max_temperature: item.max_temperature,
    source: 'central',
    note: item.note
  }));
}

async function proxyCommandToDevice(controller, body, authUser) {
  if (!env.autoProxyDeviceCommands || !controller.device_api_base) {
    return { proxied: false, status: 'queued', message: '장비 프록시가 비활성화되어 스케줄을 중앙 DB에만 반영했습니다.' };
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
  if (!response.ok || data.success === false || data.ok === false) {
    const msg = data?.error?.message || data?.message || `장비 프록시 오류 (${response.status})`;
    throw new Error(msg);
  }

  return {
    proxied: true,
    status: 'success',
    message: data?.meta?.message || data?.message || '장비에 수동 스케줄을 동기화했습니다.',
    device_response: data
  };
}

async function syncSchedulesToDevice(controller, authUser, reason = '중앙 수동 스케줄 동기화') {
  const schedules = await loadManualSchedules(controller.id);
  const result = await proxyCommandToDevice(controller, {
    command_type: 'SYNC_MANUAL_SCHEDULES',
    command_value: {
      schedules: buildSyncPayload(schedules)
    },
    reason,
    requested_by: {
      user_id: authUser.user_id,
      user_name: authUser.full_name || authUser.username || 'unknown'
    }
  }, authUser);

  await db.query(
    `UPDATE manual_schedules
        SET last_synced_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE controller_id = ?`,
    [controller.id]
  );

  await db.query(
    `UPDATE controllers
        SET last_schedule_sync_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [controller.id]
  );

  return {
    ...result,
    schedules
  };
}

router.get('/controllers/:id/manual-schedules/summary', requireAuth, ensureControllerAccess, asyncHandler(async (req, res) => {
  const controllerId = Number(req.params.id);
  const rows = await loadManualSchedules(controllerId);
  const enabledCount = rows.filter((row) => row.enabled).length;
  const offlineEnabledCount = rows.filter((row) => row.enabled && row.offline_enabled).length;
  return success(res, {
    controller_id: controllerId,
    total: rows.length,
    enabled: enabledCount,
    offline_enabled: offlineEnabledCount,
    current_control_source: req.controller.current_control_source || 'idle',
    offline_mode: Boolean(req.controller.offline_mode),
    last_schedule_sync_at: req.controller.last_schedule_sync_at || null,
    active_schedule_name: req.controller.active_schedule_name || null
  });
}));

router.get('/controllers/:id/manual-schedules', requireAuth, ensureControllerAccess, asyncHandler(async (req, res) => {
  const items = await loadManualSchedules(Number(req.params.id));
  return success(res, { items });
}));

router.post('/controllers/:id/manual-schedules', requireAuth, ensureControllerAccess, ensureControllerControl, asyncHandler(async (req, res) => {
  const controllerId = Number(req.params.id);
  const error = validateSchedulePayload(req.body || {});
  if (error) return fail(res, 400, error, 'VALIDATION_ERROR');

  const payload = req.body || {};
  const days = normalizeDaysOfWeek(payload.days_of_week);
  const result = await db.query(
    `INSERT INTO manual_schedules (
      controller_id, name, schedule_type, enabled, days_of_week,
      start_time, end_time, once_started_at, once_ended_at,
      preheat_minutes, priority, offline_enabled,
      min_temperature, max_temperature, source, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'central', ?)`,
    [
      controllerId,
      String(payload.name).trim(),
      String(payload.schedule_type).trim().toLowerCase(),
      payload.enabled === false ? 0 : 1,
      days.join(','),
      payload.start_time || null,
      payload.end_time || null,
      payload.once_started_at || null,
      payload.once_ended_at || null,
      Math.max(0, Number(payload.preheat_minutes || 0)),
      Math.max(0, Number(payload.priority || 50)),
      payload.offline_enabled === false ? 0 : 1,
      payload.min_temperature ?? null,
      payload.max_temperature ?? null,
      payload.note || ''
    ]
  );

  const rows = await db.query(`SELECT * FROM manual_schedules WHERE id = ? LIMIT 1`, [result.insertId]);
  const created = normalizeSchedule(rows[0]);

  let sync = null;
  try {
    sync = await syncSchedulesToDevice(req.controller, req.user, '중앙 수동 스케줄 생성 동기화');
  } catch (syncError) {
    await db.query(
      `INSERT INTO event_logs (controller_id, event_type, message, severity, payload_json)
       VALUES (?, 'MANUAL_SCHEDULE_SYNC_FAILED', ?, 'warning', ?)`,
      [controllerId, syncError.message, JSON.stringify({ schedule_id: result.insertId })]
    );
  }

  return success(res, created, {
    sync_message: sync?.message || '장비 동기화는 다음 주기 또는 재동기화 시 반영됩니다.'
  }, 201);
}));

router.put('/controllers/:id/manual-schedules/:scheduleId', requireAuth, ensureControllerAccess, ensureControllerControl, asyncHandler(async (req, res) => {
  const controllerId = Number(req.params.id);
  const scheduleId = Number(req.params.scheduleId);
  const error = validateSchedulePayload(req.body || {});
  if (error) return fail(res, 400, error, 'VALIDATION_ERROR');

  const existing = await db.query(`SELECT * FROM manual_schedules WHERE id = ? AND controller_id = ? LIMIT 1`, [scheduleId, controllerId]);
  if (!existing[0]) return fail(res, 404, '스케줄을 찾을 수 없습니다.', 'SCHEDULE_NOT_FOUND');

  const payload = req.body || {};
  const days = normalizeDaysOfWeek(payload.days_of_week);
  await db.query(
    `UPDATE manual_schedules
        SET name = ?,
            schedule_type = ?,
            enabled = ?,
            days_of_week = ?,
            start_time = ?,
            end_time = ?,
            once_started_at = ?,
            once_ended_at = ?,
            preheat_minutes = ?,
            priority = ?,
            offline_enabled = ?,
            min_temperature = ?,
            max_temperature = ?,
            note = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND controller_id = ?`,
    [
      String(payload.name).trim(),
      String(payload.schedule_type).trim().toLowerCase(),
      payload.enabled === false ? 0 : 1,
      days.join(','),
      payload.start_time || null,
      payload.end_time || null,
      payload.once_started_at || null,
      payload.once_ended_at || null,
      Math.max(0, Number(payload.preheat_minutes || 0)),
      Math.max(0, Number(payload.priority || 50)),
      payload.offline_enabled === false ? 0 : 1,
      payload.min_temperature ?? null,
      payload.max_temperature ?? null,
      payload.note || '',
      scheduleId,
      controllerId
    ]
  );

  const rows = await db.query(`SELECT * FROM manual_schedules WHERE id = ? LIMIT 1`, [scheduleId]);
  const updated = normalizeSchedule(rows[0]);

  let sync = null;
  try {
    sync = await syncSchedulesToDevice(req.controller, req.user, '중앙 수동 스케줄 수정 동기화');
  } catch (syncError) {
    await db.query(
      `INSERT INTO event_logs (controller_id, event_type, message, severity, payload_json)
       VALUES (?, 'MANUAL_SCHEDULE_SYNC_FAILED', ?, 'warning', ?)`,
      [controllerId, syncError.message, JSON.stringify({ schedule_id: scheduleId })]
    );
  }

  return success(res, updated, {
    sync_message: sync?.message || '장비 동기화는 다음 주기 또는 재동기화 시 반영됩니다.'
  });
}));

router.delete('/controllers/:id/manual-schedules/:scheduleId', requireAuth, ensureControllerAccess, ensureControllerControl, asyncHandler(async (req, res) => {
  const controllerId = Number(req.params.id);
  const scheduleId = Number(req.params.scheduleId);
  const rows = await db.query(`SELECT * FROM manual_schedules WHERE id = ? AND controller_id = ? LIMIT 1`, [scheduleId, controllerId]);
  if (!rows[0]) return fail(res, 404, '스케줄을 찾을 수 없습니다.', 'SCHEDULE_NOT_FOUND');

  await db.query(`DELETE FROM manual_schedules WHERE id = ? AND controller_id = ?`, [scheduleId, controllerId]);

  let sync = null;
  try {
    sync = await syncSchedulesToDevice(req.controller, req.user, '중앙 수동 스케줄 삭제 동기화');
  } catch (syncError) {
    await db.query(
      `INSERT INTO event_logs (controller_id, event_type, message, severity, payload_json)
       VALUES (?, 'MANUAL_SCHEDULE_SYNC_FAILED', ?, 'warning', ?)`,
      [controllerId, syncError.message, JSON.stringify({ schedule_id: scheduleId })]
    );
  }

  return success(res, {
    id: scheduleId,
    deleted: true
  }, {
    sync_message: sync?.message || '장비 동기화는 다음 주기 또는 재동기화 시 반영됩니다.'
  });
}));

router.post('/controllers/:id/manual-schedules/sync', requireAuth, ensureControllerAccess, ensureControllerControl, asyncHandler(async (req, res) => {
  const result = await syncSchedulesToDevice(req.controller, req.user, '중앙 수동 스케줄 수동 재동기화');
  return success(res, {
    controller_id: req.controller.id,
    count: result.schedules.length,
    proxied: result.proxied
  }, {
    message: result.message
  });
}));

module.exports = router;
