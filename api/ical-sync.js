import { getPool, json } from "./lib/admin-common.js";
import {
  syncAllExternalBookings,
  getAllIcalImportTargets,
  normalizeRoomType,
} from "./lib/ical-sync.js";

function isAuthorizedSync(req) {
  var syncToken = String(
    process.env.ICAL_SYNC_SECRET || process.env.ICAL_SYNC_CRON_SECRET || "",
  ).trim();
  if (!syncToken) {
    return false;
  }

  var qToken = "";
  try {
    var url = new URL(req.url || "", "http://localhost");
    qToken = String(url.searchParams.get("token") || "").trim();
  } catch (_e) {
    qToken = "";
  }
  return qToken === syncToken;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  if (!isAuthorizedSync(req)) {
    json(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  var pool = getPool();
  if (!pool) {
    json(res, 503, {
      ok: false,
      error: "DB 연결 정보가 없습니다.",
    });
    return;
  }

  var roomFilter = "";
  try {
    var parsedUrl = new URL(req.url || "", "http://localhost");
    roomFilter = normalizeRoomType(parsedUrl.searchParams.get("room") || "");
  } catch (_e) {
    roomFilter = "";
  }

  var targets = getAllIcalImportTargets();
  if (roomFilter) {
    targets = targets.filter(function (t) {
      return t.room === roomFilter;
    });
  }

  if (!targets.length) {
    json(res, 200, {
      ok: true,
      message: roomFilter
        ? "No iCal import URLs configured for " + roomFilter
        : "No iCal import URLs configured",
      targetCount: 0,
      results: [],
    });
    return;
  }

  try {
    var summary = await syncAllExternalBookings(pool, roomFilter || "");
    var failed = summary.results.filter(function (r) {
      return !r.ok;
    });
    json(res, 200, {
      ok: failed.length === 0,
      mode: "manual",
      targetCount: summary.targetCount,
      successCount: summary.results.length - failed.length,
      failedCount: failed.length,
      results: summary.results,
    });
  } catch (e) {
    console.error("ical-sync", e);
    json(res, 500, {
      ok: false,
      error: String(e && e.message ? e.message : e),
      code: e.code || null,
    });
  }
}
