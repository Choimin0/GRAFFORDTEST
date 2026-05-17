ALTER TABLE "room-status"
  ADD COLUMN IF NOT EXISTS status_type VARCHAR(20) NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE "room-status"
SET status_type = 'available'
WHERE status_type IS NULL OR status_type NOT IN ('available', 'repair');

COMMENT ON COLUMN "room-status".status_type IS 'available=판매 가능, repair=수리 예정';
COMMENT ON COLUMN "room-status".updated_at IS '객실 상태/메모 최근 수정일';
