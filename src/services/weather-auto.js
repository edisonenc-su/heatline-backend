const db = require('../config/db');
const env = require('../config/env');

const KMA_BASE_URL = 'https://apihub.kma.go.kr';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const VILLAGE_BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];

let schedulerTimer = null;
let schedulerRunning = false;

function toKst(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

function getKstParts(date = new Date()) {
  const kst = toKst(date);
  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  const hour = kst.getUTCHours();
  const minute = kst.getUTCMinutes();
  return {
    year,
    month,
    day,
    hour,
    minute,
    ymd: `${year}${month}${day}`,
    hm: `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`
  };
}

function fromKstDateTime(ymd, hm = '0000') {
  const year = Number(String(ymd).slice(0, 4));
  const month = Number(String(ymd).slice(4, 6));
  const day = Number(String(ymd).slice(6, 8));
  const hour = Number(String(hm).slice(0, 2));
  const minute = Number(String(hm).slice(2, 4));
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0));
}

function toDbDateTime(date) {
  if (!date) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function fromDbDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  return new Date(String(value).replace(' ', 'T') + 'Z');
}

function normalizeDbValue(value) {
  if (value instanceof Date) return toDbDateTime(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

async function updateWeatherState(controllerId, fields) {
  const entries = Object.entries(fields || {});
  if (!entries.length) return;

  const setSql = entries.map(([key]) => `${key} = ?`).join(', ');
  const params = entries.map(([, value]) => normalizeDbValue(value));
  params.push(controllerId);

  await db.query(
    `UPDATE weather_auto_state
        SET ${setSql}, updated_at = CURRENT_TIMESTAMP
      WHERE controller_id = ?`,
    params
  );
}

async function ensureWeatherAutoSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS weather_auto_state (
      controller_id BIGINT UNSIGNED NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      lead_minutes INT NOT NULL DEFAULT 60,
      hold_minutes INT NOT NULL DEFAULT 30,
      trigger_pty VARCHAR(32) NOT NULL DEFAULT '2,3,6,7',
      min_temp DECIMAL(5,2) NULL DEFAULT 3.00,
      kma_nx INT NULL,
      kma_ny INT NULL,
      active_event_key VARCHAR(80) NULL,
      forecast_start_at DATETIME NULL,
      forecast_end_at DATETIME NULL,
      armed_on_at DATETIME NULL,
      armed_off_at DATETIME NULL,
      running TINYINT(1) NOT NULL DEFAULT 0,
      heater_started_at DATETIME NULL,
      heater_stopped_at DATETIME NULL,
      last_checked_at DATETIME NULL,
      last_error TEXT NULL,
      last_message VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (controller_id),
      CONSTRAINT fk_weather_auto_state_controller
        FOREIGN KEY (controller_id) REFERENCES controllers (id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(
    `INSERT IGNORE INTO weather_auto_state (
      controller_id,
      enabled,
      lead_minutes,
      hold_minutes,
      trigger_pty,
      min_temp
    )
    SELECT
      c.id,
      1,
      ?,
      ?,
      ?,
      ?
    FROM controllers c`,
    [
      env.weatherAutoLeadMinutes,
      env.weatherAutoHoldMinutes,
      env.weatherAutoTriggerPty,
      env.weatherAutoMinTemp
    ]
  );
}

async function loadControllersForWeatherAuto() {
  const rows = await db.query(`
    SELECT
      c.*,
      COALESCE(s.enabled, 1) AS weather_enabled,
      COALESCE(s.lead_minutes, 60) AS weather_lead_minutes,
      COALESCE(s.hold_minutes, 30) AS weather_hold_minutes,
      COALESCE(s.trigger_pty, '2,3,6,7') AS weather_trigger_pty,
      COALESCE(s.min_temp, 3.00) AS weather_min_temp,
      s.kma_nx,
      s.kma_ny,
      s.active_event_key,
      s.forecast_start_at,
      s.forecast_end_at,
      s.armed_on_at,
      s.armed_off_at,
      COALESCE(s.running, 0) AS weather_running,
      s.heater_started_at,
      s.heater_stopped_at,
      s.last_checked_at,
      s.last_error,
      s.last_message
    FROM controllers c
    LEFT JOIN weather_auto_state s ON s.controller_id = c.id
    ORDER BY c.id ASC
  `);

  return rows.map((row) => ({
    ...row,
    heater_on: Boolean(row.heater_on),
    weather_enabled: Boolean(row.weather_enabled),
    weather_running: Boolean(row.weather_running),
    latitude: row.latitude !== null ? Number(row.latitude) : null,
    longitude: row.longitude !== null ? Number(row.longitude) : null,
    weather_lead_minutes: Number(row.weather_lead_minutes || 60),
    weather_hold_minutes: Number(row.weather_hold_minutes || 30),
    weather_min_temp: row.weather_min_temp !== null ? Number(row.weather_min_temp) : 3,
    kma_nx: row.kma_nx !== null ? Number(row.kma_nx) : null,
    kma_ny: row.kma_ny !== null ? Number(row.kma_ny) : null
  }));
}

function parseTriggerPty(value) {
  return String(value || '2,3,6,7')
    .split(',')
    .map((v) => Number(String(v).trim()))
    .filter((v) => Number.isFinite(v));
}

function isWinterMonth(date = new Date()) {
  const month = getKstParts(date).month;
  const allowMonths = String(env.weatherAutoMonths || '11,12,1,2,3')
    .split(',')
    .map((v) => String(Number(v.trim())));
  return allowMonths.includes(String(Number(month)));
}

function getLatestVillageBase(now = new Date()) {
  const parts = getKstParts(now);
  let baseHour = null;

  for (let i = VILLAGE_BASE_HOURS.length - 1; i >= 0; i -= 1) {
    const hour = VILLAGE_BASE_HOURS[i];
    if (parts.hour > hour || (parts.hour === hour && parts.minute >= 10)) {
      baseHour = hour;
      break;
    }
  }

  if (baseHour !== null) {
    return {
      base_date: parts.ymd,
      base_time: `${String(baseHour).padStart(2, '0')}00`
    };
  }

  const prev = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const prevParts = getKstParts(prev);
  return {
    base_date: prevParts.ymd,
    base_time: '2300'
  };
}

function getLatestUltraBase(now = new Date()) {
  const parts = getKstParts(now);
  let year = parts.year;
  let month = Number(parts.month);
  let day = Number(parts.day);
  let hour = parts.hour;

  if (parts.minute < 45) hour -= 1;

  if (hour < 0) {
    const prev = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const prevParts = getKstParts(prev);
    year = prevParts.year;
    month = Number(prevParts.month);
    day = Number(prevParts.day);
    hour = 23;
  }

  const ymd = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;

  return {
    base_date: ymd,
    base_time: `${String(hour).padStart(2, '0')}30`
  };
}

async function fetchJsonFromKma(pathname, query) {
  if (!env.kmaAuthKey) {
    throw new Error('KMA_AUTH_KEY 환경변수가 비어 있습니다.');
  }

  const url = new URL(pathname, KMA_BASE_URL);
  const params = new URLSearchParams({
    ...query,
    authKey: env.kmaAuthKey
  });
  url.search = params.toString();

  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(env.requestTimeoutMs + 5000)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const msg =
      data?.response?.header?.resultMsg ||
      data?.result?.message ||
      `KMA API 오류 (${response.status})`;
    throw new Error(msg);
  }

  const resultCode = String(
    data?.response?.header?.resultCode ??
    data?.header?.resultCode ??
    ''
  );

  if (resultCode && resultCode !== '00' && resultCode !== '0') {
    const msg =
      data?.response?.header?.resultMsg ||
      data?.header?.resultMsg ||
      'KMA API 응답 오류';
    throw new Error(msg);
  }

  return data;
}

function getItems(data) {
  const item = data?.response?.body?.items?.item ?? data?.body?.items?.item ?? [];
  return Array.isArray(item) ? item : item ? [item] : [];
}

function parseAmount(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw === '강수없음' || raw === '적설없음' || raw.toLowerCase() === 'null') {
    return 0;
  }

  const numeric = raw.replace(/[^\d.+-~]/g, '');
  if (raw.includes('미만')) {
    const n = parseFloat(numeric);
    return Number.isFinite(n) ? Math.max(0.1, n - 0.1) : 0.1;
  }

  if (raw.includes('이상')) {
    const n = parseFloat(numeric);
    return Number.isFinite(n) ? n : 1;
  }

  if (raw.includes('~')) {
    const n = parseFloat(numeric.split('~')[0]);
    return Number.isFinite(n) ? n : 0;
  }

  const n = parseFloat(numeric);
  return Number.isFinite(n) ? n : 0;
}

function groupForecastItems(items, source) {
  const map = new Map();

  for (const item of items) {
    const fcstDate = String(item.fcstDate || '').trim();
    const fcstTime = String(item.fcstTime || '').trim();
    const category = String(item.category || '').trim();
    const rawValue = item.fcstValue;

    if (!fcstDate || !fcstTime || !category) continue;

    const key = `${fcstDate}${fcstTime}`;
    const at = fromKstDateTime(fcstDate, fcstTime);
    const existing = map.get(key) || {
      key,
      at,
      pty: 0,
      tmp: null,
      pcp: 0,
      sno: 0,
      rn1: 0,
      raw: {}
    };

    existing.raw[category] = rawValue;

    if (category === 'PTY') existing.pty = Number(rawValue || 0);
    if (category === 'TMP' || category === 'T1H') {
      const n = Number(rawValue);
      existing.tmp = Number.isFinite(n) ? n : existing.tmp;
    }
    if (category === 'PCP') existing.pcp = parseAmount(rawValue);
    if (category === 'SNO') existing.sno = parseAmount(rawValue);
    if (category === 'RN1') existing.rn1 = parseAmount(rawValue);

    existing.source = source;
    map.set(key, existing);
  }

  return Array.from(map.values()).sort((a, b) => a.at - b.at);
}

function mergeForecasts(villageItems, ultraItems) {
  const map = new Map();

  for (const item of villageItems) {
    map.set(item.key, { ...item });
  }

  for (const item of ultraItems) {
    const prev = map.get(item.key) || {
      key: item.key,
      at: item.at,
      pty: 0,
      tmp: null,
      pcp: 0,
      sno: 0,
      rn1: 0,
      raw: {}
    };

    map.set(item.key, {
      ...prev,
      pty: item.pty || prev.pty,
      tmp: item.tmp ?? prev.tmp,
      rn1: item.rn1 ?? prev.rn1,
      raw: { ...prev.raw, ...item.raw }
    });
  }

  return Array.from(map.values()).sort((a, b) => a.at - b.at);
}

function isSnowLikeForecast(entry, triggerPty, minTemp) {
  const pty = Number(entry.pty || 0);
  const tmp = entry.tmp;
  const sno = Number(entry.sno || 0);

  if (sno > 0) return true;
  if (!triggerPty.includes(pty)) return false;

  // 순수 눈 / 눈날림
  if (pty === 3 || pty === 7) return true;

  // 비/눈 또는 빗방울눈날림은 기온 기준 추가 필터
  if (pty === 2 || pty === 6) {
    return tmp === null || tmp <= minTemp;
  }

  return true;
}

function findNextSnowWindow(timeline, triggerPty, minTemp, now = new Date()) {
  const future = timeline.filter((entry) => entry.at.getTime() >= now.getTime() - (30 * 60 * 1000));
  if (!future.length) return null;

  let startIndex = -1;
  for (let i = 0; i < future.length; i += 1) {
    if (isSnowLikeForecast(future[i], triggerPty, minTemp)) {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) return null;

  const bucket = [future[startIndex]];

  for (let i = startIndex + 1; i < future.length; i += 1) {
    const prev = future[i - 1];
    const cur = future[i];
    const diffHours = (cur.at.getTime() - prev.at.getTime()) / (60 * 60 * 1000);

    if (diffHours > 1.5) break;
    if (!isSnowLikeForecast(cur, triggerPty, minTemp)) break;
    bucket.push(cur);
  }

  const first = bucket[0];
  const last = bucket[bucket.length - 1];
  const startAt = first.at;
  const endAt = new Date(last.at.getTime() + 60 * 60 * 1000);

  return {
    startAt,
    endAt,
    key: `${startAt.toISOString()}__${endAt.toISOString()}`,
    first,
    bucket
  };
}

async function resolveGridIfNeeded(controller) {
  if (controller.kma_nx && controller.kma_ny) {
    return { nx: controller.kma_nx, ny: controller.kma_ny };
  }

  if (controller.latitude == null || controller.longitude == null) {
    throw new Error('장비 좌표(latitude, longitude)가 없습니다.');
  }

  const url = new URL('/api/typ01/cgi-bin/url/nph-dfs_xy_lonlat', KMA_BASE_URL);
  url.search = new URLSearchParams({
    lon: String(controller.longitude),
    lat: String(controller.latitude),
    help: '0',
    authKey: env.kmaAuthKey
  }).toString();

  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(env.requestTimeoutMs + 5000)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`격자 변환 실패 (${response.status})`);
  }

  const match = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) {
    throw new Error(`격자 변환 응답 파싱 실패: ${text.slice(0, 120)}`);
  }

  const nx = Number(match[3]);
  const ny = Number(match[4]);

  await updateWeatherState(controller.id, {
    kma_nx: nx,
    kma_ny: ny,
    last_error: null,
    last_message: `KMA 격자 매핑 완료 (${nx}, ${ny})`
  });

  return { nx, ny };
}

