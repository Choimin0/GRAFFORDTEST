import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { BigQuery } from "@google-cloud/bigquery";

const DEFAULT_DATASET = "grafford_analyze";
const DEFAULT_TABLE = "grafford_reserve";
const DEFAULT_CANCEL_TABLE = "grafford_cancel";

var bigQueryClientSingleton = null;

function trimEnv(name) {
  return String(process.env[name] || "").trim();
}

function getBigQueryConfig(tableEnvName, defaultTable) {
  var projectId = trimEnv("GOOGLE_PROJECT_ID");
  var clientEmail = trimEnv("GOOGLE_CLIENT_EMAIL");
  var privateKey = trimEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  var dataset = trimEnv("GOOGLE_BIGQUERY_DATASET") || DEFAULT_DATASET;
  var table = trimEnv(tableEnvName) || defaultTable;

  return {
    projectId: projectId,
    clientEmail: clientEmail,
    privateKey: privateKey,
    dataset: dataset,
    table: table,
  };
}

function getReservationBigQueryConfig() {
  return getBigQueryConfig("GOOGLE_BIGQUERY_TABLE", DEFAULT_TABLE);
}

function getCancelBigQueryConfig() {
  return getBigQueryConfig("GOOGLE_BIGQUERY_CANCEL_TABLE", DEFAULT_CANCEL_TABLE);
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

function formatCreatedAtKst(value) {
  if (value == null || value === "") {
    return "";
  }
  var d = new Date(value);
  if (isNaN(d.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
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

function formatCancelReason(code, otherReason) {
  var c = String(code || "")
    .trim()
    .toLowerCase();
  if (c === "mind-change") return "단순 변심";
  if (c === "schedule-change") return "일정 변경";
  if (c === "other-hotel") return "타 숙소 예약";
  if (c === "other") {
    return String(otherReason || "").trim() || "기타";
  }
  if (c === "not paid") return "입금 기한 초과";
  if (c === "manual") return "관리자 직접 취소";
  return String(code || "").trim() || "고객 요청 취소";
}

function buildRow(payload) {
  var reservationId = String(payload?.reservationId || "").trim();
  var room = normalizeRoom(payload.room);
  var amount = String(Math.floor(Number(payload.amount) || 0));
  var createdAt = formatCreatedAtKst(payload.createdAt);
  var checkIn = toDateString(payload.checkIn);
  var checkOut = toDateString(payload.checkOut);

  if (!reservationId || !room || !checkIn || !checkOut || !createdAt) {
    return null;
  }

  return {
    reservation_id: reservationId,
    room: room,
    amount: amount,
    created_at: createdAt,
    check_in: checkIn,
    check_out: checkOut,
  };
}

function buildCancelRow(payload) {
  var reservationId = String(payload?.reservationId || "").trim();
  var room = normalizeRoom(payload.room);
  var amount = String(Math.floor(Number(payload.amount) || 0));
  var refundAmount = String(Math.floor(Number(payload.refundAmount) || 0));
  var cancelReason = formatCancelReason(
    payload.cancelReason,
    payload.otherReason,
  );
  var createdAt = formatCreatedAtKst(payload.createdAt);
  var checkIn = toDateString(payload.checkIn);
  var checkOut = toDateString(payload.checkOut);
  var cancelledAt = formatCreatedAtKst(payload.cancelledAt);

  if (
    !reservationId ||
    !room ||
    !checkIn ||
    !checkOut ||
    !createdAt ||
    !cancelledAt
  ) {
    return null;
  }

  return {
    reservation_id: reservationId,
    room: room,
    amount: amount,
    refund_amount: refundAmount,
    cancel_reason: cancelReason,
    created_at: createdAt,
    check_in: checkIn,
    check_out: checkOut,
    cancelled_at: cancelledAt,
  };
}

function humanizeInsertError(e) {
  var message = (e && e.message) || "BigQuery insert failed";
  if (/bigquery\.jobs\.create/i.test(message)) {
    return (
      message +
      " — 서비스 계정에 프로젝트 수준 BigQuery Job User(roles/bigquery.jobUser) 역할을 추가해 주세요."
    );
  }
  if (/Streaming insert is not allowed/i.test(message)) {
    return message + " — 스트리밍 대신 배치 적재(load job)를 사용합니다.";
  }
  return message;
}

async function loadRowToBigQuery(row, config, logLabel) {
  if (!isConfigured(config)) {
    return { ok: false, skipped: true, error: "BigQuery credentials not configured" };
  }

  var tmpPath = join(tmpdir(), "bq-" + randomUUID() + ".ndjson");

  try {
    writeFileSync(tmpPath, JSON.stringify(row) + "\n", "utf8");
    var client = getBigQueryClient(config);
    var table = client.dataset(config.dataset).table(config.table);
    var loadResult = await table.load(tmpPath, {
      sourceFormat: "NEWLINE_DELIMITED_JSON",
      writeDisposition: "WRITE_APPEND",
    });
    var job = Array.isArray(loadResult) ? loadResult[0] : loadResult;
    if (job && typeof job.promise === "function") {
      await job.promise();
      var metaResult = await job.getMetadata();
      var metadata = Array.isArray(metaResult) ? metaResult[0] : metaResult;
      if (metadata && metadata.status && metadata.status.errorResult) {
        throw new Error(metadata.status.errorResult.message);
      }
    }
    return { ok: true };
  } catch (e) {
    console.error("[bigquery-export] load job failed", {
      label: logLabel,
      reservationId: row.reservation_id,
      dataset: config.dataset,
      table: config.table,
      message: e && e.message,
      errors: e && e.errors,
    });
    return {
      ok: false,
      error: humanizeInsertError(e),
    };
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * 예약 생성 시 BigQuery에 행을 삽입합니다.
 * (무료 티어 호환) 스트리밍 insert 대신 load job으로 NDJSON 1건을 적재합니다.
 */
export async function exportReservationToBigQuery(payload) {
  var config = getReservationBigQueryConfig();
  var row = buildRow(payload);
  if (!row) {
    return { ok: false, skipped: true, error: "Invalid reservation payload for BigQuery" };
  }
  return loadRowToBigQuery(row, config, "reservation");
}

/**
 * 예약 취소 완료 시 BigQuery 취소 테이블에 행을 삽입합니다.
 */
export async function exportCancellationToBigQuery(payload) {
  var config = getCancelBigQueryConfig();
  var row = buildCancelRow(payload);
  if (!row) {
    return {
      ok: false,
      skipped: true,
      error: "Invalid cancellation payload for BigQuery",
    };
  }
  return loadRowToBigQuery(row, config, "cancellation");
}
