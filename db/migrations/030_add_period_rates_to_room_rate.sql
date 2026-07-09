-- 기간별 요금을 room-rate 테이블에 통합 (별도 room-rate-period 테이블 제거)
DROP TABLE IF EXISTS "room-rate-period";

ALTER TABLE "room-rate"
  ADD COLUMN IF NOT EXISTS id BIGSERIAL;

ALTER TABLE "room-rate"
  ADD COLUMN IF NOT EXISTS period_start_date DATE,
  ADD COLUMN IF NOT EXISTS period_end_date DATE;

ALTER TABLE "room-rate"
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'room-rate_pkey'
      AND conrelid = '"room-rate"'::regclass
  ) THEN
    ALTER TABLE "room-rate" DROP CONSTRAINT "room-rate_pkey";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'room_rate_id_pkey'
      AND conrelid = '"room-rate"'::regclass
  ) THEN
    ALTER TABLE "room-rate" ADD CONSTRAINT room_rate_id_pkey PRIMARY KEY (id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS room_rate_base_room_name_key
  ON "room-rate" (room_name)
  WHERE period_start_date IS NULL AND period_end_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_room_rate_period_lookup
  ON "room-rate" (room_name, period_start_date, period_end_date)
  WHERE period_start_date IS NOT NULL AND period_end_date IS NOT NULL;
