import { json } from "./admin-common.js";
import { purgeExpiredBookings } from "./booking-retention.js";
import { getTodayYmdKst } from "./promotion-period.js";

const BOOKING_TABLE = "booking";

const ROOM_COLORS = {
  G1: "#7EB8D4",
  G2: "#F0A87C",
  G3: "#88C9A0",
  G4: "#E07B7B",
};

const PLATFORM_ORDER = ["direct", "airbnb", "stayfolio", "phone"];

const PLATFORM_LABELS = {
  direct: "홈페이지",
  airbnb: "에어비앤비",
  stayfolio: "스테이폴리오",
  phone: "유선예약",
  other: "기타",
};

const PLATFORM_COLORS = {
  direct: "#7EB8D4",
  airbnb: "#F0A87C",
  stayfolio: "#88C9A0",
  phone: "#A48FCF",
  other: "#c8c8c8",
};

function normalizePlatformId(bookingChannel) {
  var raw = String(bookingChannel || "")
    .trim()
    .toLowerCase();
  if (!raw || raw === "direct") {
    return "direct";
  }
  if (PLATFORM_ORDER.indexOf(raw) !== -1) {
    return raw;
  }
  return "other";
}

function resolvePlatformLabel(platformId) {
  return PLATFORM_LABELS[platformId] || PLATFORM_LABELS.other;
}

