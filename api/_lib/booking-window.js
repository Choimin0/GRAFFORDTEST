const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Matches RESERVATION.html calendar — bookable check-in up to N months from today (KST). */
export const BOOKING_ADVANCE_MONTHS = 3;

/** Same-day check-in blocked at/after this hour (KST), matches frontend cutoff. */
const CHECKIN_SAME_DAY_CUTOFF_HOUR = 12;

function getKstNowInfo(now) {
  var ref = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
  var parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(ref);
  var map = {};
  parts.forEach(function (p) {
    if (p.type !== "literal") {
      map[p.type] = p.value;
    }
  });
  return {
    todayYmd:
      String(map.year || "") +
      "-" +
      String(map.month || "01") +
      "-" +
      String(map.day || "01"),
    hour: Number(map.hour || 0),
  };
}

function parseYmdParts(ymd) {
  var s = String(ymd || "");
  if (!DATE_RE.test(s)) {
    return null;
  }
  return {
    y: Number(s.slice(0, 4)),
    m: Number(s.slice(5, 7)),
    d: Number(s.slice(8, 10)),
  };
}

function daysInMonth(y, m1to12) {
  return new Date(y, m1to12, 0).getDate();
}

function addMonthsKeepingDayParts(parts, monthsToAdd) {
  var totalMonths = parts.y * 12 + (parts.m - 1) + monthsToAdd;
  var targetY = Math.floor(totalMonths / 12);
  var targetM = (totalMonths % 12) + 1;
  var targetD = Math.min(parts.d, daysInMonth(targetY, targetM));
  return { y: targetY, m: targetM, d: targetD };
}

function ymdPartsToString(parts) {
  return (
    String(parts.y).padStart(4, "0") +
    "-" +
    String(parts.m).padStart(2, "0") +
    "-" +
    String(parts.d).padStart(2, "0")
  );
}

function addDaysYmd(ymd, days) {
  var p = parseYmdParts(ymd);
  if (!p) {
    return "";
  }
  var dt = new Date(p.y, p.m - 1, p.d + Number(days || 0));
  return ymdPartsToString({
    y: dt.getFullYear(),
    m: dt.getMonth() + 1,
    d: dt.getDate(),
  });
}

export function getBookingWindowBounds(now) {
  var kst = getKstNowInfo(now);
  var todayParts = parseYmdParts(kst.todayYmd);
  if (!todayParts) {
    return {
      todayYmd: kst.todayYmd,
      earliestCheckInYmd: kst.todayYmd,
      maxCheckInYmd: kst.todayYmd,
      maxCheckOutYmd: addDaysYmd(kst.todayYmd, 1),
    };
  }
  var maxCheckInParts = addMonthsKeepingDayParts(
    todayParts,
    BOOKING_ADVANCE_MONTHS,
  );
  var maxCheckInYmd = ymdPartsToString(maxCheckInParts);
  var maxCheckOutYmd = addDaysYmd(maxCheckInYmd, 1);
  var earliestCheckInYmd =
    kst.hour >= CHECKIN_SAME_DAY_CUTOFF_HOUR
      ? addDaysYmd(kst.todayYmd, 1)
      : kst.todayYmd;
  return {
    todayYmd: kst.todayYmd,
    earliestCheckInYmd: earliestCheckInYmd,
    maxCheckInYmd: maxCheckInYmd,
    maxCheckOutYmd: maxCheckOutYmd,
  };
}

export function validateBookingWindow(checkIn, checkOut, now) {
  if (!DATE_RE.test(String(checkIn || "")) || !DATE_RE.test(String(checkOut || ""))) {
    return {
      ok: false,
      error: "Invalid checkIn or checkOut",
      code: "invalid_dates",
    };
  }
  if (checkIn >= checkOut) {
    return {
      ok: false,
      error: "checkOut must be after checkIn",
      code: "invalid_dates",
    };
  }

  var bounds = getBookingWindowBounds(now);

  if (checkIn < bounds.earliestCheckInYmd) {
    return {
      ok: false,
      error: "체크인 날짜가 예약 가능 기간을 벗어났습니다.",
      code: "check_in_too_early",
    };
  }
  if (checkIn > bounds.maxCheckInYmd) {
    return {
      ok: false,
      error:
        "체크인은 오늘부터 " +
        BOOKING_ADVANCE_MONTHS +
        "개월 이내로만 예약할 수 있습니다.",
      code: "check_in_too_late",
    };
  }
  if (checkOut > bounds.maxCheckOutYmd) {
    return {
      ok: false,
      error:
        "체크아웃 날짜가 예약 가능 기간(" +
        bounds.maxCheckOutYmd +
        "까지)을 벗어났습니다.",
      code: "check_out_too_late",
    };
  }

  return { ok: true, bounds: bounds };
}
