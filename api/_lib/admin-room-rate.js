import { json } from "./admin-common.js";
import {
  formatPromotionDateFromDb,
  getTodayYmdKst,
  isPromotionInPeriod,
  normalizePromotionDate,
} from "./promotion-period.js";

const TABLE_NAME = '"room-rate"';
const BASE_ROW_FILTER = "period_start_date IS NULL AND period_end_date IS NULL";
const SEASONAL_ROW_FILTER =
  "period_start_date IS NOT NULL AND period_end_date IS NOT NULL";

var SPECIAL_CHARGE_NAMES = [
  "weekend-charge",
  "consecutive-sale",
  "promotion",
  "extra-guest-charge",
];

function normalizeRoomName(v) {
  var trimmed = String(v || "").trim();
  if (SPECIAL_CHARGE_NAMES.includes(trimmed.toLowerCase())) {
    return trimmed.toLowerCase();
  }
  return trimmed.toUpperCase();
}

function isSeasonalRow(row) {
  return !!(row && row.period_start_date && row.period_end_date);
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
     ADD COLUMN IF NOT EXISTS promotion_end_date DATE`,
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
     ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
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

async function getWeekendChargeAmount(pool) {
  var sel = await pool.query(
    `SELECT weekday_base_rate, is_enabled
     FROM ${TABLE_NAME}
     WHERE room_name = 'weekend-charge' AND ${BASE_ROW_FILTER}
     LIMIT 1`,
  );
  var row = sel.rows && sel.rows[0];
  if (!row || row.is_enabled === false) {
    return 0;
  }
  return Number(row.weekday_base_rate || 0);
}

async function syncBaseWeekendRatesFromSurcharge(pool) {
  var surchargeEnabled = await isWeekendSurchargeEnabled(pool);
  if (!surchargeEnabled) {
    return;
  }
  var surchargeAmount = await getWeekendChargeAmount(pool);
  await pool.query(
    `UPDATE ${TABLE_NAME}
     SET weekend_base_rate = weekday_base_rate + $1,
         updated_at = NOW()
     WHERE room_name IN ('G1', 'G2', 'G3', 'G4')
       AND ${BASE_ROW_FILTER}`,
    [Math.floor(surchargeAmount || 0)],
  );
}

async function isWeekendSurchargeEnabled(pool) {
  var sel = await pool.query(
    `SELECT is_enabled
     FROM ${TABLE_NAME}
     WHERE room_name = 'weekend-charge' AND ${BASE_ROW_FILTER}
     LIMIT 1`,
  );
  var row = sel.rows && sel.rows[0];
  return !(row && row.is_enabled === false);
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

function mapRoomRateRow(row, surchargeEnabled, surchargeAmount) {
  var out = {
    roomName: row.room_name,
    weekdayBaseRate: Number(row.weekday_base_rate || 0),
    isEnabled: row.is_enabled !== false,
  };
  if (/^G[1-4]$/.test(row.room_name) && !isSeasonalRow(row)) {
    var weekday = Number(row.weekday_base_rate || 0);
    if (surchargeEnabled) {
      out.weekendBaseRate = weekday + Math.floor(surchargeAmount || 0);
    } else {
      var weekendRate = row.weekend_base_rate;
      out.weekendBaseRate =
        weekendRate == null ? weekday : Number(weekendRate || 0);
    }
  }
  if (row.room_name === "promotion") {
    var promoFields = mapPromotionRowFields(row);
    out.promotionStartDate = promoFields.promotionStartDate;
    out.promotionEndDate = promoFields.promotionEndDate;
  }
  return out;
}

function mapSeasonalRow(row, surchargeEnabled, surchargeAmount) {
  var weekday = Number(row.weekday_base_rate || 0);
  var weekendStored = row.weekend_base_rate;
  var weekend = resolveSeasonalWeekendRate(
    weekday,
    weekendStored == null ? weekday + surchargeAmount : weekendStored,
    surchargeEnabled,
    surchargeAmount,
  );
  return {
    id: Number(row.id),
    roomName: String(row.room_name || "").toUpperCase(),
    startDate: formatPromotionDateFromDb(row.period_start_date),
    endDate: formatPromotionDateFromDb(row.period_end_date),
    weekdayBaseRate: weekday,
    weekendBaseRate: weekend,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : "",
  };
}

function validateSeasonalPayload(body, surchargeEnabled, surchargeAmount) {
  var roomName = normalizeRoomName(body.roomName || "");
  if (!/^G[1-4]$/.test(roomName)) {
    return { error: "유효하지 않은 객실명입니다." };
  }
  var startDate = normalizePromotionDate(body.startDate);
  var endDate = normalizePromotionDate(body.endDate);
  if (!startDate || !endDate) {
    return { error: "적용 기간의 시작일과 종료일을 모두 입력해 주세요." };
  }
  if (startDate > endDate) {
    return { error: "종료일은 시작일 이후여야 합니다." };
  }
  var weekdayBaseRate = Number(body.weekdayBaseRate);
  if (!Number.isFinite(weekdayBaseRate) || weekdayBaseRate < 0) {
    return { error: "유효하지 않은 평일 요금입니다." };
  }
  var weekendBaseRate =
    body.weekendBaseRate == null || body.weekendBaseRate === ""
      ? null
      : Number(body.weekendBaseRate);
  if (
    !surchargeEnabled &&
    (!Number.isFinite(weekendBaseRate) || weekendBaseRate < 0)
  ) {
    return { error: "유효하지 않은 주말 요금입니다." };
  }
  var resolvedWeekend = resolveSeasonalWeekendRate(
    weekdayBaseRate,
    weekendBaseRate,
    surchargeEnabled,
    surchargeAmount,
  );
  return {
    roomName: roomName,
    startDate: startDate,
    endDate: endDate,
    weekdayBaseRate: Math.floor(weekdayBaseRate),
    weekendBaseRate: resolvedWeekend,
  };
}

async function listSeasonalRates(pool) {
  var surchargeEnabled = await isWeekendSurchargeEnabled(pool);
  var surchargeAmount = await getWeekendChargeAmount(pool);
  var sel = await pool.query(
    `SELECT id, room_name, period_start_date, period_end_date,
            weekday_base_rate, weekend_base_rate, created_at, updated_at
     FROM ${TABLE_NAME}
     WHERE ${SEASONAL_ROW_FILTER}
     ORDER BY updated_at DESC, id DESC`,
  );
  return (sel.rows || []).map(function (row) {
    return mapSeasonalRow(row, surchargeEnabled, surchargeAmount);
  });
}

async function saveSeasonalRate(pool, body) {
  var surchargeEnabled = await isWeekendSurchargeEnabled(pool);
  var surchargeAmount = await getWeekendChargeAmount(pool);
  var payload = validateSeasonalPayload(
    body,
    surchargeEnabled,
    surchargeAmount,
  );
  if (payload.error) {
    return payload;
  }
  await pool.query(
    `INSERT INTO ${TABLE_NAME}
       (room_name, weekday_base_rate, weekend_base_rate,
        period_start_date, period_end_date, is_enabled)
     VALUES ($1, $2, $3, $4::date, $5::date, TRUE)`,
    [
      payload.roomName,
      payload.weekdayBaseRate,
      payload.weekendBaseRate,
      payload.startDate,
      payload.endDate,
    ],
  );
  return { ok: true };
}

async function updateSeasonalRate(pool, body) {
  var id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return { error: "유효하지 않은 요금 옵션입니다." };
  }
  var surchargeEnabled = await isWeekendSurchargeEnabled(pool);
  var surchargeAmount = await getWeekendChargeAmount(pool);
  var payload = validateSeasonalPayload(
    body,
    surchargeEnabled,
    surchargeAmount,
  );
  if (payload.error) {
    return payload;
  }
  var upd = await pool.query(
    `UPDATE ${TABLE_NAME}
     SET room_name = $2,
         weekday_base_rate = $3,
         weekend_base_rate = $4,
         period_start_date = $5::date,
         period_end_date = $6::date,
         updated_at = NOW()
     WHERE id = $1 AND ${SEASONAL_ROW_FILTER}
     RETURNING id`,
    [
      id,
      payload.roomName,
      payload.weekdayBaseRate,
      payload.weekendBaseRate,
      payload.startDate,
      payload.endDate,
    ],
  );
  if (!upd.rows || !upd.rows.length) {
    return { error: "요금 옵션을 찾을 수 없습니다." };
  }
  return { ok: true };
}

async function deleteSeasonalRate(pool, id) {
  var periodId = Number(id);
  if (!Number.isFinite(periodId) || periodId <= 0) {
    return { error: "유효하지 않은 요금 옵션입니다." };
  }
  var del = await pool.query(
    `DELETE FROM ${TABLE_NAME}
     WHERE id = $1 AND ${SEASONAL_ROW_FILTER}
     RETURNING id`,
    [periodId],
  );
  if (!del.rows || !del.rows.length) {
    return { error: "요금 옵션을 찾을 수 없습니다." };
  }
  return { ok: true };
}

async function saveRoomRateRow(pool, roomName, weekdayBaseRate, weekendBaseRate) {
  if (roomName === "promotion") {
    throw new Error("use promotion save path");
  }
  if (/^G[1-4]$/.test(roomName)) {
    var weekendVal =
      weekendBaseRate == null || !Number.isFinite(Number(weekendBaseRate))
        ? Math.floor(weekdayBaseRate) + 20000
        : Math.floor(Number(weekendBaseRate));
    await pool.query(
      `UPDATE ${TABLE_NAME}
       SET weekday_base_rate = $2,
           weekend_base_rate = $3,
           updated_at = NOW()
       WHERE room_name = $1 AND ${BASE_ROW_FILTER}`,
      [roomName, Math.floor(weekdayBaseRate), weekendVal],
    );
    return;
  }
  await pool.query(
    `UPDATE ${TABLE_NAME}
     SET weekday_base_rate = $2,
         updated_at = NOW()
     WHERE room_name = $1 AND ${BASE_ROW_FILTER}`,
    [roomName, Math.floor(weekdayBaseRate)],
  );
}

function mapPromotionRowFields(row) {
  return {
    promotionStartDate: formatPromotionDateFromDb(row.promotion_start_date),
    promotionEndDate: formatPromotionDateFromDb(row.promotion_end_date),
  };
}

export async function handleAdminRoomRate(res, pool, body) {
  try {
    await ensureRoomRateSchema(pool);
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "room-rate table init failed"),
    });
    return;
  }

  var action = String(body.action || "list").trim().toLowerCase();

  if (action === "seasonal-save") {
    try {
      var saveResult = await saveSeasonalRate(pool, body);
      if (saveResult.error) {
        json(res, 400, { ok: false, error: saveResult.error });
        return;
      }
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: String((e && e.message) || e || "seasonal save failed"),
      });
      return;
    }
  }

  if (action === "seasonal-update") {
    try {
      var updateResult = await updateSeasonalRate(pool, body);
      if (updateResult.error) {
        json(res, 400, { ok: false, error: updateResult.error });
        return;
      }
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: String((e && e.message) || e || "seasonal update failed"),
      });
      return;
    }
  }

  if (action === "seasonal-delete") {
    try {
      var deleteResult = await deleteSeasonalRate(pool, body.id);
      if (deleteResult.error) {
        json(res, 400, { ok: false, error: deleteResult.error });
        return;
      }
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: String((e && e.message) || e || "seasonal delete failed"),
      });
      return;
    }
  }

  if (action === "save-batch") {
    var items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) {
      json(res, 400, { ok: false, error: "저장할 객실 요금이 없습니다." });
      return;
    }
    try {
      for (var bi = 0; bi < items.length; bi += 1) {
        var item = items[bi] || {};
        var batchRoomName = normalizeRoomName(item.roomName || "");
        if (!/^G[1-4]$/.test(batchRoomName)) {
          json(res, 400, { ok: false, error: "유효하지 않은 객실명입니다." });
          return;
        }
        var batchWeekday = Number(item.weekdayBaseRate);
        var batchWeekend =
          item.weekendBaseRate == null || item.weekendBaseRate === ""
            ? null
            : Number(item.weekendBaseRate);
        if (!Number.isFinite(batchWeekday) || batchWeekday < 0) {
          json(res, 400, { ok: false, error: "유효하지 않은 평일 요금입니다." });
          return;
        }
        if (
          batchWeekend != null &&
          (!Number.isFinite(batchWeekend) || batchWeekend < 0)
        ) {
          json(res, 400, { ok: false, error: "유효하지 않은 주말 요금입니다." });
          return;
        }
        await saveRoomRateRow(pool, batchRoomName, batchWeekday, batchWeekend);
      }
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: String((e && e.message) || e || "batch save failed"),
      });
      return;
    }
  }

  if (action === "save") {
    var roomName = normalizeRoomName(body.roomName || "");
    var weekdayBaseRate = Number(body.weekdayBaseRate);
    var weekendBaseRate =
      body.weekendBaseRate == null || body.weekendBaseRate === ""
        ? null
        : Number(body.weekendBaseRate);
    var isGRoom = /^G[1-4]$/.test(roomName);
    var isCharge = SPECIAL_CHARGE_NAMES.includes(roomName);
    if (!isGRoom && !isCharge) {
      json(res, 400, { ok: false, error: "유효하지 않은 객실명입니다." });
      return;
    }
    if (!Number.isFinite(weekdayBaseRate) || weekdayBaseRate < 0) {
      json(res, 400, { ok: false, error: "유효하지 않은 요금입니다." });
      return;
    }
    if (
      isGRoom &&
      weekendBaseRate != null &&
      (!Number.isFinite(weekendBaseRate) || weekendBaseRate < 0)
    ) {
      json(res, 400, { ok: false, error: "유효하지 않은 주말 요금입니다." });
      return;
    }
    if (roomName === "promotion" && weekdayBaseRate > 100) {
      json(res, 400, { ok: false, error: "프로모션 할인율은 0~100% 사이로 입력해 주세요." });
      return;
    }
    var promoStart = null;
    var promoEnd = null;
    if (roomName === "promotion") {
      var startRaw = normalizePromotionDate(body.promotionStartDate);
      var endRaw = normalizePromotionDate(body.promotionEndDate);
      if (startRaw || endRaw) {
        if (!startRaw || !endRaw) {
          json(res, 400, {
            ok: false,
            error: "프로모션 적용 기간의 시작일과 종료일을 모두 입력해 주세요.",
          });
          return;
        }
        if (startRaw > endRaw) {
          json(res, 400, {
            ok: false,
            error: "프로모션 종료일은 시작일 이후여야 합니다.",
          });
          return;
        }
        promoStart = startRaw;
        promoEnd = endRaw;
      }
    }
    try {
      if (roomName === "promotion") {
        await pool.query(
          `UPDATE ${TABLE_NAME}
           SET weekday_base_rate = $2,
               promotion_start_date = $3::date,
               promotion_end_date = $4::date,
               updated_at = NOW()
           WHERE room_name = $1 AND ${BASE_ROW_FILTER}`,
          [roomName, Math.floor(weekdayBaseRate), promoStart, promoEnd],
        );
      } else {
        await saveRoomRateRow(
          pool,
          roomName,
          weekdayBaseRate,
          isGRoom ? weekendBaseRate : null,
        );
        if (roomName === "weekend-charge") {
          await syncBaseWeekendRatesFromSurcharge(pool);
        }
      }
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: String((e && e.message) || e || "save failed"),
      });
      return;
    }
  }

  if (action === "toggle") {
    var toggleRoomName = normalizeRoomName(body.roomName || "");
    var isToggleCharge = SPECIAL_CHARGE_NAMES.includes(toggleRoomName);
    if (!isToggleCharge) {
      json(res, 400, { ok: false, error: "유효하지 않은 요금 정책입니다." });
      return;
    }
    try {
      await pool.query(
        `UPDATE ${TABLE_NAME}
         SET is_enabled = $2,
             updated_at = NOW()
         WHERE room_name = $1 AND ${BASE_ROW_FILTER}`,
        [toggleRoomName, body.isEnabled === true],
      );
      if (toggleRoomName === "weekend-charge" && body.isEnabled === true) {
        await syncBaseWeekendRatesFromSurcharge(pool);
      }
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: String((e && e.message) || e || "toggle failed"),
      });
      return;
    }
  }

  try {
    var sel = await pool.query(
      `SELECT room_name, weekday_base_rate, weekend_base_rate, is_enabled,
              promotion_start_date, promotion_end_date
       FROM ${TABLE_NAME}
       WHERE ${BASE_ROW_FILTER}
       ORDER BY room_name ASC`,
    );
    var todayYmd = getTodayYmdKst();
    var surchargeEnabled = await isWeekendSurchargeEnabled(pool);
    var surchargeAmount = await getWeekendChargeAmount(pool);
    var rows = (sel.rows || []).map(function (row) {
      var out = mapRoomRateRow(row, surchargeEnabled, surchargeAmount);
      if (row.room_name === "promotion") {
        out.promotionInPeriod = isPromotionInPeriod(
          todayYmd,
          out.promotionStartDate,
          out.promotionEndDate,
        );
      }
      return out;
    });
    var seasonalRates = await listSeasonalRates(pool);
    json(res, 200, { ok: true, rows: rows, seasonalRates: seasonalRates });
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "lookup failed"),
    });
  }
}
