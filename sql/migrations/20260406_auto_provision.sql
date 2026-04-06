ALTER TABLE controllers
  MODIFY device_api_base VARCHAR(255) NULL,
  ADD COLUMN pairing_status ENUM('pending', 'claimed', 'active', 'error') NOT NULL DEFAULT 'pending' AFTER note,
  ADD COLUMN provision_key_hash VARCHAR(255) NULL AFTER pairing_status,
  ADD COLUMN provision_key_issued_at DATETIME NULL AFTER provision_key_hash,
  ADD COLUMN provision_key_expires_at DATETIME NULL AFTER provision_key_issued_at,
  ADD COLUMN provisioned_at DATETIME NULL AFTER provision_key_expires_at,
  ADD COLUMN last_claimed_at DATETIME NULL AFTER provisioned_at,
  ADD COLUMN last_claim_ip VARCHAR(64) NULL AFTER last_claimed_at,
  ADD COLUMN firmware_version VARCHAR(80) NULL AFTER last_claim_ip,
  ADD COLUMN hardware_model VARCHAR(120) NULL AFTER firmware_version,
  ADD COLUMN stream_type VARCHAR(30) NULL DEFAULT 'mjpeg' AFTER hardware_model,
  ADD COLUMN public_base_url VARCHAR(255) NULL AFTER stream_type,
  ADD COLUMN device_sync_token_hash VARCHAR(255) NULL AFTER public_base_url;

CREATE INDEX idx_controllers_pairing_status ON controllers (pairing_status);

UPDATE controllers
   SET pairing_status = CASE
     WHEN device_sync_token_hash IS NOT NULL THEN 'active'
     WHEN device_api_base IS NOT NULL THEN 'claimed'
     ELSE 'pending'
   END
 WHERE pairing_status IS NULL OR pairing_status = 'pending';
