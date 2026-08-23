import crypto from "node:crypto";
import {
  decryptBookingPiiResponse,
  guestNamesMatch,
} from "./pii-crypto.js";
import {
  applyBookingRetentionToRow,
  purgeExpiredBookings,
} from "./booking-retention.js";
import { resolveEffectiveBookingLocale } from "./booking-locale.js";
import {
  archivePastReservations,
  isGuestSelfCancelClosed,
} from "./booking-archive.js";
import {
  guestDisplayCheckIn,
  guestDisplayCheckOut,
  guestDisplayRoomType,
  isRoomChangeChildRow,
  isRoomChangeItinerary,
  loadStaySegmentsForPrimary,
} from "./booking-room-change.js";
import { normalizeCheckInYmd } from "./cancellation-fee.js";

const LEGACY_TO_ROOM = { A: "G1", B: "G2", C: "G3", D: "G4" };
const DEFAULT_CANCEL_TOKEN_TTL_MS = 10 * 60 * 1000;
const BOOKING_TABLE = "booking";

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
  return normalizeCheckInYmd(v) || "";
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

function formatYmdKst(v) {
  if (v == null || v === "") {
    return "";
  }
  var d = new Date(v);
  if (isNaN(d.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function isoFromDb(v) {
  if (v == null || v === "") {
    return null;
  }
  var d = new Date(v);
  if (isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
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

function getDatabaseUrl() {
  return String(
    process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL ||
      "",
  ).trim();
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

export async function handlePublicReservationsLookup(req, res, pool) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return true;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return true;
  }

  var body;
  try {
    body = await getJsonBody(req);
  } catch (e) {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return true;
  }
  var normName = normalizeLookupName(body.guestName || body.name || "");
  var normOrder = normalizeLookupOrder(
    body.reservationNumber || body.orderNo || body.number || "",
  );
  if (!normName || !normOrder) {
    json(res, 400, {
      ok: false,
      error: "guestName 과 reservationNumber(또는 orderNo)가 필요합니다.",
    });
    return true;
  }

  try {
    await archivePastReservations(pool);
    await purgeExpiredBookings(pool);

    var lookupSql =
      `SELECT
        id, reservation_number, guest_name, contact, room_type,
        check_in_date, check_out_date, guest_count, stay_nights,
        extra_guests, total_amount, guest_request, payment_method,
        bank_confirmed, created_at, status, cancel_reason, other_reason,
        cancelled_at, refund_amount, booking_locale,
        refunded_count, cancel_alarm_sent_count,
        parent_reservation_number, stay_role,
        contract_check_in, contract_check_out, original_room_type
      FROM ${BOOKING_TABLE}
      WHERE reservation_number = $1
        AND status <> 'pending'
      LIMIT 1`;
    var sel;
    try {
      sel = await pool.query(lookupSql, [normOrder]);
    } catch (lookupErr) {
      if (!lookupErr || lookupErr.code !== "42703") {
        throw lookupErr;
      }
      sel = await pool.query(
        `SELECT
          id, reservation_number, guest_name, contact, room_type,
          check_in_date, check_out_date, guest_count, stay_nights,
          extra_guests, total_amount, guest_request, payment_method,
          bank_confirmed, created_at, status, cancel_reason, other_reason,
          cancelled_at, refund_amount, booking_locale,
          refunded_count, cancel_alarm_sent_count
        FROM ${BOOKING_TABLE}
        WHERE reservation_number = $1
          AND status <> 'pending'
        LIMIT 1`,
        [normOrder],
      );
    }

    if (!sel.rows || !sel.rows.length) {
      json(res, 404, { ok: false, error: "Not found" });
      return true;
    }

    var row = await applyBookingRetentionToRow(pool, sel.rows[0]);
    if (!row) {
      json(res, 404, { ok: false, error: "Not found" });
      return true;
    }
    if (!guestNamesMatch(row.guest_name, normName, normalizeLookupName)) {
      json(res, 404, { ok: false, error: "Not found" });
      return true;
    }

    if (isRoomChangeChildRow(row)) {
      json(res, 404, { ok: false, error: "Not found" });
      return true;
    }

    var pii = decryptBookingPiiResponse(row);
    var isCancelled = row.status === "cancelled";
    var refundedCount =
      row.refunded_count != null ? Number(row.refunded_count) : 0;
    if (!Number.isFinite(refundedCount)) {
      refundedCount = 0;
    }
    var staySegments = [];
    try {
      staySegments = await loadStaySegmentsForPrimary(pool, row);
    } catch (segErr) {
      staySegments = [
        {
          room: normalizeRoomType(row.room_type) || row.room_type,
          checkIn: toYMD(row.check_in_date),
          checkOut: toYMD(row.check_out_date),
        },
      ];
    }
    var displayRoom =
      guestDisplayRoomType(row) ||
      normalizeRoomType(row.room_type) ||
      row.room_type;
    var displayCheckIn = guestDisplayCheckIn(row) || toYMD(row.check_in_date);
    var displayCheckOut = guestDisplayCheckOut(row) || toYMD(row.check_out_date);
    var hasRoomChange = isRoomChangeItinerary(staySegments, displayRoom);

    if (!isCancelled) {
      json(res, 200, {
        ok: true,
        source: "database",
        row: {
          id: row.id,
          reservationNumber: row.reservation_number,
          guestName: pii.guestName,
          contact: pii.contact,
          roomType: displayRoom,
          checkIn: displayCheckIn,
          checkOut: displayCheckOut,
          guestCount: row.guest_count,
          stayNights: row.stay_nights != null ? Number(row.stay_nights) : null,
          extraGuests: row.extra_guests != null ? Number(row.extra_guests) : null,
          totalAmount: row.total_amount != null ? Number(row.total_amount) : null,
          guestRequest: row.guest_request || "",
          paymentMethod: row.payment_method || null,
          bankConfirmed: row.bank_confirmed === true,
          createdAt: formatDateTimeKst(row.created_at),
          createdAtIso: isoFromDb(row.created_at),
          createdAtYmd: formatYmdKst(row.created_at),
          bookingLocale: resolveEffectiveBookingLocale(
            row.booking_locale,
            pii.contact,
          ),
          refundedCount: refundedCount,
          staySegments: hasRoomChange ? staySegments : [],
          hasRoomChange: hasRoomChange,
          originalRoomType: displayRoom,
        },
        cancelToken: isGuestSelfCancelClosed(displayCheckIn)
          ? ""
          : issueCancelToken(row.reservation_number, pii.guestName),
      });
      return true;
    }

    json(res, 200, {
      ok: true,
      source: "database",
      deleted: true,
      deleteReason: String(row.cancel_reason || "").toLowerCase(),
      row: {
        reservationNumber: row.reservation_number,
        guestName: pii.guestName,
        contact: pii.contact,
        roomType: displayRoom,
        checkIn: displayCheckIn,
        checkOut: displayCheckOut,
        guestCount: row.guest_count != null ? Number(row.guest_count) : null,
        stayNights: row.stay_nights != null ? Number(row.stay_nights) : null,
        extraGuests: row.extra_guests != null ? Number(row.extra_guests) : null,
        totalAmount: row.total_amount != null ? Number(row.total_amount) : null,
        guestRequest: row.guest_request || "",
        paymentMethod: row.payment_method || null,
        bankConfirmed: row.bank_confirmed === true,
        createdAt: formatDateTimeKst(row.created_at),
        createdAtIso: isoFromDb(row.created_at),
        createdAtYmd: formatYmdKst(row.created_at),
        cancelReason: row.cancel_reason || "",
        otherReason: row.other_reason || "",
        cancelledAt: formatDateTimeKst(row.cancelled_at),
        cancelledAtIso: isoFromDb(row.cancelled_at),
        cancelledAtYmd: formatYmdKst(row.cancelled_at),
        refundAmount:
          row.refund_amount != null ? Number(row.refund_amount) : null,
        bookingLocale: resolveEffectiveBookingLocale(
          row.booking_locale,
          pii.contact,
        ),
        refundedCount: refundedCount,
        cancelAlarmSentCount:
          row.cancel_alarm_sent_count != null
            ? Number(row.cancel_alarm_sent_count) || 0
            : 0,
        staySegments: hasRoomChange ? staySegments : [],
        hasRoomChange: hasRoomChange,
        originalRoomType: displayRoom,
      },
    });
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "Lookup failed"),
    });
  }
  return true;
}
