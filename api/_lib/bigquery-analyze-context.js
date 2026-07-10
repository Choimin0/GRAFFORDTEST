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

function tableRef(config) {
  return (
    "`" + config.projectId + "." + config.dataset + "." + config.table + "`"
  );
}

async function runQuery(client, sql) {
  var [rows] = await client.query({ query: sql });
  return rows || [];
}

/** ko-KR DateTimeFormat 문자열(KST) → Date (실패 시 null) */
export function parseKstDateTime(value) {
  var text = String(value || "").trim();
  if (!text) {
    return null;
  }
  var m = text.match(
    /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{1,2}):(\d{2}):(\d{2})/,
  );
  if (m) {
    // Asia/Seoul = UTC+9 (DST 없음)
    var utcMs = Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]) - 9,
      Number(m[5]),
      Number(m[6]),
    );
    return new Date(utcMs);
  }
  var iso = new Date(text);
  return isNaN(iso.getTime()) ? null : iso;
}

function leadTimeDays(createdAt, cancelledAt) {
  var created = parseKstDateTime(createdAt);
  var cancelled = parseKstDateTime(cancelledAt);
  if (!created || !cancelled) {
    return null;
  }
  return Math.round((cancelled.getTime() - created.getTime()) / 86400000);
}

function enrichCancellationSamples(rows) {
  return (rows || []).map(function (row) {
    var days = leadTimeDays(row.created_at, row.cancelled_at);
    return Object.assign({}, row, {
      lead_time_days: days == null ? null : days,
    });
  });
}

/**
 * Gemini 분석용 BigQuery 요약 컨텍스트 (버튼 클릭 시에만 호출).
 */
export async function fetchAnalyzeContext() {
  var reserveConfig = getBigQueryConfig(
    "GOOGLE_BIGQUERY_TABLE",
    DEFAULT_TABLE,
  );
  var cancelConfig = getBigQueryConfig(
    "GOOGLE_BIGQUERY_CANCEL_TABLE",
    DEFAULT_CANCEL_TABLE,
  );

  if (!isConfigured(reserveConfig)) {
    throw new Error("BigQuery credentials not configured");
  }

  var client = getBigQueryClient(reserveConfig);
  var reserveTable = tableRef(reserveConfig);
  var cancelTable = tableRef(cancelConfig);

  var byRoomSql =
    "SELECT room, COUNT(*) AS reservation_count, " +
    "SUM(SAFE_CAST(amount AS INT64)) AS total_revenue, " +
    "AVG(DATE_DIFF(SAFE.PARSE_DATE('%Y-%m-%d', check_out), SAFE.PARSE_DATE('%Y-%m-%d', check_in), DAY)) AS avg_nights " +
    "FROM " +
    reserveTable +
    " GROUP BY room ORDER BY room";

  var monthlySql =
    "SELECT FORMAT_DATE('%Y-%m', SAFE.PARSE_DATE('%Y-%m-%d', check_in)) AS month, " +
    "COUNT(*) AS reservation_count, SUM(SAFE_CAST(amount AS INT64)) AS total_revenue " +
    "FROM " +
    reserveTable +
    " WHERE SAFE.PARSE_DATE('%Y-%m-%d', check_in) >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 12 MONTH) " +
    "GROUP BY month ORDER BY month";

  var cancelSummarySql =
    "SELECT room, cancel_reason, COUNT(*) AS cancel_count, " +
    "SUM(SAFE_CAST(amount AS INT64)) AS cancelled_amount, " +
    "SUM(SAFE_CAST(refund_amount AS INT64)) AS refunded_amount " +
    "FROM " +
    cancelTable +
    " GROUP BY room, cancel_reason ORDER BY cancel_count DESC";

  var recentCancelSql =
    "SELECT reservation_id, room, amount, refund_amount, cancel_reason, " +
    "created_at, cancelled_at, check_in, check_out " +
    "FROM " +
    cancelTable +
    " ORDER BY cancelled_at DESC LIMIT 40";

  var totalsSql =
    "SELECT COUNT(*) AS total_reservations, " +
    "SUM(SAFE_CAST(amount AS INT64)) AS total_revenue FROM " +
    reserveTable;

  var cancelTotalsSql =
    "SELECT COUNT(*) AS total_cancellations FROM " + cancelTable;

  var [
    byRoom,
    monthlyTrend,
    cancelByRoomReason,
    recentCancellations,
    reserveTotals,
    cancelTotals,
  ] = await Promise.all([
    runQuery(client, byRoomSql),
    runQuery(client, monthlySql),
    runQuery(client, cancelSummarySql),
    runQuery(client, recentCancelSql),
    runQuery(client, totalsSql),
    runQuery(client, cancelTotalsSql),
  ]);

  var enrichedCancels = enrichCancellationSamples(recentCancellations);
  var leadTimes = enrichedCancels
    .map(function (r) {
      return r.lead_time_days;
    })
    .filter(function (d) {
      return d != null && d >= 0;
    });
  var avgLeadTime =
    leadTimes.length > 0
      ? Math.round(
          leadTimes.reduce(function (a, b) {
            return a + b;
          }, 0) / leadTimes.length,
        )
      : null;

  return {
    generatedAt: new Date().toISOString(),
    dataset: {
      project: reserveConfig.projectId,
      dataset: reserveConfig.dataset,
      reservationTable: reserveConfig.table,
      cancellationTable: cancelConfig.table,
    },
    totals: {
      reservations: Number(reserveTotals[0]?.total_reservations) || 0,
      revenue: Number(reserveTotals[0]?.total_revenue) || 0,
      cancellations: Number(cancelTotals[0]?.total_cancellations) || 0,
      avgCancelLeadTimeDays: avgLeadTime,
    },
    byRoom: byRoom,
    monthlyTrend: monthlyTrend,
    cancellationsByRoomAndReason: cancelByRoomReason,
    recentCancellations: enrichedCancels,
  };
}
