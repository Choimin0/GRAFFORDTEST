/**
 * Grafford reservation pricing (평일 객실가, 금·토 박당 추가, 인원 추가 박당).
 * Exposes window.GraffordBookingPricing
 */
(function (root) {
  var ROOM_WEEKDAY_BASE = {
    G1: 250000,
    G2: 250000,
    G3: 300000,
    G4: 350000,
  };
  var EXTRA_PER_PERSON_PER_NIGHT = 30000;
  var WEEKEND_SURCHARGE_PER_NIGHT = 20000;   // 기본값 (DB에서 덮어씀)
  var CONSECUTIVE_SALE_PER_NIGHT = 20000;    // 기본값 (DB에서 덮어씀)
  var PROMOTION_PERCENT = 0;                  // 기본 프로모션 할인율 (%)
  /** 객실별 기준 인원 */
  var BASE_GUESTS = { G1: 2, G2: 2, G3: 3, G4: 4 };
  /** 추가 투숙 가능 인원 (기준 인원 외) */
  var MAX_EXTRA_GUESTS = { G1: 0, G2: 0, G3: 0, G4: 1 };

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

  function setCharges(charges) {
    if (!charges || typeof charges !== "object") {
      return;
    }
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
    var pr = Number(charges.promotion);
    if (Number.isFinite(pr) && pr >= 0 && pr <= 100) {
      PROMOTION_PERCENT = Math.floor(pr);
    }
    // 외부 코드에서 읽는 공개 상수도 동기화
    if (root && root.GraffordBookingPricing) {
      root.GraffordBookingPricing.WEEKEND_SURCHARGE_PER_NIGHT =
        WEEKEND_SURCHARGE_PER_NIGHT;
      root.GraffordBookingPricing.CONSECUTIVE_SALE_PER_NIGHT =
        CONSECUTIVE_SALE_PER_NIGHT;
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

  function parseYMD(str) {
    if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return null;
    }
    var p = str.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0, 0);
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
    nightsArr.forEach(function (d) {
      if (isWeekendNight(d)) {
        weekendNights += 1;
      } else {
        weekdayNights += 1;
      }
    });
    var weekendRatePerNight = baseNightly + WEEKEND_SURCHARGE_PER_NIGHT;
    var weekdaySubtotal = weekdayNights * baseNightly;
    var weekendSubtotal = weekendNights * weekendRatePerNight;
    var baseTotal = weekdaySubtotal + weekendSubtotal;
    var weekendSurcharge = weekendNights * WEEKEND_SURCHARGE_PER_NIGHT;
    var extraGuestTotal = extraGuests * EXTRA_PER_PERSON_PER_NIGHT * nights;
    var grandTotal = baseTotal + extraGuestTotal;
    var consecutiveSale =
      nights >= 2 ? (nights - 1) * CONSECUTIVE_SALE_PER_NIGHT : 0;
    // 프로모션: 평일 박요금 합(=전체 박 × 평일 단가) 기준 PROMOTION_PERCENT% — 기존 confirm과 동일
    var promotionBase = nights * baseNightly;
    var promotionDiscount = Math.floor(
      (promotionBase * PROMOTION_PERCENT) / 100,
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
      weekendSurcharge: weekendSurcharge,
      extraGuestTotal: extraGuestTotal,
      grandTotal: grandTotal,
      consecutiveSale: consecutiveSale,
      promotionDiscount: promotionDiscount,
      promotionPercent: PROMOTION_PERCENT,
      discountedGrandTotal: discountedGrandTotal,
    };
  }

  root.GraffordBookingPricing = {
    ROOM_WEEKDAY_BASE: ROOM_WEEKDAY_BASE,
    BASE_GUESTS: BASE_GUESTS,
    MAX_EXTRA_GUESTS: MAX_EXTRA_GUESTS,
    getBaseGuests: getBaseGuests,
    getMaxGuests: getMaxGuests,
    getMaxExtraGuests: getMaxExtraGuests,
    computeGuestCount: computeGuestCount,
    EXTRA_PER_PERSON_PER_NIGHT: EXTRA_PER_PERSON_PER_NIGHT,
    WEEKEND_SURCHARGE_PER_NIGHT: WEEKEND_SURCHARGE_PER_NIGHT,
    CONSECUTIVE_SALE_PER_NIGHT: CONSECUTIVE_SALE_PER_NIGHT,
    PROMOTION_PERCENT: PROMOTION_PERCENT,
    parseYMD: parseYMD,
    countNights: countNights,
    eachNightDate: eachNightDate,
    isWeekendNight: isWeekendNight,
    clampExtra: clampExtra,
    computeStay: computeStay,
    setRoomWeekdayBase: setRoomWeekdayBase,
    setCharges: setCharges,
  };
})(typeof window !== "undefined" ? window : this);
