-- 암호화된 guest_name / contact / email 이 VARCHAR(255)를 초과할 수 있어 TEXT로 확장
ALTER TABLE booking
  ALTER COLUMN guest_name TYPE TEXT,
  ALTER COLUMN contact TYPE TEXT,
  ALTER COLUMN email TYPE TEXT;
