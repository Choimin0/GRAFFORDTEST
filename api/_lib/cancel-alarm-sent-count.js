const BOOKING_TABLE = "booking";

export function readCancelAlarmSentCount(row) {
  if (!row || row.cancel_alarm_sent_count == null) {
    return 0;
  }
  var n = Number(row.cancel_alarm_sent_count);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 취소 알림톡 최초 1회 발송 슬롯을 선점한다.
 * 이미 1회 이상이면 false.
 */
export async function claimFirstCancelAlarmSend(pool, reservationNumber) {
  var upd = await pool.query(
    `UPDATE ${BOOKING_TABLE}
     SET cancel_alarm_sent_count = COALESCE(cancel_alarm_sent_count, 0) + 1
     WHERE reservation_number = $1
       AND COALESCE(cancel_alarm_sent_count, 0) < 1
     RETURNING cancel_alarm_sent_count`,
    [reservationNumber],
  );
  return !!(upd.rows && upd.rows.length);
}

/** 발송 실패 시 선점한 1회 슬롯을 되돌려 재시도할 수 있게 한다. */
export async function releaseCancelAlarmSendClaim(pool, reservationNumber) {
  await pool.query(
    `UPDATE ${BOOKING_TABLE}
     SET cancel_alarm_sent_count = GREATEST(COALESCE(cancel_alarm_sent_count, 1) - 1, 0)
     WHERE reservation_number = $1
       AND COALESCE(cancel_alarm_sent_count, 0) > 0`,
    [reservationNumber],
  );
}
