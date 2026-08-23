import {
  decryptBookingPiiResponse,
  encryptBookingPii,
} from "./pii-crypto.js";
import { shouldSendAlimtalk } from "./booking-locale.js";
import {
  extractPaymentMethodFromPortonePayment,
  resolveVerifiedPaymentMethod,
} from "./payment-methods.js";
import {
  extractPgTxIdFromPayment,
  extractPortonePaidAmount,
  fetchPortonePayment,
} from "./portone-client.js";
import { sendBookingAlimtalk } from "./solapi-alimtalk.js";
import { getInitialBookingStatusForCheckout } from "./booking-archive.js";
import { exportReservationToBigQuery } from "./bigquery-export.js";
import { releaseBookingHold, getBookingHoldByReservationNumber } from "./booking-hold.js";
import { getHoldIdFromToken } from "./booking-token.js";
import {
  computeGuestCount,
  clampExtraGuests,
} from "./room-guest-policy.js";
import {
  getCheckoutDraft,
  persistCheckoutDraft,
  deleteCheckoutDraft,
} from "./booking-checkout-draft.js";
import {
  claimFirstReserveAlarmSend,
  releaseReserveAlarmSendClaim,
} from "./reserve-alarm-sent-count.js";
import {
  normalizePricingBreakdown,
  validatePricingBreakdownForBooking,
  serializePricingBreakdown,
} from "./pricing-breakdown.js";

const BOOKING_TABLE = "booking";

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

function nightsBetween(checkIn, checkOut) {
  var a = new Date(checkIn + "T12:00:00");
  var b = new Date(checkOut + "T12:00:00");
  if (isNaN(a.getTime()) || isNaN(b.getTime()) || b <= a) {
    return 0;
  }
  return Math.round((b - a) / 86400000);
}

function portoneCustomerName(payment) {
  var c = payment && payment.customer ? payment.customer : {};
  return String(c.name || c.fullName || "").trim();
}

function portoneCustomerContact(payment) {
  var c = payment && payment.customer ? payment.customer : {};
  return String(c.phoneNumber || c.phone || "").trim();
}

function portoneCustomerEmail(payment) {
  var c = payment && payment.customer ? payment.customer : {};
  return String(c.email || "").trim();
}

export async function findBookingByNumber(pool, reservationNumber) {
  var norm = String(reservationNumber || "").trim();
  if (!norm) {
    return null;
  }
  var result = await pool.query(
    `SELECT reservation_number, status, room_type, check_in_date, check_out_date,
            guest_name, contact, email, guest_request, guest_count, extra_guests,
            stay_nights, total_amount, payment_method, booking_locale, created_at,
            reserve_alarm_sent_count
     FROM ${BOOKING_TABLE}
     WHERE reservation_number = $1
     LIMIT 1`,
    [norm],
  );
  return (result.rows && result.rows[0]) || null;
}

function isoFromCreatedAt(v) {
  if (v == null || v === "") {
    return "";
  }
  var d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) {
    return "";
  }
  return d.toISOString();
}

/**
 * 예약완료 페이지가 바로 렌더할 수 있는 camelCase 뷰.
 * DB row(암호문 PII)와 checkout draft(평문) 모두 받습니다.
 */
