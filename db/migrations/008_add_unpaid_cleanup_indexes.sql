-- Optimize hourly unpaid-bank cleanup scans.

CREATE INDEX IF NOT EXISTS idx_reservations_unpaid_bank_created_at
  ON reservations (created_at)
  WHERE coalesce(lower(trim(payment_method)), 'bank') IN ('bank', '무통장입금')
    AND bank_confirmed IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_past_reservations_unpaid_bank_created_at
  ON past_reservations (created_at)
  WHERE coalesce(lower(trim(payment_method)), 'bank') IN ('bank', '무통장입금')
    AND bank_confirmed IS NOT TRUE;
