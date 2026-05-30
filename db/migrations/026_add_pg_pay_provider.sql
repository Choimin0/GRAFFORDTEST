-- KG이니시스(PortOne) 결제창에서 실제 선택된 간편결제 PG 코드 저장
ALTER TABLE booking
  ADD COLUMN IF NOT EXISTS pg_pay_provider VARCHAR(32);

COMMENT ON COLUMN booking.pg_pay_provider IS
  'PortOne easyPayProvider 원문 (SAMSUNGPAY, NAVERPAY, KAKAOPAY, TOSSPAY). 신용카드·무통장 시 NULL';

COMMENT ON COLUMN booking.payment_method IS
  'card | samsung | naver | kakao | toss | bank — PG 검증 후 확정된 결제수단';
