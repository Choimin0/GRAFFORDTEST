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
  countStayNights,
  validateGuestCount,
} from "./admin-manual-booking.js";
import { archivePastReservations } from "./booking-archive.js";
import {
  hasRoomBlockOverlap,
  hasReservationOverlap,
} from "./room-availability.js";
import { hasActiveHoldOverlap } from "./booking-hold.js";
import { parsePricingBreakdownFromDb } from "./pricing-breakdown.js";
import {
  attachStaySegmentsToRows,
  guestDisplayCheckIn,
  guestDisplayCheckOut,
  guestDisplayRoomType,
  isRoomChangeChildRow,
  isRoomChangeItinerary,
  normalizeStaySegments,
  persistRoomChangeOccupancy,
} from "./booking-room-change.js";

const BOOKING_TABLE = "booking";
const MAX_GUEST_NAME = 100;
const MAX_CONTACT = 40;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function checkAdminReservationUpdateAvailability(
  pool,
  room,
  checkIn,
  checkOut,
  excludeReservationNumber,
) {
  if (await hasRoomBlockOverlap(pool, room, checkIn, checkOut)) {
    return { available: false, reason: "blocked" };
  }
  if (
    await hasReservationOverlap(
      pool,
      room,
      checkIn,
      checkOut,
      excludeReservationNumber,
    )
  ) {
    return { available: false, reason: "occupied" };
  }
  if (await hasActiveHoldOverlap(pool, room, checkIn, checkOut, null)) {
    return { available: false, reason: "held" };
  }
  return { available: true };
}

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

const ROOM_CHANGE_SELECT_COLS = `
        parent_reservation_number,
        stay_role,
        contract_check_in,
        contract_check_out,
        original_room_type`;

