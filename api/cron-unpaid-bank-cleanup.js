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
  res.end(JSON.stringify(body));
}

function isAuthorizedCronRequest(req) {
  var cronSecret = String(process.env.CRON_SECRET || "").trim();
  var authHeader = String(req.headers.authorization || "");
  var expected = cronSecret ? "Bearer " + cronSecret : "";
  if (expected && authHeader === expected) {
    return true;
  }
  return String(req.headers["x-vercel-cron"] || "") === "1";
}

async function archivePastReservations(client) {
  var result = await client.query(
    `WITH moved AS (
      DELETE FROM ${ACTIVE_TABLE}
      WHERE check_in_date < CURRENT_DATE
      RETURNING *
    )
    INSERT INTO ${PAST_TABLE}
    SELECT * FROM moved
    ON CONFLICT (reservation_number) DO NOTHING
    RETURNING reservation_number`,
  );
  return (result.rows || []).length;
}

async function autoCancelUnpaidReservations(client, tableName) {
  var result = await client.query(
    `WITH moved AS (
      DELETE FROM ${tableName}
      WHERE coalesce(lower(trim(payment_method)), 'bank') IN ('bank', '무통장입금')
        AND bank_confirmed IS NOT TRUE
        AND created_at <= NOW() - INTERVAL '12 hours'
      RETURNING *
    )
    INSERT INTO ${DELETED_TABLE} (
      reservation_number,
      guest_name,
      contact,
      room_type,
      check_in_date,
      check_out_date,
      guest_count,
      created_at,
      stay_nights,
      extra_guests,
      total_amount,
      payment_method,
      guest_request,
      bank_confirmed,
      cancel_reason
    )
    SELECT
      reservation_number,
      guest_name,
      contact,
      room_type,
      check_in_date,
      check_out_date,
      guest_count,
      created_at,
      stay_nights,
      extra_guests,
      total_amount,
      payment_method,
      guest_request,
      bank_confirmed,
      'not paid'
    FROM moved
    ON CONFLICT (reservation_number) DO NOTHING
    RETURNING reservation_number`,
  );
  return (result.rows || []).length;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }
  if (!isAuthorizedCronRequest(req)) {
    json(res, 401, { ok: false, error: "Unauthorized cron request" });
    return;
  }

  var pool = getPool();
  if (!pool) {
    json(res, 503, { ok: false, error: "DB connection is not configured." });
    return;
  }

  try {
    var client = await pool.connect();
    var locked = false;
    try {
      // Prevent overlapping cron runs from doing duplicate heavy work.
      var lockRes = await client.query(
        "SELECT pg_try_advisory_lock(987654321) AS locked",
      );
      locked = !!(lockRes.rows && lockRes.rows[0] && lockRes.rows[0].locked === true);
      if (!locked) {
        json(res, 200, {
          ok: true,
          skipped: true,
          reason: "cleanup already running",
          ranAt: new Date().toISOString(),
        });
        return;
      }

      await client.query("BEGIN");
      var archivedCount = await archivePastReservations(client);
      var cancelledActive = await autoCancelUnpaidReservations(
        client,
        ACTIVE_TABLE,
      );
      var cancelledPast = await autoCancelUnpaidReservations(client, PAST_TABLE);
      await client.query("COMMIT");

      json(res, 200, {
        ok: true,
        archivedPastReservations: archivedCount,
        cancelledForNotPaid: cancelledActive + cancelledPast,
        cancelledFromActive: cancelledActive,
        cancelledFromPast: cancelledPast,
        ranAt: new Date().toISOString(),
      });

    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      if (locked) {
        try {
          await client.query("SELECT pg_advisory_unlock(987654321)");
        } catch (_e) {
          // Best effort unlock; connection release will follow.
        }
      }
      client.release();
    }
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "Cron cleanup failed"),
    });
  }
}
