import pg from "pg";

const { Pool } = pg;

export const MAX_ADMIN_LOGIN_FAILS = 5;
export const ADMIN_BLOCK_MINUTES = Math.max(
  1,
  parseInt(process.env.ADMIN_LOGIN_BLOCK_MINUTES || "60", 10) || 60,
);

export var adminLoginAttemptStore = new Map();

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

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
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
  if (inputId !== envId || inputPw !== envPw) {
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

function getIpAttemptState(ip, now) {
  var state = adminLoginAttemptStore.get(ip);
  if (!state) {
    return null;
  }
  if (state.blockedUntil && state.blockedUntil <= now) {
    adminLoginAttemptStore.delete(ip);
    return null;
  }
  return state;
}

export function getIpBlockedUntil(ip, now) {
  var state = getIpAttemptState(ip, now);
  if (!state || !state.blockedUntil || state.blockedUntil <= now) {
    return 0;
  }
  return state.blockedUntil;
}

export function registerLoginFailure(ip, now) {
  var state = getIpAttemptState(ip, now) || { fails: 0, blockedUntil: 0 };
  state.fails += 1;
  if (state.fails >= MAX_ADMIN_LOGIN_FAILS) {
    state.blockedUntil = now + ADMIN_BLOCK_MINUTES * 60 * 1000;
  }
  adminLoginAttemptStore.set(ip, state);
  return state;
}

export function clearLoginFailures(ip) {
  adminLoginAttemptStore.delete(ip);
}

/** @returns {{ ok: true } | { ok: false, status: number, error: string }} */
export function requireAdminAuth(req, body) {
  var clientIp = getClientIp(req);
  var now = Date.now();
  var blockedUntil = getIpBlockedUntil(clientIp, now);
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

  var auth = isAdminOk(body);
  if (!auth.ok) {
    var state = registerLoginFailure(clientIp, now);
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
    return { ok: false, status: 401, error: auth.error };
  }
  clearLoginFailures(clientIp);
  return { ok: true };
}
