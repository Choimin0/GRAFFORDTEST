-- Optimistic lock (temporary hold) while user is on confirm/payment checkout.
CREATE TABLE IF NOT EXISTS booking_hold (
  hold_id             VARCHAR(64)  PRIMARY KEY,
  room_type           VARCHAR(10)  NOT NULL,
  check_in_date       DATE         NOT NULL,
  check_out_date      DATE         NOT NULL,
  reservation_number  VARCHAR(32),
  expires_at          TIMESTAMPTZ  NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_hold_room_dates
  ON booking_hold (room_type, check_in_date, check_out_date);

CREATE INDEX IF NOT EXISTS idx_booking_hold_expires_at
  ON booking_hold (expires_at);

COMMENT ON TABLE booking_hold IS 'confirm/payment checkout optimistic lock (TTL hold)';
