/**
 * 예약(booking) 데이터 5년 보관 정책.
 * cron 없이 관련 API 호출 시 만료 건을 확인·삭제합니다.
 * 기준: booking.created_at (예약 생성일)
 */
const BOOKING_TABLE = "booking";
const BOOKING_HOLD_TABLE = "booking_hold";

const RETENTION_YEARS = (function () {
  var raw = Number(process.env.BOOKING_RETENTION_YEARS);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return 5;
})();

function retentionIntervalParam() {
  return RETENTION_YEARS;
}

export function getBookingRetentionYears() {
  return RETENTION_YEARS;
}

export function isBookingRetentionExpired(createdAt) {
  if (createdAt == null || createdAt === "") {
    return false;
  }
  var created = new Date(createdAt);
  if (isNaN(created.getTime())) {
    return false;
  }
  var cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - RETENTION_YEARS);
  return created.getTime() < cutoff.getTime();
}

async function deleteRelatedBookingData(poolOrClient, reservationNumber) {
  var norm = String(reservationNumber || "").trim();
  if (!norm) {
    return;
  }
  try {
    await poolOrClient.query(
      `DELETE FROM ${BOOKING_HOLD_TABLE} WHERE reservation_number = $1`,
      [norm],
    );
  } catch (e) {
    if (e && e.code === "42P01") {
      return;
    }
    throw e;
  }
}

export async function purgeExpiredBookingByNumber(poolOrClient, reservationNumber) {
  var norm = String(reservationNumber || "").trim();
  if (!norm) {
    return false;
  }
  try {
    await deleteRelatedBookingData(poolOrClient, norm);
    var result = await poolOrClient.query(
      `DELETE FROM ${BOOKING_TABLE}
       WHERE reservation_number = $1
         AND created_at < NOW() - make_interval(years => $2::int)`,
      [norm, retentionIntervalParam()],
    );
    return (result.rowCount || 0) > 0;
  } catch (e) {
    if (e && e.code === "42P01") {
      return false;
    }
    throw e;
  }
}

export async function purgeExpiredBookings(poolOrClient) {
  try {
    await poolOrClient.query(
      `DELETE FROM ${BOOKING_HOLD_TABLE}
       WHERE reservation_number IN (
         SELECT reservation_number
         FROM ${BOOKING_TABLE}
         WHERE created_at < NOW() - make_interval(years => $1::int)
       )`,
      [retentionIntervalParam()],
    );
    var result = await poolOrClient.query(
      `DELETE FROM ${BOOKING_TABLE}
       WHERE created_at < NOW() - make_interval(years => $1::int)`,
      [retentionIntervalParam()],
    );
    return result.rowCount || 0;
  } catch (e) {
    if (e && e.code === "42P01") {
      return 0;
    }
    throw e;
  }
}

/**
 * 단건 조회 결과에 보관 기간을 적용합니다.
 * 만료 시 삭제 후 null을 반환합니다.
 */
export async function applyBookingRetentionToRow(poolOrClient, row) {
  if (!row) {
    return null;
  }
  if (!isBookingRetentionExpired(row.created_at)) {
    return row;
  }
  await purgeExpiredBookingByNumber(
    poolOrClient,
    row.reservation_number,
  );
  return null;
}
