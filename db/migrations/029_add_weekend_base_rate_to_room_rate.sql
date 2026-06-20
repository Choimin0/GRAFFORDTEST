-- Migration 029: 객실별 주말 기본 요금 컬럼 추가
-- 주말 추가요금 토글이 OFF일 때 각 객실의 주말 요금을 직접 저장합니다.

ALTER TABLE "room-rate"
  ADD COLUMN IF NOT EXISTS weekend_base_rate BIGINT CHECK (weekend_base_rate IS NULL OR weekend_base_rate >= 0);

UPDATE "room-rate"
SET weekend_base_rate = weekday_base_rate + 20000
WHERE room_name IN ('G1', 'G2', 'G3', 'G4')
  AND weekend_base_rate IS NULL;
