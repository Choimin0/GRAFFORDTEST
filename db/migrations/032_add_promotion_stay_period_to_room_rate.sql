-- Migration 032: 프로모션 투숙 기간 (예약 기간과 분리)
-- promotion_start_date / promotion_end_date: 예약 완료 시점 (기존 컬럼)
-- promotion_stay_start_date / promotion_stay_end_date: 투숙 시점 (신규)

ALTER TABLE "room-rate"
  ADD COLUMN IF NOT EXISTS promotion_stay_start_date DATE,
  ADD COLUMN IF NOT EXISTS promotion_stay_end_date DATE;

-- 기존 단일 기간 설정 → 예약·투숙 동일 기간으로 이전
UPDATE "room-rate"
SET promotion_stay_start_date = promotion_start_date,
    promotion_stay_end_date = promotion_end_date
WHERE room_name = 'promotion'
  AND promotion_stay_start_date IS NULL
  AND promotion_stay_end_date IS NULL
  AND promotion_start_date IS NOT NULL
  AND promotion_end_date IS NOT NULL;
