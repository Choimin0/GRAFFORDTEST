import { parse as parseUrl } from "node:url";
import pg from "pg";

const { Pool } = pg;

const ALLOWED_ROOMS = new Set(["A", "B", "C", "D"]);
const ALLOWED_PAY = new Set(["card", "naver", "bank"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME = 255;
const MAX_CONTACT = 120;
const MAX_RESV = 32;

/** Neon/Vercel에서 오는 URL 이름이 달라도 사용 (TCP — Neon's HTTP 404 회피) */
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

function humanDbError(e) {
  if (!e) {
    return "Database error";
  }
  var c = e.code;
  if (c === "42703") {
    return "DB에 필요한 컬럼이 없습니다. db/migrations/002_reservations_booking_columns.sql 을 실행하세요.";
  }
  if (c === "42P01") {
    return "reservations 테이블이 없습니다. db/migrations/001_create_reservations.sql 을 실행하세요.";
  }
  if (c === "23505") {
    return "Duplicate reservation number";
  }
  var msg = String(e.message || e.toString() || "");
  if (/resource-not-found|HTTP status 404/i.test(msg)) {
    return "Neon HTTP 드라이버 오류(404)입니다. 지금은 TCP(pg)로 연결합니다. 그래도 실패하면 Neon 대시보드에서 연결 문자열을 다시 복사하세요.";
  }
  if (/password authentication failed|Tenant or user not found/i.test(msg)) {
    return "DB 인증에 실패했습니다. 연결 문자열(비밀번호)이 최신인지 확인하세요.";
  }
  if (/ENOTFOUND|ECONNREFUSED|getaddrinfo|ECONNRESET|timeout/i.test(msg)) {
    return "DB 서버에 연결할 수 없습니다. 네트워크와 연결 문자열을 확인하세요.";
  }
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(body));
}

function normalizeLookupName(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLookupOrder(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function toYMD(v) {
  if (v == null || v === "") {
    return "";
  }
  if (typeof v === "string") {
    return v.slice(0, 10);
  }
  var d = new Date(v);
  if (isNaN(d.getTime())) {
    return "";
  }
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, "0");
  var day = String(d.getUTCDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (c) {
      chunks.push(c);
    });
    req.on("end", function () {
      try {
        var raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) {
          resolve({});
          return;
        }
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function getJsonBody(req) {
  if (
    req.body != null &&
    typeof req.body === "object" &&
    !Buffer.isBuffer(req.body)
  ) {
    return req.body;
  }
  return readBody(req);
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

  var pool = getPool();
  if (!pool) {
    json(res, 503, {
      ok: false,
      error:
        "DB 연결 정보가 없습니다. .env.local 에 POSTGRES_URL 등을 넣은 뒤 vercel dev 를 다시 실행하세요.",
    });
    return;
  }

  if (req.method === "GET") {
    var parsed = parseUrl(req.url || "", true);
    var q = parsed.query || {};
    var guestParam = String(q.guestName || q.name || "").trim();
    var orderParam = String(
      q.reservationNumber || q.orderNo || q.number || "",
    ).trim();
    var normName = normalizeLookupName(guestParam);
    var normOrder = normalizeLookupOrder(orderParam);
    if (!normName || !normOrder) {
      json(res, 400, {
        ok: false,
        error: "guestName 과 reservationNumber(또는 orderNo) 쿼리가 필요합니다.",
      });
      return;
    }
    try {
      var sel = await pool.query(
        `SELECT
          id,
          reservation_number,
          guest_name,
          contact,
          room_type,
          check_in_date,
          check_out_date,
          guest_count,
          stay_nights,
          extra_guests,
          total_amount,
          payment_method,
          created_at
        FROM reservations
        WHERE reservation_number = $1`,
        [normOrder],
      );
      if (!sel.rows || !sel.rows.length) {
        json(res, 404, { ok: false, error: "Not found" });
        return;
      }
      var dbRow = sel.rows[0];
      if (normalizeLookupName(dbRow.guest_name) !== normName) {
        json(res, 404, { ok: false, error: "Not found" });
        return;
      }
      json(res, 200, {
        ok: true,
        source: "database",
        row: {
          id: dbRow.id,
          reservationNumber: dbRow.reservation_number,
          guestName: dbRow.guest_name,
          contact: dbRow.contact,
          roomType: dbRow.room_type,
          checkIn: toYMD(dbRow.check_in_date),
          checkOut: toYMD(dbRow.check_out_date),
          guestCount: dbRow.guest_count,
          stayNights:
            dbRow.stay_nights != null ? Number(dbRow.stay_nights) : null,
          extraGuests:
            dbRow.extra_guests != null ? Number(dbRow.extra_guests) : null,
          totalAmount:
            dbRow.total_amount != null ? Number(dbRow.total_amount) : null,
          paymentMethod: dbRow.payment_method || null,
          createdAt: dbRow.created_at,
        },
      });
    } catch (e) {
      if (e && e.code === "42703") {
        try {
          var selBasic = await pool.query(
            `SELECT
              id,
              reservation_number,
              guest_name,
              contact,
              room_type,
              check_in_date,
              check_out_date,
              guest_count,
              created_at
            FROM reservations
            WHERE reservation_number = $1`,
            [normOrder],
          );
          if (!selBasic.rows || !selBasic.rows.length) {
            json(res, 404, { ok: false, error: "Not found" });
            return;
          }
          var br = selBasic.rows[0];
          if (normalizeLookupName(br.guest_name) !== normName) {
            json(res, 404, { ok: false, error: "Not found" });
            return;
          }
          json(res, 200, {
            ok: true,
            source: "database",
            row: {
              id: br.id,
              reservationNumber: br.reservation_number,
              guestName: br.guest_name,
              contact: br.contact,
              roomType: br.room_type,
              checkIn: toYMD(br.check_in_date),
              checkOut: toYMD(br.check_out_date),
              guestCount: br.guest_count,
              stayNights: null,
              extraGuests: null,
              totalAmount: null,
              paymentMethod: null,
              createdAt: br.created_at,
            },
            warning:
              "일부 컬럼이 DB에 없습니다. db/migrations/002_reservations_booking_columns.sql 을 실행하세요.",
          });
        } catch (e2) {
          console.error("reservations lookup fallback", e2);
          json(res, 500, {
            ok: false,
            error: humanDbError(e2),
            code: e2.code || null,
          });
        }
        return;
      }
      console.error("reservations lookup", e);
      json(res, 500, {
        ok: false,
        error: humanDbError(e),
        code: e.code || null,
      });
    }
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  var body;
  try {
    body = await getJsonBody(req);
  } catch (e) {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  var reservationNumber = String(body.reservationNumber || "").trim();
  var guestName = String(body.guestName || "").trim();
  var contact = String(body.contact || "").trim();
  var roomType = String(body.roomType || "").trim().toUpperCase();
  var checkIn = String(body.checkIn || "").trim();
  var checkOut = String(body.checkOut || "").trim();
  var stayNights = Number(body.stayNights);
  var extraGuests = Number(body.extraGuests);
  var totalAmount = Number(body.totalAmount);
  var paymentMethod = String(body.paymentMethod || "").trim().toLowerCase();
  var guestCount = Number(body.guestCount);

  if (!reservationNumber || reservationNumber.length > MAX_RESV) {
    json(res, 400, { ok: false, error: "Invalid reservationNumber" });
    return;
  }
  if (!guestName || guestName.length > MAX_NAME) {
    json(res, 400, { ok: false, error: "Invalid guestName" });
    return;
  }
  if (!contact || contact.length > MAX_CONTACT) {
    json(res, 400, { ok: false, error: "Invalid contact" });
    return;
  }
  if (!ALLOWED_ROOMS.has(roomType)) {
    json(res, 400, { ok: false, error: "Invalid roomType" });
    return;
  }
  if (!DATE_RE.test(checkIn) || !DATE_RE.test(checkOut)) {
    json(res, 400, { ok: false, error: "Invalid checkIn or checkOut" });
    return;
  }
  if (!Number.isFinite(stayNights) || stayNights < 1 || stayNights > 365) {
    json(res, 400, { ok: false, error: "Invalid stayNights" });
    return;
  }
  if (!Number.isFinite(extraGuests) || extraGuests < 0 || extraGuests > 20) {
    json(res, 400, { ok: false, error: "Invalid extraGuests" });
    return;
  }
  if (!Number.isFinite(totalAmount) || totalAmount < 0 || totalAmount > 1e12) {
    json(res, 400, { ok: false, error: "Invalid totalAmount" });
    return;
  }
  if (!ALLOWED_PAY.has(paymentMethod)) {
    json(res, 400, { ok: false, error: "Invalid paymentMethod" });
    return;
  }
  if (!Number.isFinite(guestCount) || guestCount < 1 || guestCount > 50) {
    guestCount = Math.min(50, Math.max(1, 2 + (extraGuests | 0)));
  }

  var gc = Math.floor(guestCount);
  var sn = Math.floor(stayNights);
  var eg = Math.floor(extraGuests);
  var ta = Math.floor(totalAmount);

  var insertSql = `
    INSERT INTO reservations (
      reservation_number,
      guest_name,
      contact,
      room_type,
      check_in_date,
      check_out_date,
      guest_count,
      stay_nights,
      extra_guests,
      total_amount,
      payment_method
    ) VALUES (
      $1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11
    )
    RETURNING id, reservation_number, created_at
  `;

  var params = [
    reservationNumber,
    guestName,
    contact,
    roomType,
    checkIn,
    checkOut,
    gc,
    sn,
    eg,
    ta,
    paymentMethod,
  ];

  try {
    var result = await pool.query(insertSql, params);
    var row = result && result.rows && result.rows[0];
    if (!row) {
      json(res, 500, { ok: false, error: "Insert did not return a row" });
      return;
    }
    json(res, 201, {
      ok: true,
      id: row.id,
      reservationNumber: row.reservation_number,
      createdAt: row.created_at,
    });
  } catch (e) {
    if (e && e.code === "23505") {
      json(res, 409, { ok: false, error: "Duplicate reservation number" });
      return;
    }
    console.error("reservations insert", e);
    json(res, 500, {
      ok: false,
      error: humanDbError(e),
      code: e.code || null,
    });
  }
}
