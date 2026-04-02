CREATE DATABASE IF NOT EXISTS heatline CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE heatline;

CREATE TABLE IF NOT EXISTS customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_name VARCHAR(120) NOT NULL,
  contact_name VARCHAR(80) NULL,
  contact_phone VARCHAR(40) NULL,
  contact_email VARCHAR(120) NULL,
  address VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(60) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'customer') NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  full_name VARCHAR(80) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  CONSTRAINT fk_users_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS controllers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  controller_name VARCHAR(120) NOT NULL,
  serial_no VARCHAR(120) NOT NULL,
  install_address VARCHAR(255) NOT NULL,
  install_location VARCHAR(120) NOT NULL,
  latitude DECIMAL(10, 6) NULL,
  longitude DECIMAL(10, 6) NULL,
  installed_at DATETIME NULL,
  as_expire_at DATE NULL,
  status ENUM('online', 'offline', 'warning', 'error') NOT NULL DEFAULT 'offline',
  snow_detected TINYINT(1) NOT NULL DEFAULT 0,
  heater_on TINYINT(1) NOT NULL DEFAULT 0,
  temperature DECIMAL(5, 2) NULL,
  humidity DECIMAL(5, 2) NULL,
  heater_mode ENUM('auto', 'manual') NOT NULL DEFAULT 'auto',
  snow_threshold DECIMAL(4, 2) NOT NULL DEFAULT 0.80,
  camera_url VARCHAR(255) NULL,
  device_api_base VARCHAR(255) NOT NULL,
  allow_customer_control TINYINT(1) NOT NULL DEFAULT 1,
  last_seen_at DATETIME NULL,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_controllers_serial_no (serial_no),
  KEY idx_controllers_customer_id (customer_id),
  KEY idx_controllers_status (status),
  CONSTRAINT fk_controllers_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS event_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  controller_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  message VARCHAR(255) NULL,
  severity ENUM('info', 'warning', 'critical') NOT NULL DEFAULT 'info',
  payload_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_event_logs_controller_id (controller_id),
  KEY idx_event_logs_created_at (created_at),
  CONSTRAINT fk_event_logs_controller FOREIGN KEY (controller_id) REFERENCES controllers (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS control_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  controller_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  user_name VARCHAR(80) NULL,
  command_type VARCHAR(80) NOT NULL,
  command_value VARCHAR(120) NULL,
  result ENUM('success', 'failed', 'queued') NOT NULL DEFAULT 'queued',
  note VARCHAR(255) NULL,
  requested_at DATETIME NULL,
  finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_control_logs_controller_id (controller_id),
  KEY idx_control_logs_created_at (created_at),
  CONSTRAINT fk_control_logs_controller FOREIGN KEY (controller_id) REFERENCES controllers (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS commands (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  controller_id BIGINT UNSIGNED NOT NULL,
  command_type VARCHAR(80) NOT NULL,
  command_value VARCHAR(120) NULL,
  reason VARCHAR(255) NULL,
  requested_by_user_id BIGINT UNSIGNED NULL,
  requested_by_user_name VARCHAR(80) NULL,
  status ENUM('queued', 'success', 'failed') NOT NULL DEFAULT 'queued',
  response_message VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_commands_controller_id (controller_id),
  KEY idx_commands_created_at (created_at),
  CONSTRAINT fk_commands_controller FOREIGN KEY (controller_id) REFERENCES controllers (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
