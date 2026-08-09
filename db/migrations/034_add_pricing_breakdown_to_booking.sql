-- Migration 034: 예약 시점 금액 산정 내역(JSON) 저장
ALTER TABLE booking
  ADD COLUMN IF NOT EXISTS pricing_breakdown JSONB;

COMMENT ON COLUMN booking.pricing_breakdown IS
  '홈페이지 예약 시점 금액 산정 내역 (주중/주말, 연박·프로모션 할인 등)';
