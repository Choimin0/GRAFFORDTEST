-- GRAFFORD: lodging reservations
-- Run once against your Vercel / Prisma Postgres database (SQL editor or psql).

-- Optional: needed only if gen_random_uuid() is not available on your Postgres version.
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS reservations (
  id BIGSERIAL PRIMARY KEY,
  reservation_number VARCHAR(32) NOT NULL,
  guest_name VARCHAR(255) NOT NULL,
  contact VARCHAR(120) NOT NULL,
  room_type VARCHAR(50) NOT NULL,
  check_in_date DATE NOT NULL,
  check_out_date DATE,
  guest_count SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reservations_guest_count_positive CHECK (guest_count >= 1 AND guest_count <= 50),
  CONSTRAINT reservations_reservation_number_unique UNIQUE (reservation_number),
  CONSTRAINT reservations_check_out_after_check_in CHECK (
    check_out_date IS NULL OR check_out_date >= check_in_date
  )
);

CREATE INDEX IF NOT EXISTS idx_reservations_check_in ON reservations (check_in_date);
CREATE INDEX IF NOT EXISTS idx_reservations_room_type ON reservations (room_type);
CREATE INDEX IF NOT EXISTS idx_reservations_created_at ON reservations (created_at DESC);

COMMENT ON TABLE reservations IS 'Lodging reservations: name, contact, room type, dates, guest count, reservation number';

-- Auto-generate reservation_number on INSERT when omitted (e.g. GRF-20260419-A1B2C3D4).
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
      'GRF-'
      || to_char(timezone('UTC', now()), 'YYYYMMDD')
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

DROP TRIGGER IF EXISTS trg_reservations_assign_number ON reservations;

CREATE TRIGGER trg_reservations_assign_number
  BEFORE INSERT ON reservations
  FOR EACH ROW
  EXECUTE PROCEDURE reservations_assign_number();

-- Example: omit reservation_number; trigger assigns GRF-YYYYMMDD-XXXXXXXX
-- INSERT INTO reservations (guest_name, contact, room_type, check_in_date, check_out_date, guest_count)
-- VALUES ('Hong Gildong', '010-1234-5678', 'A', '2026-05-01', '2026-05-03', 2)
-- RETURNING id, reservation_number, created_at;
