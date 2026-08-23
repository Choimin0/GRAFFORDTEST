import {
  checkInYmdForCancellationFee,
  computeCancellationFeePercent,
  explainCancellationFee,
  fullRefundDeadlineMs,
  isBeforeCheckInDateKst,
  isFullRefundByGrace,
  normalizeCheckInYmd,
  policyCancellationFeePercent,
  remainDaysUntilCheckInKst,
} from "./cancellation-fee.js";
import { computeRefundAmount } from "./refund-amount.js";

var failed = 0;

function assertEqual(name, actual, expected) {
  if (actual !== expected) {
    failed += 1;
    console.error("FAIL", name, "actual=", actual, "expected=", expected);
    return;
  }
  console.log("ok", name);
}

function kst(isoLocal) {
  return new Date(isoLocal + "+09:00");
}

var checkIn = "2026-08-24";

assertEqual("policy 15 days", policyCancellationFeePercent(15), 0);
assertEqual("policy 16 days", policyCancellationFeePercent(16), 0);
assertEqual("policy 30 days", policyCancellationFeePercent(30), 0);
assertEqual("policy 14 days", policyCancellationFeePercent(14), 20);
assertEqual("policy 12 days", policyCancellationFeePercent(12), 20);
assertEqual("policy 11 days", policyCancellationFeePercent(11), 30);
assertEqual("policy 9 days", policyCancellationFeePercent(9), 30);
assertEqual("policy 8 days", policyCancellationFeePercent(8), 40);
assertEqual("policy 7 days", policyCancellationFeePercent(7), 40);
assertEqual("policy 6 days", policyCancellationFeePercent(6), 50);
assertEqual("policy 5 days", policyCancellationFeePercent(5), 50);
assertEqual("policy 4 days", policyCancellationFeePercent(4), 100);
assertEqual("policy 1 day", policyCancellationFeePercent(1), 100);
assertEqual("policy 0 days", policyCancellationFeePercent(0), 100);
assertEqual("policy negative", policyCancellationFeePercent(-3), 100);

assertEqual(
  "remain 23rd vs 24th",
  remainDaysUntilCheckInKst(checkIn, kst("2026-08-23T23:00:00")),
  1,
);
assertEqual(
  "remain on check-in day",
  remainDaysUntilCheckInKst(checkIn, kst("2026-08-24T00:01:00")),
  0,
);
assertEqual(
  "remain Aug 11 vs Aug 24",
  remainDaysUntilCheckInKst(checkIn, kst("2026-08-11T13:00:00")),
  13,
);

assertEqual(
  "before check-in 23:59",
  isBeforeCheckInDateKst(checkIn, kst("2026-08-23T23:59:59")),
  true,
);
assertEqual(
  "not before check-in 00:00",
  isBeforeCheckInDateKst(checkIn, kst("2026-08-24T00:00:00")),
  false,
);
assertEqual(
  "not before check-in 03:00",
  isBeforeCheckInDateKst(checkIn, kst("2026-08-24T03:00:00")),
  false,
);

var paidDayBefore = kst("2026-08-23T22:00:00");
assertEqual(
  "day-before 22:00 pay, 23:00 cancel = full refund",
  computeCancellationFeePercent({
    checkInYmd: checkIn,
    createdAt: paidDayBefore,
    at: kst("2026-08-23T23:00:00"),
  }),
  0,
);
assertEqual(
  "day-before 22:00 pay, 23:59 cancel = full refund",
  computeCancellationFeePercent({
    checkInYmd: checkIn,
    createdAt: paidDayBefore,
    at: kst("2026-08-23T23:59:59"),
  }),
  0,
);
assertEqual(
  "day-before 22:00 pay, 00:00 cancel = policy 100%",
  computeCancellationFeePercent({
    checkInYmd: checkIn,
    createdAt: paidDayBefore,
    at: kst("2026-08-24T00:00:00"),
  }),
  100,
);
assertEqual(
  "day-before 22:00 pay, 00:01 cancel = policy 100%",
  computeCancellationFeePercent({
    checkInYmd: checkIn,
    createdAt: paidDayBefore,
    at: kst("2026-08-24T00:01:00"),
  }),
  100,
);

assertEqual(
  "check-in day 03:00 pay, 04:00 cancel = policy 100%",
  computeCancellationFeePercent({
    checkInYmd: checkIn,
    createdAt: kst("2026-08-24T03:00:00"),
    at: kst("2026-08-24T04:00:00"),
  }),
  100,
);

assertEqual(
  "early booking within 24h = full refund despite 14 remain days",
  computeCancellationFeePercent({
    checkInYmd: checkIn,
    createdAt: kst("2026-08-10T12:00:00"),
    at: kst("2026-08-10T18:00:00"),
  }),
  0,
);

