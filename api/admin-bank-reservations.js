import pg from "pg";

const { Pool } = pg;
const ACTIVE_TABLE = "reservations";
const PAST_TABLE = "past_reservations";
const DELETED_TABLE = "delete_reservations";

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

async function archivePastReservations(pool) {
  await pool.query(
    `WITH moved AS (
      DELETE FROM ${ACTIVE_TABLE}
      WHERE check_in_date < CURRENT_DATE
      RETURNING *
    )
    INSERT INTO ${PAST_TABLE}
    SELECT * FROM moved
    ON CONFLICT (reservation_number) DO NOTHING`,
  );
}

async function autoCancelUnpaidReservations(pool) {
  await pool.query(
    `WITH moved AS (
      DELETE FROM ${ACTIVE_TABLE}
      WHERE coalesce(lower(trim(payment_method)), 'bank') IN ('bank', '무통장입금')
        AND bank_confirmed IS NOT TRUE
        AND created_at <= NOW() - INTERVAL '12 hours'
      RETURNING *
    )
    INSERT INTO ${DELETED_TABLE} (
      reservation_number,
      guest_name,
      contact,
      room_type,
      check_in_date,
      check_out_date,
      guest_count,
      created_at,
      stay_nights,
      extra_guests,
      total_amount,
      payment_method,
      guest_request,
      bank_confirmed,
      cancel_reason
    )
    SELECT
      reservation_number,
      guest_name,
      contact,
      room_type,
      check_in_date,
      check_out_date,
      guest_count,
      created_at,
      stay_nights,
      extra_guests,
      total_amount,
      payment_method,
      guest_request,
      bank_confirmed,
      'not paid'
    FROM moved
    ON CONFLICT (reservation_number) DO NOTHING`,
  );

  await pool.query(
    `WITH moved AS (
      DELETE FROM ${PAST_TABLE}
      WHERE coalesce(lower(trim(payment_method)), 'bank') IN ('bank', '무통장입금')
        AND bank_confirmed IS NOT TRUE
        AND created_at <= NOW() - INTERVAL '12 hours'
      RETURNING *
    )
    INSERT INTO ${DELETED_TABLE} (
      reservation_number,
      guest_name,
      contact,
      room_type,
      check_in_date,
      check_out_date,
      guest_count,
      created_at,
      stay_nights,
      extra_guests,
      total_amount,
      payment_method,
      guest_request,
      bank_confirmed,
      cancel_reason
    )
    SELECT
      reservation_number,
      guest_name,
      contact,
      room_type,
      check_in_date,
      check_out_date,
      guest_count,
      created_at,
      stay_nights,
      extra_guests,
      total_amount,
      payment_method,
      guest_request,
      bank_confirmed,
      'not paid'
    FROM moved
    ON CONFLICT (reservation_number) DO NOTHING`,
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
    json(res, 503, {
      ok: false,
      error: "DB 연결 정보가 없습니다.",
    });
    return;
  }

  var body;
  try {
    body = await readBody(req);
  } catch (e) {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  var auth = isAdminOk(body);
  if (!auth.ok) {
    json(res, 401, { ok: false, error: auth.error });
    return;
  }

  var action = String(body.action || "list").trim().toLowerCase();
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

  if (action === "confirm") {
    var reservationNumber = String(body.reservationNumber || "")
      .trim()
      .replace(/^GRF-/i, "");
    if (!reservationNumber) {
      json(res, 400, { ok: false, error: "reservationNumber가 필요합니다." });
      return;
    }
    try {
      var upd = await pool.query(
        `UPDATE ${ACTIVE_TABLE}
         SET bank_confirmed = TRUE
         WHERE reservation_number = $1
           AND coalesce(lower(trim(payment_method)), 'bank') IN ('bank', '무통장입금')
         RETURNING reservation_number, bank_confirmed`,
        [reservationNumber],
      );
      if (!upd.rows || !upd.rows.length) {
        json(res, 404, { ok: false, error: "대상 예약을 찾을 수 없습니다." });
        return;
      }
      json(res, 200, {
        ok: true,
        reservationNumber: upd.rows[0].reservation_number,
        bankConfirmed: upd.rows[0].bank_confirmed === true,
      });
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: String((e && e.message) || e || "update failed"),
      });
    }
    return;
  }

  try {
    var sel = await pool.query(
      `SELECT
        reservation_number,
        guest_name,
        contact,
        room_type,
        check_in_date,
        check_out_date,
        total_amount,
        bank_confirmed,
        created_at
      FROM ${ACTIVE_TABLE}
      WHERE coalesce(lower(trim(payment_method)), 'bank') IN ('bank', '무통장입금')
      ORDER BY created_at DESC`,
    );
    json(res, 200, {
      ok: true,
      rows: (sel.rows || []).map(function (row) {
        return {
          reservationNumber: row.reservation_number,
          guestName: row.guest_name,
          contact: row.contact,
          roomType: row.room_type,
          checkIn: toYMD(row.check_in_date),
          checkOut: toYMD(row.check_out_date),
          totalAmount: row.total_amount != null ? Number(row.total_amount) : 0,
          bankConfirmed: row.bank_confirmed === true,
          createdAt: formatDateTimeKst(row.created_at),
        };
      }),
    });
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "lookup failed"),
    });
  }
}
