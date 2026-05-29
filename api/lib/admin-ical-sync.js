import { json } from "./admin-common.js";
import {
  syncAllExternalBookings,
  getExternalBookingCalendarRows,
  getAllIcalImportTargets,
  normalizeRoomType,
} from "./ical-sync.js";

export async function handleAdminIcalSync(res, pool, body) {
  var roomFilter = normalizeRoomType(body.room || "");
  var targets = getAllIcalImportTargets();
  if (roomFilter) {
    targets = targets.filter(function (target) {
      return target.room === roomFilter;
    });
  }

  if (!targets.length) {
    json(res, 400, {
      ok: false,
      error: "에어비앤비 iCal import URL이 설정되어 있지 않습니다.",
    });
    return;
  }

  try {
    var sync = await syncAllExternalBookings(
      pool,
      roomFilter || undefined,
    );
    var externalRows = await getExternalBookingCalendarRows(pool);
    var successCount = (sync.results || []).filter(function (row) {
      return row.ok;
    }).length;
    var failedCount = (sync.results || []).filter(function (row) {
      return !row.ok;
    }).length;

    json(res, 200, {
      ok: true,
      mode: "admin",
      targetCount: sync.targetCount,
      successCount: successCount,
      failedCount: failedCount,
      results: sync.results || [],
      externalRows: externalRows,
    });
  } catch (e) {
    json(res, 500, {
      ok: false,
      error: String((e && e.message) || e || "iCal sync failed"),
    });
  }
}
