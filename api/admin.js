/**
 * POST /api/admin
 *
 * 관리자 API 단일 게이트웨이.
 * Body.resource: reservations | sales | sales-analyze | payment-cancel | room-status | room-rate | checkin-alimtalk | ical-sync
 */
import {
  getPool,
  getJsonBody,
  json,
  requireAdminAuth,
} from "./lib/admin-common.js";
import { handleAdminReservations } from "./lib/admin-reservations.js";
import { handleAdminSales } from "./lib/admin-sales.js";
import { handleAdminSalesAnalyze } from "./lib/admin-sales-analyze.js";
import { handleAdminPaymentCancel } from "./lib/admin-payment-cancel.js";
import { handleAdminRoomStatus } from "./lib/admin-room-status.js";
import { handleAdminRoomRate } from "./lib/admin-room-rate.js";
import { handleAdminCheckinAlimtalk } from "./lib/admin-checkin-alimtalk.js";
import { handleAdminIcalSync } from "./lib/admin-ical-sync.js";

const RESOURCE_HANDLERS = {
  reservations: handleAdminReservations,
  sales: handleAdminSales,
  "sales-analyze": handleAdminSalesAnalyze,
  "payment-cancel": handleAdminPaymentCancel,
  "room-status": handleAdminRoomStatus,
  "room-rate": handleAdminRoomRate,
  "checkin-alimtalk": handleAdminCheckinAlimtalk,
  "ical-sync": handleAdminIcalSync,
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  var pool = getPool();
  if (!pool) {
    json(res, 503, { ok: false, error: "DB 연결 정보가 없습니다." });
    return;
  }

  var body;
  try {
    body = await getJsonBody(req);
  } catch (e) {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  var authResult = requireAdminAuth(req, body);
  if (!authResult.ok) {
    json(res, authResult.status, { ok: false, error: authResult.error });
    return;
  }

  var resource = String(body.resource || "").trim().toLowerCase();
  var routeHandler = RESOURCE_HANDLERS[resource];
  if (!routeHandler) {
    json(res, 400, {
      ok: false,
      error:
        "resource가 필요합니다. (reservations, sales, sales-analyze, payment-cancel, room-status, room-rate, checkin-alimtalk, ical-sync)",
    });
    return;
  }

  try {
    await routeHandler(res, pool, body);
  } catch (e) {
    console.error("[admin] resource=" + resource, e);
    json(res, 500, {
      ok: false,
      error:
        "처리 중 서버 오류가 발생했습니다: " +
        (e && e.message ? e.message : String(e)),
    });
  }
}
