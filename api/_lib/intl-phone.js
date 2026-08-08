/**
 * 국제 연락처 저장 형식 검증 및 비교 (서버).
 * 저장 형식: +{국가번호} {국내 형식}
 */

const INTL_STORED_RE = /^\+\d{1,4}\s+\S/;

export function storedContactDialCode(contact) {
  var s = String(contact || "").trim();
  if (!s.startsWith("+")) {
    return null;
  }
  var m = s.slice(1).trim().match(/^(\d{1,4})/);
  return m ? m[1] : null;
}

/** DB/저장 연락처가 대한민국(+82) 국제 형식인지 (+852 등과 구분) */
export function isKoreaStoredContact(contact) {
  var s = String(contact || "").trim();
  return /^\+82(?:[\s-]|[1-9]|$)/.test(s);
}

/** DB/저장 연락처가 국제 형식(+국가번호)인지 (+82 제외) */
export function isInternationalStoredContact(contact) {
  var s = String(contact || "").trim();
  return s.startsWith("+") && !isKoreaStoredContact(s);
}

export function isValidInternationalStoredContact(contact) {
  var s = String(contact || "").trim();
  if (!INTL_STORED_RE.test(s)) {
    return false;
  }
  var digits = s.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

export function contactDigitsForMatch(contact) {
  return String(contact || "").replace(/\D/g, "");
}

export function contactsMatchIntl(storedContact, providedContact) {
  var a = contactDigitsForMatch(storedContact);
  var b = contactDigitsForMatch(providedContact);
  if (!a || !b) {
    return false;
  }
  return a === b;
}

/** 수기 예약 등록용: +82 → 010 국내 형식, 그 외 +국가번호는 그대로 */
export function normalizeManualReservationContact(contact) {
  var raw = String(contact || "").trim();
  if (!raw) {
    return "";
  }
  if (isKoreaStoredContact(raw)) {
    var national = contactDigitsForMatch(raw).replace(/^82/, "");
    if (!national) {
      return raw;
    }
    if (national.charAt(0) !== "0") {
      national = "0" + national;
    }
    return national;
  }
  if (raw.startsWith("+")) {
    return raw;
  }
  return raw;
}
