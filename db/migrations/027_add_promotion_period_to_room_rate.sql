-- Migration 027: 프로모션 적용 기간 (room-rate.promotion 행)
-- promotion_start_date / promotion_end_date: inclusive (KST 기준 예약일)

ALTER TABLE "room-rate"
  ADD COLUMN IF NOT EXISTS promotion_start_date DATE,
  ADD COLUMN IF NOT EXISTS promotion_end_date DATE;
