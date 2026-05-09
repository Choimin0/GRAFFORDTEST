import pg from "pg";

const { Pool } = pg;
const BOOKING_TABLE = "booking";
const MAX_ADMIN_LOGIN_FAILS = 5;
const ADMIN_BLOCK_MINUTES = Math.max(
  1,
  parseInt(process.env.ADMIN_LOGIN_BLOCK_MINUTES || "60", 10) || 60,
);

var adminLoginAttemptStore = new Map();

// collection → booking 테이블 status 필터 매핑
const ALLOWED_COLLECTIONS = {
  reservations: "confirm",
  "past-reservations": "completed",
  "delete-reservations": "cancelled",
};

function getDatabaseUrl() {
  return String(
    process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL ||
      "",
  ).trim();
}

var poolSingleton = null;

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

function toYMD(v) {
  if (v == null || v === "") {
    return "";
  }
  if (typeof v === "string") {
    return v.slice(0, 10);
  }
  var d = new Date(v);
  if (isNaN(d.getTime())) {
    return "";
  }
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, "0");
  var day = String(d.getUTCDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function formatDateTimeKst(v) {
  if (v == null || v === "") {
    return "";
  }
  var d = new Date(v);
  if (isNaN(d.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
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

async function archivePastReservations(pool) {
  await pool.query(
    `UPDATE ${BOOKING_TABLE}
     SET status = 'completed'
     WHERE status = 'confirm'
       AND check_in_date < CURRENT_DATE`,
  );
}

async function autoCancelUnpaidReservations(pool) {
  await pool.query(
    `UPDATE ${BOOKING_TABLE}
     SET status        = 'cancelled',
         cancel_reason = 'not paid',
         cancelled_at  = NOW()
     WHERE status IN ('confirm', 'completed')
       AND coalesce(lower(trim(payment_method)), 'bank') IN ('bank', '무통장입금')
       AND bank_confirmed IS NOT TRUE
       AND created_at <= NOW() - INTERVAL '12 hours'`,
  );
}

function mapRow(row, isDeleted) {
  var base = {
    reservationNumber: row.reservation_number,
    guestName: row.guest_name,
    contact: row.contact,
    roomType: row.room_type,
    checkIn: toYMD(row.check_in_date),
    checkOut: toYMD(row.check_out_date),
    guestCount: row.guest_count,
    totalAmount: row.total_amount != null ? Number(row.total_amount) : 0,
    stayPeriod: row.stay_nights != null ? Number(row.stay_nights) : null,
    guestRequest: row.guest_request || "",
    paymentMethod: row.payment_method || "",
    createdAt: formatDateTimeKst(row.created_at),
  };
  if (isDeleted) {
    base.cancelReason = row.cancel_reason || "";
    base.cancelledAt = formatDateTimeKst(row.cancelled_at);
  }
  return base;
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

  var collection = String(body.collection || "reservations")
    .trim()
    .toLowerCase();

  if (!ALLOWED_COLLECTIONS[collection]) {
    json(res, 400, { ok: false, error: "유효하지 않은 collection입니다." });
    return;
  }

  var statusFilter = ALLOWED_COLLECTIONS[collection];
  var isDeleted = collection === "delete-reservations";
  var isActive = collection === "reservations";

  try {
    await archivePastReservations(pool);
    await autoCancelUnpaidReservations(pool);
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "archive failed"),
    });
    return;
  }

  try {
    var orderClause = isDeleted
      ? "ORDER BY cancelled_at DESC, created_at DESC"
      : "ORDER BY check_in_date ASC, created_at DESC";

    var extraCols = isDeleted ? ", cancel_reason, cancelled_at" : "";

    var sel = await pool.query(
      `SELECT
        reservation_number,
        guest_name,
        contact,
        room_type,
        check_in_date,
        check_out_date,
        guest_count,
        total_amount,
        stay_nights,
        guest_request,
        payment_method,
        created_at
        ${extraCols}
      FROM ${BOOKING_TABLE}
      WHERE status = $1
      ${orderClause}`,
      [statusFilter],
    );

    var rows = (sel.rows || []).map(function (row) {
      return mapRow(row, isDeleted);
    });

    var result = { ok: true, rows: rows };

    if (isActive) {
      // 달력용: confirm + completed 모두 포함
      var calSel = await pool.query(
        `SELECT
          reservation_number, guest_name, contact, room_type,
          check_in_date, check_out_date, guest_count, total_amount,
          stay_nights, guest_request, payment_method, bank_confirmed,
          created_at, (status = 'completed') AS is_past
        FROM ${BOOKING_TABLE}
        WHERE status IN ('confirm', 'completed')
        ORDER BY check_in_date ASC, created_at DESC`,
      );
      result.calendarRows = (calSel.rows || []).map(function (row) {
        return {
          reservationNumber: row.reservation_number,
          guestName: row.guest_name,
          contact: row.contact,
          roomType: row.room_type,
          checkIn: toYMD(row.check_in_date),
          checkOut: toYMD(row.check_out_date),
          guestCount: row.guest_count,
          totalAmount: row.total_amount != null ? Number(row.total_amount) : 0,
          stayPeriod: row.stay_nights != null ? Number(row.stay_nights) : null,
          guestRequest: row.guest_request || "",
          paymentMethod: row.payment_method || "",
          bankConfirmed: row.bank_confirmed === true,
          createdAt: formatDateTimeKst(row.created_at),
          isPast: row.is_past === true,
        };
      });
    }

    json(res, 200, result);
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "lookup failed"),
    });
  }
}
