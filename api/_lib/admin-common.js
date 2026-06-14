import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;

export const MAX_ADMIN_LOGIN_FAILS = 5;
export const ADMIN_BLOCK_MINUTES = Math.max(
  1,
  parseInt(process.env.ADMIN_LOGIN_BLOCK_MINUTES || "60", 10) || 60,
);

var poolSingleton = null;

export function getDatabaseUrl() {
  return String(
    process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL ||
      "",
  ).trim();
}

export function getPool() {
  var databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }
  if (!poolSingleton) {
    poolSingleton = new Pool({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: 20000,
      idleTimeoutMillis: 15000,
    });
  }
  return poolSingleton;
}

/**
 * CORS origin 결정.
 * ALLOWED_ORIGIN 환경변수 설정 시 해당 도메인만, 미설정 시 same-origin(null 반환)
 */
export function getAllowedOrigin() {
  return String(process.env.ALLOWED_ORIGIN || "").trim() || null;
}

export function json(res, status, body) {
  var origin = getAllowedOrigin();
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(body));
}

export function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (c) {
      chunks.push(c);
    });
    req.on("end", function () {
      try {
        var raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export async function getJsonBody(req) {
  if (
    req.body != null &&
    typeof req.body === "object" &&
    !Buffer.isBuffer(req.body)
  ) {
    return req.body;
  }
  return readBody(req);
}

/** 고정 길이 버퍼 비교로 타이밍 공격 방지 */
function safeStringEqual(a, b) {
  var bufLen = Math.max(64, Buffer.byteLength(a, "utf8"), Buffer.byteLength(b, "utf8"));
  var bufA = Buffer.alloc(bufLen);
  var bufB = Buffer.alloc(bufLen);
  Buffer.from(a, "utf8").copy(bufA);
  Buffer.from(b, "utf8").copy(bufB);
  return crypto.timingSafeEqual(bufA, bufB);
}

export function isAdminOk(body) {
  var inputId = String((body && body.adminId) || "").trim();
  var inputPw = String((body && body.adminPw) || "").trim();
  var envId = String(process.env.ADMIN_ID || "").trim();
  var envPw = String(process.env.ADMIN_PW || "").trim();
  if (!envId || !envPw) {
    return { ok: false, error: "서버 ADMIN_ID/ADMIN_PW가 설정되지 않았습니다." };
  }
  if (!inputId || !inputPw) {
    return { ok: false, error: "관리자 ID/PW를 입력해주세요." };
  }
  if (!safeStringEqual(inputId, envId) || !safeStringEqual(inputPw, envPw)) {
    return { ok: false, error: "관리자 인증에 실패했습니다." };
  }
  return { ok: true };
}

export function getClientIp(req) {
  var forwarded = String(
    (req &&
      req.headers &&
      (req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"])) ||
      "",
  )
    .split(",")[0]
    .trim();
  var realIp = String(
    (req &&
      req.headers &&
      (req.headers["x-real-ip"] || req.headers["X-Real-IP"])) ||
      "",
  ).trim();
  var socketIp =
    (req && req.socket && String(req.socket.remoteAddress || "").trim()) || "";
  return forwarded || realIp || socketIp || "unknown";
}

/**
 * DB 기반 브루트포스 차단.
 * 서버리스 cold start 후에도 상태가 유지됩니다.
 * 테이블이 없으면 조용히 실패(fail-open) 하여 기존 동작을 유지합니다.
 */
async function dbGetIpBlockedUntil(pool, ip, now) {
  try {
    var result = await pool.query(
      `SELECT blocked_until, fail_count
       FROM admin_login_attempts
       WHERE ip = $1
       LIMIT 1`,
      [ip],
    );
    if (!result.rows || !result.rows.length) {
      return 0;
    }
    var row = result.rows[0];
    var blocked = row.blocked_until ? Number(new Date(row.blocked_until)) : 0;
    if (blocked > 0 && blocked <= now) {
      await pool.query("DELETE FROM admin_login_attempts WHERE ip = $1", [ip]);
      return 0;
    }
    return blocked;
  } catch (_e) {
    return 0;
  }
}

async function dbRegisterLoginFailure(pool, ip, now) {
  try {
    var result = await pool.query(
      `INSERT INTO admin_login_attempts (ip, fail_count, last_attempt_at, blocked_until)
       VALUES ($1, 1, NOW(), NULL)
       ON CONFLICT (ip)
       DO UPDATE SET
         fail_count       = admin_login_attempts.fail_count + 1,
         last_attempt_at  = NOW(),
         blocked_until    = CASE
           WHEN admin_login_attempts.fail_count + 1 >= $2
             THEN NOW() + ($3 * INTERVAL '1 minute')
           ELSE NULL
         END
       RETURNING fail_count, blocked_until`,
      [ip, MAX_ADMIN_LOGIN_FAILS, ADMIN_BLOCK_MINUTES],
    );
    var row = result.rows && result.rows[0];
    var blocked = row && row.blocked_until ? Number(new Date(row.blocked_until)) : 0;
    return { fails: row ? Number(row.fail_count) : 1, blockedUntil: blocked };
  } catch (_e) {
    return { fails: 1, blockedUntil: 0 };
  }
}

async function dbClearLoginFailures(pool, ip) {
  try {
    await pool.query("DELETE FROM admin_login_attempts WHERE ip = $1", [ip]);
  } catch (_e) {
    // 테이블 없는 경우도 무시
  }
}

/** @returns {{ ok: true } | { ok: false, status: number, error: string }} */
export async function requireAdminAuth(req, body, pool) {
  var clientIp = getClientIp(req);
  var now = Date.now();

  if (pool) {
    var blockedUntil = await dbGetIpBlockedUntil(pool, clientIp, now);
    if (blockedUntil > now) {
      var remainingMinutes = Math.ceil((blockedUntil - now) / (60 * 1000));
      return {
        ok: false,
        status: 429,
        error:
          "로그인 실패 5회 이상으로 차단되었습니다. 약 " +
          remainingMinutes +
          "분 후 다시 시도해 주세요.",
      };
    }
  }

  var auth = isAdminOk(body);
  if (!auth.ok) {
    if (pool) {
      var state = await dbRegisterLoginFailure(pool, clientIp, now);
      if (state.blockedUntil && state.blockedUntil > now) {
        return {
          ok: false,
          status: 429,
          error:
            "로그인 실패 5회 이상으로 차단되었습니다. 약 " +
            ADMIN_BLOCK_MINUTES +
            "분 후 다시 시도해 주세요.",
        };
      }
    }
    return { ok: false, status: 401, error: auth.error };
  }

  if (pool) {
    await dbClearLoginFailures(pool, clientIp);
  }
  return { ok: true };
}
