const BOOKING_HOLD_TABLE = "booking_hold";

function addOneDayYMD(ymd) {
  var p = ymd.split("-");
  var dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  dt.setDate(dt.getDate() + 1);
  var y = dt.getFullYear();
  var m = String(dt.getMonth() + 1).padStart(2, "0");
  var day = String(dt.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

export function expandOccupiedNights(ciYmd, coYmd) {
  var out = [];
  var cur = ciYmd;
  while (cur < coYmd) {
    out.push(cur);
    cur = addOneDayYMD(cur);
  }
  return out;
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

export async function cleanupExpiredBookingHolds(pool) {
  try {
    await pool.query(
      `DELETE FROM ${BOOKING_HOLD_TABLE} WHERE expires_at <= NOW()`,
    );
  } catch (e) {
    if (e && (e.code === "42P01" || e.code === "42703")) {
      return;
    }
    throw e;
  }
}

export async function upsertBookingHold(pool, data) {
  await cleanupExpiredBookingHolds(pool);
  var holdId = String(data.holdId || "").trim();
  if (!holdId) {
    throw new Error("holdId is required");
  }
  var expiresMs = Number(data.expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    throw new Error("expiresAt must be in the future");
  }
  await pool.query(
    `INSERT INTO ${BOOKING_HOLD_TABLE} (
       hold_id, room_type, check_in_date, check_out_date,
       reservation_number, expires_at
     ) VALUES (
       $1, $2, $3::date, $4::date, $5, to_timestamp($6 / 1000.0)
     )
     ON CONFLICT (hold_id) DO UPDATE SET
       room_type = EXCLUDED.room_type,
       check_in_date = EXCLUDED.check_in_date,
       check_out_date = EXCLUDED.check_out_date,
       reservation_number = COALESCE(
         NULLIF(EXCLUDED.reservation_number, ''),
         ${BOOKING_HOLD_TABLE}.reservation_number
       ),
       expires_at = EXCLUDED.expires_at`,
    [
      holdId,
      String(data.roomType || "").trim().toUpperCase(),
      String(data.checkIn || "").trim(),
      String(data.checkOut || "").trim(),
      String(data.reservationNumber || "").trim() || null,
      expiresMs,
    ],
  );
}

export async function bindBookingHoldReservation(pool, holdId, reservationNumber) {
  await cleanupExpiredBookingHolds(pool);
  var norm = String(reservationNumber || "").trim();
  if (!holdId || !norm) {
    return false;
  }
  var result = await pool.query(
    `UPDATE ${BOOKING_HOLD_TABLE}
     SET reservation_number = $2
     WHERE hold_id = $1
       AND expires_at > NOW()`,
    [holdId, norm],
  );
  return (result.rowCount || 0) > 0;
}

export async function releaseBookingHold(pool, holdId) {
  if (!holdId) {
    return false;
  }
  await pool.query(`DELETE FROM ${BOOKING_HOLD_TABLE} WHERE hold_id = $1`, [
    holdId,
  ]);
  return true;
}

export async function hasActiveHoldOverlap(
  pool,
  roomName,
  checkIn,
  checkOut,
  excludeHoldId,
) {
  await cleanupExpiredBookingHolds(pool);
  var params = [roomName, checkIn, checkOut];
  var excludeSql = "";
  if (excludeHoldId) {
    params.push(String(excludeHoldId).trim());
    excludeSql = " AND hold_id <> $" + params.length;
  }
  var result = await pool.query(
    `SELECT hold_id
     FROM ${BOOKING_HOLD_TABLE}
     WHERE room_type = $1
       AND check_in_date < $3::date
       AND check_out_date > $2::date
       AND expires_at > NOW()
       ${excludeSql}
     LIMIT 1`,
    params,
  );
  return !!(result.rows && result.rows.length);
}

export async function getActiveHoldOccupiedNights(pool, roomName) {
  await cleanupExpiredBookingHolds(pool);
  var result = await pool.query(
    `SELECT check_in_date, check_out_date
     FROM ${BOOKING_HOLD_TABLE}
     WHERE room_type = $1
       AND expires_at > NOW()
     ORDER BY check_in_date`,
    [roomName],
  );
  var occupied = Object.create(null);
  (result.rows || []).forEach(function (row) {
    var ci = rowDateToYMD(row.check_in_date);
    var co = rowDateToYMD(row.check_out_date);
    if (!ci || !co || ci >= co) {
      return;
    }
    expandOccupiedNights(ci, co).forEach(function (n) {
      occupied[n] = true;
    });
  });
  return Object.keys(occupied).sort();
}
