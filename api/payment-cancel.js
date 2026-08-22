/**
 * POST /api/payment-cancel
 *
 * 결제 취소 + 예약 삭제를 원자적으로 처리합니다.
 *
 * 1. cancelToken 검증
 * 2. DB에서 예약 조회 (pg_tid, total_amount 포함)
 * 3. pg_tid가 있으면 PortOne v2 결제 취소 API 호출
 *    - paymentId = reservationNumber (결제 시 사용한 PortOne paymentId)
 *    - refundAmount < totalAmount 이면 부분 취소, 같으면 전액 취소
 * 4. 성공 시 booking 테이블 status를 'cancelled'로 업데이트
 *
 * Body: { reservationNumber, guestName, cancelToken, cancelReason, refundAmount }
 * Response: { ok: true, pgCancelled, pgTid, cancelledAt } | { error }
 */
import pg from "pg";
import crypto from "node:crypto";
import { guestNamesMatch } from "./_lib/pii-crypto.js";
import {
  computeRefundAmount,
  resolvePaidAmountForBooking,
} from "./_lib/refund-amount.js";
import { exportCancellationToBigQuery } from "./_lib/bigquery-export.js";
import { applyBookingRetentionToRow } from "./_lib/booking-retention.js";
import { isGuestSelfCancelClosed } from "./_lib/booking-archive.js";
import { computeCancellationFeePercent } from "./_lib/cancellation-fee.js";
import { cancelRoomChangeChildren } from "./_lib/booking-room-change.js";
const { Pool } = pg;

const BOOKING_TABLE = "booking";
const DEFAULT_CANCEL_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_CANCEL_REASON = 1000;
const KNOWN_CANCEL_REASON_CODES = new Set([
  "mind-change",
  "schedule-change",
  "other-hotel",
  "other",
  "not paid",
  "manual",
]);

function cancelReasonLabelForPg(code, otherReason) {
  var c = String(code || "")
    .trim()
    .toLowerCase();
  if (c === "mind-change") return "단순 변심";
  if (c === "schedule-change") return "일정 변경";
  if (c === "other-hotel") return "타 숙소 예약";
  if (c === "other") {
    return String(otherReason || "").trim() || "기타";
  }
  if (c === "not paid") return "입금 기한 초과";
  if (c === "manual") return "관리자 직접 취소";
  return String(code || "").trim() || "고객 요청 취소";
}

function parseCancelReasonFields(body) {
  var cancelReason = String(body.cancelReason || "")
    .trim()
    .slice(0, MAX_CANCEL_REASON);
  var otherReason = String(
    body.otherReason || body["other-reason"] || body.other_reason || "",
  )
    .trim()
    .slice(0, MAX_CANCEL_REASON);
  var code = cancelReason.toLowerCase();
  if (code === "other") {
    return {
      cancelReason: "other",
      otherReason: otherReason || null,
      portoneReason: cancelReasonLabelForPg("other", otherReason),
    };
  }
  if (KNOWN_CANCEL_REASON_CODES.has(code)) {
    return {
      cancelReason: cancelReason,
      otherReason: null,
      portoneReason: cancelReasonLabelForPg(cancelReason, ""),
    };
  }
  return {
    cancelReason: cancelReason || null,
    otherReason: null,
    portoneReason: cancelReason || "고객 요청 취소",
  };
}

function getDatabaseUrl() {
  return String(
    process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL ||
      "",
  ).trim();
}

var poolSingleton = null;

function getPool() {
  var dbUrl = getDatabaseUrl();
  if (!dbUrl) return null;
  if (!poolSingleton) {
    poolSingleton = new Pool({
      connectionString: dbUrl,
      max: 1,
      connectionTimeoutMillis: 20000,
      idleTimeoutMillis: 15000,
    });
  }
  return poolSingleton;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(body));
}

