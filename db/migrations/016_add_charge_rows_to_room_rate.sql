-- Migration 016: room-rate 테이블에 주말요금/연박할인/프로모션 행 추가
-- weekend-charge : 주말(금·토) 박당 추가 요금 (원)
-- consecutive-sale : 연박(2박 이상) 1박당 할인 (원)
-- promotion : 기본 객실료 대비 할인율 (%)
-- ON CONFLICT DO NOTHING → 이미 존재하면 기존 값 유지

INSERT INTO "room-rate" (room_name, weekday_base_rate)
VALUES
  ('weekend-charge',   20000),
  ('consecutive-sale', 20000),
  ('promotion',            0)
ON CONFLICT (room_name) DO NOTHING;
