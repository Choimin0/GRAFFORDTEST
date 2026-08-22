/**
 * POST /api/portone-webhook
 *
 * PortOne v2 결제 웹훅·컨펌(confirm) 수신.
 * - Transaction.Confirm: 결제 승인 직전 객실 가용 여부 확인 후 200 응답
 * - 기타 결제 상태 웹훅: PortOne API로 재검증 후 200 응답
 */
import crypto from "node:crypto";
import pg from "pg";
import { getBookingHoldByReservationNumber } from "./_lib/booking-hold.js";
import { checkRoomAvailability, findConfirmedReservation } from "./_lib/room-availability.js";
import { fetchPortonePayment } from "./_lib/portone-client.js";
import { commitPaidBooking } from "./_lib/commit-paid-booking.js";
import { getCheckoutDraftStay } from "./_lib/booking-checkout-draft.js";

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

function rowDateToYMD(v) {
  if (v == null || v === "") {
    return "";
  }
  if (typeof v === "string") {
    return v.slice(0, 10);
  }
  if (v instanceof Date && !isNaN(v.getTime())) {
    var y = v.getUTCFullYear();
    var m = String(v.getUTCMonth() + 1).padStart(2, "0");
    var day = String(v.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  return "";
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
  var paymentId = fields.paymentId;
  if (!paymentId) {
    return {
      ok: false,
      statusCode: 400,
      errorMessage: "paymentId가 없습니다.",
    };
  }

  var existing = await findConfirmedReservation(pool, paymentId);
  if (existing) {
    return { ok: true };
  }

  var hold = await getBookingHoldByReservationNumber(pool, paymentId, {
    skipCleanup: true,
  });
  var pending = hold ? null : await getCheckoutDraftStay(pool, paymentId);
  if (!hold && !pending) {
    console.warn("[portone-webhook] confirm rejected: hold not found", paymentId);
    return {
      ok: false,
      statusCode: 409,
      errorMessage:
        "예약 세션이 만료되었습니다. 예약 확인 페이지부터 다시 진행해 주세요.",
    };
  }

  var roomType = hold ? hold.room_type : pending.roomType;
  var checkIn = hold ? rowDateToYMD(hold.check_in_date) : pending.checkIn;
  var checkOut = hold ? rowDateToYMD(hold.check_out_date) : pending.checkOut;
  var availability = await checkRoomAvailability(
    pool,
    roomType,
    checkIn,
    checkOut,
    paymentId,
    hold ? hold.hold_id : "",
    { fast: true },
  );

  if (!availability.available) {
    console.warn(
      "[portone-webhook] confirm rejected: unavailable",
      paymentId,
      availability.reason,
    );
    return {
      ok: false,
      statusCode: 409,
      errorMessage:
        "선택하신 기간에 예약이 불가합니다. 다른 날짜 또는 객실을 선택해 주세요.",
    };
  }

  console.log(
    "[portone-webhook] confirm approved",
    paymentId,
    roomType,
    checkIn,
    checkOut,
    "amount:",
    fields.totalAmount,
  );
  return { ok: true };
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
