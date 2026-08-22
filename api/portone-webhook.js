/**
 * POST /api/portone-webhook
 *
 * PortOne v2 결제 웹훅·컨펌(confirm) 수신.
 * - Transaction.Confirm: pending/confirm 예약 또는 유효 hold만 확인하고 즉시 200
 *   (가용성·iCal 조회는 하지 않음 — PortOne confirm timeout 방지)
 * - 기타 결제 상태 웹훅: PortOne API로 재검증 후 200 응답
 */
import crypto from "node:crypto";
import pg from "pg";
import { fetchPortonePayment } from "./_lib/portone-client.js";
import { commitPaidBooking } from "./_lib/commit-paid-booking.js";

/**
 * PortOne v2 웹훅 HMAC-SHA256 서명 검증 (Svix 호환 포맷).
 * 헤더: webhook-id, webhook-timestamp, webhook-signature
 * 서명: v1,{base64(HMAC-SHA256(secret, "{id}.{timestamp}.{rawBody}"))}
 */
function verifyWebhookSignature(rawBody, headers) {
  var secret = String(process.env.PORTONE_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    console.warn("[portone-webhook] PORTONE_WEBHOOK_SECRET 미설정 — 서명 검증 건너뜀");
    return true;
  }

  var msgId = String(headers["webhook-id"] || "").trim();
  var msgTimestamp = String(headers["webhook-timestamp"] || "").trim();
  var msgSignature = String(headers["webhook-signature"] || "").trim();

  if (!msgId || !msgTimestamp || !msgSignature) {
    console.warn("[portone-webhook] 서명 헤더 누락 (id/timestamp/signature)");
    return false;
  }

  var ts = parseInt(msgTimestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    console.warn("[portone-webhook] 웹훅 타임스탬프 범위 초과 (replay 공격 방지)");
    return false;
  }

  var secretBytes = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice(6), "base64")
    : Buffer.from(secret, "utf8");

  var toSign = msgId + "." + msgTimestamp + "." + rawBody;
  var expectedSig = crypto
    .createHmac("sha256", secretBytes)
    .update(toSign, "utf8")
    .digest("base64");

  return msgSignature.split(" ").some(function (part) {
    var parts = part.split(",");
    if (parts.length !== 2 || parts[0] !== "v1") {
      return false;
    }
    var sigBuf = Buffer.from(parts[1], "base64");
    var expectedBuf = Buffer.from(expectedSig, "base64");
    if (sigBuf.length !== expectedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}

const { Pool } = pg;

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
  var databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }
  if (!poolSingleton) {
    poolSingleton = new Pool({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: 20000,
      idleTimeoutMillis: 15000,
    });
  }
  return poolSingleton;
}

