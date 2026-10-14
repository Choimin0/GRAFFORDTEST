/**
 * GET  /api/payment-confirm — PortOne 결제 UI 설정 (구 payment-config)
 * POST /api/payment-confirm — PortOne v2 결제 서버 사이드 검증 (+ 수동 승인)
 *
 * POST Body: {
 *   paymentId: string,
 *   expectedAmount: number,
 *   prepareIntegrity?: boolean, // 이니시스 금액·주문번호 해시 준비
 *   paymentToken?: string,  // 수동 승인 채널
 *   txId?: string
 * }
 */
import {
  confirmPortonePayment,
  extractPgTxIdFromPayment,
  extractPortoneFailureMessage,
  extractPortonePaidAmount,
  fetchPortonePayment,
  fetchPortonePaymentUntilPaid,
} from "./_lib/portone-client.js";
import { assertNoUntrustedInicisApprovalFetch } from "./_lib/inicis-idc-whitelist.js";
import {
  buildInicisIntegrityBypass,
  createInicisIntegrityPayload,
  formatInicisDecimalAmount,
} from "./_lib/inicis-integrity.js";
import { getCheckoutDraft } from "./_lib/booking-checkout-draft.js";
import {
  extractPaymentMethodFromPortonePayment,
  normalizePaymentMethodId,
  resolveEnabledPaymentMethods,
  resolveVerifiedPaymentMethod,
} from "./_lib/payment-methods.js";
import { fetchKrwPerUsd } from "./_lib/fx-krw-usd.js";
import pg from "pg";
import {
  buildReserveCompleteView,
  commitPaidBooking,
  findBookingByNumber,
} from "./_lib/commit-paid-booking.js";

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

async function resolveLockedKrwAmount(paymentId, clientExpected, options) {
  options = options || {};
  var requireDraft = options.requireDraft !== false;
  var amountText = formatInicisDecimalAmount(clientExpected);
  var pool = getPool();
  if (!pool) {
    if (!amountText) {
      return { ok: false, error: "결제금액이 올바르지 않습니다." };
    }
    return { ok: true, amount: Number(amountText), source: "client" };
  }
  try {
    var draft = await getCheckoutDraft(pool, paymentId, { allowExpired: true });
    var storedAmount =
      draft && draft.totalAmount != null ? draft.totalAmount : null;
    if (storedAmount == null) {
      var booked = await findBookingByNumber(pool, paymentId);
      if (booked && booked.total_amount != null) {
        storedAmount = booked.total_amount;
      }
    }
    if (storedAmount == null) {
      if (requireDraft || !amountText) {
        return {
          ok: false,
          error:
            "서버에 저장된 결제금액이 없습니다. 결제 페이지부터 다시 진행해 주세요.",
        };
      }
      return { ok: true, amount: Number(amountText), source: "client" };
    }
    var lockedText = formatInicisDecimalAmount(storedAmount);
    if (!lockedText) {
      return { ok: false, error: "저장된 결제금액이 올바르지 않습니다." };
    }
    var locked = Number(lockedText);
    if (amountText && Number(amountText) !== locked) {
      return {
        ok: false,
        error: "결제 금액이 서버에 저장된 금액과 일치하지 않습니다.",
        expected: locked,
        actual: Number(amountText),
      };
    }
    return { ok: true, amount: locked, source: "draft" };
  } catch (e) {
    console.error("[payment-confirm] draft amount lookup", paymentId, e);
    return {
      ok: false,
      error: "결제금액 확인 중 오류가 발생했습니다.",
    };
  }
}

function normalizeUsdActualToExpected(actualAmount, expectedAmount) {
  if (actualAmount == null || expectedAmount == null) {
    return actualAmount;
  }
  var actual = Number(actualAmount);
  var expected = Number(expectedAmount);
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return actualAmount;
  }
  if (actual === expected) {
    return actual;
  }
  var actualAsCents = Math.round(actual * 100);
  if (actualAsCents === expected) {
    return actualAsCents;
  }
  return actual;
}

