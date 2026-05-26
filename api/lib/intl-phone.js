/**
 * 국제 연락처 저장 형식 검증 및 비교 (서버).
 * 저장 형식: +{국가번호} {국내 형식}
 */

const INTL_STORED_RE = /^\+\d{1,4}\s+\S/;

export function isInternationalStoredContact(contact) {
  return String(contact || "").trim().startsWith("+");
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
