export function getTodayYmdKst() {
  var parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  var map = {};
  parts.forEach(function (p) {
    if (p.type !== "literal") {
      map[p.type] = p.value;
    }
  });
  return (
    String(map.year || "") +
    "-" +
    String(map.month || "01") +
    "-" +
    String(map.day || "01")
  );
}

export function normalizePromotionDate(value) {
  var s = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

/** PostgreSQL DATE / ISO 문자열 / Date 객체 → YYYY-MM-DD */
export function formatPromotionDateFromDb(value) {
  if (value == null || value === "") {
    return "";
  }
  if (value instanceof Date && !isNaN(value.getTime())) {
    var y = value.getUTCFullYear();
    var m = String(value.getUTCMonth() + 1).padStart(2, "0");
    var d = String(value.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }
  var s = String(value).trim();
  var iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    return iso[1];
  }
  var parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    var py = parsed.getUTCFullYear();
    var pm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    var pd = String(parsed.getUTCDate()).padStart(2, "0");
    return py + "-" + pm + "-" + pd;
  }
  return "";
}

/** 기간 미설정 시 true (토글만으로 적용). 설정 시 inclusive. */
export function isPromotionInPeriod(todayYmd, startDate, endDate) {
  var start = normalizePromotionDate(startDate);
  var end = normalizePromotionDate(endDate);
  if (!start && !end) {
    return true;
  }
  if (!start || !end) {
    return false;
  }
  var today = normalizePromotionDate(todayYmd) || getTodayYmdKst();
  return today >= start && today <= end;
}