async function sendPaymentConfig(res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  var storeId = process.env.STORE_ID || "";
  var channelKey = process.env.CHANNEL_KEY || "";
  var paypalChannelKey = String(process.env.PAYPAL_CHANNEL_KEY || "").trim();
  var impCode = String(
    process.env.PORTONE_IMP_CODE ||
      process.env.IMP_CODE ||
      process.env.PORTONE_USER_CODE ||
      "",
  ).trim();

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

  var krwPerUsd = await fetchKrwPerUsd();

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      storeId: storeId,
      channelKey: channelKey,
      paypalChannelKey: paypalChannelKey || null,
      impCode: impCode || null,
      krwPerUsd: krwPerUsd,
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
    await sendPaymentConfig(res);
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

  if (body.prepareIntegrity === true || body.prepareIntegrity === "true") {
    var prepared = await resolveLockedKrwAmount(paymentId, expectedAmount, {
      requireDraft: true,
    });
    if (!prepared.ok) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          ok: false,
          error: prepared.error,
          expected: prepared.expected,
          actual: prepared.actual,
        }),
      );
      return;
    }
    var integrity = createInicisIntegrityPayload({
      oid: paymentId,
      amount: prepared.amount,
    });
    if (!integrity.ok) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: integrity.error }));
      return;
    }
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        ok: true,
        paymentId: paymentId,
        amount: integrity.amount,
        amountText: integrity.amountText,
        signed: integrity.signed,
        bypass: buildInicisIntegrityBypass({}, integrity),
      }),
    );
    return;
  }

  var inicisUrlGuard = assertNoUntrustedInicisApprovalFetch(body);
  if (!inicisUrlGuard.ok) {
    res.statusCode = 400;
    res.end(
      JSON.stringify({
        ok: false,
        error:
          inicisUrlGuard.error ||
          "이니시스 승인 URL 화이트리스트 검증에 실패했습니다.",
      }),
    );
    return;
  }

  if (body.statusOnly === true || body.statusOnly === "true") {
    var statusLookup = await fetchPortonePayment(paymentId);
    if (!statusLookup.ok) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          ok: false,
          error: statusLookup.error,
          status: statusLookup.status || null,
        }),
      );
      return;
    }
    var statusPayment = statusLookup.data || {};
    var statusFailure = extractPortoneFailureMessage(statusPayment);
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        ok: statusPayment.status === "PAID",
        status: statusPayment.status || null,
        error:
          statusPayment.status === "PAID"
            ? null
            : statusFailure ||
              "결제가 완료되지 않았습니다. (status: " +
                (statusPayment.status || "UNKNOWN") +
                ")",
        failureReason: statusFailure || null,
      }),
    );
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

    var requestedMethodId = normalizePaymentMethodId(requestedPaymentMethod);
    var paymentLookup = await fetchPortonePaymentUntilPaid(paymentId, {
      maxAttempts: requestedMethodId === "paypal" ? 30 : 15,
      delayMs: 1000,
    });
    if (!paymentLookup.ok) {
      console.error(
        "[payment-confirm] PortOne API error",
        paymentId,
        paymentLookup.error,
        paymentLookup.status || "",
      );
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          ok: false,
          error: paymentLookup.error,
          status: paymentLookup.status || null,
          detail: paymentLookup.detail || null,
          timedOut: !!paymentLookup.timedOut,
        }),
      );
      return;
    }

    var payment = paymentLookup.data;

    if (payment.status !== "PAID") {
      var failureReason = extractPortoneFailureMessage(payment);
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          ok: false,
          error:
            failureReason ||
            "결제가 완료되지 않았습니다. (status: " + payment.status + ")",
          status: payment.status,
          failureReason: failureReason || null,
        }),
      );
      return;
    }

    var actualAmount = extractPortonePaidAmount(payment);
    var paidCurrency = String(payment.currency || "")
      .toUpperCase()
      .replace(/^CURRENCY_/, "");
    if (paidCurrency === "USD" || requestedMethodId === "paypal") {
      actualAmount = normalizeUsdActualToExpected(actualAmount, expectedAmount);
    } else {
      var lockedKrw = await resolveLockedKrwAmount(paymentId, expectedAmount, {
        requireDraft: false,
      });
      if (!lockedKrw.ok) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            ok: false,
            error: lockedKrw.error || "결제 금액이 일치하지 않습니다.",
            expected: lockedKrw.expected,
            actual: lockedKrw.actual,
          }),
        );
        return;
      }
      expectedAmount = lockedKrw.amount;
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

    var reservationCommitted = false;
    var reservation = null;
    var pool = getPool();
    if (pool) {
      try {
        var commitResult = await commitPaidBooking(pool, {
          paymentId: paymentId,
          payment: payment,
        });
        reservationCommitted = !!(commitResult && commitResult.ok);
        if (commitResult && commitResult.reservation) {
          reservation = commitResult.reservation;
        }
        if (!commitResult.ok) {
          console.error(
            "[payment-confirm] paid commit failed",
            paymentId,
            commitResult.reason,
            commitResult.error || "",
          );
        }
      } catch (commitErr) {
        console.error("[payment-confirm] paid commit error", paymentId, commitErr);
      }
      if (!reservation) {
        try {
          var booked = await findBookingByNumber(pool, paymentId);
          if (
            booked &&
            (booked.status === "confirm" || booked.status === "completed")
          ) {
            reservation = buildReserveCompleteView(booked);
          }
        } catch (lookupErr) {
          console.error(
            "[payment-confirm] reservation lookup error",
            paymentId,
            lookupErr,
          );
        }
      }
    }

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        ok: true,
        paymentId: payment.id,
        status: payment.status,
        pgTid: pgTid,
        paymentMethod: verifiedMethod.methodId,
        pgPayProvider: verifiedMethod.pgPayProvider,
        reservationCommitted: reservationCommitted,
        reservation: reservation,
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
