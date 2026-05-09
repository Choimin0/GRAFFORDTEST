-- Migration 011: PG사 거래번호(TID) 컬럼 추가
-- KG이니시스 등 PG사에서 발급하는 거래번호(TID)를 저장합니다.
-- 결제 취소 시 해당 TID를 통해 PG사에 취소 요청을 보낼 수 있습니다.
-- PortOne v2 기준 payment.transactions[0].pgTxId 값이 저장됩니다.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS pg_tid VARCHAR(255) DEFAULT NULL;

ALTER TABLE past_reservations
  ADD COLUMN IF NOT EXISTS pg_tid VARCHAR(255) DEFAULT NULL;

ALTER TABLE delete_reservations
  ADD COLUMN IF NOT EXISTS pg_tid VARCHAR(255) DEFAULT NULL;
