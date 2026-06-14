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

/** DB/저장 연락처가 대한민국(+82) 국제 형식인지 */
export function isKoreaStoredContact(contact) {
  return storedContactDialCode(contact) === "82";
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
