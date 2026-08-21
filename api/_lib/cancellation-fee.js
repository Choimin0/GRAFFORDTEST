/**
 * 게스트 취소 위약금.
 *
 * 전액 환불(위약금 0%)은 아래를 모두 충족할 때만 적용합니다.
 * 1) 취소 시각이 체크인 날짜 서울 0시 이전
 * 2) 결제(created_at) 후 24시간 이내
 * 하나라도 아니면 입실까지 남은 일수 기준 날짜별 규정.
 */
import { getTodayYmdKst } from "./promotion-period.js";

export const FREE_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;
var KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function remainDaysUntilCheckInKst(checkInYmd, at = new Date()) {
  if (!checkInYmd) return 0;
  var todayYmd = getTodayYmdKst(at);
  var a = Date.UTC(
    Number(todayYmd.slice(0, 4)),
    Number(todayYmd.slice(5, 7)) - 1,
    Number(todayYmd.slice(8, 10)),
  );
  var b = Date.UTC(
    Number(checkInYmd.slice(0, 4)),
    Number(checkInYmd.slice(5, 7)) - 1,
    Number(checkInYmd.slice(8, 10)),
  );
  return Math.floor((b - a) / 86400000);
}

export function policyCancellationFeePercent(remainDays) {
  if (remainDays >= 15) return 0;
  if (remainDays >= 12) return 20;
  if (remainDays >= 9) return 30;
  if (remainDays >= 7) return 40;
  if (remainDays >= 5) return 50;
  return 100;
}

export function isBeforeCheckInDateKst(checkInYmd, at = new Date()) {
  var ymd = String(checkInYmd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return false;
  }
  return getTodayYmdKst(at) < ymd;
}

export function isWithinFreeCancelWindow(createdAt, at = new Date()) {
  var created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (!created || isNaN(created.getTime())) {
    return false;
  }
  var now = at instanceof Date ? at : new Date(at);
  if (!now || isNaN(now.getTime())) {
    return false;
  }
  return now.getTime() - created.getTime() <= FREE_CANCEL_WINDOW_MS;
}

export function isFullRefundByGrace(checkInYmd, createdAt, at = new Date()) {
  return (
    isBeforeCheckInDateKst(checkInYmd, at) &&
    isWithinFreeCancelWindow(createdAt, at)
  );
}

/**
 * 전액 환불 마감 시각(ms). min(결제시각+24h, 체크인 날짜 서울 0시).
 * 0시는 포함하지 않음(그날부터 면제 종료).
 */
export function fullRefundDeadlineMs(createdAt, checkInYmd) {
  var created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (!created || isNaN(created.getTime())) {
    return null;
  }
  var plus24 = created.getTime() + FREE_CANCEL_WINDOW_MS;
  var ymd = String(checkInYmd || "").slice(0, 10);
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) {
    return plus24;
  }
  var checkInStartMs =
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0) -
    KST_OFFSET_MS;
  return Math.min(plus24, checkInStartMs);
}

/**
 * @param {{ checkInYmd: string|null, createdAt: Date|string|null, at?: Date }} options
 * @returns {number} 위약금 비율(%). 0이면 전액 환불.
 */
export function computeCancellationFeePercent(options) {
  var checkInYmd = options && options.checkInYmd ? options.checkInYmd : null;
  var createdAt = options && options.createdAt != null ? options.createdAt : null;
  var at = options && options.at ? options.at : new Date();
  if (!checkInYmd) return 100;
  var policyPct = policyCancellationFeePercent(
    remainDaysUntilCheckInKst(checkInYmd, at),
  );
  if (isFullRefundByGrace(checkInYmd, createdAt, at)) {
    return 0;
  }
  return policyPct;
}
