/**
 * Grafford reservation pricing (평일 객실가, 금·토 박당 추가, 인원 추가 박당).
 * Exposes window.GraffordBookingPricing
 */
(function (root) {
  var ROOM_WEEKDAY_BASE = {
    G1: 200000,
    G2: 200000,
    G3: 300000,
    G4: 500000,
  };
  var EXTRA_PER_PERSON_PER_NIGHT = 30000;
  var WEEKEND_SURCHARGE_PER_NIGHT = 30000;
  var CONSECUTIVE_SALE_PER_NIGHT = 20000;
  /** 추가 투숙 가능 인원 (기준 인원 외) */
  var MAX_EXTRA_GUESTS = { G1: 0, G2: 0, G3: 2, G4: 4 };

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

  function clampExtra(room, n) {
    var max =
      MAX_EXTRA_GUESTS[room] !== undefined ? MAX_EXTRA_GUESTS[room] : 0;
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
    var baseTotal = 0;
    var weekendNights = 0;
    nightsArr.forEach(function (d) {
      baseTotal += baseNightly;
      if (isWeekendNight(d)) {
        weekendNights += 1;
      }
    });
    var weekendSurcharge = weekendNights * WEEKEND_SURCHARGE_PER_NIGHT;
    var extraGuestTotal =
      extraGuests * EXTRA_PER_PERSON_PER_NIGHT * nights;
    var grandTotal = baseTotal + weekendSurcharge + extraGuestTotal;
    var consecutiveSale =
      nights >= 2 ? (nights - 1) * CONSECUTIVE_SALE_PER_NIGHT : 0;
    var discountedGrandTotal = Math.max(0, grandTotal - consecutiveSale);

    return {
      room: room,
      nights: nights,
      extraGuests: extraGuests,
      baseNightly: baseNightly,
      baseTotal: baseTotal,
      weekendNights: weekendNights,
      weekendSurcharge: weekendSurcharge,
      extraGuestTotal: extraGuestTotal,
      grandTotal: grandTotal,
      consecutiveSale: consecutiveSale,
      discountedGrandTotal: discountedGrandTotal,
    };
  }

  root.GraffordBookingPricing = {
    ROOM_WEEKDAY_BASE: ROOM_WEEKDAY_BASE,
    MAX_EXTRA_GUESTS: MAX_EXTRA_GUESTS,
    EXTRA_PER_PERSON_PER_NIGHT: EXTRA_PER_PERSON_PER_NIGHT,
    WEEKEND_SURCHARGE_PER_NIGHT: WEEKEND_SURCHARGE_PER_NIGHT,
    CONSECUTIVE_SALE_PER_NIGHT: CONSECUTIVE_SALE_PER_NIGHT,
    parseYMD: parseYMD,
    countNights: countNights,
    eachNightDate: eachNightDate,
    isWeekendNight: isWeekendNight,
    clampExtra: clampExtra,
    computeStay: computeStay,
  };
})(typeof window !== "undefined" ? window : this);
