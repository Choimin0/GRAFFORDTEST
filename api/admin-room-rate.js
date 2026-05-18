import pg from "pg";

const { Pool } = pg;
const TABLE_NAME = '"room-rate"';
const MAX_ADMIN_LOGIN_FAILS = 5;
const ADMIN_BLOCK_MINUTES = Math.max(
  1,
  parseInt(process.env.ADMIN_LOGIN_BLOCK_MINUTES || "60", 10) || 60,
);

var poolSingleton = null;
var adminLoginAttemptStore = new Map();

function getDatabaseUrl() {
  return String(
    process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL ||
      "",
  ).trim();
}

function getPool() {
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

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(body));
}

function readBody(req) {
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

function isAdminOk(body) {
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

function getClientIp(req) {
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

function getIpBlockedUntil(ip, now) {
  var state = getIpAttemptState(ip, now);
  if (!state || !state.blockedUntil || state.blockedUntil <= now) {
    return 0;
  }
  return state.blockedUntil;
}

function registerLoginFailure(ip, now) {
  var state = getIpAttemptState(ip, now) || { fails: 0, blockedUntil: 0 };
  state.fails += 1;
  if (state.fails >= MAX_ADMIN_LOGIN_FAILS) {
    state.blockedUntil = now + ADMIN_BLOCK_MINUTES * 60 * 1000;
  }
  adminLoginAttemptStore.set(ip, state);
  return state;
}

function clearLoginFailures(ip) {
  adminLoginAttemptStore.delete(ip);
}

var SPECIAL_CHARGE_NAMES = [
  "weekend-charge",
  "consecutive-sale",
  "promotion",
  "extra-guest-charge",
];

function normalizeRoomName(v) {
  var trimmed = String(v || "").trim();
  if (SPECIAL_CHARGE_NAMES.includes(trimmed.toLowerCase())) {
    return trimmed.toLowerCase();
  }
  return trimmed.toUpperCase();
}

async function ensureRoomRateTable(pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      room_name VARCHAR(32) PRIMARY KEY,
      weekday_base_rate BIGINT NOT NULL CHECK (weekday_base_rate >= 0),
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ALTER COLUMN room_name TYPE VARCHAR(32)`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
  );
  await pool.query(
    `INSERT INTO ${TABLE_NAME} (room_name, weekday_base_rate, is_enabled)
     VALUES ('G1', 250000, TRUE), ('G2', 250000, TRUE), ('G3', 300000, TRUE), ('G4', 350000, TRUE),
            ('weekend-charge', 20000, TRUE), ('consecutive-sale', 20000, TRUE),
            ('promotion', 0, TRUE), ('extra-guest-charge', 30000, TRUE)
     ON CONFLICT (room_name) DO NOTHING`,
  );
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  var pool = getPool();
  if (!pool) {
    json(res, 503, { ok: false, error: "DB 연결 정보가 없습니다." });
    return;
  }

  var body;
  try {
    body = await readBody(req);
  } catch (e) {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  var clientIp = getClientIp(req);
  var now = Date.now();
  var blockedUntil = getIpBlockedUntil(clientIp, now);
  if (blockedUntil > now) {
    var remainingMinutes = Math.ceil((blockedUntil - now) / (60 * 1000));
    json(res, 429, {
      ok: false,
      error:
        "로그인 실패 5회 이상으로 차단되었습니다. 약 " +
        remainingMinutes +
        "분 후 다시 시도해 주세요.",
    });
    return;
  }

  var auth = isAdminOk(body);
  if (!auth.ok) {
    var state = registerLoginFailure(clientIp, now);
    if (state.blockedUntil && state.blockedUntil > now) {
      json(res, 429, {
        ok: false,
        error:
          "로그인 실패 5회 이상으로 차단되었습니다. 약 " +
          ADMIN_BLOCK_MINUTES +
          "분 후 다시 시도해 주세요.",
      });
      return;
    }
    json(res, 401, { ok: false, error: auth.error });
    return;
  }
  clearLoginFailures(clientIp);

  try {
    await ensureRoomRateTable(pool);
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "room-rate table init failed"),
    });
    return;
  }

  var action = String(body.action || "list").trim().toLowerCase();
  if (action === "save") {
    var roomName = normalizeRoomName(body.roomName || "");
    var weekdayBaseRate = Number(body.weekdayBaseRate);
    var isGRoom = /^G[1-4]$/.test(roomName);
    var isCharge = SPECIAL_CHARGE_NAMES.includes(roomName);
    if (!isGRoom && !isCharge) {
      json(res, 400, { ok: false, error: "유효하지 않은 객실명입니다." });
      return;
    }
    if (!Number.isFinite(weekdayBaseRate) || weekdayBaseRate < 0) {
      json(res, 400, { ok: false, error: "유효하지 않은 요금입니다." });
      return;
    }
    if (roomName === "promotion" && weekdayBaseRate > 100) {
      json(res, 400, { ok: false, error: "프로모션 할인율은 0~100% 사이로 입력해 주세요." });
      return;
    }
    try {
      await pool.query(
        `UPDATE ${TABLE_NAME}
         SET weekday_base_rate = $2,
             updated_at = NOW()
         WHERE room_name = $1`,
        [roomName, Math.floor(weekdayBaseRate)],
      );
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: String((e && e.message) || e || "save failed"),
      });
      return;
    }
  }

  if (action === "toggle") {
    var toggleRoomName = normalizeRoomName(body.roomName || "");
    var isToggleCharge = SPECIAL_CHARGE_NAMES.includes(toggleRoomName);
    if (!isToggleCharge) {
      json(res, 400, { ok: false, error: "유효하지 않은 요금 정책입니다." });
      return;
    }
    try {
      await pool.query(
        `UPDATE ${TABLE_NAME}
         SET is_enabled = $2,
             updated_at = NOW()
         WHERE room_name = $1`,
        [toggleRoomName, body.isEnabled === true],
      );
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: String((e && e.message) || e || "toggle failed"),
      });
      return;
    }
  }

  try {
    var sel = await pool.query(
      `SELECT room_name, weekday_base_rate, is_enabled
       FROM ${TABLE_NAME}
       ORDER BY room_name ASC`,
    );
    var rows = (sel.rows || []).map(function (row) {
      return {
        roomName: row.room_name,
        weekdayBaseRate: Number(row.weekday_base_rate || 0),
        isEnabled: row.is_enabled !== false,
      };
    });
    json(res, 200, { ok: true, rows: rows });
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "lookup failed"),
    });
  }
}
