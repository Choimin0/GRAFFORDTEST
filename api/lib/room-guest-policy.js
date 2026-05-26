/** 객실별 기준 인원 · 추가 인원 정책 (서버 검증용) */
export const BASE_GUESTS = { G1: 2, G2: 2, G3: 3, G4: 4 };
export const MAX_EXTRA_GUESTS = { G1: 0, G2: 0, G3: 0, G4: 1 };

export function normalizeRoom(room) {
  var r = String(room || "G1").toUpperCase();
  return BASE_GUESTS.hasOwnProperty(r) ? r : "G1";
}

export function getBaseGuests(room) {
  room = normalizeRoom(room);
  return BASE_GUESTS[room];
}

export function getMaxExtraGuests(room) {
  room = normalizeRoom(room);
  return MAX_EXTRA_GUESTS[room];
}

export function getMaxGuests(room) {
  return getBaseGuests(room) + getMaxExtraGuests(room);
}

export function clampExtraGuests(room, n) {
  var max = getMaxExtraGuests(room);
  n = Number(n);
  if (!Number.isFinite(n) || n < 0) {
    n = 0;
  }
  if (n > max) {
    n = max;
  }
  return Math.floor(n);
}

export function computeGuestCount(room, extraGuests) {
  return getBaseGuests(room) + clampExtraGuests(room, extraGuests);
}