export function buildReserveCompleteView(source, extras) {
  extras = extras || {};
  if (!source) {
    return null;
  }
  var orderNo = String(
    extras.orderNo ||
      extras.reservationNumber ||
      source.reservationNumber ||
      source.reservation_number ||
      "",
  ).trim();
  if (!orderNo) {
    return null;
  }
  var pii = decryptBookingPiiResponse({
    guest_name:
      source.guest_name != null ? source.guest_name : source.guestName,
    contact: source.contact,
    email: source.email,
  });
  var createdAtIso = isoFromCreatedAt(
    extras.createdAt || source.created_at || source.createdAt || "",
  );
  var guestCount =
    source.guestCount != null
      ? source.guestCount
      : source.guest_count != null
        ? source.guest_count
        : extras.guestCount;
  var extraGuests =
    source.extraGuests != null
      ? source.extraGuests
      : source.extra_guests != null
        ? source.extra_guests
        : extras.extraGuests;
  var totalAmount =
    source.totalAmount != null
      ? source.totalAmount
      : source.total_amount != null
        ? source.total_amount
        : extras.totalAmount;
  return {
    orderNo: orderNo,
    room: String(
      source.roomType || source.room_type || extras.room || "",
    )
      .trim()
      .toUpperCase(),
    checkIn: rowDateToYMD(
      source.checkIn || source.check_in_date || extras.checkIn,
    ),
    checkOut: rowDateToYMD(
      source.checkOut || source.check_out_date || extras.checkOut,
    ),
    guestName: pii.guestName || extras.guestName || "",
    contact: pii.contact || extras.contact || "",
    email: pii.email || extras.email || "",
    guestRequest: String(
      source.guestRequest || source.guest_request || extras.guestRequest || "",
    ),
    guestCount: guestCount != null && guestCount !== "" ? guestCount : "",
    extraGuests: extraGuests != null && extraGuests !== "" ? extraGuests : 0,
    totalAmount: totalAmount != null && totalAmount !== "" ? totalAmount : 0,
    payMethod:
      source.paymentMethod ||
      source.payment_method ||
      extras.payMethod ||
      extras.paymentMethod ||
      "",
    bookingCreatedAtIso: createdAtIso,
    bookingLocale:
      source.bookingLocale ||
      source.booking_locale ||
      extras.bookingLocale ||
      "kr",
  };
}

export async function notifyReserveCompleteAlimtalk(pool, payload, options) {
  options = options || {};
  var sendFn =
    typeof options.sendAlimtalk === "function"
      ? options.sendAlimtalk
      : sendBookingAlimtalk;
  var reservationNumber = String(
    payload.reservationNumber || payload.reservation_number || "",
  ).trim();
  if (!reservationNumber) {
    return { ok: false, skipped: true, reason: "missing_reservation" };
  }

  var guestName = String(payload.guestName || "").trim();
  var contact = String(payload.contact || "").trim();
  var roomType = payload.roomType || payload.room_type || "";
  var checkIn = payload.checkIn || rowDateToYMD(payload.check_in_date) || "";
  var checkOut = payload.checkOut || rowDateToYMD(payload.check_out_date) || "";
  var bookingLocale = payload.bookingLocale || payload.booking_locale || "kr";

  if (!guestName || !contact) {
    var row = payload.guest_name
      ? payload
      : await findBookingByNumber(pool, reservationNumber);
    if (!row) {
      return { ok: false, skipped: true, reason: "not_found" };
    }
    var pii = decryptBookingPiiResponse(row);
    guestName = guestName || pii.guestName;
    contact = contact || pii.contact;
    roomType = roomType || row.room_type;
    checkIn = checkIn || rowDateToYMD(row.check_in_date);
    checkOut = checkOut || rowDateToYMD(row.check_out_date);
    bookingLocale = bookingLocale || row.booking_locale || "kr";
  }

  var claimed = await claimFirstReserveAlarmSend(pool, reservationNumber);
  if (!claimed) {
    return { ok: true, skipped: true, reason: "already_sent" };
  }

  var skipGuest = !shouldSendAlimtalk(bookingLocale, contact);
  try {
    var sendResult = await sendFn(
      "reserve-complete",
      {
        guestName: guestName,
        contact: contact,
        reservationNumber: reservationNumber,
        roomType: roomType,
        checkIn: checkIn,
        checkOut: checkOut,
      },
      { skipGuest: skipGuest },
    );
    if (sendResult && (sendResult.skipped || !sendResult.ok)) {
      await releaseReserveAlarmSendClaim(pool, reservationNumber);
    }
    return sendResult || { ok: false };
  } catch (e) {
    try {
      await releaseReserveAlarmSendClaim(pool, reservationNumber);
    } catch (_releaseErr) {}
    throw e;
  }
}

