-- Migration 012: room-rate 테이블 생성
-- 객실별 기본 1박 요금을 관리자가 수정할 수 있도록 저장합니다.

CREATE TABLE IF NOT EXISTS "room-rate" (
  room_name VARCHAR(16) PRIMARY KEY,
  weekday_base_rate BIGINT NOT NULL CHECK (weekday_base_rate >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO "room-rate" (room_name, weekday_base_rate)
VALUES
  ('G1', 250000),
  ('G2', 250000),
  ('G3', 300000),
  ('G4', 350000)
ON CONFLICT (room_name) DO NOTHING;
