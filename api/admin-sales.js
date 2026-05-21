import pg from "pg";

const { Pool } = pg;
const BOOKING_TABLE = "booking";

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

function normalizeMonthKey(value) {
  var raw = String(value || "").trim();
  var match = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (!match) {
    var now = new Date();
    return (
      now.getUTCFullYear() +
      "-" +
      String(now.getUTCMonth() + 1).padStart(2, "0")
    );
  }
  var month = Math.min(12, Math.max(1, Number(match[2]) || 1));
  return match[1] + "-" + String(month).padStart(2, "0");
}

function resolvePaymentLabel(paymentMethod) {
  var raw = String(paymentMethod || "").trim().toLowerCase();
  if (raw === "card" || raw === "신용카드") return "신용카드";
  if (raw === "naver" || raw === "네이버페이") return "네이버페이";
  if (raw === "kakao" || raw === "kakaopay" || raw === "카카오페이") {
    return "카카오페이";
  }
  return "기타";
}

const CHANNEL_COLORS = {
  GRAFFORD: "#7EB8D4",
  야놀자: "#E07B7B",
  에어비앤비: "#F0A87C",
  "Booking.com": "#88C9A0",
  기타: "#A48FCF",
};

async function getMonthlySalesData(pool, month) {
  var monthKey = normalizeMonthKey(month);
  var monthStart = monthKey + "-01";
  const statsQuery = `
    SELECT
      COUNT(*)::int                          AS reservation_count,
      COALESCE(SUM(total_amount), 0)::bigint AS total_revenue,
      payment_method,
      room_type
    FROM ${BOOKING_TABLE}
    WHERE status IN ('confirm', 'completed')
      AND check_in_date >= $1::date
      AND check_in_date < ($1::date + INTERVAL '1 month')::date
    GROUP BY payment_method, room_type
  `;

  const cancelQuery = `
    SELECT
      COUNT(*)::int AS cancel_count,
      COALESCE(SUM(total_amount), 0)::bigint AS cancel_revenue
    FROM ${BOOKING_TABLE}
    WHERE status = 'cancelled'
      AND COALESCE(cancelled_at, created_at) >= $1::date
      AND COALESCE(cancelled_at, created_at) < ($1::date + INTERVAL '1 month')
  `;

  const occupancyQuery = `
    WITH month_bounds AS (
      SELECT
        $1::date AS month_start,
        ($1::date + INTERVAL '1 month')::date AS next_month_start
    ),
    all_res AS (
      SELECT check_in_date, check_out_date
      FROM ${BOOKING_TABLE}, month_bounds
      WHERE status IN ('confirm', 'completed')
        AND check_out_date > month_start
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

  const dailyRevenueQuery = `
    WITH month_bounds AS (
      SELECT
        $1::date AS month_start,
        ($1::date + INTERVAL '1 month')::date AS next_month_start
    ),
    days AS (
      SELECT generate_series(
        (SELECT month_start FROM month_bounds),
        (SELECT next_month_start FROM month_bounds) - INTERVAL '1 day',
        INTERVAL '1 day'
      )::date AS day
    ),
    sales AS (
      SELECT check_in_date::date AS day, SUM(total_amount)::bigint AS revenue
      FROM ${BOOKING_TABLE}, month_bounds
      WHERE status IN ('confirm', 'completed')
        AND check_in_date >= month_start
        AND check_in_date < next_month_start
      GROUP BY check_in_date::date
    ),
    daily_sales AS (
      SELECT
        days.day,
        (((days.day - (SELECT month_start FROM month_bounds)) / 7) + 1)::int AS week_no,
        COALESCE(sales.revenue, 0)::bigint AS revenue
      FROM days
      LEFT JOIN sales ON sales.day = days.day
    )
    SELECT
      week_no,
      MIN(day) AS week_start,
      SUM(revenue)::bigint AS revenue
    FROM daily_sales
    GROUP BY week_no
    ORDER BY week_no
  `;

  const [statsResult, cancelResult, occupancyResult, dailyRevenueResult] =
    await Promise.all([
      pool.query(statsQuery, [monthStart]),
      pool.query(cancelQuery, [monthStart]),
      pool.query(occupancyQuery, [monthStart]),
      pool.query(dailyRevenueQuery, [monthStart]),
    ]);

  var cancelCount =
    cancelResult.rows && cancelResult.rows[0]
      ? Number(cancelResult.rows[0].cancel_count) || 0
      : 0;
  var cancelRevenue =
    cancelResult.rows && cancelResult.rows[0]
      ? Number(cancelResult.rows[0].cancel_revenue) || 0
      : 0;

  var reservationCount = 0;
  var totalRevenue = 0;

  // 채널별 / 객실별 집계
  var channelMap = {};
  var roomMap = {};
  var roomCountMap = {};
  var paymentMap = {};
  var paymentCountMap = {};

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
      roomCountMap[room] = (roomCountMap[room] || 0) + cnt;
    }

    var payment = String(row.payment_method || "").trim().toLowerCase() || "unknown";
    paymentMap[payment] = (paymentMap[payment] || 0) + rev;
    paymentCountMap[payment] = (paymentCountMap[payment] || 0) + cnt;
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
    .map(function (r) {
      return {
        label: r,
        value: roomMap[r] || 0,
        color: ROOM_COLORS[r] || "#c8c8c8",
      };
    });

  var roomStats = ["G1", "G2", "G3", "G4"].map(function (r) {
    var revenue = roomMap[r] || 0;
    return {
      label: r,
      reservationCount: roomCountMap[r] || 0,
      revenue: revenue,
      revenueRate:
        totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 100) : 0,
    };
  });

  var paymentRevenue = Object.keys(paymentMap)
    .map(function (method) {
      return {
        method: method,
        label: resolvePaymentLabel(method),
        count: paymentCountMap[method] || 0,
        revenue: paymentMap[method] || 0,
      };
    })
    .sort(function (a, b) {
      return b.revenue - a.revenue;
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

  var occupiedRoomNights = occupancyByDay.reduce(function (sum, row) {
    return sum + (Number(row.count) || 0);
  }, 0);
  var maxRoomNights = occupancyByDay.length * 4;

  var dailyRevenue = (dailyRevenueResult.rows || []).map(function (row) {
    return {
      label: String(row.week_no || "") + "주",
      date:
        row.week_start instanceof Date
          ? row.week_start.toISOString().slice(0, 10)
          : String(row.week_start || "").slice(0, 10),
      revenue: Number(row.revenue) || 0,
    };
  });

  return {
    month: monthKey,
    reservationCount: reservationCount,
    totalRevenue: totalRevenue,
    cancelCount: cancelCount,
    cancelRevenue: cancelRevenue,
    cancellationRate:
      reservationCount + cancelCount > 0
        ? Math.round((cancelCount / (reservationCount + cancelCount)) * 100)
        : 0,
    occupiedRoomNights: occupiedRoomNights,
    maxRoomNights: maxRoomNights,
    channelRevenue: channelRevenue,
    roomRevenue: roomRevenue,
    roomStats: roomStats,
    paymentRevenue: paymentRevenue,
    dailyRevenue: dailyRevenue,
    occupancyByDay: occupancyByDay,
  };
}

async function getAnnualSalesData(pool, year) {
  var selectedYear = parseInt(year, 10);
  if (!Number.isFinite(selectedYear) || selectedYear < 1900 || selectedYear > 9999) {
    selectedYear = new Date().getUTCFullYear();
  }
  const monthlyQuery = `
    WITH year_bounds AS (
      SELECT
        MAKE_DATE($1::int, 1, 1) AS year_start,
        MAKE_DATE($1::int + 1, 1, 1) AS next_year_start
    ),
    months AS (
      SELECT generate_series(1, 12)::int AS month
    ),
    confirmed AS (
      SELECT
        EXTRACT(MONTH FROM check_in_date)::int AS month,
        COUNT(*)::int AS reservation_count,
        COALESCE(SUM(total_amount), 0)::bigint AS revenue
      FROM ${BOOKING_TABLE}, year_bounds
      WHERE status IN ('confirm', 'completed')
        AND check_in_date >= year_start
        AND check_in_date < next_year_start
      GROUP BY month
    ),
    cancelled AS (
      SELECT
        EXTRACT(MONTH FROM COALESCE(cancelled_at, created_at))::int AS month,
        COUNT(*)::int AS cancel_count,
        COALESCE(SUM(total_amount), 0)::bigint AS cancel_revenue
      FROM ${BOOKING_TABLE}, year_bounds
      WHERE status = 'cancelled'
        AND COALESCE(cancelled_at, created_at) >= year_start
        AND COALESCE(cancelled_at, created_at) < next_year_start
      GROUP BY month
    )
    SELECT
      months.month,
      COALESCE(confirmed.reservation_count, 0)::int AS reservation_count,
      COALESCE(confirmed.revenue, 0)::bigint AS revenue,
      COALESCE(cancelled.cancel_count, 0)::int AS cancel_count,
      COALESCE(cancelled.cancel_revenue, 0)::bigint AS cancel_revenue
    FROM months
    LEFT JOIN confirmed ON confirmed.month = months.month
    LEFT JOIN cancelled ON cancelled.month = months.month
    ORDER BY months.month
  `;

  const annualQuery = `
    SELECT
      EXTRACT(YEAR FROM check_in_date)::int AS year,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue
    FROM ${BOOKING_TABLE}
    WHERE status IN ('confirm', 'completed')
      AND EXTRACT(YEAR FROM check_in_date) >= 2026
    GROUP BY year
    ORDER BY year
  `;

  const [monthlyResult, annualResult] = await Promise.all([
    pool.query(monthlyQuery, [selectedYear]),
    pool.query(annualQuery),
  ]);

  // 12개월 배열 (1월~12월), 없으면 0
  var monthlyRevenue = Array(12).fill(0);
  var monthlyStats = Array(12)
    .fill(null)
    .map(function (_, index) {
      return {
        month: index + 1,
        reservationCount: 0,
        cancelCount: 0,
        cancelRate: 0,
        revenue: 0,
        cancelRevenue: 0,
      };
    });
  (monthlyResult.rows || []).forEach(function (row) {
    var m = Number(row.month);
    if (m >= 1 && m <= 12) {
      var reservationCount = Number(row.reservation_count) || 0;
      var cancelCount = Number(row.cancel_count) || 0;
      var revenue = Number(row.revenue) || 0;
      monthlyRevenue[m - 1] = revenue;
      monthlyStats[m - 1] = {
        month: m,
        reservationCount: reservationCount,
        cancelCount: cancelCount,
        cancelRate:
          reservationCount + cancelCount > 0
            ? Math.round((cancelCount / (reservationCount + cancelCount)) * 100)
            : 0,
        revenue: revenue,
        cancelRevenue: Number(row.cancel_revenue) || 0,
      };
    }
  });

  var annualTotal = monthlyStats.reduce(function (sum, row) {
    return sum + (Number(row.revenue) || 0);
  }, 0);
  var reservationCountTotal = monthlyStats.reduce(function (sum, row) {
    return sum + (Number(row.reservationCount) || 0);
  }, 0);
  var cancelCountTotal = monthlyStats.reduce(function (sum, row) {
    return sum + (Number(row.cancelCount) || 0);
  }, 0);
  var monthlyAverage = Math.round(annualTotal / 12);
  var bestMonth = monthlyStats.reduce(
    function (best, row) {
      return Number(row.revenue) > Number(best.revenue) ? row : best;
    },
    { month: 0, revenue: 0 },
  );

  var annualRevenue = (annualResult.rows || []).map(function (row) {
    return { year: Number(row.year), revenue: Number(row.revenue) || 0 };
  });

  // 2026년 데이터가 없어도 최소 1개 항목을 보장
  if (annualRevenue.length === 0) {
    annualRevenue = [{ year: 2026, revenue: 0 }];
  }

  return {
    year: selectedYear,
    monthlyRevenue: monthlyRevenue,
    monthlyStats: monthlyStats,
    annualTotal: annualTotal,
    reservationCount: reservationCountTotal,
    cancelCount: cancelCountTotal,
    monthlyAverage: monthlyAverage,
    bestMonth: { month: bestMonth.month || 0, revenue: bestMonth.revenue || 0 },
    annualRevenue: annualRevenue,
  };
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
      var data = await getMonthlySalesData(pool, body.month);
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
      var data = await getAnnualSalesData(pool, body.year);
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
