import {
  formatPromotionDateFromDb,
  getTodayYmdKst,
  isPromotionInPeriod,
} from "./promotion-period.js";

const TABLE_NAME = '"room-rate"';
const BASE_ROW_FILTER = "period_start_date IS NULL AND period_end_date IS NULL";
const SEASONAL_ROW_FILTER =
  "period_start_date IS NOT NULL AND period_end_date IS NOT NULL";

function isPolicyEnabled(val) {
  if (
    val === false ||
    val === "f" ||
    val === "false" ||
    val === 0 ||
    val === "0"
  ) {
    return false;
  }
  return true;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(body));
}

function resolveSeasonalWeekendRate(
  weekdayBaseRate,
  weekendBaseRate,
  surchargeEnabled,
  surchargeAmount,
) {
  if (surchargeEnabled) {
    return Math.floor(weekdayBaseRate) + Math.floor(surchargeAmount || 0);
  }
  return Math.floor(Number(weekendBaseRate || 0));
}

async function ensureRoomRateSchema(pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id BIGSERIAL PRIMARY KEY,
      room_name VARCHAR(32) NOT NULL,
      weekday_base_rate BIGINT NOT NULL CHECK (weekday_base_rate >= 0),
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      period_start_date DATE,
      period_end_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ALTER COLUMN room_name TYPE VARCHAR(32)`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ADD COLUMN IF NOT EXISTS id BIGSERIAL`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ADD COLUMN IF NOT EXISTS promotion_start_date DATE,
     ADD COLUMN IF NOT EXISTS promotion_end_date DATE,
     ADD COLUMN IF NOT EXISTS promotion_stay_start_date DATE,
     ADD COLUMN IF NOT EXISTS promotion_stay_end_date DATE`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ADD COLUMN IF NOT EXISTS weekend_base_rate BIGINT
     CHECK (weekend_base_rate IS NULL OR weekend_base_rate >= 0)`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ADD COLUMN IF NOT EXISTS period_start_date DATE,
     ADD COLUMN IF NOT EXISTS period_end_date DATE`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ADD COLUMN IF NOT EXISTS seasonal_option_name VARCHAR(64)`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ADD COLUMN IF NOT EXISTS seasonal_priority INTEGER`,
  );
  await pool.query(`DROP TABLE IF EXISTS "room-rate-period"`);
  await pool.query(
    `DO $$
     BEGIN
       IF EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname = 'room-rate_pkey'
           AND conrelid = '"room-rate"'::regclass
       ) THEN
         ALTER TABLE "room-rate" DROP CONSTRAINT "room-rate_pkey";
       END IF;
     END $$`,
  );
  await pool.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname = 'room_rate_id_pkey'
           AND conrelid = '"room-rate"'::regclass
       ) THEN
         ALTER TABLE "room-rate" ADD CONSTRAINT room_rate_id_pkey PRIMARY KEY (id);
       END IF;
     END $$`,
  );
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS room_rate_base_room_name_key
     ON ${TABLE_NAME} (room_name)
     WHERE period_start_date IS NULL AND period_end_date IS NULL`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_room_rate_period_lookup
     ON ${TABLE_NAME} (room_name, period_start_date, period_end_date)
     WHERE period_start_date IS NOT NULL AND period_end_date IS NOT NULL`,
  );

  var seedRows = [
    ["G1", 280000, 280000],
    ["G2", 280000, 280000],
    ["G3", 320000, 320000],
    ["G4", 410000, 410000],
    ["weekend-charge", 20000, null],
    ["consecutive-sale", 20000, null],
    ["promotion", 0, null],
    ["extra-guest-charge", 30000, null],
  ];
  for (var si = 0; si < seedRows.length; si += 1) {
    var seed = seedRows[si];
    await pool.query(
      `INSERT INTO ${TABLE_NAME}
         (room_name, weekday_base_rate, weekend_base_rate, is_enabled)
       SELECT $1::varchar(32), $2::bigint, $3::bigint, TRUE
       WHERE NOT EXISTS (
         SELECT 1 FROM ${TABLE_NAME}
         WHERE room_name = $1::varchar(32) AND ${BASE_ROW_FILTER}
       )`,
      [seed[0], seed[1], seed[2]],
    );
  }
  await pool.query(
    `UPDATE ${TABLE_NAME}
     SET weekend_base_rate = weekday_base_rate + 20000
     WHERE room_name IN ('G1', 'G2', 'G3', 'G4')
       AND ${BASE_ROW_FILTER}
       AND weekend_base_rate IS NULL`,
  );
}

