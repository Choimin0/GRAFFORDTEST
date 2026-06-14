/**
 * 예약 채널(kr/en) 및 알림톡 발송 여부 판별.
 */

import {
  isInternationalStoredContact,
  isKoreaStoredContact,
} from "./intl-phone.js";

export function normalizeBookingLocale(raw) {
  var v = String(raw || "")
    .trim()
    .toLowerCase();
  return v === "en" ? "en" : "kr";
}

/**
 * 연락처 국가번호를 반영한 실제 예약 채널.
 * +82는 국문(kr), 그 외 + 접두는 영문(en), 나머지는 booking_locale 사용.
 */
export function resolveEffectiveBookingLocale(bookingLocale, contact) {
  if (isKoreaStoredContact(contact)) {
    return "kr";
  }
  if (isInternationalStoredContact(contact)) {
    return "en";
  }
  return normalizeBookingLocale(bookingLocale);
}

/**
 * 카카오 알림톡 발송 대상 여부.
 * 영문 예약(booking_locale=en) 또는 + 접두 국제 연락처(+82 제외)는 제외.
 */
export function shouldSendAlimtalk(bookingLocale, contact) {
  return resolveEffectiveBookingLocale(bookingLocale, contact) !== "en";
}
