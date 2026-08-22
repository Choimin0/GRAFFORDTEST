-- Migration 037: 룸체인지(스플릿 스테이) — 계약은 primary, 점유는 primary + child 행

ALTER TABLE booking
  ADD COLUMN IF NOT EXISTS parent_reservation_number VARCHAR(32),
  ADD COLUMN IF NOT EXISTS stay_role VARCHAR(20) NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS contract_check_in DATE,
  ADD COLUMN IF NOT EXISTS contract_check_out DATE,
  ADD COLUMN IF NOT EXISTS original_room_type VARCHAR(10);

COMMENT ON COLUMN booking.parent_reservation_number IS '룸체인지 child 행이 가리키는 primary 예약번호';
COMMENT ON COLUMN booking.stay_role IS 'primary=원예약, room_change=점유 분할 child';
COMMENT ON COLUMN booking.contract_check_in IS '게스트 조회용 계약 체크인. 룸체인지 시에만 설정';
COMMENT ON COLUMN booking.contract_check_out IS '게스트 조회용 계약 체크아웃. 점유 날짜와 분리';
COMMENT ON COLUMN booking.original_room_type IS '최초 예약 객실. 갤러리·목록 표시용';

CREATE INDEX IF NOT EXISTS idx_booking_parent_reservation
  ON booking (parent_reservation_number)
  WHERE parent_reservation_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_stay_role
  ON booking (stay_role);