function formatDateTimeKst(v) {
  if (!v) return "";
  var d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

function formatYmdKst(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** check_in_date (DATE / string / Date) → YYYY-MM-DD */
function normalizeCheckInYmd(v) {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    var s = v.trim();
    var mm = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    if (mm) return mm[1];
  }
  var d = new Date(v);
  if (isNaN(d.getTime())) return null;
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
  return formatYmdKst(d);
}

function computeCancellationFeePercentForRow(row, at) {
  return computeCancellationFeePercent({
    checkInYmd: normalizeCheckInYmd(row && row.check_in_date),
    createdAt: row && row.created_at,
    at: at,
  });
}

function normalizeLookupName(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLookupOrder(s) {
  var t = String(s || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
  if (t.startsWith("GRF-")) t = t.slice(4);
  return t;
}

function getCancelTokenSecret() {
  return String(
    process.env.RESERVATION_CANCEL_TOKEN_SECRET ||
      process.env.CANCEL_TOKEN_SECRET ||
      getDatabaseUrl() ||
      "",
  ).trim();
}

function getCancelTokenTtlMs() {
  var raw = String(
    process.env.RESERVATION_CANCEL_TOKEN_TTL_MINUTES ||
      process.env.CANCEL_TOKEN_TTL_MINUTES ||
      "",
  ).trim();
  if (!raw) return DEFAULT_CANCEL_TOKEN_TTL_MS;
  var mins = Number(raw);
  if (!Number.isFinite(mins) || mins <= 0) return DEFAULT_CANCEL_TOKEN_TTL_MS;
  return Math.floor(Math.min(1440, mins) * 60 * 1000);
}

function b64urlDecode(s) {
  return Buffer.from(String(s || ""), "base64url").toString("utf8");
}

function verifyCancelToken(token, reservationNumber, guestName) {
  var secret = getCancelTokenSecret();
  if (!secret) {
    return { ok: false, error: "토큰 검증 키가 설정되어 있지 않습니다." };
  }
  var parts = String(token || "").split(".");
  if (parts.length !== 2) {
    return { ok: false, error: "유효하지 않은 취소 토큰입니다." };
  }
  var payload = parts[0];
  var sig = parts[1];
  var expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  if (sig !== expected) {
    return { ok: false, error: "취소 토큰 서명이 유효하지 않습니다." };
  }
  var obj;
  try {
    obj = JSON.parse(b64urlDecode(payload));
  } catch (e) {
    return { ok: false, error: "취소 토큰 형식이 올바르지 않습니다." };
  }
  if (!obj || !obj.exp || Date.now() > Number(obj.exp)) {
    return { ok: false, error: "취소 토큰이 만료되었습니다." };
  }
  if (String(obj.reservationNumber || "") !== String(reservationNumber || "")) {
    return { ok: false, error: "취소 토큰과 예약번호가 일치하지 않습니다." };
  }
  if (normalizeLookupName(obj.guestName) !== normalizeLookupName(guestName)) {
    return { ok: false, error: "취소 토큰과 예약자명이 일치하지 않습니다." };
  }
  return { ok: true };
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (c) {
      chunks.push(c);
    });
    req.on("end", function () {
      try {
        var raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function getJsonBody(req) {
  if (
    req.body != null &&
    typeof req.body === "object" &&
    !Buffer.isBuffer(req.body)
  ) {
    return req.body;
  }
  return readBody(req);
}

/**
 * PortOne v2 결제 취소 요청.
 * paymentId = reservationNumber (결제 시 portone.requestPayment({ paymentId: orderNo }) 에 사용한 값).
 * refundAmount < totalAmount 이면 부분 취소(amount + currentCancellableAmount 지정),
 * 같으면 전액 취소(amount 없이 호출).
 * refundAmount === 0 인 경우(100% 취소 수수료)는 호출하지 않아야 합니다 — 호출 전 확인 필요.
 */
async function requestPortoneCancellation(
  paymentId,
  cancelReason,
  refundAmount,
  totalAmount,
) {
  var apiSecret = (process.env.PORTONE_API_SECRET || "").trim();
  if (!apiSecret) {
    return {
      ok: false,
      error: "PORTONE_API_SECRET 환경변수가 설정되지 않았습니다.",
    };
  }

  var isPartial =
    Number.isFinite(refundAmount) &&
    Number.isFinite(totalAmount) &&
    refundAmount > 0 &&
    refundAmount < totalAmount;

  var cancelBody = { reason: cancelReason || "고객 요청 취소" };

  if (isPartial) {
    // 부분 취소: 환불할 금액(amount)과 현재 취소 가능 잔액(currentCancellableAmount) 모두 지정
    // currentCancellableAmount는 검증용 — 첫 취소이므로 totalAmount와 동일
    cancelBody.amount = refundAmount;
    cancelBody.currentCancellableAmount = totalAmount;
  }
  // 전액 취소: amount 없이 호출 → PortOne이 전액 환불 처리

  var cancelUrl =
    "https://api.portone.io/payments/" +
    encodeURIComponent(paymentId) +
    "/cancel";

  console.log(
    "[payment-cancel] PortOne 취소 요청 →",
    cancelUrl,
    "| paymentId:",
    paymentId,
    "| 부분취소:",
    isPartial,
    "| body:",
    JSON.stringify(cancelBody),
  );

  try {
    var portoneRes = await fetch(cancelUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "PortOne " + apiSecret,
      },
      body: JSON.stringify(cancelBody),
    });

    var resData = {};
    try {
      resData = await portoneRes.json();
    } catch (_) {}

    console.log(
      "[payment-cancel] PortOne 취소 응답 HTTP",
      portoneRes.status,
      "| body:",
      JSON.stringify(resData),
    );

    if (!portoneRes.ok) {
      return {
        ok: false,
        error:
          "PortOne 결제 취소 실패 (HTTP " +
          portoneRes.status +
          "): " +
          (resData.message || resData.error || JSON.stringify(resData)),
        detail: resData,
      };
    }
    return { ok: true, data: resData };
  } catch (e) {
    return {
      ok: false,
      error:
        "PortOne API 호출 중 네트워크 오류: " +
        (e && e.message ? e.message : String(e)),
    };
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  var pool = getPool();
  if (!pool) {
    json(res, 503, {
      ok: false,
      error:
        "DB 연결 정보가 없습니다. .env.local 에 POSTGRES_URL 등을 설정하세요.",
    });
    return;
  }

  var body;
  try {
    body = await getJsonBody(req);
  } catch (e) {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  var reservationNumber = normalizeLookupOrder(
    body.reservationNumber || body.orderNo || "",
  );
  var guestName = normalizeLookupName(body.guestName || body.name || "");
  var cancelToken = String(body.cancelToken || "").trim();
  var cancelFields = parseCancelReasonFields(body);
  var cancelReason = cancelFields.cancelReason;
  var otherReason = cancelFields.otherReason;
  var portoneCancelReason = cancelFields.portoneReason;

  if (!reservationNumber) {
    json(res, 400, { ok: false, error: "reservationNumber가 필요합니다." });
    return;
  }
  if (!guestName) {
    json(res, 400, { ok: false, error: "guestName이 필요합니다." });
    return;
  }
  if (!cancelToken) {
    json(res, 400, { ok: false, error: "cancelToken이 필요합니다." });
    return;
  }

  // cancelToken 검증
  var tokenVerify = verifyCancelToken(
    cancelToken,
    reservationNumber,
    guestName,
  );
  if (!tokenVerify.ok) {
    json(res, 401, { ok: false, error: tokenVerify.error });
    return;
  }

  var client;
  try {
    client = await pool.connect();
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: "DB 연결 실패: " + (e && e.message ? e.message : String(e)),
    });
    return;
  }

  try {
    // 예약 조회 — booking 테이블에서 confirm/completed 상태만
    var sel = await client.query(
      `SELECT * FROM ${BOOKING_TABLE}
       WHERE reservation_number = $1
         AND status IN ('confirm', 'completed')
       LIMIT 1`,
      [reservationNumber],
    );

    if (!sel.rows || !sel.rows.length) {
      client.release();
      json(res, 404, { ok: false, error: "예약을 찾을 수 없습니다." });
      return;
    }

    var row = await applyBookingRetentionToRow(client, sel.rows[0]);
    if (!row) {
      client.release();
      json(res, 404, { ok: false, error: "예약을 찾을 수 없습니다." });
      return;
    }
    if (!guestNamesMatch(row.guest_name, guestName, normalizeLookupName)) {
      client.release();
      json(res, 404, { ok: false, error: "예약을 찾을 수 없습니다." });
      return;
    }

    // refunded_count가 0이 아니면 이미 취소(환불) 처리된 예약
    var refundedCount =
      row.refunded_count != null ? Number(row.refunded_count) : 0;
    if (refundedCount !== 0) {
      client.release();
      json(res, 409, {
        ok: false,
        error: "이미 취소(환불) 처리된 예약입니다. 중복 취소는 불가합니다.",
      });
      return;
    }

    if (isGuestSelfCancelClosed(normalizeCheckInYmd(row.check_in_date))) {
      client.release();
      json(res, 403, {
        ok: false,
        error:
          "체크인 당일부터는 온라인 취소가 불가합니다. 숙소로 문의해 주세요.",
      });
      return;
    }

    var pgTid = row.pg_tid ? String(row.pg_tid).trim() : null;
    // payment_method: "bank" / "무통장입금" 이면 PG 취소 불필요; 그 외(card 등)는 PortOne 취소
    var paymentMethodDb = String(row.payment_method || "")
      .toLowerCase()
      .trim();
    var isBankTransfer =
      paymentMethodDb === "bank" ||
      paymentMethodDb === "무통장입금" ||
      paymentMethodDb === "bank_transfer";

    var paidResolution = await resolvePaidAmountForBooking({
      row: row,
      reservationNumber: reservationNumber,
      isBankTransfer: isBankTransfer,
    });
    var paidAmountNum = paidResolution.paidAmount;
    var feePercent = computeCancellationFeePercentForRow(row);
    // 클라이언트 refundAmount는 참고만 — 최종 결제액 기준으로 서버 재산출(조작 방지)
    var safeRefundAmount = computeRefundAmount(paidAmountNum, feePercent);

    console.log(
      "[payment-cancel] 예약번호:",
      reservationNumber,
      "| pg_tid:",
      pgTid,
      "| payment_method(DB):",
      paymentMethodDb,
      "| isBankTransfer:",
      isBankTransfer,
      "| paidAmount:",
      paidAmountNum,
      "| paidAmountSource:",
      paidResolution.source,
      "| dbTotalAmount:",
      row.total_amount,
      "| cancellationFeePercent:",
      feePercent,
      "| safeRefundAmount:",
      safeRefundAmount,
    );

    var pgCancelled = false;
    var pgError = null;

    // 카드/PG 결제(무통장입금 제외)이고 환불액이 0보다 클 때 PortOne v2 결제 취소 요청.
    // safeRefundAmount === 0 이면 100% 취소 수수료 적용 → 환불 없음, PG 취소 API 호출 불필요.
    // pg_tid 유무에 관계없이 payment_method 기준으로 판단 (pg_tid가 누락될 수 있으므로).
    if (!isBankTransfer && safeRefundAmount > 0) {
      var portoneResult = await requestPortoneCancellation(
        reservationNumber, // PortOne paymentId = 결제 시 사용한 orderNo (= reservationNumber)
        portoneCancelReason,
        safeRefundAmount,
        paidAmountNum,
      );
      if (!portoneResult.ok) {
        // PortOne에 해당 결제가 없는 경우(404/payment not found)는 DB 취소만 진행
        var portoneErrStr = portoneResult.error || "";
        var portoneDetail = portoneResult.detail || {};
        var isNotFound =
          (portoneDetail.type && portoneDetail.type === "PAYMENT_NOT_FOUND") ||
          portoneErrStr.includes("PAYMENT_NOT_FOUND") ||
          portoneErrStr.includes("404");
        if (isNotFound) {
          console.warn(
            "[payment-cancel] PortOne에서 결제건을 찾을 수 없음(PAYMENT_NOT_FOUND) → DB 취소만 진행.",
            "reservationNumber:",
            reservationNumber,
          );
          pgCancelled = false;
          pgError = portoneResult.error;
        } else {
          client.release();
          json(res, 502, {
            ok: false,
            error:
              "결제 취소에 실패했습니다. 고객센터로 문의해 주세요.\n" +
              portoneResult.error,
            pgError: portoneResult.error,
          });
          return;
        }
      } else {
        pgCancelled = true;
      }
    }

    // booking 테이블에서 status를 'cancelled'로 업데이트
    try {
      var updResult = await client.query(
        `UPDATE ${BOOKING_TABLE}
         SET status        = 'cancelled',
             cancel_reason = $3,
             other_reason  = $4,
             cancelled_at  = NOW(),
             refunded_count = 1,
             refund_amount  = $5
         WHERE reservation_number = $1
           AND guest_name = $2
           AND status IN ('confirm', 'completed')
         RETURNING reservation_number, created_at, cancelled_at`,
        [
          reservationNumber,
          row.guest_name,
          cancelReason || null,
          otherReason,
          safeRefundAmount,
        ],
      );

      if (!updResult.rows || !updResult.rows.length) {
        json(res, 404, { ok: false, error: "삭제할 예약을 찾을 수 없습니다." });
        return;
      }
      try {
        await cancelRoomChangeChildren(client, reservationNumber, {
          cancelReason: cancelReason || "guest",
          otherReason: otherReason,
          refundedCount: 1,
        });
      } catch (childErr) {
        console.error("[payment-cancel] room-change child cancel", childErr);
      }
    } finally {
      client.release();
    }

    var updRow = updResult.rows[0] || {};
    var createdAt = updRow.created_at || row.created_at;
    var cancelledAt = updRow.cancelled_at
      ? new Date(updRow.cancelled_at)
      : new Date();
    try {
      var bqResult = await exportCancellationToBigQuery({
        reservationId: reservationNumber,
        room: row.room_type,
        amount: paidAmountNum,
        refundAmount: safeRefundAmount,
        cancelReason: cancelReason,
        otherReason: otherReason,
        createdAt: createdAt,
        checkIn: normalizeCheckInYmd(row.check_in_date),
        checkOut: normalizeCheckInYmd(row.check_out_date),
        cancelledAt: cancelledAt,
      });
      if (!bqResult.ok) {
        console.error("[payment-cancel] BigQuery export failed", bqResult);
      }
    } catch (bqErr) {
      console.error("[payment-cancel] BigQuery export", bqErr);
    }

    json(res, 200, {
      ok: true,
      pgCancelled: pgCancelled,
      pgTid: pgTid,
      createdAt: formatDateTimeKst(createdAt),
      createdAtIso: createdAt ? new Date(createdAt).toISOString() : null,
      createdAtYmd: createdAt ? formatYmdKst(new Date(createdAt)) : "",
      cancelledAt: formatDateTimeKst(cancelledAt),
      cancelledAtIso: cancelledAt ? cancelledAt.toISOString() : null,
      cancelledAtYmd: cancelledAt ? formatYmdKst(cancelledAt) : "",
      reservationNumber: reservationNumber,
      refundAmount: safeRefundAmount, // 실제 환불 처리된 금액
      totalAmount: paidAmountNum, // 최종 결제 금액(환불 수수료 기준)
      paidAmountSource: paidResolution.source,
      isPartialRefund:
        pgCancelled && safeRefundAmount > 0 && safeRefundAmount < paidAmountNum,
    });
  } catch (e) {
    try {
      client.release();
    } catch (_) {}
    console.error("payment-cancel handler", e);
    json(res, 500, {
      ok: false,
      error:
        "처리 중 서버 오류가 발생했습니다: " +
        (e && e.message ? e.message : String(e)),
    });
  }
}
