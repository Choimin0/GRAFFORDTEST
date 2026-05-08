CREATE TABLE IF NOT EXISTS "room-status" (
  room_name VARCHAR(16) PRIMARY KEY,
  status_text TEXT NOT NULL DEFAULT ''
);

INSERT INTO "room-status" (room_name, status_text)
VALUES
  ('G1', ''),
  ('G2', ''),
  ('G3', ''),
  ('G4', '')
ON CONFLICT (room_name) DO NOTHING;
