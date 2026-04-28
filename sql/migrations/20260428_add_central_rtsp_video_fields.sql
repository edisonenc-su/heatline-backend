-- Heatline backend migration
-- 목적: 중앙서버 RTSP 수신 + 브라우저 재생 구조를 위해 controllers 테이블에 비디오 메타데이터 컬럼 추가
-- 주의: MySQL 8+ 기준의 IF NOT EXISTS 문법을 사용했습니다.

USE heatline;

ALTER TABLE controllers
  ADD COLUMN IF NOT EXISTS playback_url VARCHAR(255) NULL AFTER camera_url,
  ADD COLUMN IF NOT EXISTS playback_protocol VARCHAR(30) NULL DEFAULT 'mjpeg' AFTER playback_url,
  ADD COLUMN IF NOT EXISTS video_source_type ENUM('pi_camera', 'central_rtsp') NOT NULL DEFAULT 'pi_camera' AFTER playback_protocol,
  ADD COLUMN IF NOT EXISTS source_rtsp_url VARCHAR(500) NULL AFTER video_source_type,
  ADD COLUMN IF NOT EXISTS rtsp_transport ENUM('tcp', 'udp') NOT NULL DEFAULT 'tcp' AFTER source_rtsp_url,
  ADD COLUMN IF NOT EXISTS snapshot_url VARCHAR(255) NULL AFTER rtsp_transport,
  ADD COLUMN IF NOT EXISTS media_status VARCHAR(40) NULL AFTER snapshot_url,
  ADD COLUMN IF NOT EXISTS media_last_seen_at DATETIME NULL AFTER media_status;

ALTER TABLE controllers
  ADD INDEX IF NOT EXISTS idx_controllers_video_source_type (video_source_type),
  ADD INDEX IF NOT EXISTS idx_controllers_media_status (media_status);

-- 기존 데이터 정리
-- 1) playback_url 비어있으면 기존 camera_url을 승계
UPDATE controllers
   SET playback_url = camera_url
 WHERE (playback_url IS NULL OR playback_url = '')
   AND camera_url IS NOT NULL
   AND camera_url <> '';

-- 2) playback_protocol 비어있으면 기존 stream_type 기반으로 승계
UPDATE controllers
   SET playback_protocol = COALESCE(NULLIF(stream_type, ''), 'mjpeg')
 WHERE playback_protocol IS NULL OR playback_protocol = '';

-- 3) stream_type 은 기존 하위호환을 위해 playback_protocol 값과 맞춤
UPDATE controllers
   SET stream_type = COALESCE(NULLIF(playback_protocol, ''), 'mjpeg')
 WHERE stream_type IS NULL OR stream_type = '' OR stream_type <> playback_protocol;

-- 4) source type 추정
UPDATE controllers
   SET video_source_type = CASE
     WHEN camera_url LIKE '%.m3u8%' THEN 'central_rtsp'
     WHEN camera_url LIKE '%/webrtc%' THEN 'central_rtsp'
     ELSE 'pi_camera'
   END
 WHERE video_source_type IS NULL OR video_source_type = '' OR video_source_type = 'pi_camera';

-- 5) camera_url 은 브라우저 재생 URL alias 로 유지
UPDATE controllers
   SET camera_url = playback_url
 WHERE playback_url IS NOT NULL
   AND playback_url <> ''
   AND (camera_url IS NULL OR camera_url = '' OR camera_url <> playback_url);
