/**
 * 예약 채널(kr/en) 및 알림톡 발송 여부 판별.
 */

export function normalizeBookingLocale(raw) {
  var v = String(raw || "")
    .trim()
    .toLowerCase();
  return v === "en" ? "en" : "kr";
}

/** DB/저장 연락처가 국제 형식(+국가번호)인지 */
export function isInternationalStoredContact(contact) {
  return String(contact || "").trim().startsWith("+");
}

/**
 * 카카오 알림톡 발송 대상 여부.
 * 영문 예약(booking_locale=en) 또는 + 접두 국제 연락처는 제외.
 */
export function shouldSendAlimtalk(bookingLocale, contact) {
  if (normalizeBookingLocale(bookingLocale) === "en") {
    return false;
  }
  if (isInternationalStoredContact(contact)) {
    return false;
  }
  return true;
}
