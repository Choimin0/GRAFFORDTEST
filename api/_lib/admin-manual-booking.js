import crypto from "node:crypto";
import { encryptBookingPii } from "./pii-crypto.js";
import { json } from "./admin-common.js";
import {
  hasRoomBlockOverlap,
  hasReservationOverlap,
} from "./room-availability.js";
import { hasActiveHoldOverlap } from "./booking-hold.js";
import { getTodayYmdKst } from "./promotion-period.js";

const BOOKING_TABLE = "booking";
const EXTERNAL_BOOKING_TABLE = "external_booking";
const ALLOWED_ROOMS = new Set(["G1", "G2", "G3", "G4"]);
const ALLOWED_CHANNELS = new Set([
  "airbnb",
  "naver",
  "stayfolio",
  "phone",
]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GUEST_REQUEST = 2000;
const EXTERNAL_MANUAL_PAYMENT_METHOD = "external-manual";

export function isExternalManualPaymentMethod(paymentMethod) {
  return (
    String(paymentMethod || "")
      .trim()
      .toLowerCase() === EXTERNAL_MANUAL_PAYMENT_METHOD
  );
}

const ROOM_GUEST_LIMITS = {
  G1: { base: 2, max: 2 },
  G2: { base: 2, max: 2 },
  G3: { base: 2, max: 3 },
  G4: { base: 4, max: 5 },
};

function normalizeRoomType(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

function normalizeChannel(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

function countStayNights(checkIn, checkOut) {
  var d1 = new Date(checkIn + "T12:00:00");
  var d2 = new Date(checkOut + "T12:00:00");
  if (isNaN(d1.getTime()) || isNaN(d2.getTime()) || d2 <= d1) {
    return 0;
  }
  return Math.round((d2 - d1) / 86400000);
}

function generateManualReservationNumber(todayYmd) {
  var rnd = crypto.randomBytes(3).toString("hex").toUpperCase();
  return todayYmd.replace(/-/g, "") + "-" + rnd;
}

function getGuestLimits(room) {
  return ROOM_GUEST_LIMITS[room] || { base: 2, max: 2 };
}

function validateGuestCount(room, guestCount) {
  var limits = getGuestLimits(room);
  var gc = Math.floor(Number(guestCount));
  if (!Number.isFinite(gc) || gc < 1 || gc > limits.max) {
    return {
      ok: false,
      error:
        room +
        " 객실은 최대 " +
        limits.max +
        "명까지 입력할 수 있습니다.",
    };
  }
  return { ok: true, guestCount: gc, extraGuests: Math.max(0, gc - limits.base) };
}

function dateRangeOverlaps(ci1, co1, ci2, co2) {
  ci1 = String(ci1 || "").slice(0, 10);
  co1 = String(co1 || "").slice(0, 10);
  ci2 = String(ci2 || "").slice(0, 10);
  co2 = String(co2 || "").slice(0, 10);
  if (!ci1 || !co1 || !ci2 || !co2 || ci1 >= co1 || ci2 >= co2) {
    return false;
  }
  return ci1 < co2 && ci2 < co1;
}

async function findMatchingExternalBooking(pool, room, checkIn, checkOut) {
  try {
    var result = await pool.query(
      `SELECT external_uid
       FROM ${EXTERNAL_BOOKING_TABLE}
       WHERE room_type = $1
         AND check_in_date < $3::date
         AND check_out_date > $2::date
       ORDER BY
         (check_in_date = $2::date AND check_out_date = $3::date) DESC,
         (check_out_date - check_in_date) ASC,
         last_synced_at DESC NULLS LAST,
         created_at DESC
       LIMIT 1`,
      [room, checkIn, checkOut],
    );
    if (!result.rows || !result.rows.length) {
      return "";
    }
    return String(result.rows[0].external_uid || "").trim();
  } catch (e) {
    if (e && (e.code === "42P01" || e.code === "42703")) {
      return "";
    }
    throw e;
  }
}

async function hasDuplicateManualBooking(pool, room, checkIn, checkOut) {
  var result = await pool.query(
    `SELECT reservation_number
     FROM ${BOOKING_TABLE}
     WHERE status = 'confirm'
       AND room_type = $1
       AND check_in_date = $2::date
       AND check_out_date = $3::date
     LIMIT 1`,
    [room, checkIn, checkOut],
  );
  return !!(result.rows && result.rows.length);
}

async function checkManualBookingAvailability(
  pool,
  room,
  checkIn,
  checkOut,
) {
  if (await hasRoomBlockOverlap(pool, room, checkIn, checkOut)) {
    return { available: false, reason: "blocked" };
  }
  if (await hasReservationOverlap(pool, room, checkIn, checkOut, null)) {
    return { available: false, reason: "occupied" };
  }
  if (await hasActiveHoldOverlap(pool, room, checkIn, checkOut, null)) {
    return { available: false, reason: "held" };
  }
  return { available: true };
}

export function filterShadowedExternalCalendarRows(bookingRows, externalRows) {
  var bookings = bookingRows || [];
  return (externalRows || []).filter(function (ext) {
    return !bookings.some(function (booking) {
      var linkedUid = String(booking.linkedExternalUid || "").trim();
      var extUid = String(ext.externalUid || "").trim();
      if (linkedUid && extUid && linkedUid === extUid) {
        return true;
      }
      if (booking.roomType !== ext.roomType) {
        return false;
      }
      return dateRangeOverlaps(
        booking.checkIn,
        booking.checkOut,
        ext.checkIn,
        ext.checkOut,
      );
    });
  });
}

export async function handleCreateManualBooking(res, pool, body) {
  var roomType = normalizeRoomType(body.roomType || body.room);
  var bookingChannel = normalizeChannel(
    body.bookingChannel || body.platform || "",
  );
  var checkIn = String(body.checkIn || body.checkin || "").trim();
  var checkOut = String(body.checkOut || body.checkout || "").trim();
  var guestName = String(body.guestName || "").trim();
  var contact = String(body.contact || body.phone || "").trim() || "-";
  var guestRequest = String(body.guestRequest || body.memo || "")
    .trim()
    .slice(0, MAX_GUEST_REQUEST);
  var totalAmount = Math.floor(Number(body.totalAmount || body.amount || 0));

  if (!ALLOWED_ROOMS.has(roomType)) {
    json(res, 400, { ok: false, error: "유효한 객실(G1~G4)을 선택해 주세요." });
    return;
  }
  if (!ALLOWED_CHANNELS.has(bookingChannel)) {
    json(res, 400, {
      ok: false,
      error: "유효한 예약 채널을 선택해 주세요.",
    });
    return;
  }
  if (!DATE_RE.test(checkIn) || !DATE_RE.test(checkOut) || checkIn >= checkOut) {
    json(res, 400, {
      ok: false,
      error: "체크인·체크아웃 날짜를 확인해 주세요.",
    });
    return;
  }
  if (!guestName) {
    json(res, 400, { ok: false, error: "게스트 이름을 입력해 주세요." });
    return;
  }
  if (!Number.isFinite(totalAmount) || totalAmount < 0) {
    json(res, 400, { ok: false, error: "총 결제 금액을 확인해 주세요." });
    return;
  }

  var guestValidation = validateGuestCount(roomType, body.guestCount);
  if (!guestValidation.ok) {
    json(res, 400, { ok: false, error: guestValidation.error });
    return;
  }

  var stayNights = countStayNights(checkIn, checkOut);
  if (stayNights < 1) {
    json(res, 400, { ok: false, error: "숙박 일수를 확인해 주세요." });
    return;
  }

  if (await hasDuplicateManualBooking(pool, roomType, checkIn, checkOut)) {
    json(res, 409, {
      ok: false,
      error: "동일 객실·기간의 확정 예약이 이미 있습니다.",
    });
    return;
  }

  var availability = await checkManualBookingAvailability(
    pool,
    roomType,
    checkIn,
    checkOut,
  );
  if (!availability.available) {
    var reasonMessages = {
      blocked: "선택한 기간은 관리자 방막기로 등록할 수 없습니다.",
      occupied: "동일 객실·기간에 확정 예약이 있습니다.",
      held: "다른 고객이 해당 기간을 예약 진행 중입니다.",
    };
    json(res, 409, {
      ok: false,
      error:
        reasonMessages[availability.reason] ||
        "해당 기간에 예약을 등록할 수 없습니다.",
      reason: availability.reason,
    });
    return;
  }

  var linkedExternalUid = "";
  var mergedWithIcal = false;
  if (bookingChannel === "airbnb") {
    linkedExternalUid = await findMatchingExternalBooking(
      pool,
      roomType,
      checkIn,
      checkOut,
    );
    mergedWithIcal = !!linkedExternalUid;
  }

  var todayYmd = getTodayYmdKst();
  var insertStatus = checkIn < todayYmd ? "completed" : "confirm";
  var reservationNumber = generateManualReservationNumber(todayYmd);
  var encPii = encryptBookingPii({
    guestName: guestName,
    contact: contact,
    email: null,
  });

  try {
    var result = await pool.query(
      `INSERT INTO ${BOOKING_TABLE} (
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
         booking_locale,
         booking_channel,
         linked_external_uid
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7::date, $8::date, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
       )
       RETURNING reservation_number, booking_channel, linked_external_uid, created_at`,
      [
        reservationNumber,
        insertStatus,
        encPii.guest_name,
        encPii.contact,
        null,
        roomType,
        checkIn,
        checkOut,
        guestValidation.guestCount,
        stayNights,
        guestValidation.extraGuests,
        totalAmount,
        guestRequest || null,
        EXTERNAL_MANUAL_PAYMENT_METHOD,
        true,
        "kr",
        bookingChannel,
        linkedExternalUid || null,
      ],
    );

    var row = result.rows && result.rows[0];
    if (!row) {
      json(res, 500, { ok: false, error: "예약 저장에 실패했습니다." });
      return;
    }

    json(res, 200, {
      ok: true,
      reservationNumber: row.reservation_number,
      bookingChannel: row.booking_channel,
      linkedExternalUid: row.linked_external_uid || "",
      mergedWithIcal: mergedWithIcal,
      message: mergedWithIcal
        ? "Airbnb iCal 예약과 자동 병합되어 등록되었습니다."
        : "예약이 등록되었습니다.",
    });
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "manual booking insert failed"),
    });
  }
}
