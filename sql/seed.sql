USE heatline;

INSERT INTO customers (id, company_name, contact_name, contact_phone, contact_email, address, is_active)
VALUES
  (1, '한국도로공사 강원지사', '강원 담당자', '033-111-1111', 'kangwon@example.com', '강원도 원주시', 1),
  (2, '서울시 도로교통과', '서울 담당자', '02-222-2222', 'seoul@example.com', '서울특별시 중구', 1),
  (3, '부산광역시 도로과', '부산 담당자', '051-333-3333', 'busan@example.com', '부산광역시 연제구', 1)
ON DUPLICATE KEY UPDATE company_name = VALUES(company_name);

INSERT INTO users (id, username, password_hash, role, customer_id, full_name, is_active)
VALUES
  (1, 'admin', '$2a$10$DySEQ1jkWWPy8luAqILOPud4Vt.lnhwCLrn2bgR5Dak42jgIK3vKK', 'admin', NULL, '시스템 관리자', 1),
  (2, 'kangwon', '$2a$10$ZQmSOXbXn82dDMBAFPDTyu55yTgOpfktPCNv3S1sMaOgyKBQVRmBK', 'customer', 1, '강원지사 관리자', 1),
  (3, 'seoul', '$2a$10$Zue30u4Op3CYNL3Jj.Z1BeKmJ6Oq2LWSnwcXHXxR6Z2rCimw0sDDu', 'customer', 2, '서울시 관리자', 1),
  (4, 'busan', '$2a$10$tgUFPBfdgTYcKLeCkxSJ4eKwOzVALKAiYpyLl3oXZMcZxWOisL2ay', 'customer', 3, '부산시 관리자', 1)
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);

INSERT INTO controllers (
  id, customer_id, controller_name, serial_no, install_address, install_location,
  latitude, longitude, installed_at, as_expire_at, status, snow_detected, heater_on,
  temperature, humidity, heater_mode, snow_threshold, camera_url, device_api_base,
  allow_customer_control, last_seen_at, note
) VALUES
  (101, 1, '영동고속도로 1호 구간', 'KW-PI5-101', '강원도 영동군 영동로 101', '터널 입구', 37.123456, 128.123456, NOW(), '2027-12-31', 'online', 1, 1, -2.5, 81.2, 'auto', 0.80, 'http://192.168.0.31:8000/stream.mjpg', 'http://192.168.0.31:9000/api/v1', 1, NOW(), '강원 샘플 장비'),
  (102, 1, '영동고속도로 2호 구간', 'KW-PI5-102', '강원도 영동군 영동로 102', '교량 하단', 37.133456, 128.133456, NOW(), '2027-10-31', 'online', 0, 0, -1.2, 70.5, 'auto', 0.80, 'http://192.168.0.32:8000/stream.mjpg', 'http://192.168.0.32:9000/api/v1', 1, NOW(), '강원 샘플 장비'),
  (201, 2, '강변북로 과속화정리', 'SE-PI5-201', '서울 마포구 강변북로 201', '램프 구간', 37.543210, 126.987654, NOW(), '2027-08-31', 'online', 0, 0, 1.5, 58.0, 'manual', 0.75, 'http://192.168.1.21:8000/stream.mjpg', 'http://192.168.1.21:9000/api/v1', 1, NOW(), '서울 샘플 장비'),
  (301, 3, '남해고속도로 부산IC', 'BS-PI5-301', '부산 강서구 남해고속로 301', 'IC 진입부', 35.179554, 129.075642, NOW(), '2027-09-30', 'warning', 0, 0, 0.2, 66.4, 'auto', 0.82, 'http://192.168.2.31:8000/stream.mjpg', 'http://192.168.2.31:9000/api/v1', 1, NOW(), '부산 샘플 장비')
ON DUPLICATE KEY UPDATE controller_name = VALUES(controller_name);

INSERT INTO event_logs (controller_id, event_type, message, severity)
VALUES
  (101, 'SNOW_DETECTED', '눈이 감지되어 자동 제설 모드가 시작되었습니다.', 'warning'),
  (101, 'HEATER_ON', '히터가 자동으로 켜졌습니다.', 'info'),
  (301, 'DEVICE_WARNING', '장비 점검이 필요합니다.', 'warning');

INSERT INTO control_logs (controller_id, user_id, user_name, command_type, command_value, result, note, requested_at, finished_at)
VALUES
  (101, 1, '시스템 관리자', 'HEATER_ON', 'true', 'success', '샘플 제어 이력', NOW(), NOW()),
  (201, 3, '서울시 관리자', 'SET_MODE', 'manual', 'success', '수동 모드 전환', NOW(), NOW());
