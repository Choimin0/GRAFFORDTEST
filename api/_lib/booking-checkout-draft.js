import { encryptBookingPii, decryptBookingPiiResponse } from "./pii-crypto.js";
import { normalizeBookingLocale } from "./booking-locale.js";
import { normalizePaymentMethodId } from "./payment-methods.js";
import {
  clampExtraGuests,
  computeGuestCount,
} from "./room-guest-policy.js";
import { getBookingHoldByReservationNumber } from "./booking-hold.js";
import {
  normalizePricingBreakdown,
  validatePricingBreakdownForBooking,
  serializePricingBreakdown,
} from "./pricing-breakdown.js";

const BOOKING_TABLE = "booking";
const PENDING_STATUS = "pending";
const ALLOWED_ROOMS = new Set(["G1", "G2", "G3", "G4"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PENDING_TTL_MINUTES = 120;
const DEFAULT_PENDING_RETAIN_MINUTES = 7 * 24 * 60;

// 달력·겹침에서 pending이 날짜를 막는 시간은 booking_hold.expires_at 과 같습니다.
// 홀드는 confirm.html 진입 때 15분이 시작되고, payment.html 로 넘어가도 그 시각이 유지됩니다.
const MAX_NAME = 255;
const MAX_CONTACT = 120;
const MAX_EMAIL = 255;
const MAX_GUEST_REQUEST = 2000;
const MAX_RESV = 32;

export function getPendingTtlMinutes() {
  var raw = Number(process.env.BOOKING_CHECKOUT_TTL_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_PENDING_TTL_MINUTES;
  }
  return Math.min(24 * 60, Math.floor(raw));
}

function getPendingRetainMinutes() {
  var raw = Number(process.env.BOOKING_CHECKOUT_RETAIN_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_PENDING_RETAIN_MINUTES;
  }
  return Math.max(getPendingTtlMinutes(), Math.floor(raw));
}

function normalizeReservationNumber(raw) {
  var t = String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
  if (t.startsWith("GRF-")) {
    t = t.slice(4);
  }
  return t;
}

function isMissingColumn(e) {
  return !!(e && e.code === "42703");
}

export async function cleanupExpiredCheckoutDrafts(pool) {
  try {
    await pool.query(
      `DELETE FROM ${BOOKING_TABLE}
       WHERE status = $1
         AND created_at < NOW() - make_interval(mins => $2::int)`,
      [PENDING_STATUS, getPendingRetainMinutes()],
    );
  } catch (e) {
    if (e && e.code === "42P01") {
      return;
    }
    throw e;
  }
}

export function normalizeCheckoutDraftInput(raw) {
  var src = raw || {};
  var reservationNumber = normalizeReservationNumber(
    src.reservationNumber || src.orderNo || "",
  );
  var roomType = String(src.roomType || src.room || "")
    .trim()
    .toUpperCase();
  var checkIn = String(src.checkIn || src.check_in_date || "").trim();
  var checkOut = String(src.checkOut || src.check_out_date || "").trim();
  var guestName = String(src.guestName || src.guest_name || "").trim();
  var contact = String(src.contact || "").trim();
  var email = String(src.email || "")
    .trim()
    .slice(0, MAX_EMAIL);
  var guestRequest = String(src.guestRequest || src.guest_request || "")
    .trim()
    .slice(0, MAX_GUEST_REQUEST);
  var stayNights = Number(src.stayNights != null ? src.stayNights : src.stay_nights);
  var extraGuests = Number(
    src.extraGuests != null ? src.extraGuests : src.extra_guests,
  );
  var guestCount = Number(src.guestCount != null ? src.guestCount : src.guest_count);
  var totalAmount = Number(
    src.totalAmount != null ? src.totalAmount : src.total_amount,
  );
  var paymentMethod = normalizePaymentMethodId(
    src.paymentMethod || src.payMethod || src.payment_method || "",
  );
  var bookingLocale = normalizeBookingLocale(src.bookingLocale || src.booking_locale);
  var holdId = String(src.holdId || src.hold_id || "").trim();
  var pricingBreakdown =
    src.pricingBreakdown != null
      ? src.pricingBreakdown
      : src.pricing_breakdown != null
        ? src.pricing_breakdown
        : null;

  if (!reservationNumber || reservationNumber.length > MAX_RESV) {
    return { ok: false, error: "Invalid reservationNumber" };
  }
  if (!ALLOWED_ROOMS.has(roomType)) {
    return { ok: false, error: "Invalid roomType" };
  }
  if (!DATE_RE.test(checkIn) || !DATE_RE.test(checkOut) || checkIn >= checkOut) {
    return { ok: false, error: "Invalid checkIn or checkOut" };
  }
  if (!guestName || guestName.length > MAX_NAME) {
    return { ok: false, error: "Invalid guestName" };
  }
  if (!contact || contact.length > MAX_CONTACT) {
    return { ok: false, error: "Invalid contact" };
  }
  if (!Number.isFinite(stayNights) || stayNights < 1 || stayNights > 365) {
    return { ok: false, error: "Invalid stayNights" };
  }
  if (!Number.isFinite(extraGuests) || extraGuests < 0) {
    extraGuests = 0;
  }
  extraGuests = clampExtraGuests(roomType, extraGuests);
  if (!Number.isFinite(guestCount) || guestCount < 1 || guestCount > 50) {
    guestCount = computeGuestCount(roomType, extraGuests);
  }
  if (!Number.isFinite(totalAmount) || totalAmount < 0 || totalAmount > 1e12) {
    return { ok: false, error: "Invalid totalAmount" };
  }
  if (!paymentMethod) {
    paymentMethod = "card";
  }

  return {
    ok: true,
    draft: {
      reservationNumber: reservationNumber,
      holdId: holdId,
      roomType: roomType,
      checkIn: checkIn,
      checkOut: checkOut,
      guestName: guestName,
      contact: contact,
      email: email,
      guestRequest: guestRequest,
      stayNights: Math.floor(stayNights),
      extraGuests: Math.floor(extraGuests),
      guestCount: Math.floor(guestCount),
      totalAmount: Math.floor(totalAmount),
      paymentMethod: paymentMethod,
      bookingLocale: bookingLocale,
      pricingBreakdown: pricingBreakdown,
    },
  };
}

function serializeDraftBreakdown(draft) {
  var normalized = normalizePricingBreakdown(draft.pricingBreakdown);
  var check = validatePricingBreakdownForBooking(normalized, {
    roomType: draft.roomType,
    stayNights: draft.stayNights,
    extraGuests: draft.extraGuests,
    totalAmount: draft.totalAmount,
  });
  return check.ok && check.breakdown
    ? serializePricingBreakdown(check.breakdown)
    : null;
}

export async function persistCheckoutDraft(pool, raw) {
  var normalized = normalizeCheckoutDraftInput(raw);
  if (!normalized.ok) {
    return normalized;
  }
  var draft = normalized.draft;
  await cleanupExpiredCheckoutDrafts(pool);
  var encPii = encryptBookingPii({
    guestName: draft.guestName,
    contact: draft.contact,
    email: draft.email || null,
  });
  var pricingBreakdownToStore = serializeDraftBreakdown(draft);
  var params = [
    draft.reservationNumber,
    PENDING_STATUS,
    encPii.guest_name,
    encPii.contact,
    encPii.email || null,
    draft.roomType,
    draft.checkIn,
    draft.checkOut,
    draft.guestCount,
    draft.stayNights,
    draft.extraGuests,
    draft.totalAmount,
    pricingBreakdownToStore ? JSON.stringify(pricingBreakdownToStore) : null,
    draft.guestRequest || null,
    draft.paymentMethod,
    false,
    draft.bookingLocale,
  ];
  try {
    await pool.query(
      `INSERT INTO ${BOOKING_TABLE} (
         reservation_number, status, guest_name, contact, email,
         room_type, check_in_date, check_out_date,
         guest_count, stay_nights, extra_guests, total_amount,
         pricing_breakdown, guest_request, payment_method, bank_confirmed,
         booking_locale
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::date, $8::date,
         $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17
       )
       ON CONFLICT (reservation_number) DO UPDATE SET
         guest_name = EXCLUDED.guest_name,
         contact = EXCLUDED.contact,
         email = EXCLUDED.email,
         room_type = EXCLUDED.room_type,
         check_in_date = EXCLUDED.check_in_date,
         check_out_date = EXCLUDED.check_out_date,
         guest_count = EXCLUDED.guest_count,
         stay_nights = EXCLUDED.stay_nights,
         extra_guests = EXCLUDED.extra_guests,
         total_amount = EXCLUDED.total_amount,
         pricing_breakdown = EXCLUDED.pricing_breakdown,
         guest_request = EXCLUDED.guest_request,
         payment_method = EXCLUDED.payment_method,
         booking_locale = EXCLUDED.booking_locale,
         bank_confirmed = false,
         created_at = NOW()
       WHERE ${BOOKING_TABLE}.status = '${PENDING_STATUS}'`,
      params,
    );
  } catch (e) {
    if (isMissingColumn(e)) {
      await pool.query(
        `INSERT INTO ${BOOKING_TABLE} (
           reservation_number, status, guest_name, contact, email,
           room_type, check_in_date, check_out_date,
           guest_count, stay_nights, extra_guests, total_amount,
           guest_request, payment_method, bank_confirmed
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7::date, $8::date,
           $9, $10, $11, $12, $13, $14, $15
         )
         ON CONFLICT (reservation_number) DO UPDATE SET
           guest_name = EXCLUDED.guest_name,
           contact = EXCLUDED.contact,
           email = EXCLUDED.email,
           room_type = EXCLUDED.room_type,
           check_in_date = EXCLUDED.check_in_date,
           check_out_date = EXCLUDED.check_out_date,
           guest_count = EXCLUDED.guest_count,
           stay_nights = EXCLUDED.stay_nights,
           extra_guests = EXCLUDED.extra_guests,
           total_amount = EXCLUDED.total_amount,
           guest_request = EXCLUDED.guest_request,
           payment_method = EXCLUDED.payment_method,
           bank_confirmed = false,
           created_at = NOW()
         WHERE ${BOOKING_TABLE}.status = '${PENDING_STATUS}'`,
        [
          draft.reservationNumber,
          PENDING_STATUS,
          encPii.guest_name,
          encPii.contact,
          encPii.email || null,
          draft.roomType,
          draft.checkIn,
          draft.checkOut,
          draft.guestCount,
          draft.stayNights,
          draft.extraGuests,
          draft.totalAmount,
          draft.guestRequest || null,
          draft.paymentMethod,
          false,
        ],
      );
    } else {
      throw e;
    }
  }
  var hold = await getBookingHoldByReservationNumber(
    pool,
    draft.reservationNumber,
  );
  var holdExpiresAt = Number(hold && hold.expires_at_ms);
  return {
    ok: true,
    draft: draft,
    expiresAt: Number.isFinite(holdExpiresAt) && holdExpiresAt > Date.now()
      ? holdExpiresAt
      : Date.now(),
  };
}

export async function getCheckoutDraft(pool, reservationNumber, options) {
  var norm = normalizeReservationNumber(reservationNumber);
  if (!norm) {
    return null;
  }
  var allowExpired = !!(options && options.allowExpired);
  if (!allowExpired) {
    await cleanupExpiredCheckoutDrafts(pool);
  }
  var result = await pool.query(
    `SELECT reservation_number, status, guest_name, contact, email,
            room_type, check_in_date::text AS check_in, check_out_date::text AS check_out,
            guest_count, stay_nights, extra_guests, total_amount,
            guest_request, payment_method, booking_locale, pricing_breakdown
     FROM ${BOOKING_TABLE}
     WHERE reservation_number = $1
       AND status = $2
       ${allowExpired ? "" : "AND created_at > NOW() - make_interval(mins => $3::int)"}
     LIMIT 1`,
    allowExpired
      ? [norm, PENDING_STATUS]
      : [norm, PENDING_STATUS, getPendingTtlMinutes()],
  );
  if (!result.rows || !result.rows.length) {
    return null;
  }
  var row = result.rows[0];
  var pii = decryptBookingPiiResponse(row);
  var hold = await getBookingHoldByReservationNumber(pool, norm);
  return {
    reservationNumber: row.reservation_number,
    holdId: hold && hold.hold_id ? hold.hold_id : "",
    roomType: String(row.room_type || "")
      .trim()
      .toUpperCase(),
    checkIn: String(row.check_in || "").slice(0, 10),
    checkOut: String(row.check_out || "").slice(0, 10),
    guestName: pii.guestName,
    contact: pii.contact,
    email: pii.email || "",
    guestRequest: row.guest_request || "",
    stayNights: Number(row.stay_nights),
    extraGuests: Number(row.extra_guests),
    guestCount: Number(row.guest_count),
    totalAmount: Number(row.total_amount),
    paymentMethod: normalizePaymentMethodId(row.payment_method || "card") || "card",
    bookingLocale: normalizeBookingLocale(row.booking_locale),
    pricingBreakdown: row.pricing_breakdown || null,
  };
}

export async function deleteCheckoutDraft(pool, reservationNumber) {
  var norm = normalizeReservationNumber(reservationNumber);
  if (!norm) {
    return false;
  }
  var result = await pool.query(
    `DELETE FROM ${BOOKING_TABLE}
     WHERE reservation_number = $1
       AND status = $2`,
    [norm, PENDING_STATUS],
  );
  return (result.rowCount || 0) > 0;
}
