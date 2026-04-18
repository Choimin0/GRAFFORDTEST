-- 결제·숙박 상세 (Vercel Postgres / api/reservations 연동용)
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS stay_nights SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS extra_guests SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(32);

COMMENT ON COLUMN reservations.stay_nights IS '숙박 박 수';
COMMENT ON COLUMN reservations.extra_guests IS '기준 인원 외 추가 인원 수';
COMMENT ON COLUMN reservations.total_amount IS '결제(예정) 총액(원)';
COMMENT ON COLUMN reservations.payment_method IS 'card | naver | bank';
