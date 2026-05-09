/**
 * POST /api/payment-confirm
 * PortOne v2 결제 서버 사이드 검증 엔드포인트.
 *
 * Body: { paymentId: string, expectedAmount: number }
 * Response: { ok: true, paymentId, status } | { error: string }
 */
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }

  var apiSecret = (process.env.PORTONE_API_SECRET || "").trim();
  if (!apiSecret) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        error:
          "PORTONE_API_SECRET 환경변수가 설정되지 않았습니다. PortOne 콘솔 > 상점 > API 키에서 확인하세요.",
      }),
    );
    return;
  }

  var rawBody;
  try {
    rawBody = await new Promise(function (resolve, reject) {
      var chunks = [];
      req.on("data", function (c) {
        chunks.push(c);
      });
      req.on("end", function () {
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", reject);
    });
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "요청 본문을 읽는 중 오류가 발생했습니다." }));
    return;
  }

  var body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "유효하지 않은 JSON 형식입니다." }));
    return;
  }

  var paymentId = String(body.paymentId || "").trim();
  var expectedAmount =
    body.expectedAmount != null ? Number(body.expectedAmount) : null;

  if (!paymentId) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "paymentId가 필요합니다." }));
    return;
  }

  try {
    var portoneRes = await fetch(
      "https://api.portone.io/payments/" + encodeURIComponent(paymentId),
      {
        headers: {
          Authorization: "PortOne " + apiSecret,
        },
      },
    );

    if (!portoneRes.ok) {
      var errData = {};
      try {
        errData = await portoneRes.json();
      } catch (_) {}
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          error: "PortOne API 조회 실패 (HTTP " + portoneRes.status + ")",
          detail: errData,
        }),
      );
      return;
    }

    var payment = await portoneRes.json();

    if (payment.status !== "PAID") {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          error: "결제가 완료되지 않았습니다.",
          status: payment.status,
        }),
      );
      return;
    }

    if (
      expectedAmount !== null &&
      payment.amount &&
      payment.amount.total !== expectedAmount
    ) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          error: "결제 금액이 일치하지 않습니다.",
          expected: expectedAmount,
          actual: payment.amount.total,
        }),
      );
      return;
    }

    // PortOne v2: PG사 거래번호(TID)는 transactions[0].pgTxId 에 위치합니다.
    // KG이니시스 결제 취소 시 이 값이 필요합니다.
    var pgTid = null;
    if (
      payment.transactions &&
      Array.isArray(payment.transactions) &&
      payment.transactions.length > 0 &&
      payment.transactions[0].pgTxId
    ) {
      pgTid = String(payment.transactions[0].pgTxId);
    } else if (payment.pgTxId) {
      pgTid = String(payment.pgTxId);
    }

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        ok: true,
        paymentId: payment.id,
        status: payment.status,
        pgTid: pgTid,
      }),
    );
  } catch (e) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        error: "결제 검증 중 서버 오류가 발생했습니다.",
        detail: e && e.message ? e.message : String(e),
      }),
    );
  }
}
