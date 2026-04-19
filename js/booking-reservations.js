/**
 * 테스트용 예약 저장소 (localStorage). 무통장입금 완료 시 기록, 예약조회에서 조회.
 */
(function (root) {
  var STORAGE_KEY = "grafford_reservations_v1";
  var MAX_RECORDS = 200;

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function generateOrderNumber() {
    var d = new Date();
    var ymd =
      d.getFullYear() +
      pad2(d.getMonth() + 1) +
      pad2(d.getDate());
    var rnd = Math.random().toString(36).substring(2, 8).toUpperCase();
    return ymd + "-" + rnd;
  }

  function normalizeName(s) {
    return String(s || "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function normalizeOrderNo(s) {
    var t = String(s || "")
      .trim()
      .replace(/\s+/g, "")
      .toUpperCase();
    if (t.startsWith("GRF-")) {
      t = t.slice(4);
    }
    return t;
  }

  function loadAll() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function save(record) {
    var arr = loadAll();
    arr.push(record);
    if (arr.length > MAX_RECORDS) {
      arr = arr.slice(-MAX_RECORDS);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    return record;
  }

  function findByNameAndOrder(name, orderNo) {
    var n = normalizeName(name);
    var o = normalizeOrderNo(orderNo);
    if (!n || !o) {
      return null;
    }
    var arr = loadAll();
    for (var i = arr.length - 1; i >= 0; i--) {
      var r = arr[i];
      if (
        normalizeName(r.guestName) === n &&
        normalizeOrderNo(r.orderNumber) === o
      ) {
        return r;
      }
    }
    return null;
  }

  root.GraffordReservations = {
    STORAGE_KEY: STORAGE_KEY,
    generateOrderNumber: generateOrderNumber,
    normalizeName: normalizeName,
    normalizeOrderNo: normalizeOrderNo,
    save: save,
    findByNameAndOrder: findByNameAndOrder,
    loadAll: loadAll,
  };
})(typeof window !== "undefined" ? window : this);
