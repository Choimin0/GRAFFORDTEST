-- 마이그레이션 013: refunded_count 컬럼 추가
-- reservations, past_reservations, delete_reservations 세 테이블에 추가
-- 기본값 0, NOT NULL
-- delete_reservations에 이동될 때 payment-cancel API에서 1로 설정됨

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS refunded_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE past_reservations
  ADD COLUMN IF NOT EXISTS refunded_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE delete_reservations
  ADD COLUMN IF NOT EXISTS refunded_count INTEGER NOT NULL DEFAULT 0;
