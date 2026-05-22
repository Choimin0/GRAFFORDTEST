/**
 * GET  /api/payment-confirm — PortOne 결제 UI 설정 (구 payment-config)
 * POST /api/payment-confirm — PortOne v2 결제 서버 사이드 검증
 *
 * POST Body: { paymentId: string, expectedAmount: number }
 */
function sendPaymentConfig(res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  var storeId = process.env.STORE_ID || "";
  var channelKey = process.env.CHANNEL_KEY || "";
  var naverPayChannelKey = process.env.NAVER_PAY_CHANNEL_KEY || "";

  if (!storeId || !channelKey) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        error:
          "STORE_ID 또는 CHANNEL_KEY 환경변수가 설정되지 않았습니다.",
      }),
    );
    return;
  }

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      storeId: storeId,
      channelKey: channelKey,
      naverPayChannelKey: naverPayChannelKey,
    }),
  );
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method === "GET") {
    sendPaymentConfig(res);
    return;
  }

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
      console.error("[payment-confirm] PortOne API error", portoneRes.status, errData);
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          ok: false,
          error: "PortOne API 조회 실패 (HTTP " + portoneRes.status + "): " + (errData.message || errData.error || JSON.stringify(errData)),
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
          ok: false,
          error: "결제가 완료되지 않았습니다. (status: " + payment.status + ")",
          status: payment.status,
        }),
      );
      return;
    }

    // PortOne v2 응답의 amount 구조는 PG사에 따라 다를 수 있으므로 방어적으로 파싱합니다.
    // { amount: { total: N } } 또는 { amount: N } 또는 { totalAmount: N } 형태 모두 대응.
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

    if (
      expectedAmount !== null &&
      actualAmount !== null &&
      Number(actualAmount) !== Number(expectedAmount)
    ) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          ok: false,
          error: "결제 금액이 일치하지 않습니다.",
          expected: expectedAmount,
          actual: actualAmount,
        }),
      );
      return;
    }

    // PortOne v2: PG사 거래번호(TID)는 transactions[0].pgTxId 에 위치합니다.
    // KG이니시스의 경우 transactions 배열의 첫 번째 항목에 있습니다.
    var pgTid = null;
    if (
      payment.transactions &&
      Array.isArray(payment.transactions) &&
      payment.transactions.length > 0
    ) {
      var firstTx = payment.transactions[0];
      // pgTxId 또는 txId 또는 id 필드 순서로 시도
      pgTid =
        (firstTx.pgTxId && String(firstTx.pgTxId)) ||
        (firstTx.txId && String(firstTx.txId)) ||
        null;
    }
    if (!pgTid && payment.pgTxId) {
      pgTid = String(payment.pgTxId);
    }

    console.log(
      "[payment-confirm] paymentId:", paymentId,
      "| status:", payment.status,
      "| actualAmount:", actualAmount,
      "| pgTid:", pgTid,
      "| transactions count:", (payment.transactions && payment.transactions.length) || 0,
    );

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
