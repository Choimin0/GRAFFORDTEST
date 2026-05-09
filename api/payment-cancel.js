/**
 * POST /api/payment-cancel
 *
 * 결제 취소 + 예약 삭제를 원자적으로 처리합니다.
 *
 * 1. cancelToken 검증
 * 2. DB에서 예약 조회 (pg_tid, total_amount 포함)
 * 3. pg_tid가 있으면 PortOne v2 결제 취소 API 호출
 *    - paymentId = reservationNumber (결제 시 사용한 PortOne paymentId)
 *    - refundAmount < totalAmount 이면 부분 취소, 같으면 전액 취소
 * 4. 성공 시 DB에서 예약 삭제 (delete_reservations 테이블로 이동)
 *
 * Body: { reservationNumber, guestName, cancelToken, cancelReason, refundAmount }
 * Response: { ok: true, pgCancelled, pgTid, cancelledAt } | { error }
 */
import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;

const ACTIVE_TABLE = "reservations";
const PAST_TABLE = "past_reservations";
const DELETED_TABLE = "delete_reservations";
const DEFAULT_CANCEL_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_CANCEL_REASON = 1000;

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
  var dbUrl = getDatabaseUrl();
  if (!dbUrl) return null;
  if (!poolSingleton) {
    poolSingleton = new Pool({
      connectionString: dbUrl,
      max: 1,
      connectionTimeoutMillis: 20000,
      idleTimeoutMillis: 15000,
    });
  }
  return poolSingleton;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(body));
}

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

