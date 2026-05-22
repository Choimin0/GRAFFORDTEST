/**
 * POST /api/alimtalk-notify
 *
 * reserve-complete / delete-complete 페이지에서 호출.
 * DB 예약 상태와 예약자 정보를 검증한 뒤 Solapi 알림톡을 발송합니다.
 */
import pg from "pg";
import {
  decryptBookingPiiResponse,
  guestNamesMatch,
} from "./lib/pii-crypto.js";
import {
  normalizePhone,
  sendBookingAlimtalk,
} from "./lib/solapi-alimtalk.js";

const { Pool } = pg;
const BOOKING_TABLE = "booking";

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
  var dbUrl = getDatabaseUrl();
  if (!dbUrl) return null;
  if (!poolSingleton) {
    poolSingleton = new Pool({
      connectionString: dbUrl,
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

async function getJsonBody(req) {
  if (
    req.body != null &&
    typeof req.body === "object" &&
    !Buffer.isBuffer(req.body)
  ) {
    return req.body;
  }
  return readBody(req);
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

function rowDateToYMD(v) {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date && !isNaN(v.getTime())) {
    var y = v.getUTCFullYear();
    var m = String(v.getUTCMonth() + 1).padStart(2, "0");
    var day = String(v.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  return "";
}

function contactsMatch(storedContact, providedContact) {
  var a = normalizePhone(storedContact);
  var b = normalizePhone(providedContact);
  if (!a || !b) return false;
  return a === b;
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
    json(res, 503, { ok: false, error: "Database unavailable" });
    return;
  }

  var body;
  try {
    body = await getJsonBody(req);
  } catch (e) {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  var type = String(body.type || "").trim();
  if (type !== "reserve-complete" && type !== "cancel-complete") {
    json(res, 400, { ok: false, error: "Invalid type" });
    return;
  }

  var reservationNumber = normalizeLookupOrder(body.orderNo || body.reservationNumber);
  var guestName = normalizeLookupName(body.guestName || body.name || "");
  var contact = String(body.contact || "").trim();

  console.log("[GRAFFORD alimtalk test] /api/alimtalk-notify 요청 수신", {
    type: type,
    reservationNumber: reservationNumber,
    guestName: guestName,
    contact: contact,
  });

  if (!reservationNumber || !guestName || !contact) {
    json(res, 400, {
      ok: false,
      error: "orderNo, guestName, contact가 필요합니다.",
    });
    return;
  }

  try {
    var sel = await pool.query(
      `SELECT guest_name, contact, room_type, check_in_date, check_out_date, status
       FROM ${BOOKING_TABLE}
       WHERE reservation_number = $1
       LIMIT 1`,
      [reservationNumber],
    );

    if (!sel.rows || !sel.rows.length) {
      json(res, 404, { ok: false, error: "예약을 찾을 수 없습니다." });
      return;
    }

    var row = sel.rows[0];
    var pii = decryptBookingPiiResponse(row);
    if (!guestNamesMatch(row.guest_name, guestName, normalizeLookupName)) {
      json(res, 403, { ok: false, error: "예약자 정보가 일치하지 않습니다." });
      return;
    }
    if (!contactsMatch(pii.contact, contact)) {
      json(res, 403, { ok: false, error: "연락처 정보가 일치하지 않습니다." });
      return;
    }

    var status = String(row.status || "").toLowerCase();
    console.log("[GRAFFORD alimtalk test] DB 예약 검증", {
      type: type,
      reservationNumber: reservationNumber,
      status: status,
      roomType: row.room_type,
      checkIn: rowDateToYMD(row.check_in_date),
      checkOut: rowDateToYMD(row.check_out_date),
    });

    if (type === "reserve-complete") {
      if (status !== "confirm" && status !== "completed") {
        json(res, 409, {
          ok: false,
          error: "예약 완료 상태가 아닙니다.",
          skipped: true,
        });
        return;
      }
    } else if (status !== "cancelled") {
      json(res, 409, {
        ok: false,
        error: "예약 취소 상태가 아닙니다.",
        skipped: true,
      });
      return;
    }

    var sendResult = await sendBookingAlimtalk(type, {
      guestName: pii.guestName,
      contact: pii.contact,
      reservationNumber: reservationNumber,
      roomType: row.room_type,
      checkIn: rowDateToYMD(row.check_in_date) || body.checkIn || "",
      checkOut: rowDateToYMD(row.check_out_date) || body.checkOut || "",
    });

    if (sendResult.skipped) {
      console.log("[GRAFFORD alimtalk test] /api/alimtalk-notify 응답: skipped", {
        type: type,
        reservationNumber: reservationNumber,
        reason: sendResult.error || "skipped",
      });
      json(res, 200, {
        ok: true,
        skipped: true,
        reason: sendResult.error || "skipped",
      });
      return;
    }
    if (!sendResult.ok) {
      console.log("[GRAFFORD alimtalk test] /api/alimtalk-notify 응답: failed", {
        type: type,
        reservationNumber: reservationNumber,
        error: sendResult.error || "알림톡 발송에 실패했습니다.",
      });
      json(res, 502, {
        ok: false,
        error: sendResult.error || "알림톡 발송에 실패했습니다.",
      });
      return;
    }

    console.log("[GRAFFORD alimtalk test] /api/alimtalk-notify 응답: sent", {
      type: type,
      reservationNumber: reservationNumber,
    });
    json(res, 200, { ok: true, sent: true });
  } catch (e) {
    console.error("alimtalk-notify handler", e);
    json(res, 500, {
      ok: false,
      error:
        "처리 중 서버 오류가 발생했습니다: " +
        (e && e.message ? e.message : String(e)),
    });
  }
}
