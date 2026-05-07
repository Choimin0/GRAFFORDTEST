-- Migration 009: 예약자 이메일(email) 컬럼 추가
-- reservations, past_reservations 테이블에 email 컬럼을 추가합니다.
-- 기존 예약 데이터와의 호환을 위해 DEFAULT NULL 로 설정합니다.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT NULL;

ALTER TABLE past_reservations
  ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT NULL;

ALTER TABLE delete_reservations
  ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT NULL;
