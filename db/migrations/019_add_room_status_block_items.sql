ALTER TABLE "room-status"
  ADD COLUMN IF NOT EXISTS block_items JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN "room-status".block_items IS '관리자 방막기 항목 배열: id, startDate, endDate, reason, memo, createdAt';
