import { BigQuery } from "@google-cloud/bigquery";

const DEFAULT_DATASET = "reservations";
const DEFAULT_TABLE = "bookings";

var bigQueryClientSingleton = null;

function trimEnv(name) {
  return String(process.env[name] || "").trim();
}

function getBigQueryConfig() {
  var projectId = trimEnv("GOOGLE_PROJECT_ID");
  var clientEmail = trimEnv("GOOGLE_CLIENT_EMAIL");
  var privateKey = trimEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  var dataset = trimEnv("GOOGLE_BIGQUERY_DATASET") || DEFAULT_DATASET;
  var table = trimEnv("GOOGLE_BIGQUERY_TABLE") || DEFAULT_TABLE;

  return {
    projectId: projectId,
    clientEmail: clientEmail,
    privateKey: privateKey,
    dataset: dataset,
    table: table,
  };
}

function isConfigured(config) {
  return !!(config.projectId && config.clientEmail && config.privateKey);
}

function getBigQueryClient(config) {
  if (!bigQueryClientSingleton) {
    bigQueryClientSingleton = new BigQuery({
      projectId: config.projectId,
      credentials: {
        client_email: config.clientEmail,
        private_key: config.privateKey,
      },
    });
  }
  return bigQueryClientSingleton;
}

function normalizeRoom(roomType) {
  return String(roomType || "")
    .trim()
    .toUpperCase();
}

function toIsoTimestamp(value) {
  if (value == null || value === "") {
    return null;
  }
  var d = new Date(value);
  if (isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

function toDateString(value) {
  if (!value) {
    return null;
  }
  var text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  if (/^\d{8}$/.test(text)) {
    return (
      text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6, 8)
    );
  }
  return text.slice(0, 10);
}

/**
 * 예약 생성 시 BigQuery에 행을 삽입합니다.
 * GOOGLE_PROJECT_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY가 없으면 건너뜁니다.
 *
 * @param {{
 *   reservationId: string,
 *   room: string,
 *   amount: number,
 *   createdAt: string | Date,
 *   checkIn: string,
 *   checkOut: string,
 * }} payload
 */
export async function exportReservationToBigQuery(payload) {
  var config = getBigQueryConfig();
  if (!isConfigured(config)) {
    return { ok: false, skipped: true, error: "BigQuery credentials not configured" };
  }

  var reservationId = String(payload?.reservationId || "").trim();
  if (!reservationId) {
    return { ok: false, skipped: true, error: "Missing reservationId" };
  }

  var row = {
    reservation_id: reservationId,
    room: normalizeRoom(payload.room),
    amount: Math.floor(Number(payload.amount) || 0),
    created_at: toIsoTimestamp(payload.createdAt),
    check_in: toDateString(payload.checkIn),
    check_out: toDateString(payload.checkOut),
  };

  if (!row.room || !row.check_in || !row.check_out || !row.created_at) {
    return { ok: false, skipped: true, error: "Invalid reservation payload for BigQuery" };
  }

  try {
    var client = getBigQueryClient(config);
    await client.dataset(config.dataset).table(config.table).insert([row]);
    return { ok: true };
  } catch (e) {
    var insertErrors =
      e && Array.isArray(e.errors)
        ? e.errors
        : e && e.response && Array.isArray(e.response.insertErrors)
          ? e.response.insertErrors
          : null;
    console.error("[bigquery-export] insert failed", {
      reservationId: reservationId,
      message: e && e.message,
      insertErrors: insertErrors,
    });
    return {
      ok: false,
      error: (e && e.message) || "BigQuery insert failed",
    };
  }
}
