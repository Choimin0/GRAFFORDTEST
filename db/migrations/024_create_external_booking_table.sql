-- ============================================================
-- Migration 024: 외부 iCal(Airbnb 등) 예약 동기화 테이블
-- ============================================================

CREATE TABLE IF NOT EXISTS external_booking (
  id              BIGSERIAL PRIMARY KEY,
  room_type       VARCHAR(10)  NOT NULL,
  external_uid    VARCHAR(255) NOT NULL,
  source          VARCHAR(50)  NOT NULL DEFAULT 'ical',
  check_in_date   DATE         NOT NULL,
  check_out_date  DATE         NOT NULL,
  summary         TEXT,
  import_url      TEXT         NOT NULL,
  dt_stamp        TEXT,
  last_synced_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (room_type, external_uid)
);

COMMENT ON TABLE  external_booking              IS '외부 iCal 피드(Airbnb 등)에서 동기화된 예약/블록';
COMMENT ON COLUMN external_booking.external_uid IS 'iCal VEVENT UID (없으면 sync 시 synthetic UID 생성)';
COMMENT ON COLUMN external_booking.source       IS 'airbnb, ical 등 외부 채널';
COMMENT ON COLUMN external_booking.import_url   IS '동기화에 사용한 iCal URL';

CREATE INDEX IF NOT EXISTS idx_external_booking_room_dates
  ON external_booking (room_type, check_in_date, check_out_date);

CREATE INDEX IF NOT EXISTS idx_external_booking_import_url
  ON external_booking (room_type, import_url);

CREATE INDEX IF NOT EXISTS idx_external_booking_last_synced
  ON external_booking (last_synced_at DESC);
