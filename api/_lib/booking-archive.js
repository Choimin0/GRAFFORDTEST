import { getTodayYmdKst } from "./promotion-period.js";

const BOOKING_TABLE = "booking";

/** KST 기준 낮 12시(정오) 이후 여부 */
export function isKstNoonOrLater(at = new Date()) {
  var hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      hour: "numeric",
      hour12: false,
    }).format(at),
  );
  return hour >= 12;
}

/**
 * 체크아웃일 기준 '지난 예약' 처리 여부.
 * - 체크아웃일 < 오늘(KST) → past
 * - 체크아웃일 = 오늘(KST) && 12시 이후 → past
 * - 그 외 → upcoming (confirm)
 */
export function shouldTreatCheckoutAsPast(checkOutYmd, at = new Date()) {
  var checkOut = String(checkOutYmd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
    return false;
  }
  var today = getTodayYmdKst(at);
  if (checkOut < today) {
    return true;
  }
  if (checkOut > today) {
    return false;
  }
  return isKstNoonOrLater(at);
}

export function getInitialBookingStatusForCheckout(checkOutYmd, at = new Date()) {
  return shouldTreatCheckoutAsPast(checkOutYmd, at) ? "completed" : "confirm";
}

export async function archivePastReservations(pool) {
  // 체크아웃일이 KST 기준 오늘 이전이면 'completed'로 전환.
  // 체크아웃일 = 오늘이면 KST 12시 이후에만 'completed'로 전환.
  await pool.query(
    `UPDATE ${BOOKING_TABLE}
     SET status = 'completed'
     WHERE status = 'confirm'
       AND (
         check_out_date < (NOW() AT TIME ZONE 'Asia/Seoul')::date
         OR (
           check_out_date = (NOW() AT TIME ZONE 'Asia/Seoul')::date
           AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Seoul')) >= 12
         )
       )`,
  );
}
