import { getTodayYmdKst } from "./promotion-period.js";

const ROOM_STATUS_TABLE = '"room-status"';

/** endDate는 숙박과 동일하게 배타적(해당 일자부터 예약 가능). */
export function isRoomBlockActive(endDate, todayYmd) {
  var end = String(endDate || "").slice(0, 10);
  var today = String(todayYmd || getTodayYmdKst()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return false;
  }
  return end > today;
}

export async function pruneExpiredRoomBlockItems(pool) {
  var today = getTodayYmdKst();
  await pool.query(
    `UPDATE ${ROOM_STATUS_TABLE}
     SET block_items = COALESCE(
       (
         SELECT jsonb_agg(item)
         FROM jsonb_array_elements(COALESCE(block_items, '[]'::jsonb)) AS item
         WHERE (item->>'endDate') > $1
           AND (item->>'startDate') <> ''
           AND (item->>'endDate') <> ''
           AND (item->>'startDate') < (item->>'endDate')
       ),
       '[]'::jsonb
     ),
     updated_at = NOW()
     WHERE EXISTS (
       SELECT 1
       FROM jsonb_array_elements(COALESCE(block_items, '[]'::jsonb)) AS item
       WHERE COALESCE(item->>'endDate', '0000-01-01') <= $1
     )`,
    [today],
  );
}
