-- Migration 036: 결제 전 초안은 새 테이블 없이 booking.status = 'pending' 으로 저장합니다.
-- 예약 완료 알림톡 중복 방지를 위해 booking 컬럼만 추가합니다.

DROP TABLE IF EXISTS booking_checkout;

ALTER TABLE booking
  ADD COLUMN IF NOT EXISTS reserve_alarm_sent_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN booking.reserve_alarm_sent_count IS '예약 완료 알림톡(reserve-complete) 발송 횟수';

UPDATE booking
SET reserve_alarm_sent_count = 1
WHERE status IN ('confirm', 'completed')
  AND COALESCE(reserve_alarm_sent_count, 0) = 0;