async function fetchVillageForecast(nx, ny) {
  const { base_date, base_time } = getLatestVillageBase();

  const data = await fetchJsonFromKma(
    '/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst',
    {
      pageNo: '1',
      numOfRows: '1000',
      dataType: 'JSON',
      base_date,
      base_time,
      nx: String(nx),
      ny: String(ny)
    }
  );

  return groupForecastItems(getItems(data), 'village');
}

async function fetchUltraForecast(nx, ny) {
  const { base_date, base_time } = getLatestUltraBase();

  const data = await fetchJsonFromKma(
    '/api/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtFcst',
    {
      pageNo: '1',
      numOfRows: '1000',
      dataType: 'JSON',
      base_date,
      base_time,
      nx: String(nx),
      ny: String(ny)
    }
  );

  return groupForecastItems(getItems(data), 'ultra');
}

async function insertWeatherEventLog(controllerId, eventType, message, severity = 'info', payload = null) {
  await db.query(
    `INSERT INTO event_logs (controller_id, event_type, message, severity, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
    [controllerId, eventType, message, severity, payload ? JSON.stringify(payload) : null]
  );
}

async function sendWeatherAutoCommand(controller, commandType, reason) {
  if (!env.autoProxyDeviceCommands) {
    throw new Error('AUTO_PROXY_DEVICE_COMMANDS=false 상태입니다.');
  }

  if (!controller.device_api_base) {
    throw new Error('device_api_base 가 없습니다.');
  }

  const requestedByUserId = 0;
  const requestedByUserName = 'weather-auto';
  const commandValue = commandType === 'HEATER_ON' ? 'true' : 'false';

  const cmdInsert = await db.query(
    `INSERT INTO commands (
      controller_id,
      command_type,
      command_value,
      reason,
      requested_by_user_id,
      requested_by_user_name,
      status,
      response_message
    ) VALUES (?, ?, ?, ?, ?, ?, 'queued', '날씨 자동제어 명령 등록')`,
    [
      controller.id,
      commandType,
      commandValue,
      reason,
      requestedByUserId,
      requestedByUserName
    ]
  );

  const url = `${String(controller.device_api_base).replace(/\/+$/, '')}/commands`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Role': 'admin',
        'X-User-Id': String(requestedByUserId),
        'X-User-Name': requestedByUserName,
        'X-Customer-Id': String(controller.customer_id || ''),
        'X-Controller-Serial': controller.serial_no || ''
      },
      body: JSON.stringify({
        command_type: commandType,
        command_value: null,
        reason,
        requested_by: {
          user_id: requestedByUserId,
          user_name: requestedByUserName
        }
      }),
      signal: AbortSignal.timeout(env.requestTimeoutMs)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.ok === false || data?.success === false) {
      const msg =
        data?.error?.message ||
        data?.message ||
        `장비 프록시 오류 (${response.status})`;
      throw new Error(msg);
    }

    const successMessage = data?.message || data?.meta?.message || `${commandType} 성공`;

    await db.query(
      `UPDATE commands
          SET status = 'success',
              response_message = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [successMessage, cmdInsert.insertId]
    );

    await db.query(
      `INSERT INTO control_logs (
        controller_id, user_id, user_name,
        command_type, command_value, result, note,
        requested_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, 'success', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        controller.id,
        requestedByUserId,
        requestedByUserName,
        commandType,
        commandValue,
        successMessage
      ]
    );

    await insertWeatherEventLog(
      controller.id,
      commandType,
      reason,
      'info',
      { source: 'weather-auto', commandType }
    );

    return { ok: true, message: successMessage };
  } catch (error) {
    await db.query(
      `UPDATE commands
          SET status = 'failed',
              response_message = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [error.message, cmdInsert.insertId]
    );

    await db.query(
      `INSERT INTO control_logs (
        controller_id, user_id, user_name,
        command_type, command_value, result, note,
        requested_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, 'failed', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        controller.id,
        requestedByUserId,
        requestedByUserName,
        commandType,
        commandValue,
        error.message
      ]
    );

    await insertWeatherEventLog(
      controller.id,
      'WEATHER_AUTO_COMMAND_FAILED',
      `${commandType} 실패: ${error.message}`,
      'warning',
      { source: 'weather-auto', commandType }
    );

    throw error;
  }
}

async function processController(controller) {
  const now = new Date();

  try {
    if (!controller.weather_enabled) {
      await updateWeatherState(controller.id, {
        last_checked_at: now,
        last_error: null,
        last_message: '날씨 자동제어 비활성화됨'
      });
      return;
    }

    if (env.weatherAutoRequireAutoMode && String(controller.heater_mode || '').toLowerCase() !== 'auto') {
      await updateWeatherState(controller.id, {
        last_checked_at: now,
        last_error: null,
        last_message: 'heater_mode=auto 인 장비만 자동제어'
      });
      return;
    }

    if (!controller.device_api_base) {
      await updateWeatherState(controller.id, {
        last_checked_at: now,
        last_error: 'device_api_base 가 없습니다.',
        last_message: '자동제어 대상 제외'
      });
      return;
    }

    const { nx, ny } = await resolveGridIfNeeded(controller);

    const [village, ultra] = await Promise.all([
      fetchVillageForecast(nx, ny),
      fetchUltraForecast(nx, ny).catch(() => [])
    ]);

    const timeline = mergeForecasts(village, ultra);
    const triggerPty = parseTriggerPty(controller.weather_trigger_pty);
    const minTemp = Number(controller.weather_min_temp ?? 3);
    const nextSnow = findNextSnowWindow(timeline, triggerPty, minTemp, now);

    const running = Boolean(controller.weather_running);
    const armedOffAt = fromDbDateTime(controller.armed_off_at);

    if (!nextSnow) {
      if (running && armedOffAt && now >= armedOffAt) {
        const reason = '눈 예보 종료 후 30분 경과: 자동 정지';
        await sendWeatherAutoCommand(controller, 'HEATER_OFF', reason);

        await updateWeatherState(controller.id, {
          running: false,
          heater_stopped_at: now,
          active_event_key: null,
          forecast_start_at: null,
          forecast_end_at: null,
          armed_on_at: null,
          armed_off_at: null,
          last_checked_at: now,
          last_error: null,
          last_message: reason
        });
        return;
      }

      await updateWeatherState(controller.id, {
        active_event_key: null,
        forecast_start_at: null,
        forecast_end_at: null,
        armed_on_at: null,
        armed_off_at: null,
        last_checked_at: now,
        last_error: null,
        last_message: '향후 눈 예보 없음'
      });
      return;
    }

    const leadMs = controller.weather_lead_minutes * 60 * 1000;
    const holdMs = controller.weather_hold_minutes * 60 * 1000;
    const armedOnAt = new Date(nextSnow.startAt.getTime() - leadMs);
    const calculatedOffAt = new Date(nextSnow.endAt.getTime() + holdMs);

    await updateWeatherState(controller.id, {
      active_event_key: nextSnow.key,
      forecast_start_at: nextSnow.startAt,
      forecast_end_at: nextSnow.endAt,
      armed_on_at: armedOnAt,
      armed_off_at: calculatedOffAt,
      last_checked_at: now,
      last_error: null,
      last_message: `눈 예보 감지: ${toDbDateTime(nextSnow.startAt)} ~ ${toDbDateTime(nextSnow.endAt)}`
    });

    if (!running && now >= armedOnAt && now < calculatedOffAt) {
      if (!controller.heater_on) {
        const reason = `눈 예보 60분 전 자동 기동 (예보 시작 ${toDbDateTime(nextSnow.startAt)})`;
        await sendWeatherAutoCommand(controller, 'HEATER_ON', reason);

        await updateWeatherState(controller.id, {
          running: true,
          heater_started_at: now,
          last_checked_at: now,
          last_error: null,
          last_message: reason
        });
      } else {
        await updateWeatherState(controller.id, {
          last_checked_at: now,
          last_error: null,
          last_message: '히터가 이미 ON 상태라 자동기동 생략'
        });
      }
      return;
    }

    if (running && now >= calculatedOffAt) {
      const reason = '눈 예보 종료 후 30분 경과: 자동 정지';
      await sendWeatherAutoCommand(controller, 'HEATER_OFF', reason);

      await updateWeatherState(controller.id, {
        running: false,
        heater_stopped_at: now,
        active_event_key: null,
        forecast_start_at: null,
        forecast_end_at: null,
        armed_on_at: null,
        armed_off_at: null,
        last_checked_at: now,
        last_error: null,
        last_message: reason
      });
      return;
    }
  } catch (error) {
    await updateWeatherState(controller.id, {
      last_checked_at: now,
      last_error: error.message,
      last_message: '날씨 자동제어 처리 실패'
    });
  }
}

async function runWeatherAutoCycle() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  try {
    if (!env.weatherAutoEnabled) return;
    if (!isWinterMonth()) return;

    await ensureWeatherAutoSchema();
    const controllers = await loadControllersForWeatherAuto();

    for (const controller of controllers) {
      // 장비 수가 아주 많지 않다는 전제의 안전한 순차 처리
      // 필요하면 이후 p-limit 형태로 병렬 확장 가능
      // eslint-disable-next-line no-await-in-loop
      await processController(controller);
    }
  } catch (error) {
    console.error('[weather-auto] cycle failed:', error);
  } finally {
    schedulerRunning = false;
  }
}

async function startWeatherAutoScheduler() {
  if (!env.weatherAutoEnabled) {
    console.log('[weather-auto] disabled');
    return;
  }

  await ensureWeatherAutoSchema();
  await runWeatherAutoCycle();

  schedulerTimer = setInterval(() => {
    runWeatherAutoCycle().catch((error) => {
      console.error('[weather-auto] interval error:', error);
    });
  }, env.weatherAutoIntervalMs);

  console.log(`[weather-auto] started (interval=${env.weatherAutoIntervalMs}ms)`);
}

function stopWeatherAutoScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

module.exports = {
  startWeatherAutoScheduler,
  stopWeatherAutoScheduler
};
