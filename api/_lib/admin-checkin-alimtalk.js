/**
 * 관리자 체크인 리스트에서 입실 안내 알림톡 수동 발송.
 */
import { decryptBookingPiiResponse } from "./pii-crypto.js";
import { json } from "./admin-common.js";
import { shouldSendAlimtalk } from "./booking-locale.js";
import { sendBookingAlimtalk } from "./solapi-alimtalk.js";
import { applyBookingRetentionToRow } from "./booking-retention.js";
import { isRoomChangeChildRow } from "./booking-room-change.js";

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
    `SELECT guest_name, contact, room_type, check_in_date, check_out_date,
            status, booking_locale, created_at, stay_role, parent_reservation_number
     FROM ${BOOKING_TABLE}
     WHERE reservation_number = $1
     LIMIT 1`,
    [reservationNumber],
  );

  if (!sel.rows || !sel.rows.length) {
    json(res, 404, { ok: false, error: "예약을 찾을 수 없습니다." });
    return;
  }

  var row = await applyBookingRetentionToRow(pool, sel.rows[0]);
  if (!row) {
    json(res, 404, { ok: false, error: "예약을 찾을 수 없습니다." });
    return;
  }
  if (isRoomChangeChildRow(row)) {
    json(res, 400, {
      ok: false,
      error: "룸체인지 구간에는 입실 안내 알림톡을 보낼 수 없습니다. 원예약에서 발송해 주세요.",
    });
    return;
  }
  var status = String(row.status || "").toLowerCase();
  if (status !== "confirm" && status !== "completed") {
    json(res, 409, {
      ok: false,
      error: "확정된 예약만 입실 안내 알림톡을 발송할 수 있습니다.",
    });
    return;
  }

  var pii = decryptBookingPiiResponse(row);
  if (!shouldSendAlimtalk(row.booking_locale, pii.contact)) {
    json(res, 409, {
      ok: false,
      error: "영문(국제) 예약은 알림톡 대신 이메일로 안내합니다.",
      skipped: true,
      reason: "english_booking",
    });
    return;
  }
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

  var countUpd = await pool.query(
    `UPDATE ${BOOKING_TABLE}
     SET checkin_alarm_sent_count = COALESCE(checkin_alarm_sent_count, 0) + 1
     WHERE reservation_number = $1
     RETURNING checkin_alarm_sent_count`,
    [reservationNumber],
  );
  var checkinAlarmSentCount =
    countUpd.rows && countUpd.rows[0]
      ? Number(countUpd.rows[0].checkin_alarm_sent_count) || 0
      : 0;

  json(res, 200, { ok: true, sent: true, checkinAlarmSentCount: checkinAlarmSentCount });
}
