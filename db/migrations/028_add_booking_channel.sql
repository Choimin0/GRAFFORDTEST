-- ============================================================
-- Migration 028: booking_channel · linked_external_uid
-- 외부 플랫폼 수기 예약 구분 및 Airbnb iCal 병합용
-- ============================================================

ALTER TABLE booking
  ADD COLUMN IF NOT EXISTS booking_channel VARCHAR(20) NOT NULL DEFAULT 'direct';

ALTER TABLE booking
  ADD COLUMN IF NOT EXISTS linked_external_uid VARCHAR(255);

COMMENT ON COLUMN booking.booking_channel IS
  'direct=자체예약, airbnb, naver, stayfolio, phone=유선문의';

COMMENT ON COLUMN booking.linked_external_uid IS
  'Airbnb iCal external_booking.external_uid 연결 (달력 중복 제거용)';

CREATE INDEX IF NOT EXISTS idx_booking_channel
  ON booking (booking_channel);

CREATE INDEX IF NOT EXISTS idx_booking_linked_external_uid
  ON booking (linked_external_uid)
  WHERE linked_external_uid IS NOT NULL;
