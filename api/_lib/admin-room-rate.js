import { json } from "./admin-common.js";
import {
  formatPromotionDateFromDb,
  getTodayYmdKst,
  isPromotionInPeriod,
  normalizePromotionDate,
} from "./promotion-period.js";

const TABLE_NAME = '"room-rate"';

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
    `INSERT INTO ${TABLE_NAME} (room_name, weekday_base_rate, is_enabled)
     VALUES ('G1', 250000, TRUE), ('G2', 250000, TRUE), ('G3', 300000, TRUE), ('G4', 350000, TRUE),
            ('weekend-charge', 20000, TRUE), ('consecutive-sale', 20000, TRUE),
            ('promotion', 0, TRUE), ('extra-guest-charge', 30000, TRUE)
     ON CONFLICT (room_name) DO NOTHING`,
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
    await ensureRoomRateTable(pool);
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "room-rate table init failed"),
    });
    return;
  }

  var action = String(body.action || "list").trim().toLowerCase();
  if (action === "save") {
    var roomName = normalizeRoomName(body.roomName || "");
    var weekdayBaseRate = Number(body.weekdayBaseRate);
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
           WHERE room_name = $1`,
          [roomName, Math.floor(weekdayBaseRate), promoStart, promoEnd],
        );
      } else {
        await pool.query(
          `UPDATE ${TABLE_NAME}
           SET weekday_base_rate = $2,
               updated_at = NOW()
           WHERE room_name = $1`,
          [roomName, Math.floor(weekdayBaseRate)],
        );
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
         WHERE room_name = $1`,
        [toggleRoomName, body.isEnabled === true],
      );
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
      `SELECT room_name, weekday_base_rate, is_enabled,
              promotion_start_date, promotion_end_date
       FROM ${TABLE_NAME}
       ORDER BY room_name ASC`,
    );
    var todayYmd = getTodayYmdKst();
    var rows = (sel.rows || []).map(function (row) {
      var out = {
        roomName: row.room_name,
        weekdayBaseRate: Number(row.weekday_base_rate || 0),
        isEnabled: row.is_enabled !== false,
      };
      if (row.room_name === "promotion") {
        var promoFields = mapPromotionRowFields(row);
        out.promotionStartDate = promoFields.promotionStartDate;
        out.promotionEndDate = promoFields.promotionEndDate;
        out.promotionInPeriod = isPromotionInPeriod(
          todayYmd,
          promoFields.promotionStartDate,
          promoFields.promotionEndDate,
        );
      }
      return out;
    });
    json(res, 200, { ok: true, rows: rows });
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "lookup failed"),
    });
  }
}
