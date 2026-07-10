import {
  decryptBookingPiiResponse,
  encryptBookingPii,
} from "./pii-crypto.js";
import { json } from "./admin-common.js";
import { getExternalBookingCalendarRows } from "./ical-sync.js";
import {
  applyBookingRetentionToRow,
  purgeExpiredBookings,
} from "./booking-retention.js";
import {
  handleCreateManualBooking,
  filterShadowedExternalCalendarRows,
} from "./admin-manual-booking.js";
import { getTodayYmdKst } from "./promotion-period.js";

const BOOKING_TABLE = "booking";
const MAX_GUEST_NAME = 100;
const MAX_CONTACT = 40;

// collection → booking 테이블 status 필터 매핑
const ALLOWED_COLLECTIONS = {
  reservations: "confirm",
  "past-reservations": "completed",
  "delete-reservations": "cancelled",
};

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

async function archivePastReservations(pool) {
  // 체크아웃일이 KST 기준 오늘 이전이면 'completed'로 전환
  // (체크아웃일 = 오늘 또는 이후 → confirm 유지)
  var todayKst = getTodayYmdKst();
  await pool.query(
    `UPDATE ${BOOKING_TABLE}
     SET status = 'completed'
     WHERE status = 'confirm'
       AND check_out_date < $1::date`,
    [todayKst],
  );
}

function mapRow(row, isDeleted) {
  var pii = decryptBookingPiiResponse(row);
  var base = {
    reservationNumber: row.reservation_number,
    guestName: pii.guestName,
    contact: pii.contact,
    email: pii.email || "",
    roomType: row.room_type,
    checkIn: toYMD(row.check_in_date),
    checkOut: toYMD(row.check_out_date),
    guestCount: row.guest_count,
    totalAmount: row.total_amount != null ? Number(row.total_amount) : 0,
    stayPeriod: row.stay_nights != null ? Number(row.stay_nights) : null,
    guestRequest: row.guest_request || "",
    paymentMethod: row.payment_method || "",
    createdAt: formatDateTimeKst(row.created_at),
    checkinAlarmSentCount:
      row.checkin_alarm_sent_count != null
        ? Number(row.checkin_alarm_sent_count)
        : 0,
    bookingLocale: row.booking_locale || "kr",
    bookingChannel: row.booking_channel || "direct",
    linkedExternalUid: row.linked_external_uid || "",
  };
  if (isDeleted) {
    base.cancelReason = row.cancel_reason || "";
    base.otherReason = row.other_reason || "";
    base.cancelledAt = formatDateTimeKst(row.cancelled_at);
    base.refundAmount =
      row.refund_amount != null ? Number(row.refund_amount) : null;
  }
  return base;
}

