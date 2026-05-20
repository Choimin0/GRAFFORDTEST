-- Migration 020: booking.other_reason — 취소 사유가 '기타'일 때 상세 내용

ALTER TABLE booking
  ADD COLUMN IF NOT EXISTS other_reason TEXT;

COMMENT ON COLUMN booking.other_reason IS '취소 사유 기타(other) 선택 시 상세 내용';
