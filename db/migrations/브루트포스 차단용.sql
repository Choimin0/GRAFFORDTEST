-- 관리자 로그인 실패 기록 (서버리스 환경에서 브루트포스 차단용)
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  ip              TEXT        PRIMARY KEY,
  fail_count      INTEGER     NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until   TIMESTAMPTZ
);

-- 만료된 레코드 자동 정리 (선택사항: pg_cron 사용 시 활성화)
-- SELECT cron.schedule('cleanup-admin-attempts', '0 * * * *',
--   $$DELETE FROM admin_login_attempts WHERE blocked_until < NOW() - INTERVAL '1 day'$$);
