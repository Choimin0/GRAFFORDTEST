import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import {
  persistCheckoutDraft,
  getCheckoutDraft,
  deleteCheckoutDraft,
  normalizeCheckoutDraftInput,
} from "./booking-checkout-draft.js";
import {
  commitPaidBooking,
  findBookingByNumber,
  upsertConfirmedCheckoutBooking,
} from "./commit-paid-booking.js";
import { releaseBookingHold } from "./booking-hold.js";
import { hasReservationOverlap } from "./room-availability.js";

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

var draftCheck = normalizeCheckoutDraftInput({
  reservationNumber: "20260822-SVRTST",
  roomType: "G1",
  checkIn: "2027-03-01",
  checkOut: "2027-03-02",
  guestName: "점검게스트",
  contact: "01012345678",
  stayNights: 1,
  extraGuests: 0,
  totalAmount: 111000,
});
assert("normalize draft ok", draftCheck.ok === true);
assert(
  "normalize rejects missing guest",
  normalizeCheckoutDraftInput({
    reservationNumber: "20260822-SVRTST",
    roomType: "G1",
    checkIn: "2027-03-01",
    checkOut: "2027-03-02",
    stayNights: 1,
    totalAmount: 111000,
  }).ok === false,
);

const { Client } = pg;
const TEST_RESV = "20260822-SVRTST";
const LIVE_ORPHAN = "20260822-Y7Y6JQ";
const TEST_HOLD = "svrtst-hold-disconnect";

var alimtalkCalls = [];
function mockSendAlimtalk(type, payload) {
  alimtalkCalls.push({ type: type, payload: payload });
  return Promise.resolve({ ok: true, sent: true });
}

function mockPaidPayment(overrides) {
  return Object.assign(
    {
      id: TEST_RESV,
      status: "PAID",
      amount: { total: 111000 },
      currency: "KRW",
      pgTxId: "TEST_PG_TID_SVRTST",
      method: { type: "PaymentMethodCard" },
      customer: {
        name: "점검게스트",
        phoneNumber: "01012345678",
        email: "svrtst@example.com",
      },
    },
    overrides || {},
  );
}

