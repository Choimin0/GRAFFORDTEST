import pg from "pg";

const { Pool } = pg;
const ACTIVE_TABLE = "reservations";
const PAST_TABLE = "past_reservations";
const DELETED_TABLE = "delete_reservations";

function getDatabaseUrl() {
  return String(
    process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL ||
      "",
  ).trim();
}

var poolSingleton = null;

function getPool() {
  var databaseUrl = getDatabaseUrl();
  if (!databaseUrl) return null;
  if (!poolSingleton) {
    poolSingleton = new Pool({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: 20000,
      idleTimeoutMillis: 15000,
    });
  }
  return poolSingleton;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () {
      try {
        var raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function isAdminOk(body) {
  var inputId = String((body && body.adminId) || "").trim();
  var inputPw = String((body && body.adminPw) || "").trim();
  var envId = String(process.env.ADMIN_ID || "").trim();
  var envPw = String(process.env.ADMIN_PW || "").trim();
  if (!envId || !envPw) {
    return { ok: false, error: "서버 ADMIN_ID/ADMIN_PW가 설정되지 않았습니다." };
  }
  if (!inputId || !inputPw) {
    return { ok: false, error: "관리자 ID/PW를 입력해주세요." };
  }
  if (inputId !== envId || inputPw !== envPw) {
    return { ok: false, error: "관리자 인증에 실패했습니다." };
  }
  return { ok: true };
}

const ROOM_COLORS = {
  G1: "#7EB8D4",
  G2: "#F0A87C",
  G3: "#88C9A0",
  G4: "#E07B7B",
};

// 판매 채널 매핑: payment_method → channel name
// 현재는 자사 채널만 존재. 추후 OTA 채널 추가 시 여기에 매핑을 추가하면 됩니다.
function resolveChannel(paymentMethod) {
  var raw = String(paymentMethod || "").trim().toLowerCase();
  // 야놀자, 에어비앤비 등 OTA 채널이 추가될 경우 아래에 조건을 추가합니다.
  // if (raw === "yanolja") return "야놀자";
  // if (raw === "airbnb") return "에어비앤비";
  return "GRAFFORD";
}

const CHANNEL_COLORS = {
  GRAFFORD: "#7EB8D4",
  야놀자: "#E07B7B",
  에어비앤비: "#F0A87C",
  "Booking.com": "#88C9A0",
  기타: "#A48FCF",
};

async function getMonthlySalesData(pool) {
  // 이번 달 범위: 1일 00:00 ~ 다음달 1일 00:00 (UTC 기준 날짜 비교)
  const statsQuery = `
    WITH monthly AS (
      SELECT total_amount, payment_method, room_type
      FROM ${ACTIVE_TABLE}
      WHERE DATE_TRUNC('month', check_in_date) = DATE_TRUNC('month', CURRENT_DATE)
      UNION ALL
      SELECT total_amount, payment_method, room_type
      FROM ${PAST_TABLE}
      WHERE DATE_TRUNC('month', check_in_date) = DATE_TRUNC('month', CURRENT_DATE)
    )
    SELECT
      COUNT(*)::int                         AS reservation_count,
      COALESCE(SUM(total_amount), 0)::bigint AS total_revenue,
      payment_method,
      room_type
    FROM monthly
    GROUP BY payment_method, room_type
  `;

  const cancelQuery = `
    SELECT COUNT(*)::int AS cancel_count
    FROM ${DELETED_TABLE}
    WHERE DATE_TRUNC('month', COALESCE(cancelled_at, created_at)) = DATE_TRUNC('month', CURRENT_DATE)
  `;

  const occupancyQuery = `
    WITH month_bounds AS (
      SELECT
        DATE_TRUNC('month', CURRENT_DATE)::date AS month_start,
        (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month')::date AS next_month_start
    ),
    all_res AS (
      SELECT check_in_date, check_out_date
      FROM ${ACTIVE_TABLE}, month_bounds
      WHERE check_out_date > month_start
        AND check_in_date < next_month_start
      UNION ALL
      SELECT check_in_date, check_out_date
      FROM ${PAST_TABLE}, month_bounds
      WHERE check_out_date > month_start
        AND check_in_date < next_month_start
    ),
    days AS (
      SELECT generate_series(
        (SELECT month_start FROM month_bounds),
        (SELECT next_month_start FROM month_bounds) - INTERVAL '1 day',
        INTERVAL '1 day'
      )::date AS day
    )
    SELECT
      day,
      COUNT(*) FILTER (
        WHERE all_res.check_in_date <= day
          AND all_res.check_out_date > day
      )::int AS occupied_rooms
    FROM days
    LEFT JOIN all_res
      ON all_res.check_in_date <= day
     AND all_res.check_out_date > day
    GROUP BY day
    ORDER BY day
  `;

  const [statsResult, cancelResult, occupancyResult] = await Promise.all([
    pool.query(statsQuery),
    pool.query(cancelQuery),
    pool.query(occupancyQuery),
  ]);

  var cancelCount =
    cancelResult.rows && cancelResult.rows[0]
      ? Number(cancelResult.rows[0].cancel_count) || 0
      : 0;

  var reservationCount = 0;
  var totalRevenue = 0;

  // 채널별 / 객실별 집계
  var channelMap = {};
  var roomMap = {};

  (statsResult.rows || []).forEach(function (row) {
    var cnt = Number(row.reservation_count) || 0;
    var rev = Number(row.total_revenue) || 0;
    reservationCount += cnt;
    totalRevenue += rev;

    var channel = resolveChannel(row.payment_method);
    channelMap[channel] = (channelMap[channel] || 0) + rev;

    var room = String(row.room_type || "").toUpperCase();
    if (room) {
      roomMap[room] = (roomMap[room] || 0) + rev;
    }
  });

  var channelRevenue = Object.keys(channelMap).map(function (ch) {
    return {
      label: ch,
      value: channelMap[ch],
      color: CHANNEL_COLORS[ch] || "#c8c8c8",
    };
  });

  // G1~G4 순서 보장
  var roomRevenue = ["G1", "G2", "G3", "G4"]
    .filter(function (r) { return roomMap[r] != null; })
    .map(function (r) {
      return {
        label: r,
        value: roomMap[r] || 0,
        color: ROOM_COLORS[r] || "#c8c8c8",
      };
    });

  var occupancyByDay = (occupancyResult.rows || []).map(function (row) {
    return {
      date:
        row.day instanceof Date
          ? row.day.toISOString().slice(0, 10)
          : String(row.day || "").slice(0, 10),
      count: Number(row.occupied_rooms) || 0,
    };
  });

  return {
    reservationCount: reservationCount,
    totalRevenue: totalRevenue,
    cancelCount: cancelCount,
    channelRevenue: channelRevenue,
    roomRevenue: roomRevenue,
    occupancyByDay: occupancyByDay,
  };
}

async function getAnnualSalesData(pool) {
  const monthlyQuery = `
    WITH all_res AS (
      SELECT check_in_date, total_amount
      FROM ${ACTIVE_TABLE}
      WHERE EXTRACT(YEAR FROM check_in_date) = EXTRACT(YEAR FROM CURRENT_DATE)
      UNION ALL
      SELECT check_in_date, total_amount
      FROM ${PAST_TABLE}
      WHERE EXTRACT(YEAR FROM check_in_date) = EXTRACT(YEAR FROM CURRENT_DATE)
    )
    SELECT
      EXTRACT(MONTH FROM check_in_date)::int AS month,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue
    FROM all_res
    GROUP BY month
    ORDER BY month
  `;

  const annualQuery = `
    WITH all_res AS (
      SELECT check_in_date, total_amount FROM ${ACTIVE_TABLE}
      UNION ALL
      SELECT check_in_date, total_amount FROM ${PAST_TABLE}
    )
    SELECT
      EXTRACT(YEAR FROM check_in_date)::int AS year,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue
    FROM all_res
    WHERE EXTRACT(YEAR FROM check_in_date) >= 2026
    GROUP BY year
    ORDER BY year
  `;

  const [monthlyResult, annualResult] = await Promise.all([
    pool.query(monthlyQuery),
    pool.query(annualQuery),
  ]);

  // 12개월 배열 (1월~12월), 없으면 0
  var monthlyRevenue = Array(12).fill(0);
  (monthlyResult.rows || []).forEach(function (row) {
    var m = Number(row.month);
    if (m >= 1 && m <= 12) {
      monthlyRevenue[m - 1] = Number(row.revenue) || 0;
    }
  });

  var annualRevenue = (annualResult.rows || []).map(function (row) {
    return { year: Number(row.year), revenue: Number(row.revenue) || 0 };
  });

  // 2026년 데이터가 없어도 최소 1개 항목을 보장
  if (annualRevenue.length === 0) {
    annualRevenue = [{ year: 2026, revenue: 0 }];
  }

  return { monthlyRevenue: monthlyRevenue, annualRevenue: annualRevenue };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  var pool = getPool();
  if (!pool) {
    json(res, 503, { ok: false, error: "DB 연결 정보가 없습니다." });
    return;
  }

  var body;
  try {
    body = await readBody(req);
  } catch (e) {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  var auth = isAdminOk(body);
  if (!auth.ok) {
    json(res, 401, { ok: false, error: auth.error });
    return;
  }

  var type = String(body.type || "monthly").trim().toLowerCase();

  if (type === "monthly") {
    try {
      var data = await getMonthlySalesData(pool);
      json(res, 200, { ok: true, ...data });
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: String((e && e.message) || e || "query failed"),
      });
    }
    return;
  }

  if (type === "annual") {
    try {
      var data = await getAnnualSalesData(pool);
      json(res, 200, { ok: true, ...data });
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: String((e && e.message) || e || "query failed"),
      });
    }
    return;
  }

  json(res, 400, { ok: false, error: "지원하지 않는 type입니다." });
}
