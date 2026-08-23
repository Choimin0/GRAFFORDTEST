import crypto from "node:crypto";
import {
  hasRoomBlockOverlap,
  hasReservationOverlap,
} from "./room-availability.js";
import { hasActiveHoldOverlap } from "./booking-hold.js";
import { countStayNights, validateGuestCount } from "./admin-manual-booking.js";
import { getInitialBookingStatusForCheckout } from "./booking-archive.js";
import { getTodayYmdKst } from "./promotion-period.js";
import { normalizeCheckInYmd } from "./cancellation-fee.js";

const BOOKING_TABLE = "booking";
const ALLOWED_ROOMS = new Set(["G1", "G2", "G3", "G4"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAY_ROLE_PRIMARY = "primary";
const STAY_ROLE_ROOM_CHANGE = "room_change";
const ROOM_CHANGE_CHANNEL = "room_change";
const ROOM_CHANGE_PAYMENT_METHOD = "room-change";

export const ROOM_CHANGE_STAY_ROLE = STAY_ROLE_ROOM_CHANGE;

function toYMD(v) {
  return normalizeCheckInYmd(v) || "";
}

export function normalizeRoomType(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

export function normalizeStaySegments(raw) {
  if (raw == null) {
    return null;
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map(function (item) {
      return {
        room: normalizeRoomType(item && (item.room || item.roomType)),
        checkIn: String((item && (item.checkIn || item.check_in)) || "")
          .trim()
          .slice(0, 10),
        checkOut: String((item && (item.checkOut || item.check_out)) || "")
          .trim()
          .slice(0, 10),
      };
    })
    .filter(function (seg) {
      return seg.room || seg.checkIn || seg.checkOut;
    });
}

export function validateStaySegments(segments, contractCheckIn, contractCheckOut) {
  var contractIn = String(contractCheckIn || "").slice(0, 10);
  var contractOut = String(contractCheckOut || "").slice(0, 10);
  if (!DATE_RE.test(contractIn) || !DATE_RE.test(contractOut) || contractIn >= contractOut) {
    return { ok: false, error: "체크인·체크아웃 날짜를 확인해 주세요." };
  }
  if (!segments || !segments.length) {
    return { ok: false, error: "객실 일정을 입력해 주세요." };
  }
  for (var i = 0; i < segments.length; i += 1) {
    var seg = segments[i];
    if (!ALLOWED_ROOMS.has(seg.room)) {
      return { ok: false, error: "유효한 객실(G1~G4)을 선택해 주세요." };
    }
    if (
      !DATE_RE.test(seg.checkIn) ||
      !DATE_RE.test(seg.checkOut) ||
      seg.checkIn >= seg.checkOut
    ) {
      return {
        ok: false,
        error: (i + 1) + "번째 구간의 체크인·체크아웃을 확인해 주세요.",
      };
    }
    if (countStayNights(seg.checkIn, seg.checkOut) < 1) {
      return { ok: false, error: (i + 1) + "번째 구간의 숙박 일수를 확인해 주세요." };
    }
    if (i > 0 && segments[i - 1].checkOut !== seg.checkIn) {
      return {
        ok: false,
        error:
          "객실 일정은 빈틈이나 겹침 없이 이어져야 합니다. " +
          i +
          "번째 구간 체크아웃과 " +
          (i + 1) +
          "번째 구간 체크인이 같아야 합니다.",
      };
    }
  }
  if (segments[0].checkIn !== contractIn || segments[segments.length - 1].checkOut !== contractOut) {
    return {
      ok: false,
      error: "객실 일정을 이어 붙이면 투숙 기간(체크인·체크아웃)과 같아야 합니다.",
    };
  }
  return { ok: true, segments: segments };
}

export function isRoomChangeItinerary(segments, originalRoom) {
  if (!segments || !segments.length) {
    return false;
  }
  if (segments.length > 1) {
    return true;
  }
  return segments[0].room !== normalizeRoomType(originalRoom);
}

export function guestDisplayRoomType(row) {
  return (
    normalizeRoomType(row && (row.original_room_type || row.originalRoomType)) ||
    normalizeRoomType(row && (row.room_type || row.roomType))
  );
}

export function guestDisplayCheckIn(row) {
  return (
    toYMD(row && (row.contract_check_in || row.contractCheckIn)) ||
    toYMD(row && (row.check_in_date || row.checkIn))
  );
}

export function guestDisplayCheckOut(row) {
  return (
    toYMD(row && (row.contract_check_out || row.contractCheckOut)) ||
    toYMD(row && (row.check_out_date || row.checkOut))
  );
}

function childReservationNumber(parentNumber, index) {
  var base = String(parentNumber || "").trim() + "-RC" + String(index);
  if (base.length <= 32) {
    return base;
  }
  var rnd = crypto.randomBytes(3).toString("hex").toUpperCase();
  return getTodayYmdKst().replace(/-/g, "") + "-" + rnd;
}

export function buildStaySegmentsFromGroup(primaryRow, childRows) {
  var segs = [
    {
      room: normalizeRoomType(primaryRow.room_type),
      checkIn: toYMD(primaryRow.check_in_date),
      checkOut: toYMD(primaryRow.check_out_date),
    },
  ];
  (childRows || [])
    .slice()
    .sort(function (a, b) {
      return toYMD(a.check_in_date) < toYMD(b.check_in_date) ? -1 : 1;
    })
    .forEach(function (child) {
      segs.push({
        room: normalizeRoomType(child.room_type),
        checkIn: toYMD(child.check_in_date),
        checkOut: toYMD(child.check_out_date),
      });
    });
  return segs;
}

export async function loadRoomChangeChildren(pool, parentReservationNumber) {
  var parent = String(parentReservationNumber || "").trim();
  if (!parent) {
    return [];
  }
  try {
    var result = await pool.query(
      `SELECT reservation_number, room_type, check_in_date, check_out_date,
              stay_nights, stay_role, parent_reservation_number, status
       FROM ${BOOKING_TABLE}
       WHERE parent_reservation_number = $1
         AND stay_role = $2
         AND status IN ('confirm', 'completed')
       ORDER BY check_in_date ASC`,
      [parent, STAY_ROLE_ROOM_CHANGE],
    );
    return result.rows || [];
  } catch (e) {
    if (e && (e.code === "42P01" || e.code === "42703")) {
      return [];
    }
    throw e;
  }
}

export async function loadStaySegmentsForPrimary(pool, primaryRow) {
  var children = await loadRoomChangeChildren(
    pool,
    primaryRow.reservation_number,
  );
  return buildStaySegmentsFromGroup(primaryRow, children);
}

export async function attachStaySegmentsToRows(pool, rows) {
  var list = rows || [];
  if (!list.length) {
    return list;
  }
  var numbers = list
    .map(function (row) {
      return String(row.reservation_number || "").trim();
    })
    .filter(Boolean);
  var childMap = {};
  try {
    var result = await pool.query(
      `SELECT reservation_number, parent_reservation_number, room_type,
              check_in_date, check_out_date, stay_nights, stay_role, status
       FROM ${BOOKING_TABLE}
       WHERE parent_reservation_number = ANY($1::text[])
         AND stay_role = $2
         AND status IN ('confirm', 'completed')
       ORDER BY check_in_date ASC`,
      [numbers, STAY_ROLE_ROOM_CHANGE],
    );
    (result.rows || []).forEach(function (child) {
      var parent = String(child.parent_reservation_number || "");
      if (!childMap[parent]) {
        childMap[parent] = [];
      }
      childMap[parent].push(child);
    });
  } catch (e) {
    if (e && e.code !== "42P01" && e.code !== "42703") {
      throw e;
    }
  }
  list.forEach(function (row) {
    row.staySegments = buildStaySegmentsFromGroup(
      row,
      childMap[row.reservation_number] || [],
    );
  });
  return list;
}

async function checkSegmentAvailability(pool, room, checkIn, checkOut, excludeGroup) {
  if (await hasRoomBlockOverlap(pool, room, checkIn, checkOut)) {
    return { available: false, reason: "blocked" };
  }
  if (await hasReservationOverlap(pool, room, checkIn, checkOut, excludeGroup)) {
    return { available: false, reason: "occupied" };
  }
  if (await hasActiveHoldOverlap(pool, room, checkIn, checkOut, null)) {
    return { available: false, reason: "held" };
  }
  return { available: true };
}

const REASON_MESSAGES = {
  blocked: "선택한 기간은 방막기로 예약할 수 없습니다.",
  occupied: "동일 객실·기간에 다른 확정 예약이 있습니다.",
  held: "다른 고객이 해당 기간을 예약 진행 중입니다.",
};

export async function persistRoomChangeOccupancy(client, primaryRow, options) {
  var reservationNumber = String(primaryRow.reservation_number || "").trim();
  var contractCheckIn = String(options.contractCheckIn || "").slice(0, 10);
  var contractCheckOut = String(options.contractCheckOut || "").slice(0, 10);
  var segments = options.segments || [];
  var guestCount = options.guestCount;
  var originalRoom =
    normalizeRoomType(primaryRow.original_room_type) ||
    normalizeRoomType(primaryRow.room_type);

  var validated = validateStaySegments(segments, contractCheckIn, contractCheckOut);
  if (!validated.ok) {
    return validated;
  }

  for (var i = 0; i < segments.length; i += 1) {
    var guestValidation = validateGuestCount(segments[i].room, guestCount);
    if (!guestValidation.ok) {
      return { ok: false, error: guestValidation.error };
    }
    var availability = await checkSegmentAvailability(
      client,
      segments[i].room,
      segments[i].checkIn,
      segments[i].checkOut,
      reservationNumber,
    );
    if (!availability.available) {
      return {
        ok: false,
        error:
          (i + 1) +
          "번째 구간(" +
          segments[i].room +
          "): " +
          (REASON_MESSAGES[availability.reason] || "해당 기간에 예약할 수 없습니다."),
        reason: availability.reason,
      };
    }
  }

  var keepHistory = isRoomChangeItinerary(segments, originalRoom);
  var first = segments[0];
  var contractNights = countStayNights(contractCheckIn, contractCheckOut);

  await client.query(
    `DELETE FROM ${BOOKING_TABLE}
     WHERE parent_reservation_number = $1
       AND stay_role = $2`,
    [reservationNumber, STAY_ROLE_ROOM_CHANGE],
  );

  if (!keepHistory) {
    await client.query(
      `UPDATE ${BOOKING_TABLE}
       SET room_type = $2,
           check_in_date = $3::date,
           check_out_date = $4::date,
           stay_nights = $5,
           stay_role = $6,
           parent_reservation_number = NULL,
           contract_check_in = NULL,
           contract_check_out = NULL,
           original_room_type = NULL
       WHERE reservation_number = $1`,
      [
        reservationNumber,
        first.room,
        first.checkIn,
        first.checkOut,
        contractNights,
        STAY_ROLE_PRIMARY,
      ],
    );
    return { ok: true, hasRoomChange: false, staySegments: segments };
  }

  await client.query(
    `UPDATE ${BOOKING_TABLE}
     SET room_type = $2,
         check_in_date = $3::date,
         check_out_date = $4::date,
         stay_nights = $5,
         stay_role = $6,
         parent_reservation_number = NULL,
         contract_check_in = $7::date,
         contract_check_out = $8::date,
         original_room_type = $9
     WHERE reservation_number = $1`,
    [
      reservationNumber,
      first.room,
      first.checkIn,
      first.checkOut,
      contractNights,
      STAY_ROLE_PRIMARY,
      contractCheckIn,
      contractCheckOut,
      originalRoom,
    ],
  );

  for (var c = 1; c < segments.length; c += 1) {
    var child = segments[c];
    var childNights = countStayNights(child.checkIn, child.checkOut);
    var childGuest = validateGuestCount(child.room, guestCount);
    await client.query(
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
         stay_role,
         parent_reservation_number
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7::date, $8::date, $9, $10, $11, 0, NULL, $12, TRUE, $13, $14, $15, $16
       )`,
      [
        childReservationNumber(reservationNumber, c),
        getInitialBookingStatusForCheckout(child.checkOut),
        primaryRow.guest_name,
        primaryRow.contact,
        primaryRow.email || null,
        child.room,
        child.checkIn,
        child.checkOut,
        childGuest.ok ? childGuest.guestCount : guestCount,
        childNights,
        childGuest.ok ? childGuest.extraGuests : 0,
        ROOM_CHANGE_PAYMENT_METHOD,
        primaryRow.booking_locale || "kr",
        ROOM_CHANGE_CHANNEL,
        STAY_ROLE_ROOM_CHANGE,
        reservationNumber,
      ],
    );
  }

  return { ok: true, hasRoomChange: true, staySegments: segments };
}

export async function cancelRoomChangeChildren(client, parentReservationNumber, extras) {
  var parent = String(parentReservationNumber || "").trim();
  if (!parent) {
    return 0;
  }
  var cancelReason = (extras && extras.cancelReason) || "room_change_parent";
  var otherReason = extras && extras.otherReason != null ? extras.otherReason : null;
  var refundedCount =
    extras && extras.refundedCount != null ? extras.refundedCount : 1;
  try {
    var result = await client.query(
      `UPDATE ${BOOKING_TABLE}
       SET status = 'cancelled',
           cancel_reason = $2,
           other_reason = $3,
           cancelled_at = NOW(),
           refunded_count = $4,
           refund_amount = 0
       WHERE parent_reservation_number = $1
         AND stay_role = $5
         AND status IN ('confirm', 'completed')`,
      [
        parent,
        cancelReason,
        otherReason,
        refundedCount,
        STAY_ROLE_ROOM_CHANGE,
      ],
    );
    return result.rowCount || 0;
  } catch (e) {
    if (e && (e.code === "42P01" || e.code === "42703")) {
      return 0;
    }
    throw e;
  }
}

export function isRoomChangeChildRow(row) {
  if (!row) {
    return false;
  }
  return (
    String(row.stay_role || row.stayRole || "") === STAY_ROLE_ROOM_CHANGE ||
    !!String(row.parent_reservation_number || row.parentReservationNumber || "").trim()
  );
}
