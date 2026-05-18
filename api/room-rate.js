import pg from "pg";

const { Pool } = pg;
const TABLE_NAME = '"room-rate"';

var poolSingleton = null;

function getDatabaseUrl() {
  return String(
    process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL ||
      "",
  ).trim();
}

function getPool() {
  var databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }
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
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
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
    `INSERT INTO ${TABLE_NAME} (room_name, weekday_base_rate, is_enabled)
     VALUES ('G1', 250000, TRUE), ('G2', 250000, TRUE), ('G3', 300000, TRUE), ('G4', 350000, TRUE),
            ('weekend-charge', 20000, TRUE), ('consecutive-sale', 20000, TRUE),
            ('promotion', 0, TRUE), ('extra-guest-charge', 30000, TRUE)
     ON CONFLICT (room_name) DO NOTHING`,
  );
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method !== "GET") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  var pool = getPool();
  if (!pool) {
    json(res, 503, { ok: false, error: "DB 연결 정보가 없습니다." });
    return;
  }

  try {
    await ensureRoomRateTable(pool);
    var sel = await pool.query(
      `SELECT room_name, weekday_base_rate, is_enabled
       FROM ${TABLE_NAME}
       ORDER BY room_name ASC`,
    );
    var rates = {};
    var charges = {
      weekendCharge: 20000,
      consecutiveSale: 20000,
      promotion: 0,
      extraGuestCharge: 30000,
    };
    var chargeKeyMap = {
      "weekend-charge": "weekendCharge",
      "consecutive-sale": "consecutiveSale",
      "promotion": "promotion",
      "extra-guest-charge": "extraGuestCharge",
    };
    (sel.rows || []).forEach(function (row) {
      var n = Number(row.weekday_base_rate || 0);
      if (chargeKeyMap[row.room_name] !== undefined) {
        charges[chargeKeyMap[row.room_name]] = row.is_enabled === false ? 0 : n;
      } else {
        rates[row.room_name] = n;
      }
    });
    json(res, 200, { ok: true, rates: rates, charges: charges });
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "lookup failed"),
    });
  }
}
