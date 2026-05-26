-- Migration 025: 예약 언어/채널 구분 (kr=한국어, en=영문·국제)
ALTER TABLE booking
  ADD COLUMN IF NOT EXISTS booking_locale VARCHAR(5) NOT NULL DEFAULT 'kr';

COMMENT ON COLUMN booking.booking_locale IS 'kr=한국어 예약(알림톡), en=영문 예약(이메일 안내)';
