/**
 * 게스트 취소 위약금.
 *
 * 전액 환불(위약금 0%)은 아래를 모두 충족할 때만 적용합니다.
 * 1) 취소 시각이 체크인 날짜 서울 0시 이전
 * 2) 결제(created_at) 후 24시간 이내
 * 하나라도 아니면 입실까지 남은 일수 기준 날짜별 규정.
 *
 * 날짜별 규정은 화면의 "환불율"이 아니라 위약금(수수료) % 입니다.
 * 15일 전 100% 환불 → 위약금 0, 12일 전 80% 환불 → 위약금 20, …
 */
import { getTodayYmdKst } from "./promotion-period.js";

export const FREE_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;
var KST_OFFSET_MS = 9 * 60 * 60 * 1000;
var YMD_RE = /^(\d{4}-\d{2}-\d{2})/;

/** DATE / ISO / Date → YYYY-MM-DD. 파싱 실패 시 null. */
export function normalizeCheckInYmd(v) {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    var s = v.trim();
    var mm = YMD_RE.exec(s);
    if (mm) return mm[1];
  }
  var d = v instanceof Date ? v : new Date(v);
  if (!d || isNaN(d.getTime())) return null;
  // DATE 컬럼이 Date로 오면 UTC 자정 → getUTC*로 달력일 보존
  if (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  ) {
    var y = d.getUTCFullYear();
    var mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    var da = String(d.getUTCDate()).padStart(2, "0");
    return y + "-" + mo + "-" + da;
  }
  return getTodayYmdKst(d);
}

/** 게스트 기준 체크인: 객실변경 시 contract_check_in, 아니면 check_in_date. */
export function checkInYmdForCancellationFee(row) {
  if (!row) return null;
  return (
    normalizeCheckInYmd(row.contract_check_in || row.contractCheckIn) ||
    normalizeCheckInYmd(row.check_in_date || row.checkIn)
  );
}

export function remainDaysUntilCheckInKst(checkInYmd, at = new Date()) {
  var ymd = normalizeCheckInYmd(checkInYmd);
  if (!ymd) return 0;
  var todayYmd = getTodayYmdKst(at);
  var a = Date.UTC(
    Number(todayYmd.slice(0, 4)),
    Number(todayYmd.slice(5, 7)) - 1,
    Number(todayYmd.slice(8, 10)),
  );
  var b = Date.UTC(
    Number(ymd.slice(0, 4)),
    Number(ymd.slice(5, 7)) - 1,
    Number(ymd.slice(8, 10)),
  );
  var days = Math.floor((b - a) / 86400000);
  return Number.isFinite(days) ? days : 0;
}

export function policyCancellationFeePercent(remainDays) {
  var days = Number(remainDays);
  if (!Number.isFinite(days)) return 100;
  if (days >= 15) return 0;
  if (days >= 12) return 20;
  if (days >= 9) return 30;
  if (days >= 7) return 40;
  if (days >= 5) return 50;
  return 100;
}

export function isBeforeCheckInDateKst(checkInYmd, at = new Date()) {
  var ymd = normalizeCheckInYmd(checkInYmd);
  if (!ymd) {
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
  var ymd = normalizeCheckInYmd(checkInYmd);
  var m = ymd ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd) : null;
  if (!m) {
    return plus24;
  }
  var checkInStartMs =
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0) -
    KST_OFFSET_MS;
  return Math.min(plus24, checkInStartMs);
}

/**
 * @param {{ checkInYmd?: string|Date|null, createdAt?: Date|string|null, at?: Date }} options
 */
export function explainCancellationFee(options) {
  var checkInYmd = normalizeCheckInYmd(
    options && options.checkInYmd != null ? options.checkInYmd : null,
  );
  var createdAt =
    options && options.createdAt != null ? options.createdAt : null;
  var at = options && options.at ? options.at : new Date();
  if (!checkInYmd) {
    return {
      feePercent: 100,
      remainDays: 0,
      checkInYmd: null,
      grace: false,
      policyPct: 100,
      reason: "missing_check_in",
    };
  }
  var remainDays = remainDaysUntilCheckInKst(checkInYmd, at);
  var policyPct = policyCancellationFeePercent(remainDays);
  var grace = isFullRefundByGrace(checkInYmd, createdAt, at);
  return {
    feePercent: grace ? 0 : policyPct,
    remainDays: remainDays,
    checkInYmd: checkInYmd,
    grace: grace,
    policyPct: policyPct,
    reason: grace ? "grace_24h" : "policy",
  };
}

/**
 * @param {{ checkInYmd: string|null, createdAt: Date|string|null, at?: Date }} options
 * @returns {number} 위약금 비율(%). 0이면 전액 환불.
 */
export function computeCancellationFeePercent(options) {
  return explainCancellationFee(options).feePercent;
}
