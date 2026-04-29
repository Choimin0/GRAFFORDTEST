-- Add cancellation timestamp to deleted reservations.

ALTER TABLE delete_reservations
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN delete_reservations.cancelled_at IS '예약 취소 일시';

CREATE INDEX IF NOT EXISTS idx_delete_reservations_cancelled_at
  ON delete_reservations (cancelled_at DESC);
