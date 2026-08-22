import { hasActiveHoldOverlap } from "./booking-hold.js";
import { hasExternalBookingOverlap } from "./ical-sync.js";
import { validateBookingWindow } from "./booking-window.js";
import { getTodayYmdKst } from "./promotion-period.js";
import {
  applyBookingRetentionToRow,
  purgeExpiredBookings,
} from "./booking-retention.js";
import { cleanupExpiredCheckoutDrafts } from "./booking-checkout-draft.js";

const ALLOWED_ROOMS = new Set(["G1", "G2", "G3", "G4"]);
const LEGACY_TO_ROOM = { A: "G1", B: "G2", C: "G3", D: "G4" };
const ROOM_TO_LEGACY = { G1: "A", G2: "B", G3: "C", G4: "D" };
const BOOKING_TABLE = "booking";
const ROOM_STATUS_TABLE = '"room-status"';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeRoomType(raw) {
  var room = String(raw || "")
    .trim()
    .toUpperCase();
  if (ALLOWED_ROOMS.has(room)) {
    return room;
  }
  return LEGACY_TO_ROOM[room] || "";
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

async function getRoomBlockRows(pool, roomFilter) {
  try {
    var today = getTodayYmdKst();
    var params = [today];
    var where = "WHERE (item->>'endDate') > $1";
    if (roomFilter) {
      params.push(roomFilter);
      where += " AND rs.room_name = $2";
    }
    var result = await pool.query(
      `SELECT
         rs.room_name,
         item->>'id' AS block_id,
         item->>'startDate' AS start_date,
         item->>'endDate' AS end_date
       FROM ${ROOM_STATUS_TABLE} rs,
         jsonb_array_elements(COALESCE(rs.block_items, '[]'::jsonb)) AS item
       ${where}
       ORDER BY item->>'startDate'`,
      params,
    );
    return (result.rows || []).filter(function (row) {
      return row.start_date && row.end_date && row.start_date < row.end_date;
    });
  } catch (e) {
    if (e && (e.code === "42P01" || e.code === "42703")) {
      return [];
    }
    throw e;
  }
}

export async function hasRoomBlockOverlap(pool, roomName, checkIn, checkOut) {
  var rows = await getRoomBlockRows(pool, roomName);
  return rows.some(function (row) {
    return String(row.start_date) < checkOut && String(row.end_date) > checkIn;
  });
}

export async function hasReservationOverlap(
  pool,
  roomName,
  checkIn,
  checkOut,
  excludeReservationNumber,
) {
  var room = normalizeRoomType(roomName);
  if (!ALLOWED_ROOMS.has(room)) {
    return false;
  }
  var legacyRoom = ROOM_TO_LEGACY[room] || "";
  var params = [[room, legacyRoom], checkIn, checkOut];
  var excludeSql = "";
  if (excludeReservationNumber) {
    params.push(String(excludeReservationNumber).trim());
    excludeSql = " AND reservation_number <> $" + params.length;
  }
  var result = await pool.query(
    `SELECT reservation_number
     FROM ${BOOKING_TABLE}
     WHERE (
         status = 'confirm'
         OR (
           status = 'pending'
           AND EXISTS (
             SELECT 1
             FROM booking_hold h
             WHERE h.reservation_number = ${BOOKING_TABLE}.reservation_number
               AND h.expires_at > NOW()
           )
         )
       )
       AND room_type = ANY($1::text[])
       AND check_in_date < $3::date
       AND check_out_date > $2::date
       ${excludeSql}
     LIMIT 1`,
    params,
  );
  return !!(result.rows && result.rows.length);
}

export async function checkRoomAvailability(
  pool,
  roomName,
  checkIn,
  checkOut,
  excludeReservationNumber,
  excludeHoldId,
) {
  await purgeExpiredBookings(pool);
  await cleanupExpiredCheckoutDrafts(pool);
  var room = normalizeRoomType(roomName);
  if (!ALLOWED_ROOMS.has(room)) {
    return { available: false, reason: "invalid_room" };
  }
  if (!DATE_RE.test(checkIn) || !DATE_RE.test(checkOut) || checkIn >= checkOut) {
    return { available: false, reason: "invalid_dates" };
  }
  var windowCheck = validateBookingWindow(checkIn, checkOut);
  if (!windowCheck.ok) {
    return {
      available: false,
      reason: windowCheck.code || "booking_window",
      error: windowCheck.error,
    };
  }
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
  if (await hasExternalBookingOverlap(pool, room, checkIn, checkOut)) {
    return { available: false, reason: "external" };
  }
  if (
    await hasActiveHoldOverlap(pool, room, checkIn, checkOut, excludeHoldId)
  ) {
    return { available: false, reason: "held" };
  }
  return { available: true, room: room };
}

export async function findConfirmedReservation(pool, reservationNumber) {
  var norm = String(reservationNumber || "").trim();
  if (!norm) {
    return null;
  }
  var result = await pool.query(
    `SELECT reservation_number, room_type, check_in_date, check_out_date, status, created_at
     FROM ${BOOKING_TABLE}
     WHERE reservation_number = $1
       AND status = 'confirm'
     LIMIT 1`,
    [norm],
  );
  if (!result.rows || !result.rows.length) {
    return null;
  }
  var row = await applyBookingRetentionToRow(pool, result.rows[0]);
  if (!row) {
    return null;
  }
  return {
    reservationNumber: row.reservation_number,
    roomType: normalizeRoomType(row.room_type) || row.room_type,
    checkIn: rowDateToYMD(row.check_in_date),
    checkOut: rowDateToYMD(row.check_out_date),
    status: row.status,
  };
}