async function buildDraftFromHoldAndPayment(pool, paymentId, payment) {
  var hold = await getBookingHoldByReservationNumber(pool, paymentId);
  if (!hold) {
    return null;
  }
  var guestName = portoneCustomerName(payment);
  var contact = portoneCustomerContact(payment);
  if (!guestName || !contact) {
    return null;
  }
  var holdDates = await pool.query(
    `SELECT check_in_date::text AS ci, check_out_date::text AS co
     FROM booking_hold
     WHERE reservation_number = $1
     ORDER BY expires_at DESC
     LIMIT 1`,
    [paymentId],
  );
  var checkIn =
    holdDates.rows && holdDates.rows[0]
      ? String(holdDates.rows[0].ci || "").slice(0, 10)
      : rowDateToYMD(hold.check_in_date);
  var checkOut =
    holdDates.rows && holdDates.rows[0]
      ? String(holdDates.rows[0].co || "").slice(0, 10)
      : rowDateToYMD(hold.check_out_date);
  var stayNights = nightsBetween(checkIn, checkOut);
  var roomType = String(hold.room_type || "")
    .trim()
    .toUpperCase();
  var extraGuests = 0;
  return {
    reservationNumber: paymentId,
    holdId: hold.hold_id || "",
    roomType: roomType,
    checkIn: checkIn,
    checkOut: checkOut,
    guestName: guestName,
    contact: contact,
    email: portoneCustomerEmail(payment),
    guestRequest: "",
    stayNights: stayNights || 1,
    extraGuests: extraGuests,
    guestCount: computeGuestCount(roomType, extraGuests),
    totalAmount: extractPortonePaidAmount(payment),
    paymentMethod: "card",
    bookingLocale: "kr",
    pricingBreakdown: null,
  };
}

