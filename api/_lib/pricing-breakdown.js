var BREAKDOWN_VERSION = 1;

var NUMERIC_FIELDS = [
  "nights",
  "extraGuests",
  "weekdayNights",
  "weekendNights",
  "weekdaySubtotal",
  "weekendSubtotal",
  "weekdayRatePerNight",
  "weekendRatePerNight",
  "baseTotal",
  "extraGuestTotal",
  "grandTotal",
  "consecutiveSale",
  "promotionPercent",
  "promotionDiscount",
  "discountedGrandTotal",
];

function floorNonNeg(n) {
  var v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 0) {
    return 0;
  }
  return v;
}

function parseBreakdownObject(raw) {
  if (raw == null || raw === "") {
    return null;
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (_e) {
      return null;
    }
  }
  if (typeof raw === "object") {
    return raw;
  }
  return null;
}

/**
 * @param {unknown} raw
 * @returns {object|null}
 */
export function normalizePricingBreakdown(raw) {
  var obj = parseBreakdownObject(raw);
  if (!obj || typeof obj !== "object") {
    return null;
  }
  var version = Number(obj.version);
  if (version !== BREAKDOWN_VERSION) {
    return null;
  }
  var room = String(obj.room || "")
    .trim()
    .toUpperCase();
  if (!/^G[1-4]$/.test(room)) {
    return null;
  }
  var nights = floorNonNeg(obj.nights);
  if (nights < 1) {
    return null;
  }
  var out = {
    version: BREAKDOWN_VERSION,
    room: room,
    nights: nights,
    extraGuests: floorNonNeg(obj.extraGuests),
    weekdayNights: floorNonNeg(obj.weekdayNights),
    weekendNights: floorNonNeg(obj.weekendNights),
    weekdaySubtotal: floorNonNeg(obj.weekdaySubtotal),
    weekendSubtotal: floorNonNeg(obj.weekendSubtotal),
    weekdayRatePerNight: floorNonNeg(obj.weekdayRatePerNight),
    weekendRatePerNight: floorNonNeg(obj.weekendRatePerNight),
    baseTotal: floorNonNeg(obj.baseTotal),
    extraGuestTotal: floorNonNeg(obj.extraGuestTotal),
    grandTotal: floorNonNeg(obj.grandTotal),
    consecutiveSale: floorNonNeg(obj.consecutiveSale),
    promotionPercent: floorNonNeg(obj.promotionPercent),
    promotionDiscount: floorNonNeg(obj.promotionDiscount),
    discountedGrandTotal: floorNonNeg(obj.discountedGrandTotal),
  };
  if (out.weekdayNights + out.weekendNights !== out.nights) {
    return null;
  }
  if (out.discountedGrandTotal <= 0) {
    return null;
  }
  return out;
}

/**
 * @param {object|null|undefined} breakdown
 * @param {{
 *   roomType: string,
 *   stayNights: number,
 *   extraGuests: number,
 *   totalAmount: number,
 * }} ctx
 * @returns {{ ok: true, breakdown: object } | { ok: false, error: string } | { ok: true, breakdown: null }}
 */
export function validatePricingBreakdownForBooking(breakdown, ctx) {
  if (!breakdown) {
    return { ok: true, breakdown: null };
  }
  var roomType = String(ctx.roomType || "")
    .trim()
    .toUpperCase();
  var stayNights = floorNonNeg(ctx.stayNights);
  var extraGuests = floorNonNeg(ctx.extraGuests);
  var totalAmount = floorNonNeg(ctx.totalAmount);

  if (breakdown.room !== roomType) {
    return { ok: false, error: "pricingBreakdown room mismatch" };
  }
  if (breakdown.nights !== stayNights) {
    return { ok: false, error: "pricingBreakdown nights mismatch" };
  }
  if (breakdown.extraGuests !== extraGuests) {
    return { ok: false, error: "pricingBreakdown extraGuests mismatch" };
  }
  if (breakdown.discountedGrandTotal !== totalAmount) {
    return { ok: false, error: "pricingBreakdown total mismatch" };
  }
  return { ok: true, breakdown: breakdown };
}

/**
 * @param {unknown} dbValue
 * @returns {object|null}
 */
export function parsePricingBreakdownFromDb(dbValue) {
  return normalizePricingBreakdown(dbValue);
}

export function serializePricingBreakdown(breakdown) {
  if (!breakdown) {
    return null;
  }
  var out = { version: BREAKDOWN_VERSION, room: breakdown.room };
  NUMERIC_FIELDS.forEach(function (key) {
    out[key] = floorNonNeg(breakdown[key]);
  });
  return out;
}
