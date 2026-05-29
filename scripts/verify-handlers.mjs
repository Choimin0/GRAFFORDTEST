/**
 * Serverless handler 단위 검증 (HTTP 서버 없이 mock req/res)
 */
import adminHandler from "../api/admin.js";
import paymentConfirmHandler from "../api/payment-confirm.js";
import reservationsLookupHandler from "../api/reservations-lookup.js";
import roomRateHandler from "../api/room-rate.js";

function mockRes() {
  const state = { statusCode: 200, headers: {}, body: "" };
  return {
    statusCode: 200,
    setHeader(k, v) {
      state.headers[k] = v;
    },
    end(body) {
      state.body = body || "";
    },
    get state() {
      return state;
    },
  };
}

function mockReq(method, body) {
  const payload = body ? JSON.stringify(body) : "";
  const chunks = [Buffer.from(payload)];
  const req = {
    method,
    headers: {},
    body: body && typeof body === "object" ? body : undefined,
    socket: { remoteAddress: "127.0.0.1" },
    on(ev, fn) {
      if (ev === "data") chunks.forEach(fn);
      if (ev === "end") fn();
    },
  };
  return req;
}

async function invoke(handler, method, body) {
  const req = mockReq(method, body);
  const res = mockRes();
  await handler(req, res);
  let data = null;
  try {
    data = res.state.body ? JSON.parse(res.state.body) : null;
  } catch {
    data = { _raw: res.state.body };
  }
  return { status: res.statusCode, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const cfg = await invoke(paymentConfirmHandler, "GET");
  assert(cfg.status === 200 || cfg.status === 500, "payment-confirm GET");
  console.log("OK payment-confirm GET →", cfg.status);

  const postNoId = await invoke(paymentConfirmHandler, "POST", {});
  assert(
    postNoId.status === 400 || postNoId.status === 500,
    "payment-confirm POST rejects empty body",
  );
  console.log("OK payment-confirm POST validation →", postNoId.status);

  const portoneWebhook = await import("../api/portone-webhook.js");
  const webhookBad = await invoke(portoneWebhook.default, "POST", { type: "test" });
  assert(
    webhookBad.status === 200 || webhookBad.status === 503,
    "portone-webhook accepts POST",
  );
  console.log("OK portone-webhook POST →", webhookBad.status);

  const admin401 = await invoke(adminHandler, "POST", {
    resource: "reservations",
    action: "list",
  });
  assert(
    admin401.status === 401 || admin401.status === 503,
    "admin rejects unauthenticated or no DB",
  );
  console.log("OK admin guard →", admin401.status);

  const adminBad = await invoke(adminHandler, "POST", {
    resource: "nope",
    adminId: "a",
    adminPw: "b",
  });
  assert(
    adminBad.status === 401 || adminBad.status === 400 || adminBad.status === 503,
    "admin bad resource",
  );
  console.log("OK admin bad resource →", adminBad.status);

  const lookup = await invoke(reservationsLookupHandler, "POST", {});
  assert(lookup.status === 400 || lookup.status === 503, "lookup validation");
  console.log("OK reservations-lookup →", lookup.status);

  const rate = await invoke(roomRateHandler, "GET");
  assert(rate.status === 200 || rate.status === 503, "room-rate");
  console.log("OK room-rate GET →", rate.status);

  const adminOpts = await invoke(adminHandler, "OPTIONS");
  assert(adminOpts.status === 204, "admin OPTIONS");
  console.log("OK admin OPTIONS → 204");

  console.log("\nHandler unit checks passed.");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
