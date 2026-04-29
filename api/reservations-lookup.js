import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;
const LEGACY_TO_ROOM = { A: "G1", B: "G2", C: "G3", D: "G4" };
const DEFAULT_CANCEL_TOKEN_TTL_MS = 10 * 60 * 1000;
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

function normalizeLookupName(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLookupOrder(s) {
  var t = String(s || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
  if (t.startsWith("GRF-")) {
    t = t.slice(4);
  }
  return t;
}

function normalizeRoomType(raw) {
  var room = String(raw || "")
    .trim()
    .toUpperCase();
  return LEGACY_TO_ROOM[room] || room;
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

function getCancelTokenSecret() {
  return String(
    process.env.RESERVATION_CANCEL_TOKEN_SECRET ||
      process.env.CANCEL_TOKEN_SECRET ||
      getDatabaseUrl() ||
      "",
  ).trim();
}

function getCancelTokenTtlMs() {
  var raw = String(
    process.env.RESERVATION_CANCEL_TOKEN_TTL_MINUTES ||
      process.env.CANCEL_TOKEN_TTL_MINUTES ||
      "",
  ).trim();
  if (!raw) {
    return DEFAULT_CANCEL_TOKEN_TTL_MS;
  }
  var mins = Number(raw);
  if (!Number.isFinite(mins) || mins <= 0) {
    return DEFAULT_CANCEL_TOKEN_TTL_MS;
  }
  mins = Math.min(1440, mins);
  return Math.floor(mins * 60 * 1000);
}

function b64urlEncode(s) {
  return Buffer.from(s, "utf8").toString("base64url");
}

function issueCancelToken(reservationNumber, guestName) {
  var secret = getCancelTokenSecret();
  var ttlMs = getCancelTokenTtlMs();
  if (!secret) {
    return "";
  }
  var payloadObj = {
    reservationNumber: String(reservationNumber || ""),
    guestName: normalizeLookupName(guestName || ""),
    exp: Date.now() + ttlMs,
    nonce: crypto.randomBytes(12).toString("hex"),
  };
  var payload = b64urlEncode(JSON.stringify(payloadObj));
  var sig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return payload + "." + sig;
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
  var resActive = await pool.query(
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
    ON CONFLICT (reservation_number) DO NOTHING
    RETURNING reservation_number`,
  );
  var resPast = await pool.query(
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
    ON CONFLICT (reservation_number) DO NOTHING
    RETURNING reservation_number`,
  );
  return {
    movedFromActive: (resActive.rows || []).length,
    movedFromPast: (resPast.rows || []).length,
  };
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
      error:
        "DB 연결 정보가 없습니다. .env.local 에 POSTGRES_URL 등을 넣은 뒤 vercel dev 를 다시 실행하세요.",
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
  var reqId = Math.random().toString(36).slice(2, 10);
  var debugMode =
    body && (body.debug === true || String(body.debug).toLowerCase() === "1");
  console.error("[lookup] start", { reqId: reqId, at: new Date().toISOString() });

  var normName = normalizeLookupName(body.guestName || body.name || "");
  var normOrder = normalizeLookupOrder(
    body.reservationNumber || body.orderNo || body.number || "",
  );
  if (!normName || !normOrder) {
    json(res, 400, {
      ok: false,
      error: "guestName 과 reservationNumber(또는 orderNo)가 필요합니다.",
    });
    return;
  }

  try {
    await archivePastReservations(pool);
    var autoCancelStats = await autoCancelUnpaidReservations(pool);
    console.error("[lookup] auto-cancel stats", {
      reqId: reqId,
      movedFromActive: autoCancelStats.movedFromActive,
      movedFromPast: autoCancelStats.movedFromPast,
    });
    var sel = await pool.query(
      `SELECT
        id,
        reservation_number,
        guest_name,
        contact,
        room_type,
        check_in_date,
        check_out_date,
        guest_count,
        stay_nights,
        extra_guests,
        total_amount,
        guest_request,
        payment_method,
        bank_confirmed,
        created_at
      FROM (
        SELECT * FROM ${ACTIVE_TABLE}
        UNION ALL
        SELECT * FROM ${PAST_TABLE}
      ) AS merged_reservations
      WHERE reservation_number = $1
      LIMIT 1`,
      [normOrder],
    );
    if (sel.rows && sel.rows.length) {
      var row = sel.rows[0];
      if (normalizeLookupName(row.guest_name) !== normName) {
        json(res, 404, { ok: false, error: "Not found" });
        return;
      }
      json(res, 200, {
        ok: true,
        source: "database",
        debug:
          debugMode === true
            ? {
                reqId: reqId,
                autoCancelStats: autoCancelStats,
              }
            : undefined,
        row: {
          id: row.id,
          reservationNumber: row.reservation_number,
          guestName: row.guest_name,
          contact: row.contact,
          roomType: normalizeRoomType(row.room_type) || row.room_type,
          checkIn: toYMD(row.check_in_date),
          checkOut: toYMD(row.check_out_date),
          guestCount: row.guest_count,
          stayNights: row.stay_nights != null ? Number(row.stay_nights) : null,
          extraGuests:
            row.extra_guests != null ? Number(row.extra_guests) : null,
          totalAmount:
            row.total_amount != null ? Number(row.total_amount) : null,
          guestRequest: row.guest_request || "",
          paymentMethod: row.payment_method || null,
          bankConfirmed: row.bank_confirmed === true,
          createdAt: formatDateTimeKst(row.created_at),
        },
        cancelToken: issueCancelToken(row.reservation_number, row.guest_name),
      });
      return;
    }

    var deletedSel = await pool.query(
      `SELECT
        reservation_number,
        guest_name,
        contact,
        room_type,
        check_in_date,
        check_out_date,
        guest_count,
        stay_nights,
        extra_guests,
        total_amount,
        guest_request,
        payment_method,
        bank_confirmed,
        created_at,
        cancel_reason
      FROM ${DELETED_TABLE}
      WHERE reservation_number = $1
      LIMIT 1`,
      [normOrder],
    );
    if (!deletedSel.rows || !deletedSel.rows.length) {
      json(res, 404, { ok: false, error: "Not found" });
      return;
    }
    var deletedRow = deletedSel.rows[0];
    if (normalizeLookupName(deletedRow.guest_name) !== normName) {
      json(res, 404, { ok: false, error: "Not found" });
      return;
    }
    json(res, 200, {
      ok: true,
      source: "database",
      deleted: true,
      deleteReason: String(deletedRow.cancel_reason || "").toLowerCase(),
      debug:
        debugMode === true
          ? {
              reqId: reqId,
              autoCancelStats: autoCancelStats,
            }
          : undefined,
      row: {
        reservationNumber: deletedRow.reservation_number,
        guestName: deletedRow.guest_name,
        contact: deletedRow.contact,
        roomType:
          normalizeRoomType(deletedRow.room_type) || deletedRow.room_type,
        checkIn: toYMD(deletedRow.check_in_date),
        checkOut: toYMD(deletedRow.check_out_date),
        guestCount:
          deletedRow.guest_count != null
            ? Number(deletedRow.guest_count)
            : null,
        stayNights:
          deletedRow.stay_nights != null
            ? Number(deletedRow.stay_nights)
            : null,
        extraGuests:
          deletedRow.extra_guests != null
            ? Number(deletedRow.extra_guests)
            : null,
        totalAmount:
          deletedRow.total_amount != null
            ? Number(deletedRow.total_amount)
            : null,
        guestRequest: deletedRow.guest_request || "",
        paymentMethod: deletedRow.payment_method || null,
        bankConfirmed: deletedRow.bank_confirmed === true,
        createdAt: formatDateTimeKst(deletedRow.created_at),
        cancelReason: deletedRow.cancel_reason || "",
      },
    });
  } catch (e) {
    console.error("[lookup] error", { reqId: reqId, error: String(e && e.message ? e.message : e) });
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "Lookup failed"),
    });
  }
}
