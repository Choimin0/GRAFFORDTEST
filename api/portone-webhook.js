/**
 * POST /api/portone-webhook
 *
 * PortOne v2 결제 웹훅·컨펌(confirm) 수신.
 * - Transaction.Confirm: 결제 승인 직전 객실 가용 여부 확인 후 200 응답
 * - 기타 결제 상태 웹훅: PortOne API로 재검증 후 200 응답
 */
import pg from "pg";
import { getBookingHoldByReservationNumber } from "./_lib/booking-hold.js";
import { checkRoomAvailability, findConfirmedReservation } from "./_lib/room-availability.js";
import { fetchPortonePayment } from "./_lib/portone-client.js";

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

function extractConfirmFields(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (payload.type === "Transaction.Confirm" && payload.data) {
    return {
      paymentId: String(payload.data.paymentId || "").trim(),
      transactionId: String(payload.data.transactionId || "").trim(),
      totalAmount:
        payload.data.totalAmount != null
          ? Number(payload.data.totalAmount)
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

async function handleTransactionConfirm(pool, fields) {
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

  var hold = await getBookingHoldByReservationNumber(pool, paymentId);
  if (!hold) {
    console.warn("[portone-webhook] confirm rejected: hold not found", paymentId);
    return {
      ok: false,
      statusCode: 409,
      errorMessage:
        "예약 세션이 만료되었습니다. 예약 확인 페이지부터 다시 진행해 주세요.",
    };
  }

  var checkIn = rowDateToYMD(hold.check_in_date);
  var checkOut = rowDateToYMD(hold.check_out_date);
  var availability = await checkRoomAvailability(
    pool,
    hold.room_type,
    checkIn,
    checkOut,
    paymentId,
    hold.hold_id,
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
    hold.room_type,
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
      } else {
        console.log(
          "[portone-webhook] payment event",
          paymentId,
          "status:",
          lookup.data && lookup.data.status,
          "type:",
          payload.type || payload.status || "",
        );
      }
    } catch (e) {
      console.error("[portone-webhook] payment sync error", e);
    }
  } else {
    console.log("[portone-webhook] received event without paymentId", payload.type || "");
  }

  res.statusCode = 200;
  res.end();
}
