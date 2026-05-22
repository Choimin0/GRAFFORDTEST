/**
 * 관리자 체크인 리스트에서 입실 안내 알림톡 수동 발송.
 */
import { decryptBookingPiiResponse } from "./pii-crypto.js";
import { json } from "./admin-common.js";
import { sendBookingAlimtalk } from "./solapi-alimtalk.js";

const BOOKING_TABLE = "booking";

function normalizeReservationNumber(s) {
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

export async function handleAdminCheckinAlimtalk(res, pool, body) {
  var reservationNumber = normalizeReservationNumber(body.reservationNumber);
  if (!reservationNumber) {
    json(res, 400, { ok: false, error: "예약번호가 필요합니다." });
    return;
  }

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
  var status = String(row.status || "").toLowerCase();
  if (status !== "confirm" && status !== "completed") {
    json(res, 409, {
      ok: false,
      error: "확정된 예약만 입실 안내 알림톡을 발송할 수 있습니다.",
    });
    return;
  }

  var pii = decryptBookingPiiResponse(row);
  var sendResult = await sendBookingAlimtalk("checkin-alarm", {
    guestName: pii.guestName,
    contact: pii.contact,
    reservationNumber: reservationNumber,
    roomType: row.room_type,
    checkIn: rowDateToYMD(row.check_in_date),
    checkOut: rowDateToYMD(row.check_out_date),
  });

  if (sendResult.skipped) {
    json(res, 200, {
      ok: true,
      skipped: true,
      reason: sendResult.error || "skipped",
    });
    return;
  }
  if (!sendResult.ok) {
    json(res, 502, {
      ok: false,
      error: sendResult.error || "알림톡 발송에 실패했습니다.",
    });
    return;
  }

  json(res, 200, { ok: true, sent: true });
}
