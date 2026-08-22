const BOOKING_TABLE = "booking";

export function readReserveAlarmSentCount(row) {
  if (!row || row.reserve_alarm_sent_count == null) {
    return 0;
  }
  var n = Number(row.reserve_alarm_sent_count);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function claimFirstReserveAlarmSend(pool, reservationNumber) {
  try {
    var upd = await pool.query(
      `UPDATE ${BOOKING_TABLE}
       SET reserve_alarm_sent_count = COALESCE(reserve_alarm_sent_count, 0) + 1
       WHERE reservation_number = $1
         AND COALESCE(reserve_alarm_sent_count, 0) < 1
       RETURNING reserve_alarm_sent_count`,
      [reservationNumber],
    );
    return !!(upd.rows && upd.rows.length);
  } catch (e) {
    if (e && e.code === "42703") {
      return true;
    }
    throw e;
  }
}

export async function releaseReserveAlarmSendClaim(pool, reservationNumber) {
  try {
    await pool.query(
      `UPDATE ${BOOKING_TABLE}
       SET reserve_alarm_sent_count = GREATEST(COALESCE(reserve_alarm_sent_count, 1) - 1, 0)
       WHERE reservation_number = $1
         AND COALESCE(reserve_alarm_sent_count, 0) > 0`,
      [reservationNumber],
    );
  } catch (e) {
    if (e && e.code === "42703") {
      return;
    }
    throw e;
  }
}
