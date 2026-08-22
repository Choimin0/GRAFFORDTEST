import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { persistCheckoutDraft, getCheckoutDraftStay } from "./booking-checkout-draft.js";
import { checkRoomAvailability } from "./room-availability.js";
import {
  extractConfirmFields,
  handleTransactionConfirm,
} from "../portone-webhook.js";

var failed = 0;

function assert(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error("FAIL", name, detail || "");
    return;
  }
  console.log("ok", name);
}

function loadEnv(path) {
  var text = readFileSync(path, "utf8");
  text.split("\n").forEach(function (line) {
    var m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) return;
    var key = m[1];
    var val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) {
      process.env[key] = val.replace(/\\n/g, "\n");
    }
  });
}

var here = dirname(fileURLToPath(import.meta.url));
loadEnv(join(here, "../../.env"));

assert(
  "v2 confirm payload",
  !!extractConfirmFields({
    type: "Transaction.Confirm",
    data: {
      paymentId: "20260822-FAST01",
      transactionId: "tx-1",
      totalAmount: 111000,
    },
  }),
);
assert(
  "paid webhook is not confirm",
  extractConfirmFields({
    type: "Transaction.Paid",
    data: { paymentId: "20260822-FAST01" },
  }) == null,
);
assert(
  "legacy confirm payload",
  !!extractConfirmFields({
    payment_id: "20260822-FAST01",
    tx_id: "tx-1",
    total_amount: 111000,
  }),
);

const { Client } = pg;
const TEST_RESV = "20260822-FAST01";
const client = new Client({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(`DELETE FROM booking WHERE reservation_number = $1`, [
    TEST_RESV,
  ]);
  await persistCheckoutDraft(client, {
    reservationNumber: TEST_RESV,
    roomType: "G4",
    checkIn: "2026-09-10",
    checkOut: "2026-09-11",
    guestName: "컨펌점검",
    contact: "01011112222",
    stayNights: 1,
    extraGuests: 0,
    guestCount: 2,
    totalAmount: 111000,
    paymentMethod: "card",
    bookingLocale: "kr",
  });
  var stay = await getCheckoutDraftStay(client, TEST_RESV);
  assert("pending stay without decrypt", !!(stay && stay.roomType === "G4"), stay);

  var t0 = Date.now();
  var availability = await checkRoomAvailability(
    client,
    "G4",
    "2026-09-10",
    "2026-09-11",
    TEST_RESV,
    "",
    { fast: true },
  );
  var fastMs = Date.now() - t0;
  assert("fast availability ok", availability.available === true, availability);
  assert("fast availability under 1.5s", fastMs < 1500, fastMs + "ms");

  t0 = Date.now();
  var confirm = await handleTransactionConfirm(client, {
    paymentId: TEST_RESV,
    transactionId: "tx-fast",
    totalAmount: 111000,
  });
  var confirmMs = Date.now() - t0;
  assert("confirm approves pending without hold", confirm.ok === true, confirm);
  assert("confirm under 1.5s", confirmMs < 1500, confirmMs + "ms");

  var livePending = await handleTransactionConfirm(client, {
    paymentId: "20260822-W5M9WA",
    transactionId: "tx-live",
    totalAmount: 224000,
  });
  assert(
    "live mobile pending still confirmable",
    livePending.ok === true,
    livePending,
  );
} catch (e) {
  failed += 1;
  console.error("FAIL suite", e);
} finally {
  try {
    await client.query(`DELETE FROM booking WHERE reservation_number = $1`, [
      TEST_RESV,
    ]);
  } catch (_e) {}
  await client.end();
}

if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall passed");
