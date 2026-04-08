USE heatline;

ALTER TABLE controllers
  MODIFY COLUMN heater_mode ENUM('auto', 'manual', 'schedule') NOT NULL DEFAULT 'auto';

ALTER TABLE controllers
  ADD COLUMN IF NOT EXISTS offline_mode TINYINT(1) NOT NULL DEFAULT 0 AFTER heater_mode,
  ADD COLUMN IF NOT EXISTS current_control_source VARCHAR(40) NULL DEFAULT 'idle' AFTER offline_mode,
  ADD COLUMN IF NOT EXISTS active_schedule_name VARCHAR(120) NULL AFTER current_control_source,
  ADD COLUMN IF NOT EXISTS last_schedule_sync_at DATETIME NULL AFTER active_schedule_name;

CREATE TABLE IF NOT EXISTS manual_schedules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  controller_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  schedule_type ENUM('weekly', 'once') NOT NULL DEFAULT 'weekly',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  days_of_week VARCHAR(32) NULL,
  start_time CHAR(5) NULL,
  end_time CHAR(5) NULL,
  once_started_at DATETIME NULL,
  once_ended_at DATETIME NULL,
  preheat_minutes INT NOT NULL DEFAULT 0,
  priority INT NOT NULL DEFAULT 50,
  offline_enabled TINYINT(1) NOT NULL DEFAULT 1,
  min_temperature DECIMAL(5, 2) NULL,
  max_temperature DECIMAL(5, 2) NULL,
  source ENUM('central', 'local') NOT NULL DEFAULT 'central',
  note TEXT NULL,
  last_synced_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_manual_schedules_controller_id (controller_id),
  KEY idx_manual_schedules_enabled (enabled),
  CONSTRAINT fk_manual_schedules_controller FOREIGN KEY (controller_id) REFERENCES controllers (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