export async function handleAdminReservations(res, pool, body) {
  var action = String(body.action || "list").trim().toLowerCase();
  if (action === "create-manual") {
    await handleCreateManualBooking(res, pool, body);
    return;
  }
  if (action === "save-request") {
    var requestReservationNumber = String(body.reservationNumber || "")
      .trim()
      .replace(/^GRF-/i, "");
    var guestRequest = String(body.guestRequest || "");
    if (!requestReservationNumber) {
      json(res, 400, { ok: false, error: "reservationNumber가 필요합니다." });
      return;
    }
    try {
      await purgeExpiredBookings(pool);
      var requestSel = await pool.query(
        `SELECT reservation_number, created_at
         FROM ${BOOKING_TABLE}
         WHERE reservation_number = $1
         LIMIT 1`,
        [requestReservationNumber],
      );
      if (!requestSel.rows || !requestSel.rows.length) {
        json(res, 404, { ok: false, error: "대상 예약을 찾을 수 없습니다." });
        return;
      }
      if (!(await applyBookingRetentionToRow(pool, requestSel.rows[0]))) {
        json(res, 404, { ok: false, error: "대상 예약을 찾을 수 없습니다." });
        return;
      }
      var requestUpd = await pool.query(
        `UPDATE ${BOOKING_TABLE}
         SET guest_request = $2
         WHERE reservation_number = $1
         RETURNING reservation_number, guest_request`,
        [requestReservationNumber, guestRequest],
      );
      if (!requestUpd.rows || !requestUpd.rows.length) {
        json(res, 404, { ok: false, error: "대상 예약을 찾을 수 없습니다." });
        return;
      }
      json(res, 200, {
        ok: true,
        reservationNumber: requestUpd.rows[0].reservation_number,
        guestRequest: requestUpd.rows[0].guest_request || "",
      });
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: String((e && e.message) || e || "request update failed"),
      });
    }
    return;
  }

  if (action === "update-reservation") {
    var updateReservationNumber = String(body.reservationNumber || "")
      .trim()
      .replace(/^GRF-/i, "");
    var nextGuestName = String(body.guestName || "").trim();
    var nextContact = String(body.contact || "").trim();
    var nextTotalAmount = Number(
      String(body.totalAmount != null ? body.totalAmount : "")
        .replace(/[^\d.-]/g, ""),
    );
    if (!updateReservationNumber) {
      json(res, 400, { ok: false, error: "reservationNumber가 필요합니다." });
      return;
    }
    if (!nextGuestName) {
      json(res, 400, { ok: false, error: "예약자명을 입력해 주세요." });
      return;
    }
    if (nextGuestName.length > MAX_GUEST_NAME) {
      json(res, 400, {
        ok: false,
        error: "예약자명은 " + MAX_GUEST_NAME + "자 이내로 입력해 주세요.",
      });
      return;
    }
    if (!nextContact) {
      json(res, 400, { ok: false, error: "연락처를 입력해 주세요." });
      return;
    }
    if (nextContact.length > MAX_CONTACT) {
      json(res, 400, {
        ok: false,
        error: "연락처는 " + MAX_CONTACT + "자 이내로 입력해 주세요.",
      });
      return;
    }
    if (!Number.isFinite(nextTotalAmount) || nextTotalAmount < 0) {
      json(res, 400, { ok: false, error: "금액을 확인해 주세요." });
      return;
    }
    nextTotalAmount = Math.floor(nextTotalAmount);
    try {
      await archivePastReservations(pool);
      await purgeExpiredBookings(pool);
      var updateSel = await pool.query(
        `SELECT reservation_number, created_at, status
         FROM ${BOOKING_TABLE}
         WHERE reservation_number = $1
         LIMIT 1`,
        [updateReservationNumber],
      );
      if (!updateSel.rows || !updateSel.rows.length) {
        json(res, 404, { ok: false, error: "대상 예약을 찾을 수 없습니다." });
        return;
      }
      if (!(await applyBookingRetentionToRow(pool, updateSel.rows[0]))) {
        json(res, 404, { ok: false, error: "대상 예약을 찾을 수 없습니다." });
        return;
      }
      if (String(updateSel.rows[0].status || "") !== "confirm") {
        json(res, 400, {
          ok: false,
          error: "다가올 예약만 수정할 수 있습니다.",
        });
        return;
      }
      var encryptedPii = encryptBookingPii({
        guestName: nextGuestName,
        contact: nextContact,
      });
      var updateUpd = await pool.query(
        `UPDATE ${BOOKING_TABLE}
         SET guest_name = $2,
             contact = $3,
             total_amount = $4
         WHERE reservation_number = $1
           AND status = 'confirm'
         RETURNING
           reservation_number,
           guest_name,
           contact,
           total_amount`,
        [
          updateReservationNumber,
          encryptedPii.guest_name,
          encryptedPii.contact,
          nextTotalAmount,
        ],
      );
      if (!updateUpd.rows || !updateUpd.rows.length) {
        json(res, 404, { ok: false, error: "대상 예약을 찾을 수 없습니다." });
        return;
      }
      var updated = mapRow(updateUpd.rows[0], false);
      json(res, 200, {
        ok: true,
        reservationNumber: updated.reservationNumber,
        guestName: updated.guestName,
        contact: updated.contact,
        totalAmount: updated.totalAmount,
      });
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: String((e && e.message) || e || "reservation update failed"),
      });
    }
    return;
  }

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
    await purgeExpiredBookings(pool);
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

    var extraCols = isDeleted
      ? ", cancel_reason, other_reason, cancelled_at, refund_amount"
      : "";

    var sel = await pool.query(
      `SELECT
        reservation_number,
        guest_name,
        contact,
        email,
        room_type,
        check_in_date,
        check_out_date,
        guest_count,
        total_amount,
        stay_nights,
        guest_request,
        payment_method,
        checkin_alarm_sent_count,
        booking_locale,
        booking_channel,
        linked_external_uid,
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
          reservation_number, guest_name, contact, email, room_type,
          check_in_date, check_out_date, guest_count, total_amount,
          stay_nights, guest_request, payment_method, bank_confirmed,
          checkin_alarm_sent_count,
          booking_locale,
          booking_channel,
          linked_external_uid,
          created_at, (status = 'completed') AS is_past
        FROM ${BOOKING_TABLE}
        WHERE status IN ('confirm', 'completed')
        ORDER BY check_in_date ASC, created_at DESC`,
      );
      var bookingCalendarRows = (calSel.rows || []).map(function (row) {
        var calPii = decryptBookingPiiResponse(row);
        return {
          reservationNumber: row.reservation_number,
          guestName: calPii.guestName,
          contact: calPii.contact,
          email: calPii.email || "",
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
          checkinAlarmSentCount:
            row.checkin_alarm_sent_count != null
              ? Number(row.checkin_alarm_sent_count)
              : 0,
          bookingLocale: row.booking_locale || "kr",
          bookingChannel: row.booking_channel || "direct",
          linkedExternalUid: row.linked_external_uid || "",
        };
      });
      var externalCalendarRows = await getExternalBookingCalendarRows(pool);
      result.calendarRows = bookingCalendarRows.concat(
        filterShadowedExternalCalendarRows(
          bookingCalendarRows,
          externalCalendarRows,
        ),
      );
    }

    json(res, 200, result);
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "lookup failed"),
    });
  }
}
