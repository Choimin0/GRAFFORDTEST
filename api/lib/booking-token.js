import crypto from "node:crypto";

const DEFAULT_BOOKING_TOKEN_TTL_MS = 15 * 60 * 1000;

function getDatabaseUrlFallback() {
  return String(
    process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL ||
      "",
  ).trim();
}

export function getBookingTokenSecret() {
  return String(
    process.env.BOOKING_TOKEN_SECRET ||
      process.env.RESERVATION_CANCEL_TOKEN_SECRET ||
      process.env.CANCEL_TOKEN_SECRET ||
      getDatabaseUrlFallback() ||
      "",
  ).trim();
}

export function getBookingTokenTtlMs() {
  var raw = String(
    process.env.BOOKING_TOKEN_TTL_MINUTES ||
      process.env.RESERVATION_BOOKING_TOKEN_TTL_MINUTES ||
      "",
  ).trim();
  if (!raw) {
    return DEFAULT_BOOKING_TOKEN_TTL_MS;
  }
  var mins = Number(raw);
  if (!Number.isFinite(mins) || mins <= 0) {
    return DEFAULT_BOOKING_TOKEN_TTL_MS;
  }
  mins = Math.min(15, mins);
  return Math.floor(mins * 60 * 1000);
}

function b64urlEncode(s) {
  return Buffer.from(s, "utf8").toString("base64url");
}

function b64urlDecode(s) {
  return Buffer.from(String(s || ""), "base64url").toString("utf8");
}

function normalizeReservationNumber(raw) {
  var t = String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
  if (t.startsWith("GRF-")) {
    t = t.slice(4);
  }
  return t;
}

export function parseBookingTokenPayload(token) {
  var parts = String(token || "").split(".");
  if (parts.length !== 2) {
    return null;
  }
  try {
    return JSON.parse(b64urlDecode(parts[0]));
  } catch (_e) {
    return null;
  }
}

export function getHoldIdFromToken(token) {
  var payload = parseBookingTokenPayload(token);
  return payload && payload.nonce ? String(payload.nonce) : "";
}

export function issueBookingToken(payload) {
  var secret = getBookingTokenSecret();
  if (!secret) {
    return null;
  }
  var payloadObj = {
    room: String(payload.room || "")
      .trim()
      .toUpperCase(),
    checkIn: String(payload.checkIn || "").trim(),
    checkOut: String(payload.checkOut || "").trim(),
    reservationNumber: normalizeReservationNumber(payload.reservationNumber || ""),
    exp: Date.now() + getBookingTokenTtlMs(),
    nonce: crypto.randomBytes(12).toString("hex"),
  };
  var encoded = b64urlEncode(JSON.stringify(payloadObj));
  var sig = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return {
    token: encoded + "." + sig,
    expiresAt: payloadObj.exp,
    holdId: payloadObj.nonce,
  };
}

export function verifyBookingToken(token, expected) {
  var secret = getBookingTokenSecret();
  if (!secret) {
    return { ok: false, error: "booking_token_secret_missing" };
  }
  var parts = String(token || "").split(".");
  if (parts.length !== 2) {
    return { ok: false, error: "invalid_booking_token" };
  }
  var encoded = parts[0];
  var sig = parts[1];
  var expectedSig = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  if (sig !== expectedSig) {
    return { ok: false, error: "invalid_booking_token_signature" };
  }
  var obj;
  try {
    obj = JSON.parse(b64urlDecode(encoded));
  } catch (_e) {
    return { ok: false, error: "invalid_booking_token_payload" };
  }
  if (!obj || !obj.exp || Date.now() > Number(obj.exp)) {
    return { ok: false, error: "booking_token_expired" };
  }
  var room = String(expected.room || "")
    .trim()
    .toUpperCase();
  if (String(obj.room || "").toUpperCase() !== room) {
    return { ok: false, error: "booking_token_room_mismatch" };
  }
  if (String(obj.checkIn || "") !== String(expected.checkIn || "")) {
    return { ok: false, error: "booking_token_checkin_mismatch" };
  }
  if (String(obj.checkOut || "") !== String(expected.checkOut || "")) {
    return { ok: false, error: "booking_token_checkout_mismatch" };
  }
  var expectedOrder = normalizeReservationNumber(expected.reservationNumber || "");
  var tokenOrder = normalizeReservationNumber(obj.reservationNumber || "");
  if (expectedOrder && tokenOrder && expectedOrder !== tokenOrder) {
    return { ok: false, error: "booking_token_order_mismatch" };
  }
  return { ok: true, payload: obj };
}
