import {
  decryptBookingPiiResponse,
  guestNamesMatch,
} from "./pii-crypto.js";
import { shouldSendAlimtalk } from "./booking-locale.js";
import {
  contactsMatchIntl,
  isInternationalStoredContact,
} from "./intl-phone.js";
import {
  normalizePhone,
  sendBookingAlimtalk,
} from "./solapi-alimtalk.js";
import { applyBookingRetentionToRow } from "./booking-retention.js";

const BOOKING_TABLE = "booking";

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
  if (
    isInternationalStoredContact(storedContact) ||
    isInternationalStoredContact(providedContact)
  ) {
    return contactsMatchIntl(storedContact, providedContact);
  }
  var a = normalizePhone(storedContact);
  var b = normalizePhone(providedContact);
  if (!a || !b) return false;
  return a === b;
}

export async function handlePublicAlimtalkNotify(req, res, pool) {
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

  var type = String(body.type || "").trim();
  if (type !== "reserve-complete" && type !== "cancel-complete") {
    json(res, 400, { ok: false, error: "Invalid type" });
    return true;
  }

  var reservationNumber = normalizeLookupOrder(body.orderNo || body.reservationNumber);
  var guestName = normalizeLookupName(body.guestName || body.name || "");
  var contact = String(body.contact || "").trim();

  if (!reservationNumber || !guestName || !contact) {
    json(res, 400, {
      ok: false,
      error: "orderNo, guestName, contact가 필요합니다.",
    });
    return true;
  }

  try {
    var sel = await pool.query(
      `SELECT guest_name, contact, room_type, check_in_date, check_out_date, status, booking_locale, created_at
       FROM ${BOOKING_TABLE}
       WHERE reservation_number = $1
       LIMIT 1`,
      [reservationNumber],
    );

    if (!sel.rows || !sel.rows.length) {
      json(res, 404, { ok: false, error: "예약을 찾을 수 없습니다." });
      return true;
    }

    var row = await applyBookingRetentionToRow(pool, sel.rows[0]);
    if (!row) {
      json(res, 404, { ok: false, error: "예약을 찾을 수 없습니다." });
      return true;
    }
    var pii = decryptBookingPiiResponse(row);
    if (!shouldSendAlimtalk(row.booking_locale, pii.contact)) {
      json(res, 200, {
        ok: true,
        skipped: true,
        reason: "english_booking",
      });
      return true;
    }
    if (!guestNamesMatch(row.guest_name, guestName, normalizeLookupName)) {
      json(res, 403, { ok: false, error: "예약자 정보가 일치하지 않습니다." });
      return true;
    }
    if (!contactsMatch(pii.contact, contact)) {
      json(res, 403, { ok: false, error: "연락처 정보가 일치하지 않습니다." });
      return true;
    }

    var status = String(row.status || "").toLowerCase();

    if (type === "reserve-complete") {
      if (status !== "confirm" && status !== "completed") {
        json(res, 409, {
          ok: false,
          error: "예약 완료 상태가 아닙니다.",
          skipped: true,
        });
        return true;
      }
    } else if (status !== "cancelled") {
      json(res, 409, {
        ok: false,
        error: "예약 취소 상태가 아닙니다.",
        skipped: true,
      });
      return true;
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
      json(res, 200, {
        ok: true,
        skipped: true,
        reason: sendResult.error || "skipped",
      });
      return true;
    }
    if (!sendResult.ok) {
      json(res, 502, {
        ok: false,
        error: sendResult.error || "알림톡 발송에 실패했습니다.",
      });
      return true;
    }

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
  return true;
}