async function readRawBody(req) {
  if (typeof req.body === "string") {
    return req.body;
  }
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }
  if (req.body != null && typeof req.body === "object") {
    return JSON.stringify(req.body);
  }
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (c) {
      chunks.push(c);
    });
    req.on("end", function () {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function parseWebhookPayload(rawBody) {
  if (!rawBody) {
    return null;
  }
  try {
    return JSON.parse(rawBody);
  } catch (_) {
    return null;
  }
}

export function extractConfirmFields(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  var eventType = String(payload.type || "").trim();
  if (eventType && eventType !== "Transaction.Confirm") {
    return null;
  }

  if (eventType === "Transaction.Confirm") {
    var data = payload.data && typeof payload.data === "object" ? payload.data : {};
    return {
      paymentId: String(
        data.paymentId || payload.paymentId || payload.payment_id || "",
      ).trim(),
      transactionId: String(
        data.transactionId || payload.transactionId || payload.tx_id || "",
      ).trim(),
      totalAmount:
        data.totalAmount != null
          ? Number(data.totalAmount)
          : payload.totalAmount != null
            ? Number(payload.totalAmount)
            : payload.total_amount != null
              ? Number(payload.total_amount)
              : null,
    };
  }

  var legacyPaymentId = String(payload.payment_id || payload.paymentId || "").trim();
  var legacyTxId = String(payload.tx_id || payload.transactionId || "").trim();
  var legacyAmount =
    payload.total_amount != null
      ? Number(payload.total_amount)
      : payload.totalAmount != null
        ? Number(payload.totalAmount)
        : null;
  var legacyStatus = payload.status != null ? String(payload.status) : "";

  if (
    legacyPaymentId &&
    legacyTxId &&
    legacyAmount != null &&
    Number.isFinite(legacyAmount) &&
    !legacyStatus
  ) {
    return {
      paymentId: legacyPaymentId,
      transactionId: legacyTxId,
      totalAmount: legacyAmount,
    };
  }

  return null;
}

function extractPaymentId(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  if (payload.data && payload.data.paymentId) {
    return String(payload.data.paymentId).trim();
  }
  return String(payload.payment_id || payload.paymentId || "").trim();
}

export async function handleTransactionConfirm(pool, fields) {
  var paymentId = String((fields && fields.paymentId) || "").trim();
  if (!paymentId) {
    return {
      ok: false,
      statusCode: 400,
      errorMessage: "paymentId가 없습니다.",
    };
  }

  try {
    var found = await pool.query(
      `SELECT 1 AS ok
       FROM booking
       WHERE reservation_number = $1
         AND status IN ('confirm', 'completed', 'pending')
       UNION ALL
       SELECT 1 AS ok
       FROM booking_hold
       WHERE reservation_number = $1
         AND expires_at > NOW()
       LIMIT 1`,
      [paymentId],
    );
    if (found.rows && found.rows.length) {
      console.log("[portone-webhook] confirm approved", paymentId);
      return { ok: true };
    }
  } catch (e) {
    console.error("[portone-webhook] confirm lookup", paymentId, e);
    return {
      ok: false,
      statusCode: 500,
      errorMessage: "예약 확인 중 오류가 발생했습니다.",
    };
  }

  console.warn("[portone-webhook] confirm rejected: hold not found", paymentId);
  return {
    ok: false,
    statusCode: 409,
    errorMessage:
      "예약 세션이 만료되었습니다. 예약 확인 페이지부터 다시 진행해 주세요.",
  };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }

  var rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    console.error("[portone-webhook] body read error", e);
    res.statusCode = 400;
    res.end();
    return;
  }

  if (!verifyWebhookSignature(rawBody, req.headers)) {
    console.error("[portone-webhook] 서명 검증 실패 — 요청 거부");
    res.statusCode = 401;
    res.end();
    return;
  }

  var payload = parseWebhookPayload(rawBody);
  if (!payload) {
    console.error("[portone-webhook] invalid JSON body");
    res.statusCode = 400;
    res.end();
    return;
  }

  var pool = getPool();
  if (!pool) {
    console.error("[portone-webhook] DB unavailable");
    res.statusCode = 503;
    res.end();
    return;
  }

  var confirmFields = extractConfirmFields(payload);
  if (confirmFields) {
    try {
      var confirmResult = await handleTransactionConfirm(pool, confirmFields);
      if (!confirmResult.ok) {
        res.statusCode = confirmResult.statusCode || 409;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            errorMessage: confirmResult.errorMessage || "결제를 승인할 수 없습니다.",
          }),
        );
        return;
      }
      res.statusCode = 200;
      res.end();
      return;
    } catch (e) {
      console.error("[portone-webhook] confirm handler error", e);
      res.statusCode = 500;
      res.end();
      return;
    }
  }

  var paymentId = extractPaymentId(payload);
  if (paymentId) {
    try {
      var lookup = await fetchPortonePayment(paymentId);
      if (!lookup.ok) {
        console.warn(
          "[portone-webhook] payment lookup failed",
          paymentId,
          lookup.error,
        );
        res.statusCode = 500;
        res.end();
        return;
      } else {
        console.log(
          "[portone-webhook] payment event",
          paymentId,
          "status:",
          lookup.data && lookup.data.status,
          "type:",
          payload.type || payload.status || "",
        );
        if (lookup.data && lookup.data.status === "PAID") {
          var commitResult = await commitPaidBooking(pool, {
            paymentId: paymentId,
            payment: lookup.data,
          });
          if (!commitResult.ok) {
            console.error(
              "[portone-webhook] paid commit failed",
              paymentId,
              commitResult.reason,
              commitResult.error || "",
            );
            if (
              commitResult.reason === "draft_missing" ||
              commitResult.reason === "insert_failed" ||
              commitResult.reason === "db_error" ||
              commitResult.reason === "payment_lookup_failed"
            ) {
              res.statusCode = 500;
              res.end();
              return;
            }
          }
        }
      }
    } catch (e) {
      console.error("[portone-webhook] payment sync error", e);
      res.statusCode = 500;
      res.end();
      return;
    }
  } else {
    console.log("[portone-webhook] received event without paymentId", payload.type || "");
  }

  res.statusCode = 200;
  res.end();
}
