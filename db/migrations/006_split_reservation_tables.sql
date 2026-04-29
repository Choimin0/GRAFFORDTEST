-- Split reservations into active/past/deleted tables.
-- - reservations: today and future check-in
-- - past_reservations: check-in before today
-- - delete_reservations: all cancelled reservations with reason

CREATE TABLE IF NOT EXISTS past_reservations (
  LIKE reservations INCLUDING ALL
);

CREATE TABLE IF NOT EXISTS delete_reservations (
  LIKE reservations INCLUDING ALL
);

ALTER TABLE delete_reservations
  ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(1000) NOT NULL DEFAULT '';

COMMENT ON TABLE past_reservations IS 'Past reservations (check_in_date < CURRENT_DATE)';
COMMENT ON TABLE delete_reservations IS 'Cancelled reservations (from active/past), includes cancel_reason';
COMMENT ON COLUMN delete_reservations.cancel_reason IS '예약 취소 사유';

CREATE INDEX IF NOT EXISTS idx_past_reservations_check_in
  ON past_reservations (check_in_date);
CREATE INDEX IF NOT EXISTS idx_past_reservations_room_type
  ON past_reservations (room_type);
CREATE INDEX IF NOT EXISTS idx_past_reservations_created_at
  ON past_reservations (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delete_reservations_check_in
  ON delete_reservations (check_in_date);
CREATE INDEX IF NOT EXISTS idx_delete_reservations_room_type
  ON delete_reservations (room_type);
CREATE INDEX IF NOT EXISTS idx_delete_reservations_created_at
  ON delete_reservations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delete_reservations_cancel_reason
  ON delete_reservations (cancel_reason);

WITH moved AS (
  DELETE FROM reservations
  WHERE check_in_date < CURRENT_DATE
  RETURNING *
)
INSERT INTO past_reservations
SELECT * FROM moved
ON CONFLICT (reservation_number) DO NOTHING;
