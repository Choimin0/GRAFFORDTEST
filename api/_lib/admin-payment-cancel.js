/**
 * 관리자 직접 취소(천재지변 등): 선택한 환불 비율만큼 PG 환불 후 예약 취소.
 */
import { decryptBookingPiiResponse } from "./pii-crypto.js";
import {
  fetchPortonePayment,
  resolvePaidAmountForBooking,
} from "./refund-amount.js";
import { shouldSendAlimtalk } from "./booking-locale.js";
import { sendBookingAlimtalk } from "./solapi-alimtalk.js";
import {
  claimFirstCancelAlarmSend,
  releaseCancelAlarmSendClaim,
} from "./cancel-alarm-sent-count.js";
import { exportCancellationToBigQuery } from "./bigquery-export.js";
import { json } from "./admin-common.js";
import { applyBookingRetentionToRow } from "./booking-retention.js";
import { isExternalManualPaymentMethod } from "./admin-manual-booking.js";
import { cancelRoomChangeChildren } from "./booking-room-change.js";

const BOOKING_TABLE = "booking";
const CANCEL_REASON_MANUAL = "MANUAL";

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

function normalizeReservationNumber(s) {
  var t = String(s || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
  if (t.startsWith("GRF-")) t = t.slice(4);
  return t;
}

function formatYmdKst(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

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

function isBankTransferMethod(paymentMethodDb) {
  var m = String(paymentMethodDb || "")
    .toLowerCase()
    .trim();
  return m === "bank" || m === "무통장입금" || m === "bank_transfer";
}

function extractPgTxIdFromPayment(payment) {
  if (!payment) return null;
  if (
    payment.transactions &&
    Array.isArray(payment.transactions) &&
    payment.transactions.length > 0
  ) {
    var firstTx = payment.transactions[0];
    return (
      (firstTx.pgTxId && String(firstTx.pgTxId)) ||
      (firstTx.txId && String(firstTx.txId)) ||
      null
    );
  }
  if (payment.pgTxId) return String(payment.pgTxId);
  return null;
}

function parseAdminRefundPercent(body, isExternalManual) {
  if (body.refundPercent == null || body.refundPercent === "") {
    return isExternalManual ? 0 : 100;
  }
  var value = Number(body.refundPercent);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return null;
  }
  return Math.round(value);
}

function computeAdminRefundAmount(paidAmount, refundPercent) {
  var paid = Number.isFinite(Number(paidAmount))
    ? Math.max(0, Math.floor(Number(paidAmount)))
    : 0;
  var percent = Number.isFinite(Number(refundPercent))
    ? Math.min(100, Math.max(0, Math.round(Number(refundPercent))))
    : 0;
  var refundAmount = Math.min(
    paid,
    Math.max(0, Math.round((paid * percent) / 100)),
  );
  return refundAmount;
}

/**
 * PortOne v2 결제 취소. refundAmount < totalAmount 이면 부분 취소.
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

  var cancelBody = { reason: cancelReason || "관리자 직접 취소" };
  if (isPartial) {
    cancelBody.amount = refundAmount;
    cancelBody.currentCancellableAmount = totalAmount;
  }

  var cancelUrl =
    "https://api.portone.io/payments/" +
    encodeURIComponent(paymentId) +
    "/cancel";

  console.log(
    "[admin-payment-cancel] PortOne 취소 →",
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

export async function handleAdminPaymentCancel(res, pool, body) {
  var reservationNumber = normalizeReservationNumber(
    body.reservationNumber || "",
  );
  if (!reservationNumber) {
    json(res, 400, { ok: false, error: "reservationNumber가 필요합니다." });
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
    var sel = await client.query(
      `SELECT * FROM ${BOOKING_TABLE}
       WHERE reservation_number = $1
         AND status IN ('confirm', 'completed')
       LIMIT 1`,
      [reservationNumber],
    );

    if (!sel.rows || !sel.rows.length) {
      client.release();
      json(res, 404, { ok: false, error: "취소할 예약을 찾을 수 없습니다." });
      return;
    }

    var row = await applyBookingRetentionToRow(client, sel.rows[0]);
    if (!row) {
      client.release();
      json(res, 404, { ok: false, error: "취소할 예약을 찾을 수 없습니다." });
      return;
    }
    var refundedCount =
      row.refunded_count != null ? Number(row.refunded_count) : 0;
    if (refundedCount !== 0) {
      client.release();
      json(res, 409, {
        ok: false,
        error: "이미 취소(환불) 처리된 예약입니다.",
      });
      return;
    }

    var pgTid = row.pg_tid ? String(row.pg_tid).trim() : null;
    var paymentMethodDb = String(row.payment_method || "")
      .toLowerCase()
      .trim();
    var isBankTransfer = isBankTransferMethod(paymentMethodDb);
    var isExternalManual = isExternalManualPaymentMethod(paymentMethodDb);
    var refundPercent = parseAdminRefundPercent(body, isExternalManual);
    if (refundPercent == null) {
      client.release();
      json(res, 400, {
        ok: false,
        error: "refundPercent는 0~100 사이 정수여야 합니다.",
      });
      return;
    }
    var paidResolution = await resolvePaidAmountForBooking({
      row: row,
      reservationNumber: reservationNumber,
      isBankTransfer: isBankTransfer,
    });
    var paidAmountNum = paidResolution.paidAmount;
    var refundAmount = computeAdminRefundAmount(paidAmountNum, refundPercent);

    console.log(
      "[admin-payment-cancel] 예약번호:",
      reservationNumber,
      "| pg_tid:",
      pgTid,
      "| payment_method:",
      paymentMethodDb,
      "| paidAmount:",
      paidAmountNum,
      "| paidAmountSource:",
      paidResolution.source,
      "| dbTotalAmount:",
      row.total_amount,
      "| refundPercent:",
      refundPercent,
      "| refundAmount:",
      refundAmount,
    );

    var pgCancelled = false;

    if (!isBankTransfer && !isExternalManual && refundAmount > 0) {
      var paymentLookup = await fetchPortonePayment(reservationNumber);
      if (!paymentLookup.ok) {
        var lookupErr = paymentLookup.error || "";
        var isNotFound =
          (paymentLookup.detail &&
            paymentLookup.detail.type === "PAYMENT_NOT_FOUND") ||
          lookupErr.includes("PAYMENT_NOT_FOUND") ||
          lookupErr.includes("404");
        if (!isNotFound) {
          client.release();
          json(res, 502, {
            ok: false,
            error: "결제 조회에 실패했습니다.\n" + lookupErr,
          });
          return;
        }
        console.warn(
          "[admin-payment-cancel] PortOne 결제 조회 실패(PAYMENT_NOT_FOUND) → pg_tid 기준 취소 시도.",
          reservationNumber,
        );
      } else {
        var portonePgTxId = extractPgTxIdFromPayment(paymentLookup.data);
        if (portonePgTxId && pgTid && portonePgTxId !== pgTid) {
          console.warn(
            "[admin-payment-cancel] DB pg_tid와 PortOne pgTxId 불일치.",
            "DB:",
            pgTid,
            "PortOne:",
            portonePgTxId,
          );
        }
      }

      var portoneResult = await requestPortoneCancellation(
        reservationNumber,
        "관리자 직접 취소(천재지변)",
        refundAmount,
        paidAmountNum,
      );
      if (!portoneResult.ok) {
        var portoneErrStr = portoneResult.error || "";
        var portoneDetail = portoneResult.detail || {};
        var isCancelNotFound =
          (portoneDetail.type && portoneDetail.type === "PAYMENT_NOT_FOUND") ||
          portoneErrStr.includes("PAYMENT_NOT_FOUND") ||
          portoneErrStr.includes("404");
        if (!isCancelNotFound) {
          client.release();
          json(res, 502, {
            ok: false,
            error:
              "결제 취소(환불)에 실패했습니다.\n" + portoneResult.error,
            pgError: portoneResult.error,
          });
          return;
        }
        console.warn(
          "[admin-payment-cancel] PortOne 취소 PAYMENT_NOT_FOUND → DB 취소만 진행.",
          reservationNumber,
        );
      } else {
        pgCancelled = true;
      }
    }

    var updResult = await client.query(
      `UPDATE ${BOOKING_TABLE}
       SET status         = 'cancelled',
           cancel_reason  = $2,
           cancelled_at   = NOW(),
           refunded_count = 1,
           refund_amount  = $3
       WHERE reservation_number = $1
         AND status IN ('confirm', 'completed')
       RETURNING reservation_number, guest_name`,
      [reservationNumber, CANCEL_REASON_MANUAL, refundAmount],
    );

    if (!updResult.rows || !updResult.rows.length) {
      client.release();
      json(res, 404, { ok: false, error: "예약 취소 처리에 실패했습니다." });
      return;
    }

    try {
      await cancelRoomChangeChildren(client, reservationNumber, {
        cancelReason: CANCEL_REASON_MANUAL,
        refundedCount: 1,
      });
    } catch (childErr) {
      console.error("[admin-payment-cancel] room-change child cancel", childErr);
    }

    client.release();

    var cancelledAt = new Date();
    try {
      var bqResult = await exportCancellationToBigQuery({
        reservationId: reservationNumber,
        room: row.room_type,
        amount: paidAmountNum,
        refundAmount: refundAmount,
        cancelReason: CANCEL_REASON_MANUAL,
        otherReason: null,
        createdAt: row.created_at,
        checkIn: normalizeCheckInYmd(row.check_in_date),
        checkOut: normalizeCheckInYmd(row.check_out_date),
        cancelledAt: cancelledAt,
      });
      if (!bqResult.ok) {
        console.error("[admin-payment-cancel] BigQuery export failed", bqResult);
      }
    } catch (bqErr) {
      console.error("[admin-payment-cancel] BigQuery export", bqErr);
    }

    var cancelledPii = decryptBookingPiiResponse(updResult.rows[0]);
    if (
      !isExternalManual &&
      shouldSendAlimtalk(row.booking_locale, cancelledPii.contact)
    ) {
      claimFirstCancelAlarmSend(pool, reservationNumber)
        .then(function (claimed) {
          if (!claimed) {
            return null;
          }
          return sendBookingAlimtalk("cancel-complete", {
            guestName: cancelledPii.guestName,
            contact: cancelledPii.contact,
            reservationNumber: reservationNumber,
            roomType: row.room_type,
            checkIn: normalizeCheckInYmd(row.check_in_date) || "",
            checkOut: normalizeCheckInYmd(row.check_out_date) || "",
          }).then(function (sendResult) {
            if (sendResult && sendResult.ok && !sendResult.skipped) {
              return sendResult;
            }
            return releaseCancelAlarmSendClaim(pool, reservationNumber);
          });
        })
        .catch(function (err) {
          console.error("admin-payment-cancel alimtalk", err);
        });
    }

    json(res, 200, {
      ok: true,
      pgCancelled: pgCancelled,
      pgTid: pgTid,
      cancelledAt: formatDateTimeKst(cancelledAt),
      reservationNumber: reservationNumber,
      guestName: cancelledPii.guestName,
      refundAmount: refundAmount,
      refundPercent: refundPercent,
      retainedAmount: Math.max(0, paidAmountNum - refundAmount),
      totalAmount: paidAmountNum,
      paidAmountSource: paidResolution.source,
      cancelReason: CANCEL_REASON_MANUAL,
      isBankTransfer: isBankTransfer,
      isExternalManual: isExternalManual,
    });
  } catch (e) {
    try {
      client.release();
    } catch (_) {}
    console.error("admin-payment-cancel handler", e);
    json(res, 500, {
      ok: false,
      error:
        "처리 중 서버 오류가 발생했습니다: " +
        (e && e.message ? e.message : String(e)),
    });
  }
}
