const express = require('express');
const db = require('../config/db');
const { success, fail, asyncHandler } = require('../utils/http');
const { hashOpaqueToken, issueOpaqueToken } = require('../middleware/auth');

const router = express.Router();

async function loadControllerBySerial(serialNo) {
  const rows = await db.query(
    `SELECT *
       FROM controllers
      WHERE serial_no = ?
      LIMIT 1`,
    [serialNo]
  );
  return rows[0] || null;
}

router.post('/claim', asyncHandler(async (req, res) => {
  const {
    serial_no,
    provision_key,
    device_api_base = null,
    camera_url = null,
    public_base_url = null,
    stream_type = 'mjpeg',
    firmware_version = null,
    hardware_model = null,
    controller_name = null,
    install_address = null,
    install_location = null,
    latitude = null,
    longitude = null
  } = req.body || {};

  if (!serial_no || !provision_key) {
    return fail(res, 400, 'serial_no 와 provision_key 가 필요합니다.', 'VALIDATION_ERROR');
  }

  const controller = await loadControllerBySerial(serial_no);
  if (!controller) {
    return fail(res, 404, '시리얼 번호에 해당하는 장비를 찾을 수 없습니다.', 'CONTROLLER_NOT_FOUND');
  }

  if (!controller.provision_key_hash) {
    return fail(res, 409, '발급된 프로비전 키가 없습니다.', 'PROVISION_KEY_NOT_ISSUED');
  }

  const now = new Date();
  if (controller.provision_key_expires_at && new Date(controller.provision_key_expires_at) < now) {
    return fail(res, 410, '프로비전 키가 만료되었습니다.', 'PROVISION_KEY_EXPIRED');
  }

  if (hashOpaqueToken(provision_key) !== controller.provision_key_hash) {
    return fail(res, 401, '프로비전 키가 올바르지 않습니다.', 'INVALID_PROVISION_KEY');
  }

  const deviceSyncToken = issueOpaqueToken('dsk');
  const deviceSyncTokenHash = hashOpaqueToken(deviceSyncToken);
  const claimIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64) || null;

  await db.query(
    `UPDATE controllers
        SET controller_name = COALESCE(?, controller_name),
            install_address = COALESCE(?, install_address),
            install_location = COALESCE(?, install_location),
            latitude = COALESCE(?, latitude),
            longitude = COALESCE(?, longitude),
            device_api_base = COALESCE(?, device_api_base),
            camera_url = COALESCE(?, camera_url),
            public_base_url = COALESCE(?, public_base_url),
            stream_type = COALESCE(?, stream_type),
            firmware_version = COALESCE(?, firmware_version),
            hardware_model = COALESCE(?, hardware_model),
            device_sync_token_hash = ?,
            pairing_status = 'claimed',
            provisioned_at = COALESCE(provisioned_at, CURRENT_TIMESTAMP),
            last_claimed_at = CURRENT_TIMESTAMP,
            last_claim_ip = ?,
            provision_key_hash = NULL,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [
      controller_name,
      install_address,
      install_location,
      latitude,
      longitude,
      device_api_base,
      camera_url,
      public_base_url,
      stream_type,
      firmware_version,
      hardware_model,
      deviceSyncTokenHash,
      claimIp,
      controller.id
    ]
  );

  const rows = await db.query(`SELECT * FROM controllers WHERE id = ? LIMIT 1`, [controller.id]);
  const updated = rows[0];

  return success(res, {
    controller_id: updated.id,
    serial_no: updated.serial_no,
    device_sync_token: deviceSyncToken,
    pairing_status: updated.pairing_status,
    status_push_path: `/api/v1/controllers/${updated.id}/status`,
    heartbeat_path: `/api/v1/controllers/${updated.id}/heartbeat`,
    events_path: `/api/v1/controllers/${updated.id}/events`
  }, {
    message: '장비 프로비저닝이 완료되었습니다. 발급된 device_sync_token 을 Pi에 저장하세요.'
  });
}));

module.exports = router;
