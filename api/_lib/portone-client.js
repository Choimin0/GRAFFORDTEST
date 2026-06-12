/**
 * PortOne v2 REST API helpers (결제 조회·수동 승인).
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

export function extractPgTxIdFromPayment(payment) {
  if (!payment) return null;
  var pgTid = null;
  if (
    payment.transactions &&
    Array.isArray(payment.transactions) &&
    payment.transactions.length > 0
  ) {
    var firstTx = payment.transactions[0];
    pgTid =
      (firstTx.pgTxId && String(firstTx.pgTxId)) ||
      (firstTx.txId && String(firstTx.txId)) ||
      null;
  }
  if (!pgTid && payment.pgTxId) {
    pgTid = String(payment.pgTxId);
  }
  return pgTid;
}

function getPortoneApiSecret() {
  return String(process.env.PORTONE_API_SECRET || "").trim();
}

export async function fetchPortonePayment(paymentId) {
  var apiSecret = getPortoneApiSecret();
  if (!apiSecret) {
    return {
      ok: false,
      error: "PORTONE_API_SECRET 환경변수가 설정되지 않았습니다.",
    };
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

function isAlreadyPaidError(detail) {
  if (!detail || typeof detail !== "object") return false;
  if (detail.type === "ALREADY_PAID") return true;
  var msg = String(detail.message || detail.error || "");
  return msg.includes("ALREADY_PAID") || msg.includes("AlreadyPaid");
}

/**
 * 수동 승인(인증 결제) 채널에서 paymentToken으로 결제를 확정합니다.
 */
export async function confirmPortonePayment(options) {
  var paymentId = String(options.paymentId || "").trim();
  var paymentToken = String(options.paymentToken || "").trim();
  var txId = options.txId != null ? String(options.txId).trim() : "";
  var storeId = String(options.storeId || process.env.STORE_ID || "").trim();

  if (!paymentId || !paymentToken) {
    return { ok: false, skipped: true };
  }
  if (!storeId) {
    return {
      ok: false,
      error: "STORE_ID 환경변수가 설정되지 않았습니다.",
    };
  }

  var apiSecret = getPortoneApiSecret();
  if (!apiSecret) {
    return {
      ok: false,
      error: "PORTONE_API_SECRET 환경변수가 설정되지 않았습니다.",
    };
  }

  var body = { storeId: storeId, paymentToken: paymentToken };
  if (txId) {
    body.txId = txId;
  }

  try {
    var confirmRes = await fetch(
      "https://api.portone.io/payments/" + encodeURIComponent(paymentId) + "/confirm",
      {
        method: "POST",
        headers: {
          Authorization: "PortOne " + apiSecret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    var confirmData = {};
    try {
      confirmData = await confirmRes.json();
    } catch (_) {}

    if (confirmRes.ok) {
      return { ok: true, data: confirmData };
    }
    if (isAlreadyPaidError(confirmData)) {
      return { ok: true, alreadyPaid: true, detail: confirmData };
    }
    return {
      ok: false,
      error:
        "PortOne 결제 승인 실패 (HTTP " +
        confirmRes.status +
        "): " +
        (confirmData.message || confirmData.error || JSON.stringify(confirmData)),
      detail: confirmData,
    };
  } catch (e) {
    return {
      ok: false,
      error:
        "PortOne 결제 승인 중 네트워크 오류: " +
        (e && e.message ? e.message : String(e)),
    };
  }
}
