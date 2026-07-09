-- Migration 031: 객실별 기본 요금(평일·주말) 업데이트
-- 기간별 요금 옵션에 해당하지 않는 날짜에 적용되는 기본 요금입니다.

UPDATE "room-rate"
SET weekday_base_rate = 280000,
    weekend_base_rate = 280000,
    updated_at = NOW()
WHERE room_name = 'G1'
  AND period_start_date IS NULL
  AND period_end_date IS NULL;

UPDATE "room-rate"
SET weekday_base_rate = 280000,
    weekend_base_rate = 280000,
    updated_at = NOW()
WHERE room_name = 'G2'
  AND period_start_date IS NULL
  AND period_end_date IS NULL;

UPDATE "room-rate"
SET weekday_base_rate = 320000,
    weekend_base_rate = 320000,
    updated_at = NOW()
WHERE room_name = 'G3'
  AND period_start_date IS NULL
  AND period_end_date IS NULL;

UPDATE "room-rate"
SET weekday_base_rate = 410000,
    weekend_base_rate = 410000,
    updated_at = NOW()
WHERE room_name = 'G4'
  AND period_start_date IS NULL
  AND period_end_date IS NULL;
