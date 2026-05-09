-- 취소(환불) 완료 시 실제 환불 처리된 금액을 delete_reservations에 기록합니다.
-- refund_amount: PortOne을 통해 환불된 금액(원 단위). 은행이체나 0원 취소는 NULL 또는 0.

ALTER TABLE delete_reservations
  ADD COLUMN IF NOT EXISTS refund_amount BIGINT DEFAULT NULL;

COMMENT ON COLUMN delete_reservations.refund_amount IS '실제 환불 처리된 금액(원). PG 환불이 없으면 0, 미기록이면 NULL';