function normalizeLookupName(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLookupOrder(s) {
  var t = String(s || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
  if (t.startsWith("GRF-")) t = t.slice(4);
  return t;
}

function getCancelTokenSecret() {
  return String(
    process.env.RESERVATION_CANCEL_TOKEN_SECRET ||
      process.env.CANCEL_TOKEN_SECRET ||
      getDatabaseUrl() ||
      "",
  ).trim();
}

function getCancelTokenTtlMs() {
  var raw = String(
    process.env.RESERVATION_CANCEL_TOKEN_TTL_MINUTES ||
      process.env.CANCEL_TOKEN_TTL_MINUTES ||
      "",
  ).trim();
  if (!raw) return DEFAULT_CANCEL_TOKEN_TTL_MS;
  var mins = Number(raw);
  if (!Number.isFinite(mins) || mins <= 0) return DEFAULT_CANCEL_TOKEN_TTL_MS;
  return Math.floor(Math.min(1440, mins) * 60 * 1000);
}

function b64urlDecode(s) {
  return Buffer.from(String(s || ""), "base64url").toString("utf8");
}

function verifyCancelToken(token, reservationNumber, guestName) {
  var secret = getCancelTokenSecret();
  if (!secret) {
    return { ok: false, error: "토큰 검증 키가 설정되어 있지 않습니다." };
  }
  var parts = String(token || "").split(".");
  if (parts.length !== 2) {
    return { ok: false, error: "유효하지 않은 취소 토큰입니다." };
  }
  var payload = parts[0];
  var sig = parts[1];
  var expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  if (sig !== expected) {
    return { ok: false, error: "취소 토큰 서명이 유효하지 않습니다." };
  }
  var obj;
  try {
    obj = JSON.parse(b64urlDecode(payload));
  } catch (e) {
    return { ok: false, error: "취소 토큰 형식이 올바르지 않습니다." };
  }
  if (!obj || !obj.exp || Date.now() > Number(obj.exp)) {
    return { ok: false, error: "취소 토큰이 만료되었습니다." };
  }
  if (String(obj.reservationNumber || "") !== String(reservationNumber || "")) {
    return { ok: false, error: "취소 토큰과 예약번호가 일치하지 않습니다." };
  }
  if (normalizeLookupName(obj.guestName) !== normalizeLookupName(guestName)) {
    return { ok: false, error: "취소 토큰과 예약자명이 일치하지 않습니다." };
  }
  return { ok: true };
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () {
      try {
        var raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

async function getJsonBody(req) {
  if (req.body != null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  return readBody(req);
}

/**
 * PortOne v2 결제 취소 요청.
 * paymentId = reservationNumber (결제 시 portone.requestPayment({ paymentId: orderNo }) 에 사용한 값).
 * refundAmount < totalAmount 이면 부분 취소(amount + currentCancellableAmount 지정),
 * 같으면 전액 취소(amount 없이 호출).
 * refundAmount === 0 인 경우(100% 취소 수수료)는 호출하지 않아야 합니다 — 호출 전 확인 필요.
 */
async function requestPortoneCancellation(paymentId, cancelReason, refundAmount, totalAmount) {
  var apiSecret = (process.env.PORTONE_API_SECRET || "").trim();
  if (!apiSecret) {
    return { ok: false, error: "PORTONE_API_SECRET 환경변수가 설정되지 않았습니다." };
  }

  var isPartial =
    Number.isFinite(refundAmount) &&
    Number.isFinite(totalAmount) &&
    refundAmount > 0 &&
    refundAmount < totalAmount;

  var cancelBody = { reason: cancelReason || "고객 요청 취소" };

  if (isPartial) {
    // 부분 취소: 환불할 금액(amount)과 현재 취소 가능 잔액(currentCancellableAmount) 모두 지정
    // currentCancellableAmount는 검증용 — 첫 취소이므로 totalAmount와 동일
    cancelBody.amount = refundAmount;
    cancelBody.currentCancellableAmount = totalAmount;
  }
  // 전액 취소: amount 없이 호출 → PortOne이 전액 환불 처리

  var cancelUrl =
    "https://api.portone.io/payments/" + encodeURIComponent(paymentId) + "/cancel";

  console.log(
    "[payment-cancel] PortOne 취소 요청 →",
    cancelUrl,
    "| paymentId:", paymentId,
    "| 부분취소:", isPartial,
    "| body:", JSON.stringify(cancelBody),
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
    try { resData = await portoneRes.json(); } catch (_) {}

    console.log(
      "[payment-cancel] PortOne 취소 응답 HTTP", portoneRes.status,
      "| body:", JSON.stringify(resData),
    );

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
      error: "PortOne API 호출 중 네트워크 오류: " + (e && e.message ? e.message : String(e)),
    };
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  var pool = getPool();
  if (!pool) {
    json(res, 503, {
      ok: false,
      error: "DB 연결 정보가 없습니다. .env.local 에 POSTGRES_URL 등을 설정하세요.",
    });
    return;
  }

  var body;
  try {
    body = await getJsonBody(req);
  } catch (e) {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  var reservationNumber = normalizeLookupOrder(body.reservationNumber || body.orderNo || "");
  var guestName = normalizeLookupName(body.guestName || body.name || "");
  var cancelToken = String(body.cancelToken || "").trim();
  var cancelReason = String(body.cancelReason || "")
    .trim()
    .slice(0, MAX_CANCEL_REASON);
  var refundAmount = body.refundAmount != null ? Number(body.refundAmount) : null;

  if (!reservationNumber) {
    json(res, 400, { ok: false, error: "reservationNumber가 필요합니다." });
    return;
  }
  if (!guestName) {
    json(res, 400, { ok: false, error: "guestName이 필요합니다." });
    return;
  }
  if (!cancelToken) {
    json(res, 400, { ok: false, error: "cancelToken이 필요합니다." });
    return;
  }

  // cancelToken 검증
  var tokenVerify = verifyCancelToken(cancelToken, reservationNumber, guestName);
  if (!tokenVerify.ok) {
    json(res, 401, { ok: false, error: tokenVerify.error });
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
    // 예약 조회 — pg_tid 포함
    var sel = await client.query(
      `SELECT *, 'active' AS _source FROM ${ACTIVE_TABLE} WHERE reservation_number = $1
       UNION ALL
       SELECT *, 'past' AS _source FROM ${PAST_TABLE} WHERE reservation_number = $1
       LIMIT 1`,
      [reservationNumber],
    );

    if (!sel.rows || !sel.rows.length) {
      client.release();
      json(res, 404, { ok: false, error: "예약을 찾을 수 없습니다." });
      return;
    }

    var row = sel.rows[0];
    if (normalizeLookupName(row.guest_name) !== guestName) {
      client.release();
      json(res, 404, { ok: false, error: "예약을 찾을 수 없습니다." });
      return;
    }

    // refunded_count가 0이 아니면 이미 취소(환불) 처리된 예약
    var refundedCount = row.refunded_count != null ? Number(row.refunded_count) : 0;
    if (refundedCount !== 0) {
      client.release();
      json(res, 409, {
        ok: false,
        error: "이미 취소(환불) 처리된 예약입니다. 중복 취소는 불가합니다.",
      });
      return;
    }

    var pgTid = row.pg_tid ? String(row.pg_tid).trim() : null;
    var totalAmount = row.total_amount != null ? Number(row.total_amount) : null;
    var source = String(row._source || "active");
    // payment_method: "bank" / "무통장입금" 이면 PG 취소 불필요; 그 외(card 등)는 PortOne 취소
    var paymentMethodDb = String(row.payment_method || "").toLowerCase().trim();
    var isBankTransfer =
      paymentMethodDb === "bank" ||
      paymentMethodDb === "무통장입금" ||
      paymentMethodDb === "bank_transfer";

    // refundAmount 유효성 체크: totalAmount 초과 불가
    var safeRefundAmount = refundAmount;
    if (
      Number.isFinite(safeRefundAmount) &&
      Number.isFinite(totalAmount) &&
      safeRefundAmount > totalAmount
    ) {
      safeRefundAmount = totalAmount;
    }
    if (!Number.isFinite(safeRefundAmount) || safeRefundAmount < 0) {
      safeRefundAmount = totalAmount;
    }

    console.log(
      "[payment-cancel] 예약번호:", reservationNumber,
      "| pg_tid:", pgTid,
      "| payment_method(DB):", paymentMethodDb,
      "| isBankTransfer:", isBankTransfer,
      "| totalAmount:", totalAmount,
      "| safeRefundAmount:", safeRefundAmount,
    );

    var pgCancelled = false;
    var pgError = null;

    // 카드/PG 결제(무통장입금 제외)이고 환불액이 0보다 클 때 PortOne v2 결제 취소 요청.
    // safeRefundAmount === 0 이면 100% 취소 수수료 적용 → 환불 없음, PG 취소 API 호출 불필요.
    // pg_tid 유무에 관계없이 payment_method 기준으로 판단 (pg_tid가 누락될 수 있으므로).
    if (!isBankTransfer && safeRefundAmount > 0) {
      var portoneResult = await requestPortoneCancellation(
        reservationNumber, // PortOne paymentId = 결제 시 사용한 orderNo (= reservationNumber)
        cancelReason || "고객 요청 취소",
        safeRefundAmount,
        totalAmount,
      );
      if (!portoneResult.ok) {
        // PortOne에 해당 결제가 없는 경우(404/payment not found)는 DB 취소만 진행
        var portoneErrStr = portoneResult.error || "";
        var portoneDetail = portoneResult.detail || {};
        var isNotFound =
          (portoneDetail.type && portoneDetail.type === "PAYMENT_NOT_FOUND") ||
          portoneErrStr.includes("PAYMENT_NOT_FOUND") ||
          portoneErrStr.includes("404");
        if (isNotFound) {
          console.warn(
            "[payment-cancel] PortOne에서 결제건을 찾을 수 없음(PAYMENT_NOT_FOUND) → DB 취소만 진행.",
            "reservationNumber:", reservationNumber,
          );
          pgCancelled = false;
          pgError = portoneResult.error;
        } else {
          client.release();
          json(res, 502, {
            ok: false,
            error:
              "결제 취소에 실패했습니다. 고객센터로 문의해 주세요.\n" + portoneResult.error,
            pgError: portoneResult.error,
          });
          return;
        }
      } else {
        pgCancelled = true;
      }
    }

    // DB에서 예약 삭제 후 delete_reservations로 이동
    try {
      await client.query("BEGIN");

      var sourceTable = source === "past" ? PAST_TABLE : ACTIVE_TABLE;
      var delResult = await client.query(
        `DELETE FROM ${sourceTable}
         WHERE reservation_number = $1 AND guest_name = $2
         RETURNING *`,
        [reservationNumber, row.guest_name],
      );

      // active에 없으면 past에서도 시도
      if ((!delResult.rows || !delResult.rows.length) && source !== "past") {
        delResult = await client.query(
          `DELETE FROM ${PAST_TABLE}
           WHERE reservation_number = $1 AND guest_name = $2
           RETURNING *`,
          [reservationNumber, row.guest_name],
        );
      }

      if (!delResult.rows || !delResult.rows.length) {
        await client.query("ROLLBACK");
        client.release();
        json(res, 404, { ok: false, error: "삭제할 예약을 찾을 수 없습니다." });
        return;
      }

      var deletedRow = delResult.rows[0];

      await client.query(
        `INSERT INTO ${DELETED_TABLE} (
          reservation_number,
          guest_name,
          contact,
          email,
          room_type,
          check_in_date,
          check_out_date,
          guest_count,
          created_at,
          stay_nights,
          extra_guests,
          total_amount,
          payment_method,
          guest_request,
          bank_confirmed,
          pg_tid,
          cancel_reason,
          refunded_count,
          refund_amount
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        ) ON CONFLICT (reservation_number) DO NOTHING`,
        [
          deletedRow.reservation_number,
          deletedRow.guest_name,
          deletedRow.contact,
          deletedRow.email || null,
          deletedRow.room_type,
          deletedRow.check_in_date,
          deletedRow.check_out_date,
          deletedRow.guest_count,
          deletedRow.created_at,
          deletedRow.stay_nights,
          deletedRow.extra_guests,
          deletedRow.total_amount,
          deletedRow.payment_method,
          deletedRow.guest_request,
          deletedRow.bank_confirmed,
          deletedRow.pg_tid || null,
          cancelReason || null,
          1,                // 취소 완료: refunded_count = 1
          safeRefundAmount, // 실제 환불 처리된 금액 (0이면 환불 없음)
        ],
      );

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

    json(res, 200, {
      ok: true,
      pgCancelled: pgCancelled,
      pgTid: pgTid,
      cancelledAt: formatDateTimeKst(new Date()),
      reservationNumber: reservationNumber,
      refundAmount: safeRefundAmount,    // 실제 환불 처리된 금액
      totalAmount: totalAmount,          // 원래 결제 금액
      isPartialRefund: pgCancelled && Number.isFinite(safeRefundAmount) && Number.isFinite(totalAmount) && safeRefundAmount > 0 && safeRefundAmount < totalAmount,
    });
  } catch (e) {
    try { client.release(); } catch (_) {}
    console.error("payment-cancel handler", e);
    json(res, 500, {
      ok: false,
      error: "처리 중 서버 오류가 발생했습니다: " + (e && e.message ? e.message : String(e)),
    });
  }
}
