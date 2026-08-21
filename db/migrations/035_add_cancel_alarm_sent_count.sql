-- Migration 035: 예약 취소 알림톡(cancel-complete) 발송 횟수

ALTER TABLE booking
  ADD COLUMN IF NOT EXISTS cancel_alarm_sent_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN booking.cancel_alarm_sent_count IS '예약 취소 완료 알림톡(cancel-complete) 발송 횟수';

-- 이미 취소된 예약은 재조회(delete-complete) 시 추가 발송하지 않도록 1회로 간주
UPDATE booking
SET cancel_alarm_sent_count = 1
WHERE status = 'cancelled'
  AND COALESCE(cancel_alarm_sent_count, 0) = 0;