async function listSeasonalRates(pool, surchargeEnabled, surchargeAmount) {
  var sel = await pool.query(
    `SELECT id, room_name, seasonal_option_name, period_start_date, period_end_date,
            weekday_base_rate, weekend_base_rate, seasonal_priority, created_at, updated_at
     FROM ${TABLE_NAME}
     WHERE ${SEASONAL_ROW_FILTER}
     ORDER BY room_name ASC,
              COALESCE(seasonal_priority, 2147483647) ASC,
              id ASC`,
  );
  return (sel.rows || []).map(function (row) {
    var weekday = Number(row.weekday_base_rate || 0);
    var weekendStored = row.weekend_base_rate;
    return {
      id: Number(row.id),
      roomName: String(row.room_name || "").toUpperCase(),
      optionName: String(row.seasonal_option_name || "").trim(),
      startDate: formatPromotionDateFromDb(row.period_start_date),
      endDate: formatPromotionDateFromDb(row.period_end_date),
      weekdayBaseRate: weekday,
      weekendBaseRate: resolveSeasonalWeekendRate(
        weekday,
        weekendStored == null
          ? surchargeEnabled
            ? weekday + Math.floor(Number(surchargeAmount || 0))
            : weekday
          : weekendStored,
        surchargeEnabled,
        surchargeAmount,
      ),
      priority: Number(row.seasonal_priority || 0),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : "",
    };
  });
}

export async function handlePublicRoomRate(req, res, pool) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return true;
  }

  if (req.method !== "GET") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return true;
  }

  try {
    await ensureRoomRateSchema(pool);
    var sel = await pool.query(
      `SELECT room_name, weekday_base_rate, weekend_base_rate, is_enabled,
              promotion_start_date, promotion_end_date,
              promotion_stay_start_date, promotion_stay_end_date
       FROM ${TABLE_NAME}
       WHERE ${BASE_ROW_FILTER}
       ORDER BY room_name ASC`,
    );
    var rates = {};
    var weekendBaseRates = {};
    var charges = {
      weekendCharge: 20000,
      consecutiveSale: 20000,
      promotion: 0,
      extraGuestCharge: 30000,
    };
    var chargeEnabled = {
      weekendCharge: true,
      consecutiveSale: true,
      promotion: true,
      extraGuestCharge: true,
    };
    var promotionBookingPeriod = { startDate: "", endDate: "" };
    var promotionStayPeriod = { startDate: "", endDate: "" };
    var promotionInPeriod = true;
    var promotionPercent = 0;
    var chargeKeyMap = {
      "weekend-charge": "weekendCharge",
      "consecutive-sale": "consecutiveSale",
      promotion: "promotion",
      "extra-guest-charge": "extraGuestCharge",
    };
    var todayYmd = getTodayYmdKst();
    // weekend-charge는 room_name 정렬상 G1–G4보다 뒤에 오므로,
    // 요금 정책(ON/OFF)을 먼저 확정한 뒤 주말 요금을 계산한다.
    var storedWeekendByRoom = {};
    (sel.rows || []).forEach(function (row) {
      var n = Number(row.weekday_base_rate || 0);
      if (chargeKeyMap[row.room_name] !== undefined) {
        var key = chargeKeyMap[row.room_name];
        var enabled = isPolicyEnabled(row.is_enabled);
        chargeEnabled[key] = enabled;
        charges[key] = enabled ? n : 0;
        if (row.room_name === "promotion") {
          promotionPercent = Math.max(0, Math.min(100, Math.floor(n)));
          var bookingStart = formatPromotionDateFromDb(row.promotion_start_date);
          var bookingEnd = formatPromotionDateFromDb(row.promotion_end_date);
          var stayStart = formatPromotionDateFromDb(
            row.promotion_stay_start_date,
          );
          var stayEnd = formatPromotionDateFromDb(row.promotion_stay_end_date);
          promotionBookingPeriod = {
            startDate: bookingStart,
            endDate: bookingEnd,
          };
          promotionStayPeriod = { startDate: stayStart, endDate: stayEnd };
          promotionInPeriod = isPromotionInPeriod(
            todayYmd,
            bookingStart,
            bookingEnd,
          );
        }
      } else if (/^G[1-4]$/.test(row.room_name)) {
        rates[row.room_name] = n;
        storedWeekendByRoom[row.room_name] = row.weekend_base_rate;
      }
    });
    ["G1", "G2", "G3", "G4"].forEach(function (room) {
      if (rates[room] == null) {
        return;
      }
      var weekday = Number(rates[room] || 0);
      if (chargeEnabled.weekendCharge !== false) {
        weekendBaseRates[room] =
          weekday + Math.floor(Number(charges.weekendCharge || 0));
      } else {
        var weekendStored = storedWeekendByRoom[room];
        weekendBaseRates[room] =
          weekendStored == null ? weekday : Number(weekendStored || 0);
      }
    });
    var seasonalRates = await listSeasonalRates(
      pool,
      chargeEnabled.weekendCharge !== false,
      charges.weekendCharge,
    );
    json(res, 200, {
      ok: true,
      rates: rates,
      weekendBaseRates: weekendBaseRates,
      charges: charges,
      chargeEnabled: chargeEnabled,
      promotionBookingPeriod: promotionBookingPeriod,
      promotionStayPeriod: promotionStayPeriod,
      /** @deprecated promotionBookingPeriod 사용 */
      promotionPeriod: promotionBookingPeriod,
      promotionInPeriod: promotionInPeriod,
      promotionPercent: promotionPercent,
      seasonalRates: seasonalRates,
    });
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "lookup failed"),
    });
  }
  return true;
}