var client = new Client({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  var migration = readFileSync(
    join(here, "../../db/migrations/036_add_booking_checkout_and_reserve_alarm.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("ok applied migration 036");

  await client.query(`DELETE FROM booking WHERE reservation_number = $1`, [
    TEST_RESV,
  ]);
  await client.query(`DELETE FROM booking_hold WHERE hold_id = $1`, [TEST_HOLD]);
  var extraTable = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'booking_checkout'`,
  );
  assert("no booking_checkout table", extraTable.rows.length === 0);

  var persisted = await persistCheckoutDraft(client, {
    reservationNumber: TEST_RESV,
    holdId: TEST_HOLD,
    roomType: "G1",
    checkIn: "2027-03-01",
    checkOut: "2027-03-02",
    guestName: "점검게스트",
    contact: "010-1234-5678",
    email: "svrtst@example.com",
    guestRequest: "브라우저 끊김 점검",
    stayNights: 1,
    extraGuests: 0,
    guestCount: 2,
    totalAmount: 111000,
    paymentMethod: "card",
    bookingLocale: "kr",
  });
  assert("persist draft", persisted.ok === true);
  var pendingRow = await findBookingByNumber(client, TEST_RESV);
  assert("draft stored as pending booking", !!(pendingRow && pendingRow.status === "pending"), pendingRow);

  await client.query(
    `INSERT INTO booking_hold (
       hold_id, room_type, check_in_date, check_out_date, reservation_number, expires_at
     ) VALUES ($1, 'G1', '2027-03-01', '2027-03-02', $2, NOW() + INTERVAL '15 minutes')`,
    [TEST_HOLD, TEST_RESV],
  );

  await releaseBookingHold(client, TEST_HOLD);
  var holdGone = await client.query(
    `SELECT 1 FROM booking_hold WHERE hold_id = $1`,
    [TEST_HOLD],
  );
  assert("hold released like pagehide", !holdGone.rows.length);

  var draftAfterHoldRelease = await getCheckoutDraft(client, TEST_RESV);
  assert(
    "draft survives hold release",
    !!(draftAfterHoldRelease && draftAfterHoldRelease.guestName === "점검게스트"),
    draftAfterHoldRelease,
  );

  alimtalkCalls = [];
  var first = await commitPaidBooking(client, {
    paymentId: TEST_RESV,
    payment: mockPaidPayment(),
    sendAlimtalk: mockSendAlimtalk,
    skipBigQuery: true,
  });
  assert("commit without browser POST", first.ok === true && first.inserted === true, first);
  assert(
    "commit returns complete-page reservation view",
    !!(
      first.reservation &&
      first.reservation.orderNo === TEST_RESV &&
      first.reservation.room === "G1" &&
      first.reservation.checkIn === "2027-03-01" &&
      first.reservation.checkOut === "2027-03-02" &&
      first.reservation.guestName === "점검게스트"
    ),
    first.reservation,
  );
  assert(
    "draft dates preserved after hold release",
    !!(
      draftAfterHoldRelease &&
      draftAfterHoldRelease.checkIn === "2027-03-01" &&
      draftAfterHoldRelease.checkOut === "2027-03-02"
    ),
    draftAfterHoldRelease,
  );

  var row = await findBookingByNumber(client, TEST_RESV);
  assert("booking saved after disconnect", !!(row && row.status === "confirm"), row);
  var storedDates = await client.query(
    `SELECT check_in_date::text AS ci, check_out_date::text AS co
     FROM booking WHERE reservation_number = $1`,
    [TEST_RESV],
  );
  assert(
    "booking dates match draft",
    !!(
      storedDates.rows[0] &&
      String(storedDates.rows[0].ci).slice(0, 10) === "2027-03-01" &&
      String(storedDates.rows[0].co).slice(0, 10) === "2027-03-02"
    ),
    storedDates.rows[0],
  );
  assert(
    "alimtalk sent once",
    alimtalkCalls.length === 1 && alimtalkCalls[0].type === "reserve-complete",
    alimtalkCalls,
  );
  assert(
    "alimtalk uses guest contact",
    alimtalkCalls[0] &&
      alimtalkCalls[0].payload.contact === "010-1234-5678" &&
      alimtalkCalls[0].payload.reservationNumber === TEST_RESV,
  );

  var draftGone = await getCheckoutDraft(client, TEST_RESV);
  assert("draft removed after commit", draftGone == null);

  alimtalkCalls = [];
  var second = await commitPaidBooking(client, {
    paymentId: TEST_RESV,
    payment: mockPaidPayment(),
    sendAlimtalk: mockSendAlimtalk,
    skipBigQuery: true,
  });
  assert("second commit idempotent", second.ok === true && second.alreadyCommitted === true, second);
  assert("alimtalk not resent", alimtalkCalls.length === 0 || (alimtalkCalls.length === 1 && second.alimtalk && second.alimtalk.reason === "already_sent"));

  var count = await client.query(
    `SELECT COUNT(*)::int AS n FROM booking WHERE reservation_number = $1`,
    [TEST_RESV],
  );
  assert("single booking row", count.rows[0].n === 1);

  var recovered = await findBookingByNumber(client, LIVE_ORPHAN);
  assert(
    "recovered live booking stays confirm",
    !!(recovered && recovered.status === "confirm"),
    recovered,
  );

  var mismatch = await persistCheckoutDraft(client, {
    reservationNumber: "20260822-AMT001",
    roomType: "G1",
    checkIn: "2027-03-10",
    checkOut: "2027-03-11",
    guestName: "금액불일치",
    contact: "01099998888",
    stayNights: 1,
    extraGuests: 0,
    totalAmount: 200000,
    paymentMethod: "card",
    bookingLocale: "kr",
  });
  assert("mismatch draft saved", mismatch.ok === true);
  var mismatchCommit = await commitPaidBooking(client, {
    paymentId: "20260822-AMT001",
    payment: mockPaidPayment({
      id: "20260822-AMT001",
      amount: { total: 111000 },
    }),
    sendAlimtalk: mockSendAlimtalk,
    skipBigQuery: true,
  });
  assert(
    "amount mismatch does not insert",
    mismatchCommit.ok === false && mismatchCommit.reason === "amount_mismatch",
    mismatchCommit,
  );
  var mismatchRow = await findBookingByNumber(client, "20260822-AMT001");
  assert(
    "amount mismatch does not confirm",
    !mismatchRow || mismatchRow.status === "pending",
    mismatchRow,
  );

  var missing = await commitPaidBooking(client, {
    paymentId: "20260822-NODRFT",
    payment: mockPaidPayment({ id: "20260822-NODRFT" }),
    sendAlimtalk: mockSendAlimtalk,
    skipBigQuery: true,
  });
  assert("no draft no hold → not committed", missing.ok === false && missing.reason === "draft_missing", missing);

  var stalePersist = await persistCheckoutDraft(client, {
    reservationNumber: "20260822-OLDTTL",
    roomType: "G1",
    checkIn: "2027-04-01",
    checkOut: "2027-04-02",
    guestName: "만료초안",
    contact: "01011112222",
    stayNights: 1,
    extraGuests: 0,
    totalAmount: 111000,
    paymentMethod: "card",
    bookingLocale: "kr",
  });
  assert("stale draft saved", stalePersist.ok === true);
  await client.query(
    `UPDATE booking
     SET created_at = NOW() - INTERVAL '3 hours'
     WHERE reservation_number = $1
       AND status = 'pending'`,
    ["20260822-OLDTTL"],
  );
  var staleHidden = await getCheckoutDraft(client, "20260822-OLDTTL");
  assert("expired draft hidden from calendar path", staleHidden == null);
  alimtalkCalls = [];
  var staleCommit = await commitPaidBooking(client, {
    paymentId: "20260822-OLDTTL",
    payment: mockPaidPayment({ id: "20260822-OLDTTL" }),
    sendAlimtalk: mockSendAlimtalk,
    skipBigQuery: true,
  });
  assert(
    "expired pending still confirms after PAID",
    staleCommit.ok === true,
    staleCommit,
  );
  var staleRow = await findBookingByNumber(client, "20260822-OLDTTL");
  assert(
    "expired pending promoted not left pending",
    !!(staleRow && staleRow.status === "confirm"),
    staleRow,
  );

  var promotePersist = await persistCheckoutDraft(client, {
    reservationNumber: "20260822-PROMOTE",
    roomType: "G2",
    checkIn: "2027-05-01",
    checkOut: "2027-05-02",
    guestName: "승격게스트",
    contact: "01033334444",
    stayNights: 1,
    extraGuests: 0,
    totalAmount: 222000,
    paymentMethod: "card",
    bookingLocale: "kr",
  });
  assert("promote draft saved", promotePersist.ok === true);
  var promoted = await upsertConfirmedCheckoutBooking(
    client,
    Object.assign({}, promotePersist.draft, {
      guestName: "승격게스트",
      contact: "01033334444",
    }),
    {
      paymentMethod: "card",
      pgTid: "PROMOTE_TID",
      pgPayProvider: null,
    },
  );
  assert("promote without deleting pending first", !!(promoted && promoted.status === "confirm"), promoted);
  var promoteCount = await client.query(
    `SELECT COUNT(*)::int AS n, MAX(status) AS status
     FROM booking WHERE reservation_number = $1`,
    ["20260822-PROMOTE"],
  );
  assert(
    "promote keeps single row",
    promoteCount.rows[0].n === 1 && promoteCount.rows[0].status === "confirm",
    promoteCount.rows[0],
  );

  var calPersist = await persistCheckoutDraft(client, {
    reservationNumber: "20260822-CALHLD",
    roomType: "G3",
    checkIn: "2027-06-01",
    checkOut: "2027-06-02",
    guestName: "달력홀드",
    contact: "01055556666",
    stayNights: 1,
    extraGuests: 0,
    totalAmount: 111000,
    paymentMethod: "card",
    bookingLocale: "kr",
  });
  assert("calendar draft saved", calPersist.ok === true);
  var overlapNoHold = await hasReservationOverlap(
    client,
    "G3",
    "2027-06-01",
    "2027-06-02",
  );
  assert(
    "pending without hold does not occupy calendar",
    overlapNoHold === false,
  );
  await client.query(
    `INSERT INTO booking_hold (
       hold_id, room_type, check_in_date, check_out_date, reservation_number, expires_at
     ) VALUES ($1, 'G3', '2027-06-01', '2027-06-02', $2, NOW() + INTERVAL '15 minutes')`,
    ["svrtst-hold-calendar", "20260822-CALHLD"],
  );
  var overlapLiveHold = await hasReservationOverlap(
    client,
    "G3",
    "2027-06-01",
    "2027-06-02",
  );
  assert(
    "pending with live hold occupies calendar",
    overlapLiveHold === true,
  );
  await client.query(
    `UPDATE booking_hold
     SET expires_at = NOW() - INTERVAL '1 minute'
     WHERE hold_id = $1`,
    ["svrtst-hold-calendar"],
  );
  var overlapExpiredHold = await hasReservationOverlap(
    client,
    "G3",
    "2027-06-01",
    "2027-06-02",
  );
  assert(
    "pending after hold expiry does not occupy calendar",
    overlapExpiredHold === false,
  );
} catch (e) {
  failed += 1;
  console.error("FAIL suite", e);
} finally {
  try {
    await client.query(`DELETE FROM booking WHERE reservation_number = ANY($1::text[])`, [
      [
        TEST_RESV,
        "20260822-AMT001",
        "20260822-OLDTTL",
        "20260822-PROMOTE",
        "20260822-CALHLD",
      ],
    ]);
    await client.query(`DELETE FROM booking_hold WHERE hold_id = ANY($1::text[])`, [
      [TEST_HOLD, "svrtst-hold-calendar"],
    ]);
  } catch (cleanupErr) {
    console.error("cleanup", cleanupErr);
  }
  await client.end();
}

if (failed) {
  console.error("\n" + failed + " failed");
  process.exit(1);
}
console.log("\nall passed");
