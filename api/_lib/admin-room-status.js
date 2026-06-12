import { json } from "./admin-common.js";
import {
  isRoomBlockActive,
  pruneExpiredRoomBlockItems,
} from "./room-block-period.js";

const TABLE_NAME = '"room-status"';

function normalizeBlockItems(value) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (_e) {
      value = [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .map(function (item) {
      return {
        id: String((item && item.id) || "").trim(),
        startDate: String((item && item.startDate) || "").slice(0, 10),
        endDate: String((item && item.endDate) || "").slice(0, 10),
        reason: String((item && item.reason) || "").trim(),
        memo: String((item && item.memo) || "").trim(),
        createdAt: String((item && item.createdAt) || "").trim(),
      };
    })
    .filter(function (item) {
      return (
        item.id &&
        item.startDate &&
        item.endDate &&
        item.startDate < item.endDate &&
        isRoomBlockActive(item.endDate)
      );
    });
}

function makeBlockId() {
  return (
    "block-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 8)
  );
}

async function ensureRoomStatusTable(pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      room_name VARCHAR(16) PRIMARY KEY,
      status_text TEXT NOT NULL DEFAULT '',
      status_type VARCHAR(20) NOT NULL DEFAULT 'available',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      block_items JSONB NOT NULL DEFAULT '[]'::jsonb
    )`,
  );
  await pool.query(
    `ALTER TABLE ${TABLE_NAME}
       ADD COLUMN IF NOT EXISTS status_type VARCHAR(20) NOT NULL DEFAULT 'available',
       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       ADD COLUMN IF NOT EXISTS block_items JSONB NOT NULL DEFAULT '[]'::jsonb`,
  );
  await pool.query(
    `INSERT INTO ${TABLE_NAME} (room_name, status_text, status_type)
     VALUES
       ('G1', '', 'available'),
       ('G2', '', 'available'),
       ('G3', '', 'available'),
       ('G4', '', 'available')
     ON CONFLICT (room_name) DO NOTHING`,
  );
}

export async function handleAdminRoomStatus(res, pool, body) {
  try {
    await ensureRoomStatusTable(pool);
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "room-status table init failed"),
    });
    return;
  }

  var action = String(body.action || "list").trim().toLowerCase();
  if (action === "save") {
    var roomName = String(body.roomName || "")
      .trim()
      .toUpperCase();
    if (!/^G[1-4]$/.test(roomName)) {
      json(res, 400, { ok: false, error: "유효하지 않은 객실명입니다." });
      return;
    }
    var statusText = String(body.statusText || "");
    var statusType =
      String(body.statusType || "").trim().toLowerCase() === "repair"
        ? "repair"
        : "available";
    try {
      await pool.query(
        `UPDATE ${TABLE_NAME}
         SET status_text = $2,
             status_type = $3,
             updated_at = NOW()
         WHERE room_name = $1`,
        [roomName, statusText, statusType],
      );
    } catch (e) {
      json(res, 500, {
        ok: false,
        error: String((e && e.message) || e || "save failed"),
      });
      return;
    }
  }

  if (action === "block-save") {
    var rooms = Array.isArray(body.rooms) ? body.rooms : [];
    var normalizedRooms = rooms
      .map(function (room) {
        return String(room || "").trim().toUpperCase();
      })
      .filter(function (room, index, arr) {
        return /^G[1-4]$/.test(room) && arr.indexOf(room) === index;
      });
    var startDate = String(body.startDate || "").slice(0, 10);
    var endDate = String(body.endDate || "").slice(0, 10);
    var reason = String(body.reason || "").trim();
    var memo = String(body.memo || "").trim();
    if (!normalizedRooms.length || !startDate || !endDate || startDate >= endDate || !reason) {
      json(res, 400, { ok: false, error: "객실/기간/사유를 확인해주세요." });
      return;
    }
    var block = {
      id: makeBlockId(),
      startDate: startDate,
      endDate: endDate,
      reason: reason,
      memo: memo,
      createdAt: new Date().toISOString(),
    };
    try {
      for (var bi = 0; bi < normalizedRooms.length; bi += 1) {
        await pool.query(
          `UPDATE ${TABLE_NAME}
           SET block_items = COALESCE(block_items, '[]'::jsonb) || $2::jsonb,
               updated_at = NOW()
           WHERE room_name = $1`,
          [normalizedRooms[bi], JSON.stringify([block])],
        );
      }
    } catch (e) {
      json(res, 500, { ok: false, error: String((e && e.message) || e || "block save failed") });
      return;
    }
  }

  if (action === "block-release") {
    var blockId = String(body.blockId || "").trim();
    if (!blockId) {
      json(res, 400, { ok: false, error: "해제할 방막기 항목이 없습니다." });
      return;
    }
    try {
      await pool.query(
        `UPDATE ${TABLE_NAME}
         SET block_items = COALESCE(
           (
             SELECT jsonb_agg(item)
             FROM jsonb_array_elements(COALESCE(block_items, '[]'::jsonb)) AS item
             WHERE item->>'id' <> $1
           ),
           '[]'::jsonb
         ),
         updated_at = NOW()`,
        [blockId],
      );
    } catch (e) {
      json(res, 500, { ok: false, error: String((e && e.message) || e || "block release failed") });
      return;
    }
  }

  try {
    await pruneExpiredRoomBlockItems(pool);
    var sel = await pool.query(
      `SELECT
         room_name,
         status_text,
         status_type,
         block_items,
         TO_CHAR(updated_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS updated_ymd
       FROM ${TABLE_NAME}
       ORDER BY room_name ASC`,
    );
    json(res, 200, {
      ok: true,
      rows: (sel.rows || []).map(function (row) {
        return {
          roomName: row.room_name,
          statusText: row.status_text || "",
          statusType: row.status_type === "repair" ? "repair" : "available",
          updatedAt: row.updated_ymd || "",
        };
      }),
      blockRows: (sel.rows || []).reduce(function (acc, row) {
        normalizeBlockItems(row.block_items).forEach(function (item) {
          acc.push({
            id: item.id,
            roomName: row.room_name,
            startDate: item.startDate,
            endDate: item.endDate,
            reason: item.reason,
            memo: item.memo,
            createdAt: item.createdAt,
          });
        });
        return acc;
      }, []),
    });
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "lookup failed"),
    });
  }
}
