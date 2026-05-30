/**
 * GET  /api/payment-confirm — PortOne 결제 UI 설정 (구 payment-config)
 * POST /api/payment-confirm — PortOne v2 결제 서버 사이드 검증 (+ 수동 승인)
 *
 * POST Body: {
 *   paymentId: string,
 *   expectedAmount: number,
 *   paymentToken?: string,  // 수동 승인 채널
 *   txId?: string
 * }
 */
import {
  confirmPortonePayment,
  extractPgTxIdFromPayment,
  extractPortonePaidAmount,
  fetchPortonePayment,
} from "./lib/portone-client.js";
import {
  extractPaymentMethodFromPortonePayment,
  resolveEnabledPaymentMethods,
  resolveVerifiedPaymentMethod,
} from "./lib/payment-methods.js";

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
      enabledMethods: resolveEnabledPaymentMethods(),
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
  res.setHeader("Access-Control-Allow-Origin", "*");

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
  var paymentToken =
    body.paymentToken != null ? String(body.paymentToken).trim() : "";
  var txId = body.txId != null ? String(body.txId).trim() : "";
  var requestedPaymentMethod =
    body.requestedPaymentMethod != null
      ? String(body.requestedPaymentMethod).trim()
      : "";

  if (!paymentId) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "paymentId가 필요합니다." }));
    return;
  }

  try {
    if (paymentToken) {
      var confirmResult = await confirmPortonePayment({
        paymentId: paymentId,
        paymentToken: paymentToken,
        txId: txId,
      });
      if (!confirmResult.ok && !confirmResult.skipped) {
        console.error(
          "[payment-confirm] manual confirm failed",
          paymentId,
          confirmResult.error,
        );
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            ok: false,
            error:
              confirmResult.error ||
              "결제 승인(수동 승인)에 실패했습니다. 잠시 후 다시 시도해 주세요.",
            detail: confirmResult.detail || null,
          }),
        );
        return;
      }
      if (confirmResult.ok) {
        console.log(
          "[payment-confirm] manual confirm succeeded",
          paymentId,
          confirmResult.alreadyPaid ? "(already paid)" : "",
        );
      }
    }

    var paymentLookup = await fetchPortonePayment(paymentId);
    if (!paymentLookup.ok) {
      console.error(
        "[payment-confirm] PortOne API error",
        paymentId,
        paymentLookup.error,
      );
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          ok: false,
          error: paymentLookup.error,
          detail: paymentLookup.detail || null,
        }),
      );
      return;
    }

    var payment = paymentLookup.data;

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

    var actualAmount = extractPortonePaidAmount(payment);
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

    var pgTid = extractPgTxIdFromPayment(payment);
    var extractedMethod = extractPaymentMethodFromPortonePayment(payment);
    var verifiedMethod = resolveVerifiedPaymentMethod(
      extractedMethod,
      requestedPaymentMethod,
    );

    console.log(
      "[payment-confirm] paymentId:",
      paymentId,
      "| status:",
      payment.status,
      "| actualAmount:",
      actualAmount,
      "| pgTid:",
      pgTid,
      "| paymentMethod:",
      verifiedMethod.methodId,
      "| pgPayProvider:",
      verifiedMethod.pgPayProvider || "(none)",
      "| transactions count:",
      (payment.transactions && payment.transactions.length) || 0,
    );

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        ok: true,
        paymentId: payment.id,
        status: payment.status,
        pgTid: pgTid,
        paymentMethod: verifiedMethod.methodId,
        pgPayProvider: verifiedMethod.pgPayProvider,
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
