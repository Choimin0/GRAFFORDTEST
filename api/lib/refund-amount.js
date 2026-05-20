/**
 * 환불 기준 금액: 이용자가 실제 결제한 금액(최종 결제액).
 * PG(카드/네이버페이)는 PortOne 결제 조회값을 우선하고, 무통장은 DB total_amount를 사용합니다.
 */

export function extractPortonePaidAmount(payment) {
  if (!payment) return null;
  var actualAmount = null;
  if (payment.amount != null) {
    if (typeof payment.amount === "object" && payment.amount.total != null) {
      actualAmount = Number(payment.amount.total);
    } else if (typeof payment.amount === "number") {
      actualAmount = Number(payment.amount);
    }
  }
  if (actualAmount == null && payment.totalAmount != null) {
    actualAmount = Number(payment.totalAmount);
  }
  if (!Number.isFinite(actualAmount) || actualAmount < 0) {
    return null;
  }
  return Math.floor(actualAmount);
}

export async function fetchPortonePayment(paymentId) {
  var apiSecret = (process.env.PORTONE_API_SECRET || "").trim();
  if (!apiSecret) {
    return { ok: false, error: "PORTONE_API_SECRET 환경변수가 설정되지 않았습니다." };
  }
  try {
    var portoneRes = await fetch(
      "https://api.portone.io/payments/" + encodeURIComponent(paymentId),
      { headers: { Authorization: "PortOne " + apiSecret } },
    );
    var resData = {};
    try {
      resData = await portoneRes.json();
    } catch (_) {}
    if (!portoneRes.ok) {
      return {
        ok: false,
        error:
          "PortOne 결제 조회 실패 (HTTP " +
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
        "PortOne API 조회 중 네트워크 오류: " +
        (e && e.message ? e.message : String(e)),
    };
  }
}

function isBankTransferMethod(paymentMethodDb) {
  var m = String(paymentMethodDb || "").toLowerCase().trim();
  return m === "bank" || m === "무통장입금" || m === "bank_transfer";
}

/**
 * @param {{ row: object, reservationNumber: string, isBankTransfer?: boolean }} options
 * @returns {Promise<{ paidAmount: number, source: "portone"|"db" }>}
 */
export async function resolvePaidAmountForBooking(options) {
  var row = options && options.row ? options.row : {};
  var reservationNumber = String(
    (options && options.reservationNumber) || row.reservation_number || "",
  ).trim();
  var isBankTransfer =
    options && options.isBankTransfer != null
      ? !!options.isBankTransfer
      : isBankTransferMethod(row.payment_method);

  var dbRaw = row.total_amount != null ? Number(row.total_amount) : null;
  var dbAmount = Number.isFinite(dbRaw) ? Math.max(0, Math.floor(dbRaw)) : 0;

  if (isBankTransfer || !reservationNumber) {
    return { paidAmount: dbAmount, source: "db" };
  }

  var paymentLookup = await fetchPortonePayment(reservationNumber);
  if (!paymentLookup.ok) {
    return { paidAmount: dbAmount, source: "db" };
  }

  var portonePaid = extractPortonePaidAmount(paymentLookup.data);
  if (portonePaid == null) {
    return { paidAmount: dbAmount, source: "db" };
  }

  return { paidAmount: portonePaid, source: "portone" };
}

/** 위약금 비율(%) 적용 후 환불액. paidAmount는 최종 결제액 기준. */
export function computeRefundAmount(paidAmount, feePercent) {
  var paid = Number.isFinite(Number(paidAmount))
    ? Math.max(0, Math.floor(Number(paidAmount)))
    : 0;
  var pct = Number.isFinite(Number(feePercent)) ? Number(feePercent) : 100;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  var refund = Math.max(0, Math.round(paid * ((100 - pct) / 100)));
  return refund > paid ? paid : refund;
}