async function insertConfirmedBooking(pool, draft, paymentFields) {
  var extraGuests = clampExtraGuests(draft.roomType, draft.extraGuests);
  var guestCount =
    Number.isFinite(Number(draft.guestCount)) && Number(draft.guestCount) >= 1
      ? Math.floor(Number(draft.guestCount))
      : computeGuestCount(draft.roomType, extraGuests);
  var stayNights = Math.floor(Number(draft.stayNights) || 1);
  var totalAmount = Math.floor(Number(draft.totalAmount) || 0);
  var normalizedBreakdown = normalizePricingBreakdown(draft.pricingBreakdown);
  var breakdownCheck = validatePricingBreakdownForBooking(normalizedBreakdown, {
    roomType: draft.roomType,
    stayNights: stayNights,
    extraGuests: extraGuests,
    totalAmount: totalAmount,
  });
  var pricingBreakdownToStore =
    breakdownCheck.ok && breakdownCheck.breakdown
      ? serializePricingBreakdown(breakdownCheck.breakdown)
      : null;
  var encPii = encryptBookingPii({
    guestName: draft.guestName,
    contact: draft.contact,
    email: draft.email || null,
  });
  var insertStatus = getInitialBookingStatusForCheckout(draft.checkOut);
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
      pricing_breakdown,
      guest_request,
      payment_method,
      bank_confirmed,
      pg_tid,
      pg_pay_provider,
      booking_locale
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18, $19
    )
    RETURNING id, reservation_number, created_at, status`,
    [
      draft.reservationNumber,
      insertStatus,
      encPii.guest_name,
      encPii.contact,
      encPii.email || null,
      draft.roomType,
      draft.checkIn,
      draft.checkOut,
      guestCount,
      stayNights,
      extraGuests,
      totalAmount,
      pricingBreakdownToStore ? JSON.stringify(pricingBreakdownToStore) : null,
      draft.guestRequest || "",
      paymentFields.paymentMethod || draft.paymentMethod || "card",
      true,
      paymentFields.pgTid || null,
      paymentFields.pgPayProvider || null,
      draft.bookingLocale || "kr",
    ],
  );
  return result.rows && result.rows[0] ? result.rows[0] : null;
}

async function promotePendingBooking(pool, draft, paymentFields) {
  var extraGuests = clampExtraGuests(draft.roomType, draft.extraGuests);
  var guestCount =
    Number.isFinite(Number(draft.guestCount)) && Number(draft.guestCount) >= 1
      ? Math.floor(Number(draft.guestCount))
      : computeGuestCount(draft.roomType, extraGuests);
  var stayNights = Math.floor(Number(draft.stayNights) || 1);
  var totalAmount = Math.floor(Number(draft.totalAmount) || 0);
  var normalizedBreakdown = normalizePricingBreakdown(draft.pricingBreakdown);
  var breakdownCheck = validatePricingBreakdownForBooking(normalizedBreakdown, {
    roomType: draft.roomType,
    stayNights: stayNights,
    extraGuests: extraGuests,
    totalAmount: totalAmount,
  });
  var pricingBreakdownToStore =
    breakdownCheck.ok && breakdownCheck.breakdown
      ? serializePricingBreakdown(breakdownCheck.breakdown)
      : null;
  var encPii = encryptBookingPii({
    guestName: draft.guestName,
    contact: draft.contact,
    email: draft.email || null,
  });
  var insertStatus = getInitialBookingStatusForCheckout(draft.checkOut);
  var result = await pool.query(
    `UPDATE ${BOOKING_TABLE}
     SET status = $2,
         guest_name = $3,
         contact = $4,
         email = $5,
         room_type = $6,
         check_in_date = $7::date,
         check_out_date = $8::date,
         guest_count = $9,
         stay_nights = $10,
         extra_guests = $11,
         total_amount = $12,
         pricing_breakdown = $13::jsonb,
         guest_request = $14,
         payment_method = $15,
         bank_confirmed = true,
         pg_tid = $16,
         pg_pay_provider = $17,
         booking_locale = $18,
         created_at = NOW()
     WHERE reservation_number = $1
       AND status = 'pending'
     RETURNING id, reservation_number, created_at, status`,
    [
      draft.reservationNumber,
      insertStatus,
      encPii.guest_name,
      encPii.contact,
      encPii.email || null,
      draft.roomType,
      draft.checkIn,
      draft.checkOut,
      guestCount,
      stayNights,
      extraGuests,
      totalAmount,
      pricingBreakdownToStore ? JSON.stringify(pricingBreakdownToStore) : null,
      draft.guestRequest || "",
      paymentFields.paymentMethod || draft.paymentMethod || "card",
      paymentFields.pgTid || null,
      paymentFields.pgPayProvider || null,
      draft.bookingLocale || "kr",
    ],
  );
  return result.rows && result.rows[0] ? result.rows[0] : null;
}

export async function upsertConfirmedCheckoutBooking(pool, draft, paymentFields) {
  var promoted = await promotePendingBooking(pool, draft, paymentFields);
  if (promoted) {
    return promoted;
  }
  return insertConfirmedBooking(pool, draft, paymentFields);
}

/**
 * 결제가 PAID이면 초안(또는 hold+PortOne 고객정보)으로 booking을 확정하고 알림톡을 보냅니다.
 * 브라우저 POST 없이 웹훅/결제검증만으로도 동작합니다.
 */
export async function commitPaidBooking(pool, options) {
  options = options || {};
  var paymentId = String(options.paymentId || "").trim();
  if (!paymentId) {
    return { ok: false, reason: "missing_payment_id" };
  }

  var payment = options.payment || null;
  if (!payment) {
    var lookup = await fetchPortonePayment(paymentId);
    if (!lookup.ok) {
      return { ok: false, reason: "payment_lookup_failed", error: lookup.error };
    }
    payment = lookup.data;
  }
  if (!payment || payment.status !== "PAID") {
    return {
      ok: false,
      reason: "not_paid",
      status: payment && payment.status,
    };
  }

  var existing = null;
  try {
    existing = await findBookingByNumber(pool, paymentId);
  } catch (e) {
    return { ok: false, reason: "db_error", error: e && e.message };
  }

  if (existing && (existing.status === "confirm" || existing.status === "completed")) {
    var notifyExisting = await notifyReserveCompleteAlimtalk(pool, existing, options);
    return {
      ok: true,
      alreadyCommitted: true,
      reservationNumber: existing.reservation_number,
      reservation: buildReserveCompleteView(existing),
      alimtalk: notifyExisting,
    };
  }
  if (existing && existing.status && existing.status !== "pending") {
    return { ok: false, reason: "reservation_not_confirmable", status: existing.status };
  }

  var draft =
    options.draft ||
    (await getCheckoutDraft(pool, paymentId, { allowExpired: true }));
  if (!draft) {
    draft = await buildDraftFromHoldAndPayment(pool, paymentId, payment);
  }
  if (!draft || !draft.guestName || !draft.contact) {
    return { ok: false, reason: "draft_missing" };
  }

  var actualAmount = extractPortonePaidAmount(payment);
  if (
    draft.totalAmount != null &&
    actualAmount != null &&
    Number(actualAmount) !== Number(draft.totalAmount)
  ) {
    console.error(
      "[commit-paid-booking] amount mismatch",
      paymentId,
      "draft:",
      draft.totalAmount,
      "paid:",
      actualAmount,
    );
    return {
      ok: false,
      reason: "amount_mismatch",
      expected: draft.totalAmount,
      actual: actualAmount,
    };
  }

  var extractedMethod = extractPaymentMethodFromPortonePayment(payment);
  var verifiedMethod = resolveVerifiedPaymentMethod(
    extractedMethod,
    draft.paymentMethod,
  );
  var pgTid = extractPgTxIdFromPayment(payment);

  var paymentFields = {
    paymentMethod: verifiedMethod.methodId,
    pgPayProvider: verifiedMethod.pgPayProvider,
    pgTid: pgTid,
  };
  var inserted = null;
  try {
    inserted = await promotePendingBooking(pool, draft, paymentFields);
    if (!inserted) {
      inserted = await insertConfirmedBooking(pool, draft, paymentFields);
    }
  } catch (e) {
    if (e && e.code === "23505") {
      var dup = await findBookingByNumber(pool, paymentId);
      if (dup && (dup.status === "confirm" || dup.status === "completed")) {
        var notifyDup = await notifyReserveCompleteAlimtalk(pool, dup, options);
        return {
          ok: true,
          alreadyCommitted: true,
          reservationNumber: paymentId,
          reservation: buildReserveCompleteView(dup),
          alimtalk: notifyDup,
        };
      }
    }
    console.error("[commit-paid-booking] insert failed", paymentId, e);
    return { ok: false, reason: "insert_failed", error: e && e.message };
  }

  if (!inserted) {
    return { ok: false, reason: "insert_failed" };
  }

  var holdId = draft.holdId || "";
  if (holdId) {
    try {
      await releaseBookingHold(pool, holdId);
    } catch (holdErr) {
      console.error("[commit-paid-booking] release hold", paymentId, holdErr);
    }
  }
  try {
    await deleteCheckoutDraft(pool, paymentId);
  } catch (draftErr) {
    console.error("[commit-paid-booking] delete draft", paymentId, draftErr);
  }

  if (options.skipBigQuery !== true) {
    try {
      var bqResult = await exportReservationToBigQuery({
        reservationId: inserted.reservation_number,
        room: draft.roomType,
        amount: draft.totalAmount,
        createdAt: inserted.created_at,
        checkIn: draft.checkIn,
        checkOut: draft.checkOut,
      });
      if (!bqResult.ok) {
        console.error("[commit-paid-booking] BigQuery export failed", bqResult);
      }
    } catch (bqErr) {
      console.error("[commit-paid-booking] BigQuery export", bqErr);
    }
  }

  var alimtalk = await notifyReserveCompleteAlimtalk(
    pool,
    {
      reservationNumber: paymentId,
      guestName: draft.guestName,
      contact: draft.contact,
      roomType: draft.roomType,
      checkIn: draft.checkIn,
      checkOut: draft.checkOut,
      bookingLocale: draft.bookingLocale,
    },
    options,
  );

  console.log(
    "[commit-paid-booking] committed",
    paymentId,
    draft.roomType,
    draft.checkIn,
    draft.checkOut,
    "alimtalk:",
    alimtalk && (alimtalk.skipped ? alimtalk.reason : alimtalk.ok),
  );

  return {
    ok: true,
    inserted: true,
    reservationNumber: inserted.reservation_number,
    createdAt: inserted.created_at,
    reservation: buildReserveCompleteView(draft, {
      orderNo: inserted.reservation_number,
      createdAt: inserted.created_at,
    }),
    alimtalk: alimtalk,
  };
}

export async function saveCheckoutDraftFromRequest(pool, body, bookingToken) {
  var holdId = getHoldIdFromToken(bookingToken) || String(body.holdId || "").trim();
  return persistCheckoutDraft(
    pool,
    Object.assign({}, body, {
      holdId: holdId,
      reservationNumber: body.reservationNumber || body.orderNo,
      roomType: body.roomType || body.room,
    }),
  );
}