function dateToYmd(value) {
  if (value == null || value === "") {
    return "";
  }
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  if (value instanceof Date && !isNaN(value.getTime())) {
    var y = value.getUTCFullYear();
    var m = String(value.getUTCMonth() + 1).padStart(2, "0");
    var d = String(value.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }
  return String(value).slice(0, 10);
}

function normalizeMonthKey(value) {
  var raw = String(value || "").trim();
  var match = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (!match) {
    var todayKst = getTodayYmdKst();
    return todayKst.slice(0, 7);
  }
  var month = Math.min(12, Math.max(1, Number(match[2]) || 1));
  return match[1] + "-" + String(month).padStart(2, "0");
}

async function getMonthlySalesData(pool, month) {
  var monthKey = normalizeMonthKey(month);
  var monthStart = monthKey + "-01";
  // Revenue and reservation counts are attributed to check_out_date.
  const statsQuery = `
    SELECT
      COUNT(*)::int                          AS reservation_count,
      COALESCE(SUM(total_amount), 0)::bigint AS total_revenue,
      booking_channel,
      room_type
    FROM ${BOOKING_TABLE}
    WHERE status IN ('confirm', 'completed')
      AND COALESCE(stay_role, 'primary') <> 'room_change'
      AND check_out_date >= $1::date
      AND check_out_date < ($1::date + INTERVAL '1 month')::date
    GROUP BY booking_channel, room_type
  `;

  const cancelQuery = `
    SELECT
      COUNT(*)::int AS cancel_count,
      COALESCE(
        SUM(GREATEST(total_amount - COALESCE(refund_amount, 0), 0)),
        0
      )::bigint AS cancel_revenue
    FROM ${BOOKING_TABLE}
    WHERE status = 'cancelled'
      AND COALESCE(stay_role, 'primary') <> 'room_change'
      AND (COALESCE(cancelled_at, created_at) AT TIME ZONE 'Asia/Seoul')::date >= $1::date
      AND (COALESCE(cancelled_at, created_at) AT TIME ZONE 'Asia/Seoul')::date < ($1::date + INTERVAL '1 month')::date
  `;

  const occupancyQuery = `
    WITH month_bounds AS (
      SELECT
        $1::date AS month_start,
        ($1::date + INTERVAL '1 month')::date AS next_month_start
    ),
    all_res AS (
      -- Occupancy counts confirmed/completed bookings only. Room blocks are excluded.
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
      SELECT check_out_date::date AS day, SUM(total_amount)::bigint AS revenue
      FROM ${BOOKING_TABLE}, month_bounds
      WHERE status IN ('confirm', 'completed')
        AND COALESCE(stay_role, 'primary') <> 'room_change'
        AND check_out_date >= month_start
        AND check_out_date < next_month_start
      GROUP BY check_out_date::date
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

  // 플랫폼별 / 객실별 집계
  var roomMap = {};
  var roomCountMap = {};
  var platformMap = {};
  var platformCountMap = {};

  (statsResult.rows || []).forEach(function (row) {
    var cnt = Number(row.reservation_count) || 0;
    var rev = Number(row.total_revenue) || 0;
    reservationCount += cnt;
    totalRevenue += rev;

    var platform = normalizePlatformId(row.booking_channel);
    platformMap[platform] = (platformMap[platform] || 0) + rev;
    platformCountMap[platform] = (platformCountMap[platform] || 0) + cnt;

    var room = String(row.room_type || "").toUpperCase();
    if (room) {
      roomMap[room] = (roomMap[room] || 0) + rev;
      roomCountMap[room] = (roomCountMap[room] || 0) + cnt;
    }
  });

  var channelRevenue = PLATFORM_ORDER.concat(
    platformMap.other ? ["other"] : [],
  ).map(function (platformId) {
    return {
      label: resolvePlatformLabel(platformId),
      value: platformMap[platformId] || 0,
      color: PLATFORM_COLORS[platformId] || "#c8c8c8",
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

  var platformRevenue = PLATFORM_ORDER.concat(
    platformMap.other ? ["other"] : [],
  ).map(function (platformId) {
    return {
      platform: platformId,
      label: resolvePlatformLabel(platformId),
      count: platformCountMap[platformId] || 0,
      revenue: platformMap[platformId] || 0,
    };
  });

  var occupancyByDay = (occupancyResult.rows || []).map(function (row) {
    return {
      date: dateToYmd(row.day),
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
      date: dateToYmd(row.week_start),
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
    platformRevenue: platformRevenue,
    dailyRevenue: dailyRevenue,
    occupancyByDay: occupancyByDay,
  };
}

async function getAnnualSalesData(pool, year) {
  var selectedYear = parseInt(year, 10);
  if (!Number.isFinite(selectedYear) || selectedYear < 1900 || selectedYear > 9999) {
    selectedYear = Number(getTodayYmdKst().slice(0, 4));
  }
  // Revenue and reservation counts are attributed to check_out_date.
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
        EXTRACT(MONTH FROM check_out_date)::int AS month,
        COUNT(*)::int AS reservation_count,
        COALESCE(SUM(total_amount), 0)::bigint AS revenue
      FROM ${BOOKING_TABLE}, year_bounds
      WHERE status IN ('confirm', 'completed')
        AND COALESCE(stay_role, 'primary') <> 'room_change'
        AND check_out_date >= year_start
        AND check_out_date < next_year_start
      GROUP BY month
    ),
    cancelled AS (
      SELECT
        EXTRACT(MONTH FROM (COALESCE(cancelled_at, created_at) AT TIME ZONE 'Asia/Seoul'))::int AS month,
        COUNT(*)::int AS cancel_count,
        COALESCE(
          SUM(GREATEST(total_amount - COALESCE(refund_amount, 0), 0)),
          0
        )::bigint AS cancel_revenue
      FROM ${BOOKING_TABLE}, year_bounds
      WHERE status = 'cancelled'
        AND COALESCE(stay_role, 'primary') <> 'room_change'
        AND (COALESCE(cancelled_at, created_at) AT TIME ZONE 'Asia/Seoul')::date >= year_start
        AND (COALESCE(cancelled_at, created_at) AT TIME ZONE 'Asia/Seoul')::date < next_year_start
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
      EXTRACT(YEAR FROM check_out_date)::int AS year,
      COALESCE(SUM(total_amount), 0)::bigint AS revenue
    FROM ${BOOKING_TABLE}
    WHERE status IN ('confirm', 'completed')
      AND COALESCE(stay_role, 'primary') <> 'room_change'
      AND EXTRACT(YEAR FROM check_out_date) >= 2026
    GROUP BY year
    ORDER BY year
  `;

  const occupancyQuery = `
    WITH year_bounds AS (
      SELECT
        MAKE_DATE($1::int, 1, 1) AS year_start,
        MAKE_DATE($1::int + 1, 1, 1) AS next_year_start
    ),
    months AS (
      SELECT
        month_num,
        MAKE_DATE($1::int, month_num, 1) AS month_start,
        (MAKE_DATE($1::int, month_num, 1) + INTERVAL '1 month')::date AS next_month_start
      FROM generate_series(1, 12) AS month_num
    ),
    all_res AS (
      -- Occupancy counts confirmed/completed bookings only. Room blocks are excluded.
      SELECT check_in_date, check_out_date
      FROM ${BOOKING_TABLE}, year_bounds
      WHERE status IN ('confirm', 'completed')
        AND check_out_date > year_start
        AND check_in_date < next_year_start
    ),
    month_days AS (
      SELECT
        m.month_num AS month,
        d.day::date AS day
      FROM months m
      CROSS JOIN LATERAL generate_series(
        m.month_start,
        m.next_month_start - INTERVAL '1 day',
        INTERVAL '1 day'
      ) AS d(day)
    ),
    daily_occupancy AS (
      SELECT
        md.month,
        md.day,
        COUNT(*) FILTER (
          WHERE all_res.check_in_date <= md.day
            AND all_res.check_out_date > md.day
        )::int AS occupied_rooms
      FROM month_days md
      LEFT JOIN all_res
        ON all_res.check_in_date <= md.day
       AND all_res.check_out_date > md.day
      GROUP BY md.month, md.day
    )
    SELECT
      month,
      SUM(occupied_rooms)::int AS occupied_room_nights,
      COUNT(*)::int AS days_in_month
    FROM daily_occupancy
    GROUP BY month
    ORDER BY month
  `;

  const [monthlyResult, annualResult, occupancyResult] = await Promise.all([
    pool.query(monthlyQuery, [selectedYear]),
    pool.query(annualQuery),
    pool.query(occupancyQuery, [selectedYear]),
  ]);

  var occupancyByMonth = {};
  (occupancyResult.rows || []).forEach(function (row) {
    var m = Number(row.month);
    if (m >= 1 && m <= 12) {
      var daysInMonth = Number(row.days_in_month) || 0;
      var occupiedRoomNights = Number(row.occupied_room_nights) || 0;
      var maxRoomNights = daysInMonth * 4;
      occupancyByMonth[m] = {
        occupiedRoomNights: occupiedRoomNights,
        maxRoomNights: maxRoomNights,
        occupancyRate:
          maxRoomNights > 0
            ? Math.round((occupiedRoomNights / maxRoomNights) * 100)
            : 0,
      };
    }
  });

  // 12개월 배열 (1월~12월), 없으면 0
  var monthlyRevenue = Array(12).fill(0);
  var monthlyStats = Array(12)
    .fill(null)
    .map(function (_, index) {
      var month = index + 1;
      var occupancy = occupancyByMonth[month] || {
        occupiedRoomNights: 0,
        maxRoomNights: 0,
        occupancyRate: 0,
      };
      return {
        month: month,
        reservationCount: 0,
        cancelCount: 0,
        cancelRate: 0,
        revenue: 0,
        cancelRevenue: 0,
        occupiedRoomNights: occupancy.occupiedRoomNights,
        maxRoomNights: occupancy.maxRoomNights,
        occupancyRate: occupancy.occupancyRate,
      };
    });
  (monthlyResult.rows || []).forEach(function (row) {
    var m = Number(row.month);
    if (m >= 1 && m <= 12) {
      var reservationCount = Number(row.reservation_count) || 0;
      var cancelCount = Number(row.cancel_count) || 0;
      var revenue = Number(row.revenue) || 0;
      var occupancy = occupancyByMonth[m] || {
        occupiedRoomNights: 0,
        maxRoomNights: 0,
        occupancyRate: 0,
      };
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
        occupiedRoomNights: occupancy.occupiedRoomNights,
        maxRoomNights: occupancy.maxRoomNights,
        occupancyRate: occupancy.occupancyRate,
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

export async function handleAdminSales(res, pool, body) {
  var type = String(body.type || "monthly").trim().toLowerCase();

  try {
    await purgeExpiredBookings(pool);
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "retention purge failed"),
    });
    return;
  }

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
