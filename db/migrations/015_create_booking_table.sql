-- ============================================================
-- Migration 015: booking 통합 테이블 생성 및 기존 3개 테이블 데이터 이전
--
-- reservations       → status = 'confirm'   (예약 확정, 체크인 미완료)
-- past_reservations  → status = 'completed' (체크인 완료/과거)
-- delete_reservations→ status = 'cancelled' (취소된 예약)
-- ============================================================

CREATE TABLE IF NOT EXISTS booking (
  id                 BIGSERIAL PRIMARY KEY,
  reservation_number VARCHAR(32)  UNIQUE NOT NULL,
  status             VARCHAR(20)  NOT NULL DEFAULT 'confirm',
    -- 'confirm'   : 확정된 예약 (체크인 전)
    -- 'completed' : 체크인 완료 / 과거 예약
    -- 'cancelled' : 취소된 예약
  guest_name         VARCHAR(255) NOT NULL,
  contact            VARCHAR(120) NOT NULL,
  email              VARCHAR(255),
  room_type          VARCHAR(10)  NOT NULL,
  check_in_date      DATE         NOT NULL,
  check_out_date     DATE         NOT NULL,
  guest_count        INTEGER      NOT NULL DEFAULT 2,
  stay_nights        INTEGER      NOT NULL DEFAULT 1,
  extra_guests       INTEGER      NOT NULL DEFAULT 0,
  total_amount       BIGINT       NOT NULL DEFAULT 0,
  guest_request      TEXT,
  payment_method     VARCHAR(50),
  bank_confirmed     BOOLEAN      DEFAULT FALSE,
  pg_tid             VARCHAR(255),
  refunded_count     INTEGER      NOT NULL DEFAULT 0,
  cancel_reason      TEXT,
  cancelled_at       TIMESTAMPTZ,
  refund_amount      BIGINT,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  booking                    IS '예약 통합 테이블 (confirm/completed/cancelled)';
COMMENT ON COLUMN booking.status             IS 'confirm=예약확정, completed=체크인완료, cancelled=취소';
COMMENT ON COLUMN booking.cancel_reason      IS '취소 사유 (status=cancelled 일 때만 사용)';
COMMENT ON COLUMN booking.cancelled_at       IS '취소 처리 시각 (status=cancelled 일 때만 사용)';
COMMENT ON COLUMN booking.refund_amount      IS '실제 환불 처리된 금액(원). PG 환불 없으면 0, 미기록이면 NULL';
COMMENT ON COLUMN booking.refunded_count     IS '0=미취소, 1=취소(환불)완료';

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_booking_status         ON booking (status);
CREATE INDEX IF NOT EXISTS idx_booking_check_in       ON booking (check_in_date);
CREATE INDEX IF NOT EXISTS idx_booking_room_type      ON booking (room_type);
CREATE INDEX IF NOT EXISTS idx_booking_created_at     ON booking (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_payment_method ON booking (payment_method);
CREATE INDEX IF NOT EXISTS idx_booking_cancelled_at   ON booking (cancelled_at DESC);

-- ----------------------------------------------------------------
-- 기존 데이터 이전
-- ----------------------------------------------------------------

-- 1. reservations → status = 'confirm'
INSERT INTO booking (
  reservation_number, status,
  guest_name, contact, email, room_type,
  check_in_date, check_out_date, guest_count, stay_nights, extra_guests,
  total_amount, guest_request, payment_method, bank_confirmed, pg_tid,
  refunded_count, created_at
)
SELECT
  reservation_number, 'confirm',
  guest_name, contact, email, room_type,
  check_in_date, check_out_date,
  COALESCE(guest_count, 2),
  COALESCE(stay_nights, 1),
  COALESCE(extra_guests, 0),
  COALESCE(total_amount, 0),
  guest_request, payment_method,
  COALESCE(bank_confirmed, FALSE),
  pg_tid,
  COALESCE(refunded_count, 0),
  COALESCE(created_at, NOW())
FROM reservations
ON CONFLICT (reservation_number) DO NOTHING;

-- 2. past_reservations → status = 'completed'
INSERT INTO booking (
  reservation_number, status,
  guest_name, contact, email, room_type,
  check_in_date, check_out_date, guest_count, stay_nights, extra_guests,
  total_amount, guest_request, payment_method, bank_confirmed, pg_tid,
  refunded_count, created_at
)
SELECT
  reservation_number, 'completed',
  guest_name, contact, email, room_type,
  check_in_date, check_out_date,
  COALESCE(guest_count, 2),
  COALESCE(stay_nights, 1),
  COALESCE(extra_guests, 0),
  COALESCE(total_amount, 0),
  guest_request, payment_method,
  COALESCE(bank_confirmed, FALSE),
  pg_tid,
  COALESCE(refunded_count, 0),
  COALESCE(created_at, NOW())
FROM past_reservations
ON CONFLICT (reservation_number) DO NOTHING;

-- 3. delete_reservations → status = 'cancelled'
INSERT INTO booking (
  reservation_number, status,
  guest_name, contact, email, room_type,
  check_in_date, check_out_date, guest_count, stay_nights, extra_guests,
  total_amount, guest_request, payment_method, bank_confirmed, pg_tid,
  refunded_count, cancel_reason, cancelled_at, refund_amount, created_at
)
SELECT
  reservation_number, 'cancelled',
  guest_name, contact, email, room_type,
  check_in_date, check_out_date,
  COALESCE(guest_count, 2),
  COALESCE(stay_nights, 1),
  COALESCE(extra_guests, 0),
  COALESCE(total_amount, 0),
  guest_request, payment_method,
  COALESCE(bank_confirmed, FALSE),
  pg_tid,
  COALESCE(refunded_count, 0),
  cancel_reason,
  cancelled_at,
  refund_amount,
  COALESCE(created_at, NOW())
FROM delete_reservations
ON CONFLICT (reservation_number) DO NOTHING;
