/**
 * Grafford reservation pricing (평일 객실가, 금·토 박당 추가, 인원 추가 박당).
 * Exposes window.GraffordBookingPricing
 */
(function (root) {
  var ROOM_WEEKDAY_BASE = {
    G1: 280000,
    G2: 280000,
    G3: 320000,
    G4: 410000,
  };
  var ROOM_WEEKEND_BASE = {
    G1: 280000,
    G2: 280000,
    G3: 320000,
    G4: 410000,
  };
  var EXTRA_PER_PERSON_PER_NIGHT = 30000;
  var WEEKEND_SURCHARGE_PER_NIGHT = 20000;   // 기본값 (DB에서 덮어씀)
  // API 로드 전 기본은 OFF — ON이면 금·토에 +추가요금이 붙으므로 안전하게 시작
  var WEEKEND_SURCHARGE_ENABLED = false;
  var CONSECUTIVE_SALE_PER_NIGHT = 20000;    // 기본값 (DB에서 덮어씀)
  // API 로드 전 기본은 OFF — ON이면 2박 이상 연박할인이 적용되므로 안전하게 시작
  var CONSECUTIVE_SALE_ENABLED = false;
  var PROMOTION_PERCENT = 0;                  // 기본 프로모션 할인율 (%)
  var PROMOTION_ENABLED = false;
  var PROMOTION_PERIOD_START = "";
  var PROMOTION_PERIOD_END = "";
  var PROMOTION_STAY_PERIOD_START = "";
  var PROMOTION_STAY_PERIOD_END = "";
  var PROMOTION_LEGACY_IN_PERIOD = true;
  /** 기간별 요금 옵션 (겹치면 createdAt 최신 우선) */
  var SEASONAL_RATES = [];
  /** 객실별 기준 인원 */
  var BASE_GUESTS = { G1: 2, G2: 2, G3: 2, G4: 4 };
  /** 추가 투숙 가능 인원 (기준 인원 외) */
  var MAX_EXTRA_GUESTS = { G1: 0, G2: 0, G3: 1, G4: 1 };

  function setRoomWeekdayBase(nextMap) {
    if (!nextMap || typeof nextMap !== "object") {
      return;
    }
    ["G1", "G2", "G3", "G4"].forEach(function (room) {
      var n = Number(nextMap[room]);
      if (Number.isFinite(n) && n >= 0) {
        ROOM_WEEKDAY_BASE[room] = Math.floor(n);
      }
    });
  }

  function setRoomWeekendBase(nextMap) {
    if (!nextMap || typeof nextMap !== "object") {
      return;
    }
    ["G1", "G2", "G3", "G4"].forEach(function (room) {
      var n = Number(nextMap[room]);
      if (Number.isFinite(n) && n >= 0) {
        ROOM_WEEKEND_BASE[room] = Math.floor(n);
      }
    });
  }

  function setCharges(charges, opts) {
    if (!charges || typeof charges !== "object") {
      return;
    }
    opts = opts || {};
    WEEKEND_SURCHARGE_ENABLED = opts.weekendChargeEnabled !== false;
    CONSECUTIVE_SALE_ENABLED = opts.consecutiveSaleEnabled !== false;
    var wc = Number(
      charges.weekendCharge !== undefined
        ? charges.weekendCharge
        : charges["weekend-charge"],
    );
    if (Number.isFinite(wc) && wc >= 0) {
      WEEKEND_SURCHARGE_PER_NIGHT = Math.floor(wc);
    }
    var cs = Number(
      charges.consecutiveSale !== undefined
        ? charges.consecutiveSale
        : charges["consecutive-sale"],
    );
    if (Number.isFinite(cs) && cs >= 0) {
      CONSECUTIVE_SALE_PER_NIGHT = Math.floor(cs);
    }
    PROMOTION_ENABLED = opts.promotionEnabled === true;
    var pr = Number(charges.promotion);
    if (
      PROMOTION_ENABLED &&
      Number.isFinite(pr) &&
      pr >= 0 &&
      pr <= 100
    ) {
      PROMOTION_PERCENT = Math.floor(pr);
    } else {
      PROMOTION_PERCENT = 0;
    }
    var period = opts.promotionPeriod;
    var bookingPeriod = opts.promotionBookingPeriod || period;
    if (bookingPeriod && typeof bookingPeriod === "object") {
      PROMOTION_PERIOD_START = normalizePromotionYmd(bookingPeriod.startDate);
      PROMOTION_PERIOD_END = normalizePromotionYmd(bookingPeriod.endDate);
    }
    var stayPeriod = opts.promotionStayPeriod;
    if (stayPeriod && typeof stayPeriod === "object") {
      PROMOTION_STAY_PERIOD_START = normalizePromotionYmd(stayPeriod.startDate);
      PROMOTION_STAY_PERIOD_END = normalizePromotionYmd(stayPeriod.endDate);
    } else {
      PROMOTION_STAY_PERIOD_START = "";
      PROMOTION_STAY_PERIOD_END = "";
    }
    PROMOTION_LEGACY_IN_PERIOD = opts.promotionInPeriod !== false;
    // 외부 코드에서 읽는 공개 상수도 동기화
    if (root && root.GraffordBookingPricing) {
      root.GraffordBookingPricing.WEEKEND_SURCHARGE_PER_NIGHT =
        WEEKEND_SURCHARGE_PER_NIGHT;
      root.GraffordBookingPricing.WEEKEND_SURCHARGE_ENABLED =
        WEEKEND_SURCHARGE_ENABLED;
      root.GraffordBookingPricing.CONSECUTIVE_SALE_PER_NIGHT =
        CONSECUTIVE_SALE_PER_NIGHT;
      root.GraffordBookingPricing.CONSECUTIVE_SALE_ENABLED =
        CONSECUTIVE_SALE_ENABLED;
      root.GraffordBookingPricing.PROMOTION_PERCENT = PROMOTION_PERCENT;
    }
    var eg = Number(
      charges.extraGuestCharge !== undefined
        ? charges.extraGuestCharge
        : charges["extra-guest-charge"],
    );
    if (Number.isFinite(eg) && eg >= 0) {
      EXTRA_PER_PERSON_PER_NIGHT = Math.floor(eg);
    }
    if (root && root.GraffordBookingPricing) {
      root.GraffordBookingPricing.EXTRA_PER_PERSON_PER_NIGHT =
        EXTRA_PER_PERSON_PER_NIGHT;
    }
  }

  function setSeasonalRates(nextList) {
    if (!Array.isArray(nextList)) {
      SEASONAL_RATES = [];
      return;
    }
    SEASONAL_RATES = nextList
      .map(function (row) {
        return {
          id: Number(row.id || 0),
          roomName: String(row.roomName || row.room_name || "")
            .trim()
            .toUpperCase(),
          startDate: normalizePromotionYmd(row.startDate || row.start_date),
          endDate: normalizePromotionYmd(row.endDate || row.end_date),
          weekdayBaseRate: Math.floor(Number(row.weekdayBaseRate || row.weekday_base_rate || 0)),
          weekendBaseRate: Math.floor(Number(row.weekendBaseRate || row.weekend_base_rate || 0)),
          optionName: String(row.optionName || row.seasonal_option_name || "").trim(),
          createdAt: String(row.createdAt || row.created_at || ""),
          updatedAt: String(row.updatedAt || row.updated_at || ""),
        };
      })
      .filter(function (row) {
        return (
          /^G[1-4]$/.test(row.roomName) &&
          row.startDate &&
          row.endDate &&
          row.weekdayBaseRate >= 0 &&
          row.weekendBaseRate >= 0
        );
      });
  }

  function findSeasonalRateForNight(room, d) {
    var ymd = ymdFromDate(d);
    var matches = SEASONAL_RATES.filter(function (row) {
      return (
        row.roomName === room &&
        row.startDate <= ymd &&
        ymd <= row.endDate
      );
    });
    if (!matches.length) {
      return null;
    }
    matches.sort(function (a, b) {
      var ua = String(a.updatedAt || a.createdAt || "");
      var ub = String(b.updatedAt || b.createdAt || "");
      if (ua !== ub) {
        return ub.localeCompare(ua);
      }
      return Number(b.id || 0) - Number(a.id || 0);
    });
    return matches[0];
  }

  function getEffectiveRatesForNight(room, d) {
    room = String(room || "G1").toUpperCase();
    var seasonal = findSeasonalRateForNight(room, d);
    if (seasonal) {
      var weekday = seasonal.weekdayBaseRate;
      var weekend = seasonal.weekendBaseRate;
      if (WEEKEND_SURCHARGE_ENABLED) {
        weekend = weekday + WEEKEND_SURCHARGE_PER_NIGHT;
      }
      return {
        weekday: weekday,
        weekend: weekend,
        source: "seasonal",
        optionName: seasonal.optionName || "",
      };
    }
    var weekday = ROOM_WEEKDAY_BASE.hasOwnProperty(room)
      ? ROOM_WEEKDAY_BASE[room]
      : ROOM_WEEKDAY_BASE.G1;
    return {
      weekday: weekday,
      weekend: getWeekendRatePerNight(room),
      source: "base",
    };
  }

  function getEffectiveRatesForDate(room, ymd) {
    var d = parseYMD(ymd);
    if (!d) {
      return null;
    }
    return getEffectiveRatesForNight(room, d);
  }
  function parseYMD(str) {
    if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return null;
    }
    var p = str.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0, 0);
  }

  function normalizePromotionYmd(value) {
    var s = String(value || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  }

  function ymdFromDate(d) {
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  /** 투숙 박(check-in ~ check-out 전날)이 프로모션 기간과 겹치면 true. 기간 미설정 시 true. */
  function isStayInPromotionPeriod(checkInStr, checkOutStr, startDate, endDate) {
    var start = normalizePromotionYmd(startDate);
    var end = normalizePromotionYmd(endDate);
    if (!start && !end) {
      return true;
    }
    if (!start || !end) {
      return false;
    }
    var ci = normalizePromotionYmd(checkInStr);
    var co = normalizePromotionYmd(checkOutStr);
    if (!ci || !co || co <= ci) {
      return false;
    }
    var checkout = parseYMD(co);
    if (!checkout) {
      return false;
    }
    checkout.setDate(checkout.getDate() - 1);
    var lastNight = ymdFromDate(checkout);
    return ci <= end && lastNight >= start;
  }

  function isPromotionActiveForStay(checkInStr, checkOutStr) {
    if (!PROMOTION_ENABLED || PROMOTION_PERCENT <= 0) {
      return false;
    }
    var hasBooking = !!(PROMOTION_PERIOD_START || PROMOTION_PERIOD_END);
    var hasStay = !!(
      PROMOTION_STAY_PERIOD_START || PROMOTION_STAY_PERIOD_END
    );

    if (hasBooking && hasStay) {
      if (!PROMOTION_LEGACY_IN_PERIOD) {
        return false;
      }
      return isStayInPromotionPeriod(
        checkInStr,
        checkOutStr,
        PROMOTION_STAY_PERIOD_START,
        PROMOTION_STAY_PERIOD_END,
      );
    }
    if (hasBooking && !hasStay) {
      return isStayInPromotionPeriod(
        checkInStr,
        checkOutStr,
        PROMOTION_PERIOD_START,
        PROMOTION_PERIOD_END,
      );
    }
    if (!hasBooking && hasStay) {
      return isStayInPromotionPeriod(
        checkInStr,
        checkOutStr,
        PROMOTION_STAY_PERIOD_START,
        PROMOTION_STAY_PERIOD_END,
      );
    }
    return true;
  }

  /** 체크인 날짜부터 체크아웃 전날까지 각 박의 Date 목록 */
  function eachNightDate(checkInStr, checkOutStr) {
    var list = [];
    var a = parseYMD(checkInStr);
    var b = parseYMD(checkOutStr);
    if (!a || !b) {
      return list;
    }
    if (b.getTime() <= a.getTime()) {
      return list;
    }
    var cur = new Date(a.getTime());
    while (cur < b) {
      list.push(new Date(cur.getTime()));
      cur.setDate(cur.getDate() + 1);
    }
    return list;
  }

  function countNights(checkInStr, checkOutStr) {
    return eachNightDate(checkInStr, checkOutStr).length;
  }

  /** 금·토 박 (로컬 요일 5, 6) */
  function isWeekendNight(d) {
    var day = d.getDay();
    return day === 5 || day === 6;
  }

  function getBaseGuests(room) {
    room = String(room || "G1").toUpperCase();
    return BASE_GUESTS.hasOwnProperty(room) ? BASE_GUESTS[room] : 2;
  }

  function getMaxGuests(room) {
    return getBaseGuests(room) + clampExtra(room, getMaxExtraGuests(room));
  }

  function getMaxExtraGuests(room) {
    room = String(room || "G1").toUpperCase();
    return MAX_EXTRA_GUESTS.hasOwnProperty(room) ? MAX_EXTRA_GUESTS[room] : 0;
  }

  function computeGuestCount(room, extraGuests) {
    return getBaseGuests(room) + clampExtra(room, extraGuests);
  }

  function clampExtra(room, n) {
    var max = getMaxExtraGuests(room);
    n = Number(n);
    if (isNaN(n) || n < 0) {
      n = 0;
    }
    if (n > max) {
      n = max;
    }
    return n;
  }

  function getWeekendRatePerNight(room) {
    room = String(room || "G1").toUpperCase();
    var baseNightly = ROOM_WEEKDAY_BASE.hasOwnProperty(room)
      ? ROOM_WEEKDAY_BASE[room]
      : ROOM_WEEKDAY_BASE.G1;
    if (WEEKEND_SURCHARGE_ENABLED) {
      return baseNightly + WEEKEND_SURCHARGE_PER_NIGHT;
    }
    if (ROOM_WEEKEND_BASE.hasOwnProperty(room)) {
      return ROOM_WEEKEND_BASE[room];
    }
    return baseNightly;
  }

  /**
   * @param {string} room G1–G4
   * @param {string} checkInStr YYYY-MM-DD
   * @param {string} checkOutStr YYYY-MM-DD
   * @param {number} extraGuests 추가 인원 수 (박당 3만원)
   */
  function computeStay(room, checkInStr, checkOutStr, extraGuests) {
    room = String(room || "G1").toUpperCase();
    if (!ROOM_WEEKDAY_BASE.hasOwnProperty(room)) {
      room = "G1";
    }
    var nightsArr = eachNightDate(checkInStr, checkOutStr);
    var nights = nightsArr.length;
    extraGuests = clampExtra(room, extraGuests);

    if (!nights) {
      return {
        room: room,
        nights: 0,
        extraGuests: extraGuests,
        baseNightly: ROOM_WEEKDAY_BASE[room],
        baseTotal: 0,
        weekendNights: 0,
        weekendSurcharge: 0,
        extraGuestTotal: 0,
        grandTotal: 0,
      };
    }

    var baseNightly = ROOM_WEEKDAY_BASE[room];
    var weekdayNights = 0;
    var weekendNights = 0;
    var weekdaySubtotal = 0;
    var weekendSubtotal = 0;
    var weekendSurcharge = 0;
    nightsArr.forEach(function (d) {
      var effective = getEffectiveRatesForNight(room, d);
      if (isWeekendNight(d)) {
        weekendNights += 1;
        weekendSubtotal += effective.weekend;
        weekendSurcharge += effective.weekend - effective.weekday;
      } else {
        weekdayNights += 1;
        weekdaySubtotal += effective.weekday;
      }
    });
    var baseTotal = weekdaySubtotal + weekendSubtotal;
    var weekendRatePerNight =
      weekendNights > 0
        ? Math.floor(weekendSubtotal / weekendNights)
        : getWeekendRatePerNight(room);
    var weekdayRatePerNight =
      weekdayNights > 0
        ? Math.floor(weekdaySubtotal / weekdayNights)
        : baseNightly;
    var extraGuestTotal = extraGuests * EXTRA_PER_PERSON_PER_NIGHT * nights;
    var grandTotal = baseTotal + extraGuestTotal;
    var consecutiveSale =
      CONSECUTIVE_SALE_ENABLED && nights >= 2
        ? (nights - 1) * CONSECUTIVE_SALE_PER_NIGHT
        : 0;
    // 프로모션: 객실 박요금 합(주중·주말) 기준 % — 투숙일이 프로모션 기간과 겹칠 때만
    var effectivePromoPercent = isPromotionActiveForStay(checkInStr, checkOutStr)
      ? PROMOTION_PERCENT
      : 0;
    var promotionDiscount = Math.floor(
      (baseTotal * effectivePromoPercent) / 100,
    );
    var discountedGrandTotal = Math.max(0, grandTotal - consecutiveSale - promotionDiscount);

    return {
      room: room,
      nights: nights,
      extraGuests: extraGuests,
      baseNightly: baseNightly,
      baseTotal: baseTotal,
      weekdayNights: weekdayNights,
      weekendNights: weekendNights,
      weekdaySubtotal: weekdaySubtotal,
      weekendSubtotal: weekendSubtotal,
      weekendRatePerNight: weekendRatePerNight,
      weekdayRatePerNight: weekdayRatePerNight,
      weekendSurcharge: weekendSurcharge,
      extraGuestTotal: extraGuestTotal,
      grandTotal: grandTotal,
      consecutiveSale: consecutiveSale,
      promotionDiscount: promotionDiscount,
      promotionPercent: effectivePromoPercent,
      discountedGrandTotal: discountedGrandTotal,
    };
  }

  root.GraffordBookingPricing = {
    ROOM_WEEKDAY_BASE: ROOM_WEEKDAY_BASE,
    ROOM_WEEKEND_BASE: ROOM_WEEKEND_BASE,
    BASE_GUESTS: BASE_GUESTS,
    MAX_EXTRA_GUESTS: MAX_EXTRA_GUESTS,
    getBaseGuests: getBaseGuests,
    getMaxGuests: getMaxGuests,
    getMaxExtraGuests: getMaxExtraGuests,
    computeGuestCount: computeGuestCount,
    EXTRA_PER_PERSON_PER_NIGHT: EXTRA_PER_PERSON_PER_NIGHT,
    WEEKEND_SURCHARGE_PER_NIGHT: WEEKEND_SURCHARGE_PER_NIGHT,
    WEEKEND_SURCHARGE_ENABLED: WEEKEND_SURCHARGE_ENABLED,
    CONSECUTIVE_SALE_PER_NIGHT: CONSECUTIVE_SALE_PER_NIGHT,
    CONSECUTIVE_SALE_ENABLED: CONSECUTIVE_SALE_ENABLED,
    PROMOTION_PERCENT: PROMOTION_PERCENT,
    parseYMD: parseYMD,
    countNights: countNights,
    eachNightDate: eachNightDate,
    isWeekendNight: isWeekendNight,
    getWeekendRatePerNight: getWeekendRatePerNight,
    clampExtra: clampExtra,
    computeStay: computeStay,
    isStayInPromotionPeriod: isStayInPromotionPeriod,
    isPromotionActiveForStay: isPromotionActiveForStay,
    setRoomWeekdayBase: setRoomWeekdayBase,
    setRoomWeekendBase: setRoomWeekendBase,
    setSeasonalRates: setSeasonalRates,
    getEffectiveRatesForDate: getEffectiveRatesForDate,
    getEffectiveRatesForNight: getEffectiveRatesForNight,
    setCharges: setCharges,
  };
})(typeof window !== "undefined" ? window : this);
