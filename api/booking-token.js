import pg from "pg";
import {
  issueBookingToken,
  verifyBookingToken,
  getHoldIdFromToken,
} from "./lib/booking-token.js";
import {
  bindBookingHoldReservation,
  releaseBookingHold,
  upsertBookingHold,
} from "./lib/booking-hold.js";
import {
  checkRoomAvailability,
  findConfirmedReservation,
} from "./lib/room-availability.js";

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

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  if (
    req.body != null &&
    typeof req.body === "object" &&
    !Buffer.isBuffer(req.body)
  ) {
    return req.body;
  }
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (c) {
      chunks.push(c);
    });
    req.on("end", function () {
      try {
        var raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
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
      error: "DB 연결 정보가 없습니다.",
    });
    return;
  }

  var body;
  try {
    body = await readJsonBody(req);
  } catch (_e) {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  var action = String(body.action || "").trim().toLowerCase();
  var room = String(body.room || "")
    .trim()
    .toUpperCase();
  var checkIn = String(body.checkIn || "").trim();
  var checkOut = String(body.checkOut || "").trim();
  var reservationNumber = String(body.reservationNumber || body.orderNo || "").trim();
  var bookingToken = String(body.bookingToken || "").trim();

  if (action === "issue") {
    if (!room || !checkIn || !checkOut) {
      json(res, 400, {
        ok: false,
        error: "room, checkIn, checkOut are required",
      });
      return;
    }
    var issued = issueBookingToken({
      room: room,
      checkIn: checkIn,
      checkOut: checkOut,
      reservationNumber: reservationNumber,
    });
    if (!issued || !issued.token) {
      json(res, 500, {
        ok: false,
        error: "booking token secret is not configured",
      });
      return;
    }
    try {
      await upsertBookingHold(pool, {
        holdId: issued.holdId,
        roomType: room,
        checkIn: checkIn,
        checkOut: checkOut,
        reservationNumber: reservationNumber,
        expiresAt: issued.expiresAt,
      });
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: e && e.message ? e.message : "Failed to create booking hold",
      });
      return;
    }
    json(res, 200, {
      ok: true,
      bookingToken: issued.token,
      expiresAt: issued.expiresAt,
      holdId: issued.holdId,
    });
    return;
  }

  if (action === "bind") {
    if (!bookingToken || !reservationNumber) {
      json(res, 400, {
        ok: false,
        error: "bookingToken and reservationNumber are required",
      });
      return;
    }
    var bindVerify = verifyBookingToken(bookingToken, {
      room: room,
      checkIn: checkIn,
      checkOut: checkOut,
    });
    if (!bindVerify.ok) {
      json(res, 401, {
        ok: false,
        error: bindVerify.error,
        tokenValid: false,
      });
      return;
    }
    var bindHoldId = getHoldIdFromToken(bookingToken);
    var bound = await bindBookingHoldReservation(
      pool,
      bindHoldId,
      reservationNumber,
    );
    if (!bound) {
      json(res, 404, {
        ok: false,
        error: "Active booking hold not found",
      });
      return;
    }
    json(res, 200, { ok: true, holdId: bindHoldId });
    return;
  }

  if (action === "release") {
    if (!bookingToken) {
      json(res, 400, {
        ok: false,
        error: "bookingToken is required",
      });
      return;
    }
    var releaseHoldId = getHoldIdFromToken(bookingToken);
    if (releaseHoldId) {
      await releaseBookingHold(pool, releaseHoldId);
    }
    json(res, 200, { ok: true, released: true });
    return;
  }

  if (action === "validate") {
    if (!bookingToken || !room || !checkIn || !checkOut) {
      json(res, 400, {
        ok: false,
        error: "bookingToken, room, checkIn, checkOut are required",
      });
      return;
    }

    var verify = verifyBookingToken(bookingToken, {
      room: room,
      checkIn: checkIn,
      checkOut: checkOut,
      reservationNumber: reservationNumber,
    });
    if (!verify.ok) {
      json(res, 401, {
        ok: false,
        error: verify.error,
        tokenValid: false,
        expired: verify.error === "booking_token_expired",
      });
      return;
    }

    if (reservationNumber) {
      var existing = await findConfirmedReservation(pool, reservationNumber);
      if (existing) {
        json(res, 200, {
          ok: true,
          tokenValid: true,
          available: true,
          alreadyBooked: true,
          reservationNumber: existing.reservationNumber,
        });
        return;
      }
    }

    var holdId = getHoldIdFromToken(bookingToken);
    var availability = await checkRoomAvailability(
      pool,
      room,
      checkIn,
      checkOut,
      reservationNumber,
      holdId,
    );
    if (!availability.available) {
      json(res, 409, {
        ok: false,
        tokenValid: true,
        available: false,
        unavailable: true,
        reason: availability.reason || "occupied",
        error: "해당 날짜에 예약이 불가합니다. 예약을 다시 확인해주세요",
      });
      return;
    }

    json(res, 200, {
      ok: true,
      tokenValid: true,
      available: true,
      expiresAt: verify.payload && verify.payload.exp ? verify.payload.exp : null,
    });
    return;
  }

  json(res, 400, { ok: false, error: "Invalid action" });
}