assertEqual(
  "early booking after 24h uses 13-day policy 20%",
  computeCancellationFeePercent({
    checkInYmd: checkIn,
    createdAt: kst("2026-08-10T12:00:00"),
    at: kst("2026-08-11T13:00:00"),
  }),
  20,
);

var paidExact = kst("2026-08-09T12:00:00");
assertEqual(
  "exactly 24h later still grace",
  isFullRefundByGrace(checkIn, paidExact, kst("2026-08-10T12:00:00")),
  true,
);
assertEqual(
  "24h + 1s no grace",
  isFullRefundByGrace(checkIn, paidExact, kst("2026-08-10T12:00:01")),
  false,
);

assertEqual(
  "missing check-in = 100%",
  computeCancellationFeePercent({
    checkInYmd: null,
    createdAt: paidDayBefore,
    at: kst("2026-08-23T23:00:00"),
  }),
  100,
);
assertEqual(
  "missing created_at uses policy (1 day = 100%)",
  computeCancellationFeePercent({
    checkInYmd: checkIn,
    createdAt: null,
    at: kst("2026-08-23T23:00:00"),
  }),
  100,
);
assertEqual(
  "missing created_at 15+ days = 0% from policy",
  computeCancellationFeePercent({
    checkInYmd: checkIn,
    createdAt: null,
    at: kst("2026-08-01T12:00:00"),
  }),
  0,
);

var deadline = fullRefundDeadlineMs(paidDayBefore, checkIn);
var checkInMidnight = kst("2026-08-24T00:00:00").getTime();
assertEqual(
  "deadline capped at check-in midnight",
  deadline,
  checkInMidnight,
);

var paidEarly = kst("2026-08-10T12:00:00");
var deadlineEarly = fullRefundDeadlineMs(paidEarly, checkIn);
assertEqual(
  "deadline is payment+24h when that is earlier",
  deadlineEarly,
  paidEarly.getTime() + 24 * 60 * 60 * 1000,
);

assertEqual(
  "ISO datetime check-in still counts as calendar date",
  remainDaysUntilCheckInKst("2026-08-24T15:00:00.000Z", kst("2026-08-09T12:00:00")),
  15,
);
assertEqual(
  "KST midnight Date is not shifted back a day",
  remainDaysUntilCheckInKst(
    new Date("2026-08-23T15:00:00.000Z"),
    kst("2026-08-09T12:00:00"),
  ),
  15,
);
assertEqual(
  "ISO check-in 15 days out is 0% fee (100% refund)",
  computeCancellationFeePercent({
    checkInYmd: "2026-08-24T00:00:00.000Z",
    createdAt: kst("2026-08-01T12:00:00"),
    at: kst("2026-08-09T12:00:00"),
  }),
  0,
);

assertEqual(
  "contract check-in wins over occupancy date",
  checkInYmdForCancellationFee({
    contract_check_in: "2026-09-20",
    check_in_date: "2026-08-26",
  }),
  "2026-09-20",
);
assertEqual(
  "occupancy date used when contract missing",
  checkInYmdForCancellationFee({ check_in_date: "2026-08-26" }),
  "2026-08-26",
);
assertEqual(
  "room-change occupancy soon still 100% refund if contract is 15+ days out",
  computeCancellationFeePercent({
    checkInYmd: checkInYmdForCancellationFee({
      contract_check_in: "2026-09-20",
      check_in_date: "2026-08-26",
    }),
    createdAt: kst("2026-08-01T12:00:00"),
    at: kst("2026-08-24T12:00:00"),
  }),
  0,
);

assertEqual("normalize ISO prefix", normalizeCheckInYmd("2026-08-24T15:00:00.000Z"), "2026-08-24");
assertEqual("normalize empty", normalizeCheckInYmd(""), null);

var missingExplain = explainCancellationFee({
  checkInYmd: null,
  createdAt: kst("2026-08-23T22:00:00"),
  at: kst("2026-08-23T23:00:00"),
});
assertEqual("missing check-in reason", missingExplain.reason, "missing_check_in");
assertEqual("missing check-in fee", missingExplain.feePercent, 100);

assertEqual("refund amount fee 0 = full", computeRefundAmount(111000, 0), 111000);
assertEqual("refund amount fee 20 = 80%", computeRefundAmount(111000, 20), 88800);
assertEqual("refund amount fee 50 = 50%", computeRefundAmount(111000, 50), 55500);
assertEqual("refund amount fee 100 = 0", computeRefundAmount(111000, 100), 0);
assertEqual(
  "환불율 100을 위약금으로 넣으면 0원 환불(혼동 방지)",
  computeRefundAmount(111000, 100),
  0,
);

if (failed) {
  console.error("failed count:", failed);
  process.exit(1);
}
console.log("all cancellation-fee checks passed");
