import { sql } from "@vercel/postgres";

const ALLOWED_ROOMS = new Set(["A", "B", "C", "D"]);
const ALLOWED_PAY = new Set(["card", "naver", "bank"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NAME = 255;
const MAX_CONTACT = 120;
const MAX_RESV = 32;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(body));
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

  if (!process.env.POSTGRES_URL) {
    json(res, 503, {
      ok: false,
      error:
        "POSTGRES_URL is not configured. Connect Vercel Postgres in the project Storage tab.",
    });
    return;
  }

  var body;
  try {
    body = await readBody(req);
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

  try {
    var result = await sql`
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
        ${reservationNumber},
        ${guestName},
        ${contact},
        ${roomType},
        ${checkIn}::date,
        ${checkOut}::date,
        ${Math.floor(guestCount)},
        ${Math.floor(stayNights)},
        ${Math.floor(extraGuests)},
        ${Math.floor(totalAmount)},
        ${paymentMethod}
      )
      RETURNING id, reservation_number, created_at
    `;
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
    if (e && e.code === "42703") {
      json(res, 500, {
        ok: false,
        error:
          "Database schema missing columns. Run db/migrations/002_reservations_booking_columns.sql on your Postgres.",
      });
      return;
    }
    console.error("reservations insert", e);
    json(res, 500, { ok: false, error: "Database error" });
  }
}
