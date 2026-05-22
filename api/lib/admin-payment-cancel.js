/**
 * 관리자 직접 취소(천재지변 등): PG 100% 환불 후 예약 취소.
 */
import { decryptBookingPiiResponse } from "./pii-crypto.js";
import {
  fetchPortonePayment,
  resolvePaidAmountForBooking,
} from "./refund-amount.js";
import { queueBookingAlimtalk } from "./solapi-alimtalk.js";
import { json } from "./admin-common.js";

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

function normalizeCheckInYmd(v) {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    var s = v.trim();
    var mm = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    if (mm) return mm[1];
  }
  var d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
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

/**
 * PortOne v2 전액 취소. paymentId = 결제 시 merchant paymentId(예약번호).
 */
async function requestPortoneFullCancellation(paymentId, cancelReason) {
  var apiSecret = (process.env.PORTONE_API_SECRET || "").trim();
  if (!apiSecret) {
    return {
      ok: false,
      error: "PORTONE_API_SECRET 환경변수가 설정되지 않았습니다.",
    };
  }

  var cancelBody = { reason: cancelReason || "관리자 직접 취소" };
  var cancelUrl =
    "https://api.portone.io/payments/" +
    encodeURIComponent(paymentId) +
    "/cancel";

  console.log(
    "[admin-payment-cancel] PortOne 전액 취소 →",
    cancelUrl,
    "| paymentId:",
    paymentId,
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

    var row = sel.rows[0];
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
    var paidResolution = await resolvePaidAmountForBooking({
      row: row,
      reservationNumber: reservationNumber,
      isBankTransfer: isBankTransfer,
    });
    var paidAmountNum = paidResolution.paidAmount;
    var refundAmount = paidAmountNum;

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
      "| refundAmount(100%):",
      refundAmount,
    );

    var pgCancelled = false;

    if (!isBankTransfer && refundAmount > 0) {
      if (!pgTid) {
        client.release();
        json(res, 400, {
          ok: false,
          error:
            "PG 결제 거래번호(pg_tid)가 없어 환불을 진행할 수 없습니다. 결제 정보를 확인해 주세요.",
        });
        return;
      }

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

      var portoneResult = await requestPortoneFullCancellation(
        reservationNumber,
        "관리자 직접 취소(천재지변)",
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
              "결제 취소(100% 환불)에 실패했습니다.\n" + portoneResult.error,
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

    client.release();

    var cancelledPii = decryptBookingPiiResponse(updResult.rows[0]);
    queueBookingAlimtalk("cancel-complete", {
      guestName: cancelledPii.guestName,
      contact: cancelledPii.contact,
      reservationNumber: reservationNumber,
      roomType: row.room_type,
      checkIn: normalizeCheckInYmd(row.check_in_date) || "",
      checkOut: normalizeCheckInYmd(row.check_out_date) || "",
    });

    json(res, 200, {
      ok: true,
      pgCancelled: pgCancelled,
      pgTid: pgTid,
      cancelledAt: formatDateTimeKst(new Date()),
      reservationNumber: reservationNumber,
      guestName: cancelledPii.guestName,
      refundAmount: refundAmount,
      totalAmount: paidAmountNum,
      paidAmountSource: paidResolution.source,
      cancelReason: CANCEL_REASON_MANUAL,
      isBankTransfer: isBankTransfer,
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
