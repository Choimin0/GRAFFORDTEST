ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS bank_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN reservations.bank_confirmed IS '무통장 입금 확인 여부 (false: 입금대기, true: 입금확인)';
