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

/** 체크인 당일부터 투숙객 직접 취소(환불) 불가. 관리자 취소는 별도 API. */
export function isGuestSelfCancelClosed(checkInYmd, at = new Date()) {
  var checkIn = String(checkInYmd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn)) {
    return false;
  }
  return getTodayYmdKst(at) >= checkIn;
}

export async function archivePastReservations(pool) {
  // 체크아웃일이 KST 기준 오늘 이전이면 'completed'로 전환.
  // 체크아웃일 = 오늘이면 KST 12시 이후에만 'completed'로 전환.
  var archiveSql =
    `UPDATE ${BOOKING_TABLE}
     SET status = 'completed'
     WHERE status = 'confirm'
       AND (
         COALESCE(contract_check_out, check_out_date) < (NOW() AT TIME ZONE 'Asia/Seoul')::date
         OR (
           COALESCE(contract_check_out, check_out_date) = (NOW() AT TIME ZONE 'Asia/Seoul')::date
           AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Seoul')) >= 12
         )
       )`;
  try {
    await pool.query(archiveSql);
  } catch (e) {
    if (!e || e.code !== "42703") {
      throw e;
    }
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
}
