import { parse as parseUrl } from "node:url";
import pg from "pg";
import crypto from "node:crypto";
import {
  decryptBookingPiiResponse,
  encryptBookingPii,
  guestNamesMatch,
} from "./lib/pii-crypto.js";
import {
  getActiveHoldOccupiedNights,
  cleanupExpiredBookingHolds,
  releaseBookingHold,
} from "./lib/booking-hold.js";
import {
  verifyBookingToken,
  getHoldIdFromToken,
} from "./lib/booking-token.js";
import { checkRoomAvailability } from "./lib/room-availability.js";
import { exportReservationToBigQuery } from "./lib/bigquery-export.js";
import {
  buildIcalCalendar,
  getMergedOccupiedNightsForRoom,
} from "./lib/ical-sync.js";

const { Pool } = pg;

const ALLOWED_ROOMS = new Set(["G1", "G2", "G3", "G4"]);
const LEGACY_TO_ROOM = { A: "G1", B: "G2", C: "G3", D: "G4" };
const ROOM_TO_LEGACY = { G1: "A", G2: "B", G3: "C", G4: "D" };
const ALLOWED_PAY = new Set(["card", "naver"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/;
const MAX_NAME = 255;
const MAX_CONTACT = 120;
const MAX_RESV = 32;
const MAX_GUEST_REQUEST = 2000;
const MAX_CANCEL_REASON = 1000;
const MAX_EMAIL = 255;
const DEFAULT_CANCEL_TOKEN_TTL_MS = 10 * 60 * 1000;
const BOOKING_TABLE = "booking";
const ROOM_STATUS_TABLE = '"room-status"';

/** Neon/Vercel에서 오는 URL 이름이 달라도 사용 (TCP — Neon's HTTP 404 회피) */
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

function humanDbError(e) {
  if (!e) {
    return "Database error";
  }
  var c = e.code;
  if (c === "42703") {
    return "DB에 필요한 컬럼이 없습니다. db/migrations/015_create_booking_table.sql 을 실행하세요.";
  }
  if (c === "42P01") {
    return "booking 테이블이 없습니다. db/migrations/015_create_booking_table.sql 을 실행하세요.";
  }
  if (c === "23505") {
    return "Duplicate reservation number";
  }
  var msg = String(e.message || e.toString() || "");
  if (/resource-not-found|HTTP status 404/i.test(msg)) {
    return "Neon HTTP 드라이버 오류(404)입니다. 지금은 TCP(pg)로 연결합니다. 그래도 실패하면 Neon 대시보드에서 연결 문자열을 다시 복사하세요.";
  }
  if (/password authentication failed|Tenant or user not found/i.test(msg)) {
    return "DB 인증에 실패했습니다. 연결 문자열(비밀번호)이 최신인지 확인하세요.";
  }
  if (/ENOTFOUND|ECONNREFUSED|getaddrinfo|ECONNRESET|timeout/i.test(msg)) {
    return "DB 서버에 연결할 수 없습니다. 네트워크와 연결 문자열을 확인하세요.";
  }
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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
  if (ALLOWED_ROOMS.has(room)) {
    return room;
  }
  return LEGACY_TO_ROOM[room] || "";
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

/** Postgres DATE / 문자열 → YYYY-MM-DD */
function rowDateToYMD(v) {
  if (v == null || v === "") {
    return "";
  }
  if (typeof v === "string") {
    return v.slice(0, 10);
  }
  if (v instanceof Date && !isNaN(v.getTime())) {
    var y = v.getUTCFullYear();
    var m = String(v.getUTCMonth() + 1).padStart(2, "0");
    var day = String(v.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  return "";
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

function addOneDayYMD(ymd) {
  var p = ymd.split("-");
  var dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  dt.setDate(dt.getDate() + 1);
  var y = dt.getFullYear();
  var m = String(dt.getMonth() + 1).padStart(2, "0");
  var day = String(dt.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

async function getRoomBlockRows(pool, roomFilter) {
  try {
    var params = [];
    var where = "";
    if (roomFilter) {
      params.push(roomFilter);
      where = "WHERE rs.room_name = $1";
    }
    var result = await pool.query(
      `SELECT
         rs.room_name,
         item->>'id' AS block_id,
         item->>'startDate' AS start_date,
         item->>'endDate' AS end_date
       FROM ${ROOM_STATUS_TABLE} rs,
         jsonb_array_elements(COALESCE(rs.block_items, '[]'::jsonb)) AS item
       ${where}
       ORDER BY item->>'startDate'`,
      params,
    );
    return (result.rows || []).filter(function (row) {
      return row.start_date && row.end_date && row.start_date < row.end_date;
    });
  } catch (e) {
    if (e && (e.code === "42P01" || e.code === "42703")) {
      return [];
    }
    throw e;
  }
}

async function hasRoomBlockOverlap(pool, roomName, checkIn, checkOut) {
  var rows = await getRoomBlockRows(pool, roomName);
  return rows.some(function (row) {
    return String(row.start_date) < checkOut && String(row.end_date) > checkIn;
  });
}

function todayYMDUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function archivePastReservations(pool) {
  // 체크인일이 지난 'confirm' 예약을 'completed'로 상태 전환
  await pool.query(
    `UPDATE ${BOOKING_TABLE}
     SET status = 'completed'
     WHERE status = 'confirm'
       AND check_in_date < CURRENT_DATE`,
  );
}

/** [check_in, check_out) 구간의 숙박일(밤) — check_out 아침 퇴실 전날 밤까지 */
function expandOccupiedNights(ciYmd, coYmd) {
  var out = [];
  var cur = ciYmd;
  while (cur < coYmd) {
    out.push(cur);
    cur = addOneDayYMD(cur);
  }
  return out;
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
        if (!raw) {
          resolve({});
          return;
        }
        resolve(JSON.parse(raw));
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
  // 상한 24시간(1440분)으로 제한해 과도한 장기 토큰 발급 방지
  mins = Math.min(1440, mins);
  return Math.floor(mins * 60 * 1000);
}

function b64urlEncode(s) {
  return Buffer.from(s, "utf8").toString("base64url");
}

function b64urlDecode(s) {
  return Buffer.from(String(s || ""), "base64url").toString("utf8");
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

function verifyCancelToken(token, reservationNumber, guestName) {
  var secret = getCancelTokenSecret();
  if (!secret) {
    return { ok: false, error: "토큰 검증 키가 설정되어 있지 않습니다." };
  }
  var parts = String(token || "").split(".");
  if (parts.length !== 2) {
    return { ok: false, error: "유효하지 않은 취소 토큰입니다." };
  }
  var payload = parts[0];
  var sig = parts[1];
  var expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  if (sig !== expected) {
    return { ok: false, error: "취소 토큰 서명이 유효하지 않습니다." };
  }
  var obj;
  try {
    obj = JSON.parse(b64urlDecode(payload));
  } catch (e) {
    return { ok: false, error: "취소 토큰 형식이 올바르지 않습니다." };
  }
  if (!obj || !obj.exp || Date.now() > Number(obj.exp)) {
    return { ok: false, error: "취소 토큰이 만료되었습니다." };
  }
  if (String(obj.reservationNumber || "") !== String(reservationNumber || "")) {
    return { ok: false, error: "취소 토큰과 예약번호가 일치하지 않습니다." };
  }
  if (normalizeLookupName(obj.guestName) !== normalizeLookupName(guestName)) {
    return { ok: false, error: "취소 토큰과 예약자명이 일치하지 않습니다." };
  }
  return { ok: true };
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

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
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

  if (req.method === "GET") {
    try {
      await archivePastReservations(pool);
    } catch (e) {
      console.error("archive past reservations before GET", e);
      json(res, 500, {
        ok: false,
        error: humanDbError(e),
        code: e.code || null,
      });
      return;
    }
    var parsed = parseUrl(req.url || "", true);
    var q = parsed.query || {};
    if (q.ical === "1" || q.format === "ics") {
      var exportRoom = String(q.room || "").trim();
      var tokenExpected = String(process.env.ICAL_EXPORT_TOKEN || "").trim();
      var tokenGiven = String(q.token || "").trim();
      if (tokenExpected && tokenGiven !== tokenExpected) {
        json(res, 401, { ok: false, error: "Invalid iCal export token" });
        return;
      }
      var roomFilter = "";
      if (exportRoom) {
        roomFilter = normalizeRoomType(exportRoom);
        if (!ALLOWED_ROOMS.has(roomFilter)) {
          json(res, 400, { ok: false, error: "Invalid room" });
          return;
        }
      }
      try {
        var rowsForIcal;
        if (roomFilter) {
          var legacyRoom = ROOM_TO_LEGACY[roomFilter] || "";
          rowsForIcal = await pool.query(
            `SELECT reservation_number, room_type, check_in_date, check_out_date
             FROM ${BOOKING_TABLE}
             WHERE status = 'confirm'
               AND room_type = ANY($1::text[])
               AND check_out_date IS NOT NULL
             ORDER BY check_in_date`,
            [[roomFilter, legacyRoom]],
          );
        } else {
          rowsForIcal = await pool.query(
            `SELECT reservation_number, room_type, check_in_date, check_out_date
             FROM ${BOOKING_TABLE}
             WHERE status = 'confirm'
               AND check_out_date IS NOT NULL
             ORDER BY check_in_date`,
          );
        }
        var blockRowsForIcal = await getRoomBlockRows(pool, roomFilter || "");
        var blockEvents = blockRowsForIcal.map(function (row) {
          return {
            reservation_number: "BLOCK-" + row.block_id,
            room_type: row.room_name,
            check_in_date: row.start_date,
            check_out_date: row.end_date,
            is_block: true,
          };
        });
        var ics = buildIcalCalendar((rowsForIcal.rows || []).concat(blockEvents), rowDateToYMD);
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/calendar; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          'inline; filename="grafford-reservations.ics"',
        );
        res.setHeader("Cache-Control", "no-store");
        res.end(ics);
      } catch (e) {
        console.error("reservations iCal export", e);
        json(res, 500, {
          ok: false,
          error: humanDbError(e),
          code: e.code || null,
        });
      }
      return;
    }

    if (q.availability === "1" || q.availability === "true") {
      var roomForCal = normalizeRoomType(q.room || "");
      if (!ALLOWED_ROOMS.has(roomForCal)) {
        json(res, 400, { ok: false, error: "Invalid room" });
        return;
      }
      try {
        await cleanupExpiredBookingHolds(pool);
        var roomForCalLegacy = ROOM_TO_LEGACY[roomForCal] || "";
        var calRows = await pool.query(
          `SELECT check_in_date, check_out_date
           FROM ${BOOKING_TABLE}
           WHERE status = 'confirm'
             AND room_type = ANY($1::text[])
             AND check_out_date IS NOT NULL
           ORDER BY check_in_date`,
          [[roomForCal, roomForCalLegacy]],
        );
        var occupied = Object.create(null);
        var checkouts = Object.create(null);
        (calRows.rows || []).forEach(function (row) {
          var ci = rowDateToYMD(row.check_in_date);
          var co = rowDateToYMD(row.check_out_date);
          if (!ci || !co || ci >= co) {
            return;
          }
          expandOccupiedNights(ci, co).forEach(function (n) {
            occupied[n] = true;
          });
          checkouts[co] = true;
        });
        var importedNights = await getMergedOccupiedNightsForRoom(pool, roomForCal);
        importedNights.forEach(function (n) {
          occupied[n] = true;
        });
        var blockRows = await getRoomBlockRows(pool, roomForCal);
        blockRows.forEach(function (row) {
          expandOccupiedNights(String(row.start_date), String(row.end_date)).forEach(
            function (n) {
              occupied[n] = true;
            },
          );
        });
        var holdNights = await getActiveHoldOccupiedNights(pool, roomForCal);
        holdNights.forEach(function (n) {
          occupied[n] = true;
        });
        json(res, 200, {
          ok: true,
          room: roomForCal,
          occupiedNights: Object.keys(occupied).sort(),
          checkoutDays: Object.keys(checkouts).sort(),
          importedIcalNightsCount: importedNights.length,
          blockedNightsCount: blockRows.reduce(function (sum, row) {
            return (
              sum +
              expandOccupiedNights(String(row.start_date), String(row.end_date)).length
            );
          }, 0),
          heldNightsCount: holdNights.length,
        });
      } catch (e) {
        console.error("reservations availability", e);
        json(res, 500, {
          ok: false,
          error: humanDbError(e),
          code: e.code || null,
        });
      }
      return;
    }

    if (q.guestName || q.name || q.reservationNumber || q.orderNo || q.number) {
      json(res, 405, {
        ok: false,
        error:
          "보안 강화를 위해 예약 조회는 POST /api/reservations-lookup 만 허용됩니다.",
      });
      return;
    }

    var guestParam = String(q.guestName || q.name || "").trim();
    var orderParam = String(
      q.reservationNumber || q.orderNo || q.number || "",
    ).trim();
    var normName = normalizeLookupName(guestParam);
    var normOrder = normalizeLookupOrder(orderParam);
    if (!normName || !normOrder) {
      json(res, 400, {
        ok: false,
        error:
          "guestName 과 reservationNumber(또는 orderNo) 쿼리가 필요합니다.",
      });
      return;
    }
    try {
      var sel = await pool.query(
        `SELECT
          id, reservation_number, guest_name, contact, email,
          room_type, check_in_date, check_out_date, guest_count,
          stay_nights, extra_guests, total_amount, guest_request,
          payment_method, bank_confirmed, created_at
        FROM ${BOOKING_TABLE}
        WHERE reservation_number = $1
          AND status = 'confirm'`,
        [normOrder],
      );
      if (!sel.rows || !sel.rows.length) {
        json(res, 404, { ok: false, error: "Not found" });
        return;
      }
      var dbRow = sel.rows[0];
      if (!guestNamesMatch(dbRow.guest_name, normName, normalizeLookupName)) {
        json(res, 404, { ok: false, error: "Not found" });
        return;
      }
      var pii = decryptBookingPiiResponse(dbRow);
      json(res, 200, {
        ok: true,
        source: "database",
        row: {
          id: dbRow.id,
          reservationNumber: dbRow.reservation_number,
          guestName: pii.guestName,
          contact: pii.contact,
          email: pii.email,
          roomType: normalizeRoomType(dbRow.room_type) || dbRow.room_type,
          checkIn: toYMD(dbRow.check_in_date),
          checkOut: toYMD(dbRow.check_out_date),
          guestCount: dbRow.guest_count,
          stayNights: dbRow.stay_nights != null ? Number(dbRow.stay_nights) : null,
          extraGuests: dbRow.extra_guests != null ? Number(dbRow.extra_guests) : null,
          totalAmount: dbRow.total_amount != null ? Number(dbRow.total_amount) : null,
          guestRequest: dbRow.guest_request || "",
          paymentMethod: dbRow.payment_method || null,
          bankConfirmed: dbRow.bank_confirmed === true,
          createdAt: formatDateTimeKst(dbRow.created_at),
          createdAtIso: dbRow.created_at
            ? new Date(dbRow.created_at).toISOString()
            : null,
        },
      });
    } catch (e) {
      console.error("reservations lookup", e);
      json(res, 500, { ok: false, error: humanDbError(e), code: e.code || null });
    }
    return;
  }

  if (req.method === "DELETE") {
    try {
      await archivePastReservations(pool);
    } catch (e) {
      console.error("archive past reservations before DELETE", e);
      json(res, 500, {
        ok: false,
        error: humanDbError(e),
        code: e.code || null,
      });
      return;
    }
    var deleteBody;
    try {
      deleteBody = await getJsonBody(req);
    } catch (e) {
      json(res, 400, { ok: false, error: "Invalid JSON body" });
      return;
    }

    var delReservationNumber = normalizeLookupOrder(
      deleteBody.reservationNumber || deleteBody.orderNo || "",
    );
    var delGuestName = normalizeLookupName(deleteBody.guestName || "");
    var cancelReasonRaw = String(deleteBody.cancelReason || "")
      .trim()
      .slice(0, MAX_CANCEL_REASON);
    var otherReasonRaw = String(
      deleteBody.otherReason ||
        deleteBody["other-reason"] ||
        deleteBody.other_reason ||
        "",
    )
      .trim()
      .slice(0, MAX_CANCEL_REASON);
    var cancelReason =
      cancelReasonRaw.toLowerCase() === "other"
        ? "other"
        : cancelReasonRaw;
    var otherReason =
      cancelReasonRaw.toLowerCase() === "other"
        ? otherReasonRaw || null
        : null;
    var cancelToken = String(deleteBody.cancelToken || "").trim();
    if (!delReservationNumber) {
      json(res, 400, {
        ok: false,
        error: "reservationNumber(또는 orderNo)이 필요합니다.",
      });
      return;
    }
    if (!delGuestName) {
      json(res, 400, {
        ok: false,
        error: "guestName이 필요합니다.",
      });
      return;
    }
    if (!cancelToken) {
      json(res, 400, {
        ok: false,
        error: "cancelToken(1회용 토큰)이 필요합니다.",
      });
      return;
    }
    var verify = verifyCancelToken(
      cancelToken,
      delReservationNumber,
      delGuestName,
    );
    if (!verify.ok) {
      json(res, 401, { ok: false, error: verify.error });
      return;
    }

    try {
      var delSel = await pool.query(
        `SELECT guest_name FROM ${BOOKING_TABLE}
         WHERE reservation_number = $1
           AND status IN ('confirm', 'completed')
         LIMIT 1`,
        [delReservationNumber],
      );
      if (!delSel.rows || !delSel.rows.length) {
        json(res, 404, { ok: false, error: "삭제할 예약을 찾을 수 없습니다." });
        return;
      }
      var delStoredName = delSel.rows[0].guest_name;
      if (
        !guestNamesMatch(delStoredName, delGuestName, normalizeLookupName)
      ) {
        json(res, 404, { ok: false, error: "삭제할 예약을 찾을 수 없습니다." });
        return;
      }
      var upd = await pool.query(
        `UPDATE ${BOOKING_TABLE}
         SET status        = 'cancelled',
             cancel_reason = $3,
             other_reason  = $4,
             cancelled_at  = NOW()
         WHERE reservation_number = $1
           AND guest_name = $2
           AND status IN ('confirm', 'completed')
         RETURNING reservation_number`,
        [
          delReservationNumber,
          delStoredName,
          cancelReason || null,
          otherReason,
        ],
      );
      if (!upd.rows || !upd.rows.length) {
        json(res, 404, { ok: false, error: "삭제할 예약을 찾을 수 없습니다." });
        return;
      }
      json(res, 200, {
        ok: true,
        deleted: true,
        reservationNumber: upd.rows[0].reservation_number,
        cancelledAt: formatDateTimeKst(new Date()),
      });
    } catch (e) {
      console.error("reservations delete", e);
      json(res, 500, { ok: false, error: humanDbError(e), code: e.code || null });
    }
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  var body;
  try {
    body = await getJsonBody(req);
  } catch (e) {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  var reservationNumber = String(body.reservationNumber || "").trim();
  var guestName = String(body.guestName || "").trim();
  var contact = String(body.contact || "").trim();
  var email = String(body.email || "").trim().slice(0, MAX_EMAIL);
  var roomType = normalizeRoomType(body.roomType || "");
  var checkIn = String(body.checkIn || "").trim();
  var checkOut = String(body.checkOut || "").trim();
  var stayNights = Number(body.stayNights);
  var extraGuests = Number(body.extraGuests);
  var totalAmount = Number(body.totalAmount);
  var guestRequest = String(body.guestRequest || "")
    .trim()
    .slice(0, MAX_GUEST_REQUEST);
  var paymentMethod = String(body.paymentMethod || "")
    .trim()
    .toLowerCase();
  var guestCount = Number(body.guestCount);
  var pgTid = body.pgTid ? String(body.pgTid).trim().slice(0, 255) : null;
  var bookingToken = String(body.bookingToken || "").trim();

  if (!bookingToken) {
    json(res, 400, {
      ok: false,
      error: "bookingToken is required",
      code: "booking_token_required",
    });
    return;
  }
  var bookingTokenVerify = verifyBookingToken(bookingToken, {
    room: roomType,
    checkIn: checkIn,
    checkOut: checkOut,
    reservationNumber: reservationNumber,
  });
  if (!bookingTokenVerify.ok) {
    json(res, 401, {
      ok: false,
      error: "유효하지 않은 예약 토큰입니다.",
      code: bookingTokenVerify.error || "invalid_booking_token",
    });
    return;
  }

  if (!reservationNumber || reservationNumber.length > MAX_RESV) {
    console.error("[reservations POST] Invalid reservationNumber:", JSON.stringify(reservationNumber));
    json(res, 400, { ok: false, error: "Invalid reservationNumber" });
    return;
  }
  if (!guestName || guestName.length > MAX_NAME) {
    console.error("[reservations POST] Invalid guestName:", JSON.stringify(guestName));
    json(res, 400, { ok: false, error: "Invalid guestName" });
    return;
  }
  if (!contact || contact.length > MAX_CONTACT) {
    console.error("[reservations POST] Invalid contact:", JSON.stringify(contact));
    json(res, 400, { ok: false, error: "Invalid contact" });
    return;
  }
  if (!ALLOWED_ROOMS.has(roomType)) {
    console.error("[reservations POST] Invalid roomType:", JSON.stringify(roomType), "raw:", JSON.stringify(body.roomType));
    json(res, 400, { ok: false, error: "Invalid roomType" });
    return;
  }
  if (!DATE_RE.test(checkIn) || !DATE_RE.test(checkOut)) {
    console.error("[reservations POST] Invalid dates: checkIn=" + checkIn + " checkOut=" + checkOut);
    json(res, 400, { ok: false, error: "Invalid checkIn or checkOut" });
    return;
  }
  if (!Number.isFinite(stayNights) || stayNights < 1 || stayNights > 365) {
    console.error("[reservations POST] Invalid stayNights:", stayNights, "raw:", body.stayNights);
    json(res, 400, { ok: false, error: "Invalid stayNights" });
    return;
  }
  if (!Number.isFinite(extraGuests) || extraGuests < 0 || extraGuests > 20) {
    console.error("[reservations POST] Invalid extraGuests:", extraGuests, "raw:", body.extraGuests);
    json(res, 400, { ok: false, error: "Invalid extraGuests" });
    return;
  }
  if (!Number.isFinite(totalAmount) || totalAmount < 0 || totalAmount > 1e12) {
    console.error("[reservations POST] Invalid totalAmount:", totalAmount, "raw:", body.totalAmount);
    json(res, 400, { ok: false, error: "Invalid totalAmount" });
    return;
  }
  if (!ALLOWED_PAY.has(paymentMethod)) {
    console.error("[reservations POST] Invalid paymentMethod:", JSON.stringify(paymentMethod));
    json(res, 400, { ok: false, error: "Invalid paymentMethod" });
    return;
  }
  if (email && !EMAIL_RE.test(email)) {
    console.error("[reservations POST] Invalid email:", JSON.stringify(email));
    json(res, 400, { ok: false, error: "Invalid email format" });
    return;
  }
  if (!Number.isFinite(guestCount) || guestCount < 1 || guestCount > 50) {
    guestCount = Math.min(50, Math.max(1, 2 + (extraGuests | 0)));
  }

  var gc = Math.floor(guestCount);
  var sn = Math.floor(stayNights);
  var eg = Math.floor(extraGuests);
  var ta = Math.floor(totalAmount);
  // 체크인일이 이미 지났으면 'completed', 아니면 'confirm'
  var insertStatus = checkIn < todayYMDUtc() ? "completed" : "confirm";

  var encPii = encryptBookingPii({
    guestName: guestName,
    contact: contact,
    email: email || null,
  });

  var insertSql = `
    INSERT INTO ${BOOKING_TABLE} (
      reservation_number,
      status,
      guest_name,
      contact,
      email,
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
      pg_tid
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12, $13, $14, $15, $16
    )
    RETURNING id, reservation_number, created_at
  `;

  var params = [
    reservationNumber,
    insertStatus,
    encPii.guest_name,
    encPii.contact,
    encPii.email || null,
    roomType,
    checkIn,
    checkOut,
    gc,
    sn,
    eg,
    ta,
    guestRequest,
    paymentMethod,
    true,
    pgTid || null,
  ];

  try {
    await archivePastReservations(pool);
    var availability = await checkRoomAvailability(
      pool,
      roomType,
      checkIn,
      checkOut,
      reservationNumber,
      getHoldIdFromToken(bookingToken),
    );
    if (!availability.available) {
      var unavailableMsg =
        availability.reason === "blocked"
          ? "선택한 기간은 관리자 방막기로 예약할 수 없습니다."
          : "해당 날짜에 예약이 불가합니다. 예약을 다시 확인해주세요";
      json(res, 409, {
        ok: false,
        error: unavailableMsg,
        unavailable: true,
        reason: availability.reason || "occupied",
      });
      return;
    }
    var result = await pool.query(insertSql, params);
    var row = result && result.rows && result.rows[0];
    if (!row) {
      json(res, 500, { ok: false, error: "Insert did not return a row" });
      return;
    }
    var insertedHoldId = getHoldIdFromToken(bookingToken);
    if (insertedHoldId) {
      await releaseBookingHold(pool, insertedHoldId);
    }
    try {
      var bqResult = await exportReservationToBigQuery({
        reservationId: row.reservation_number,
        room: roomType,
        amount: ta,
        createdAt: row.created_at,
        checkIn: checkIn,
        checkOut: checkOut,
      });
      if (!bqResult.ok) {
        console.error("[reservations POST] BigQuery export failed", bqResult);
      }
    } catch (bqErr) {
      console.error("[reservations POST] BigQuery export", bqErr);
    }
    json(res, 201, {
      ok: true,
      id: row.id,
      reservationNumber: row.reservation_number,
      createdAt: formatDateTimeKst(row.created_at),
      createdAtIso: new Date(row.created_at).toISOString(),
      cancelToken: issueCancelToken(reservationNumber, guestName),
      bankConfirmed: true,
    });
  } catch (e) {
    if (e && e.code === "23505") {
      try {
        var dupSel = await pool.query(
          `SELECT created_at, guest_name, bank_confirmed, payment_method
           FROM ${BOOKING_TABLE}
           WHERE reservation_number = $1
           LIMIT 1`,
          [reservationNumber],
        );
        if (dupSel.rows && dupSel.rows.length) {
          var dupRow = dupSel.rows[0];
          if (
            guestNamesMatch(dupRow.guest_name, guestName, normalizeLookupName)
          ) {
            json(res, 409, {
              ok: true,
              duplicate: true,
              createdAtIso: new Date(dupRow.created_at).toISOString(),
              cancelToken: issueCancelToken(reservationNumber, guestName),
              bankConfirmed: dupRow.bank_confirmed === true,
            });
            return;
          }
        }
      } catch (dupErr) {
        console.error("[reservations POST] duplicate follow-up query", dupErr);
      }
      json(res, 409, { ok: false, error: "Duplicate reservation number" });
      return;
    }
    console.error("reservations insert", e);
    json(res, 500, {
      ok: false,
      error: humanDbError(e),
      code: e.code || null,
    });
  }
}