function mapRow(row, isDeleted, options) {
  var useOccupancy = options && options.useOccupancyDates === true;
  var pii = decryptBookingPiiResponse(row);
  var occupancyCheckIn = toYMD(row.check_in_date);
  var occupancyCheckOut = toYMD(row.check_out_date);
  var displayCheckIn = useOccupancy
    ? occupancyCheckIn
    : guestDisplayCheckIn(row) || occupancyCheckIn;
  var displayCheckOut = useOccupancy
    ? occupancyCheckOut
    : guestDisplayCheckOut(row) || occupancyCheckOut;
  var originalRoom = guestDisplayRoomType(row) || row.room_type;
  var displayRoom = useOccupancy ? row.room_type : originalRoom || row.room_type;
  var staySegments = row.staySegments || null;
  var hasRoomChange = staySegments
    ? isRoomChangeItinerary(staySegments, originalRoom || row.room_type)
    : !!(row.contract_check_out || isRoomChangeChildRow(row));
  var stayPeriod = row.stay_nights != null ? Number(row.stay_nights) : null;
  if (useOccupancy && occupancyCheckIn && occupancyCheckOut) {
    stayPeriod =
      countStayNights(occupancyCheckIn, occupancyCheckOut) || stayPeriod;
  } else if (displayCheckIn && displayCheckOut) {
    stayPeriod = countStayNights(displayCheckIn, displayCheckOut) || stayPeriod;
  }
  var base = {
    reservationNumber: row.reservation_number,
    guestName: pii.guestName,
    contact: pii.contact,
    email: pii.email || "",
    roomType: displayRoom,
    checkIn: displayCheckIn,
    checkOut: displayCheckOut,
    occupancyCheckIn: occupancyCheckIn,
    occupancyCheckOut: occupancyCheckOut,
    occupancyRoomType: row.room_type,
    originalRoomType: originalRoom || row.room_type,
    guestCount: row.guest_count,
    extraGuests: row.extra_guests != null ? Number(row.extra_guests) : null,
    totalAmount: row.total_amount != null ? Number(row.total_amount) : 0,
    stayPeriod: stayPeriod,
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
    pricingBreakdown: parsePricingBreakdownFromDb(row.pricing_breakdown),
    staySegments: staySegments,
    hasRoomChange: hasRoomChange,
    parentReservationNumber: row.parent_reservation_number || "",
    stayRole: row.stay_role || "primary",
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
    var nextCheckIn = String(body.checkIn || body.checkin || "").trim();
    var nextCheckOut = String(body.checkOut || body.checkout || "").trim();
    var nextGuestCount = Math.floor(Number(body.guestCount));
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
    if (
      !DATE_RE.test(nextCheckIn) ||
      !DATE_RE.test(nextCheckOut) ||
      nextCheckIn >= nextCheckOut
    ) {
      json(res, 400, {
        ok: false,
        error: "체크인·체크아웃 날짜를 확인해 주세요.",
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
        `SELECT reservation_number, created_at, status, room_type,
                check_in_date, check_out_date, guest_count,
                guest_name, contact, email, booking_locale,
                ${ROOM_CHANGE_SELECT_COLS}
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
      if (isRoomChangeChildRow(updateSel.rows[0])) {
        json(res, 400, {
          ok: false,
          error: "룸체인지 구간은 원예약에서만 수정할 수 있습니다.",
        });
        return;
      }
      var roomType = String(updateSel.rows[0].room_type || "")
        .trim()
        .toUpperCase();
      var guestValidation = validateGuestCount(roomType, nextGuestCount);
      if (!guestValidation.ok) {
        json(res, 400, { ok: false, error: guestValidation.error });
        return;
      }
      var stayNights = countStayNights(nextCheckIn, nextCheckOut);
      if (stayNights < 1) {
        json(res, 400, { ok: false, error: "숙박 일수를 확인해 주세요." });
        return;
      }
      var staySegments = normalizeStaySegments(body.staySegments);
      var hasExistingRoomChange = !!(
        updateSel.rows[0].contract_check_out ||
        updateSel.rows[0].original_room_type
      );
      if (staySegments && staySegments.length) {
        var firstRoomValidation = validateGuestCount(
          staySegments[0].room,
          nextGuestCount,
        );
        if (!firstRoomValidation.ok) {
          json(res, 400, { ok: false, error: firstRoomValidation.error });
          return;
        }
        guestValidation = firstRoomValidation;
      } else if (hasExistingRoomChange) {
        var existingContractIn = guestDisplayCheckIn(updateSel.rows[0]);
        var existingContractOut = guestDisplayCheckOut(updateSel.rows[0]);
        if (
          nextCheckIn !== existingContractIn ||
          nextCheckOut !== existingContractOut
        ) {
          json(res, 400, {
            ok: false,
            error: "룸체인지 예약은 객실 일정과 함께 저장해 주세요.",
          });
          return;
        }
      } else {
        var prevCheckIn = toYMD(updateSel.rows[0].check_in_date);
        var prevCheckOut = toYMD(updateSel.rows[0].check_out_date);
        var datesChanged =
          nextCheckIn !== prevCheckIn || nextCheckOut !== prevCheckOut;
        if (datesChanged) {
          var availability = await checkAdminReservationUpdateAvailability(
            pool,
            roomType,
            nextCheckIn,
            nextCheckOut,
            updateReservationNumber,
          );
          if (!availability.available) {
            var reasonMessages = {
              blocked: "선택한 기간은 방막기로 예약할 수 없습니다.",
              occupied: "동일 객실·기간에 다른 확정 예약이 있습니다.",
              held: "다른 고객이 해당 기간을 예약 진행 중입니다.",
            };
            json(res, 409, {
              ok: false,
              error:
                reasonMessages[availability.reason] ||
                "해당 기간으로 변경할 수 없습니다.",
              reason: availability.reason,
            });
            return;
          }
        }
      }
      var encryptedPii = encryptBookingPii({
        guestName: nextGuestName,
        contact: nextContact,
      });
      var client = await pool.connect();
      var updated;
      try {
        await client.query("BEGIN");
        var updateUpd = await client.query(
          `UPDATE ${BOOKING_TABLE}
           SET guest_name = $2,
               contact = $3,
               total_amount = $4,
               guest_count = $5,
               extra_guests = $6,
               pricing_breakdown = NULL
           WHERE reservation_number = $1
             AND status = 'confirm'
           RETURNING
             reservation_number,
             guest_name,
             contact,
             email,
             total_amount,
             room_type,
             check_in_date,
             check_out_date,
             guest_count,
             extra_guests,
             stay_nights,
             guest_request,
             payment_method,
             checkin_alarm_sent_count,
             booking_locale,
             booking_channel,
             linked_external_uid,
             created_at,
             ${ROOM_CHANGE_SELECT_COLS}`,
          [
            updateReservationNumber,
            encryptedPii.guest_name,
            encryptedPii.contact,
            nextTotalAmount,
            guestValidation.guestCount,
            guestValidation.extraGuests,
          ],
        );
        if (!updateUpd.rows || !updateUpd.rows.length) {
          await client.query("ROLLBACK");
          json(res, 404, { ok: false, error: "대상 예약을 찾을 수 없습니다." });
          return;
        }
        var primaryAfterPii = updateUpd.rows[0];
        if (staySegments && staySegments.length) {
          var persistResult = await persistRoomChangeOccupancy(
            client,
            primaryAfterPii,
            {
              contractCheckIn: nextCheckIn,
              contractCheckOut: nextCheckOut,
              segments: staySegments,
              guestCount: guestValidation.guestCount,
            },
          );
          if (!persistResult.ok) {
            await client.query("ROLLBACK");
            json(res, persistResult.reason ? 409 : 400, {
              ok: false,
              error: persistResult.error,
              reason: persistResult.reason,
            });
            return;
          }
        } else if (!hasExistingRoomChange) {
          await client.query(
            `UPDATE ${BOOKING_TABLE}
             SET check_in_date = $2::date,
                 check_out_date = $3::date,
                 stay_nights = $4
             WHERE reservation_number = $1
               AND status = 'confirm'`,
            [updateReservationNumber, nextCheckIn, nextCheckOut, stayNights],
          );
        }
        var finalSel = await client.query(
          `SELECT
             reservation_number,
             guest_name,
             contact,
             email,
             total_amount,
             room_type,
             check_in_date,
             check_out_date,
             guest_count,
             extra_guests,
             stay_nights,
             guest_request,
             payment_method,
             checkin_alarm_sent_count,
             booking_locale,
             booking_channel,
             linked_external_uid,
             created_at,
             ${ROOM_CHANGE_SELECT_COLS}
           FROM ${BOOKING_TABLE}
           WHERE reservation_number = $1
           LIMIT 1`,
          [updateReservationNumber],
        );
        await attachStaySegmentsToRows(client, finalSel.rows || []);
        updated = mapRow(finalSel.rows[0], false);
        await client.query("COMMIT");
      } catch (txErr) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackErr) {
          /* ignore */
        }
        throw txErr;
      } finally {
        client.release();
      }
      json(res, 200, {
        ok: true,
        reservationNumber: updated.reservationNumber,
        guestName: updated.guestName,
        contact: updated.contact,
        totalAmount: updated.totalAmount,
        checkIn: updated.checkIn,
        checkOut: updated.checkOut,
        guestCount: updated.guestCount,
        stayPeriod: updated.stayPeriod,
        staySegments: updated.staySegments || [],
        hasRoomChange: updated.hasRoomChange === true,
        originalRoomType: updated.originalRoomType,
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
      : collection === "past-reservations"
        ? "ORDER BY check_out_date DESC, created_at DESC"
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
        extra_guests,
        total_amount,
        pricing_breakdown,
        stay_nights,
        guest_request,
        payment_method,
        checkin_alarm_sent_count,
        booking_locale,
        booking_channel,
        linked_external_uid,
        created_at,
        ${ROOM_CHANGE_SELECT_COLS}
        ${extraCols}
      FROM ${BOOKING_TABLE}
      WHERE status = $1
        AND COALESCE(parent_reservation_number, '') = ''
        AND COALESCE(stay_role, 'primary') <> 'room_change'
      ${orderClause}`,
      [statusFilter],
    );

    await attachStaySegmentsToRows(pool, sel.rows || []);
    var rows = (sel.rows || []).map(function (row) {
      return mapRow(row, isDeleted);
    });

    var result = { ok: true, rows: rows };

    if (isActive) {
      // 달력용: confirm + completed 모두 포함
      var calSel = await pool.query(
        `SELECT
          reservation_number, guest_name, contact, email, room_type,
          check_in_date, check_out_date, guest_count, extra_guests, total_amount,
          pricing_breakdown,
          stay_nights, guest_request, payment_method, bank_confirmed,
          checkin_alarm_sent_count,
          booking_locale,
          booking_channel,
          linked_external_uid,
          created_at, (status = 'completed') AS is_past,
          ${ROOM_CHANGE_SELECT_COLS}
        FROM ${BOOKING_TABLE}
        WHERE status IN ('confirm', 'completed')
        ORDER BY check_in_date ASC, created_at DESC`,
      );
      var primaryCalRows = (calSel.rows || []).filter(function (row) {
        return !isRoomChangeChildRow(row);
      });
      await attachStaySegmentsToRows(pool, primaryCalRows);
      var segmentByParent = {};
      primaryCalRows.forEach(function (row) {
        segmentByParent[row.reservation_number] = row.staySegments || [];
      });
      var bookingCalendarRows = (calSel.rows || []).map(function (row) {
        if (!isRoomChangeChildRow(row)) {
          var mapped = mapRow(row, false, { useOccupancyDates: true });
          mapped.isPast = row.is_past === true;
          mapped.bankConfirmed = row.bank_confirmed === true;
          return mapped;
        }
        var parentSegs = segmentByParent[row.parent_reservation_number] || [];
        var mappedChild = mapRow(
          Object.assign({}, row, { staySegments: parentSegs }),
          false,
          { useOccupancyDates: true },
        );
        mappedChild.isPast = row.is_past === true;
        mappedChild.bankConfirmed = row.bank_confirmed === true;
        mappedChild.hasRoomChange = true;
        return mappedChild;
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
