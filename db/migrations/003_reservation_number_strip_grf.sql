-- 기존 GRF- 접두 제거 + 트리거 생성 규칙을 클라이언트와 동일하게 (YYYYMMDD-XXXXXXXX)
-- Vercel / Neon SQL 편집기 또는 psql에서 한 번 실행하세요.

UPDATE reservations
SET reservation_number = substr(reservation_number, 5)
WHERE reservation_number LIKE 'GRF-%';

CREATE OR REPLACE FUNCTION reservations_assign_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  candidate VARCHAR(32);
  attempts INT := 0;
BEGIN
  IF NEW.reservation_number IS NOT NULL AND btrim(NEW.reservation_number) <> '' THEN
    RETURN NEW;
  END IF;

  LOOP
    candidate :=
      to_char(timezone('UTC', now()), 'YYYYMMDD')
      || '-'
      || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM reservations r WHERE r.reservation_number = candidate
    );

    attempts := attempts + 1;
    IF attempts > 20 THEN
      RAISE EXCEPTION 'Could not generate unique reservation_number';
    END IF;
  END LOOP;

  NEW.reservation_number := candidate;
  RETURN NEW;
END;
$$;
