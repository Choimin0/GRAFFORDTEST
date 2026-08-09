-- Migration 033: 기간별 요금 옵션 우선순위 (객실별 목록 순서)
-- priority 1 = 최상위. 초기값은 기존 updated_at 최신순(= 최근 추가·수정 우선)과 동일하게 부여.
ALTER TABLE "room-rate"
  ADD COLUMN IF NOT EXISTS seasonal_priority INTEGER;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY room_name
           ORDER BY updated_at DESC, id DESC
         ) AS rn
  FROM "room-rate"
  WHERE period_start_date IS NOT NULL
    AND period_end_date IS NOT NULL
)
UPDATE "room-rate" AS r
SET seasonal_priority = ranked.rn
FROM ranked
WHERE r.id = ranked.id
  AND r.seasonal_priority IS NULL;

CREATE INDEX IF NOT EXISTS idx_room_rate_seasonal_priority
  ON "room-rate" (room_name, seasonal_priority)
  WHERE period_start_date IS NOT NULL AND period_end_date IS NOT NULL;
