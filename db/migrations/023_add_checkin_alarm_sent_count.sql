-- Migration 023: 입실 안내 알림톡(checkin-alarm) 발송 횟수

ALTER TABLE booking
  ADD COLUMN IF NOT EXISTS checkin_alarm_sent_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN booking.checkin_alarm_sent_count IS '입실 안내 알림톡(checkin-alarm) 발송 횟수';
