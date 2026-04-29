-- Optimize hourly unpaid-bank cleanup scans.

CREATE INDEX IF NOT EXISTS idx_reservations_unpaid_bank_created_at
  ON reservations (created_at)
  WHERE payment_method = 'bank' AND bank_confirmed = FALSE;

CREATE INDEX IF NOT EXISTS idx_past_reservations_unpaid_bank_created_at
  ON past_reservations (created_at)
  WHERE payment_method = 'bank' AND bank_confirmed = FALSE;
