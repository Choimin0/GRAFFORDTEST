import {
  formatPromotionDateFromDb,
  getTodayYmdKst,
  isPromotionInPeriod,
} from "./promotion-period.js";

const TABLE_NAME = '"room-rate"';

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

async function ensureRoomRateTable(pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      room_name VARCHAR(32) PRIMARY KEY,
      weekday_base_rate BIGINT NOT NULL CHECK (weekday_base_rate >= 0),
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ALTER COLUMN room_name TYPE VARCHAR(32)`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ADD COLUMN IF NOT EXISTS promotion_start_date DATE,
     ADD COLUMN IF NOT EXISTS promotion_end_date DATE`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
     ADD COLUMN IF NOT EXISTS weekend_base_rate BIGINT
     CHECK (weekend_base_rate IS NULL OR weekend_base_rate >= 0)`,
  );
  await pool.query(
    `INSERT INTO ${TABLE_NAME} (room_name, weekday_base_rate, weekend_base_rate, is_enabled)
     VALUES ('G1', 250000, 270000, TRUE), ('G2', 250000, 270000, TRUE),
            ('G3', 300000, 320000, TRUE), ('G4', 350000, 370000, TRUE),
            ('weekend-charge', 20000, NULL, TRUE), ('consecutive-sale', 20000, NULL, TRUE),
            ('promotion', 0, NULL, TRUE), ('extra-guest-charge', 30000, NULL, TRUE)
     ON CONFLICT (room_name) DO NOTHING`,
  );
  await pool.query(
    `UPDATE ${TABLE_NAME}
     SET weekend_base_rate = weekday_base_rate + 20000
     WHERE room_name IN ('G1', 'G2', 'G3', 'G4')
       AND weekend_base_rate IS NULL`,
  );
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
    await ensureRoomRateTable(pool);
    var sel = await pool.query(
      `SELECT room_name, weekday_base_rate, weekend_base_rate, is_enabled,
              promotion_start_date, promotion_end_date
       FROM ${TABLE_NAME}
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
    var promotionPeriod = { startDate: "", endDate: "" };
    var promotionInPeriod = true;
    var promotionPercent = 0;
    var chargeKeyMap = {
      "weekend-charge": "weekendCharge",
      "consecutive-sale": "consecutiveSale",
      promotion: "promotion",
      "extra-guest-charge": "extraGuestCharge",
    };
    var todayYmd = getTodayYmdKst();
    (sel.rows || []).forEach(function (row) {
      var n = Number(row.weekday_base_rate || 0);
      if (chargeKeyMap[row.room_name] !== undefined) {
        var key = chargeKeyMap[row.room_name];
        var enabled = isPolicyEnabled(row.is_enabled);
        chargeEnabled[key] = enabled;
        charges[key] = enabled ? n : 0;
        if (row.room_name === "promotion") {
          promotionPercent = Math.max(0, Math.min(100, Math.floor(n)));
          var start = formatPromotionDateFromDb(row.promotion_start_date);
          var end = formatPromotionDateFromDb(row.promotion_end_date);
          promotionPeriod = { startDate: start, endDate: end };
          promotionInPeriod = isPromotionInPeriod(todayYmd, start, end);
        }
      } else {
        rates[row.room_name] = n;
        if (/^G[1-4]$/.test(row.room_name)) {
          var weekendStored = row.weekend_base_rate;
          weekendBaseRates[row.room_name] =
            weekendStored == null ? n + 20000 : Number(weekendStored || 0);
        }
      }
    });
    json(res, 200, {
      ok: true,
      rates: rates,
      weekendBaseRates: weekendBaseRates,
      charges: charges,
      chargeEnabled: chargeEnabled,
      promotionPeriod: promotionPeriod,
      promotionInPeriod: promotionInPeriod,
      promotionPercent: promotionPercent,
    });
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "lookup failed"),
    });
  }
  return true;
}
