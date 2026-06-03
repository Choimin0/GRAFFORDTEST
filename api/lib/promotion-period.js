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
