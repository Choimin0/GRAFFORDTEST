import {
  buildChkfake,
  buildInicisIntegrityBypass,
  buildStdpayMKey,
  buildStdpaySignature,
  buildStdpayVerification,
  createInicisIntegrityPayload,
  formatInicisDecimalAmount,
} from "./inicis-integrity.js";

var failed = 0;

function assert(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error("FAIL", name, detail || "");
    return;
  }
  console.log("ok", name);
}

assert("decimal floor", formatInicisDecimalAmount(111000.9) === "111000");
assert("reject negative", formatInicisDecimalAmount(-1) === "");
assert("reject hex string", formatInicisDecimalAmount("0x10") === "");

assert(
  "stdpay signature sample",
  buildStdpaySignature(
    "INIpayTest_1361252896871",
    "1004",
    "1361252896871",
  ) === "422a0e78529b419d9412d6e344c6e138584d9174c691da6cd91d4330240b9192",
);

assert(
  "stdpay verification sample",
  buildStdpayVerification(
    "INIpayTest_1361252896871",
    "1004",
    "SU5JTElURV9UUklQTEVERVNfS0VZU1RS",
    "1361252896871",
  ) === "05c6b90795860660a8490afc659cc0bee4d5c771f2386e1cb272b90e02250bed",
);

assert(
  "stdpay mKey sample",
  buildStdpayMKey("SU5JTElURV9UUklQTEVERVNfS0VZU1RS") ===
    "3a9503069192f207491d4b19bd743fc249a761ed94246c8c42fed06c3cd15a33",
);

assert(
  "mobile P_CHKFAKE sample",
  buildChkfake(
    "1000",
    "20150515208799704",
    "1431678259",
    "123456789012345678901234567890",
  ) ===
    "hE/Q+F//ZmnoGFNercEp6qyTaIuq7CLbrrUHtFWRKyktueQl97wjjISvqBB0aZC25b79YNs7bLxPT/hKMwySNA==",
);

assert(
  "inipaypro P_CHKFAKE sample",
  buildChkfake(
    "1000",
    "url_99120",
    "1640061760611",
    "3CB8183A4BE283555ACC8363C0360223",
  ) ===
    "bKVddmNY3kUqWWbeffnPN6r9NatBqhNZe7bx677NyxeLvb42wCRCxEjGx+aH2CATMm0BE8PEKw1x2PqFQbgrsA==",
);

var payload = createInicisIntegrityPayload({
  oid: "20261014-ABC123",
  amount: 250000,
  timestamp: "1700000000000",
  signKey: "SU5JTElURV9UUklQTEVERVNfS0VZU1RS",
  hashKey: "123456789012345678901234567890",
});
assert("payload amount stays decimal", payload.amount === 250000 && payload.amountText === "250000");
assert("payload signed", payload.signed === true);

var bypass = buildInicisIntegrityBypass({}, payload);
assert("pc use_chkfake", bypass.inicis_v2.use_chkfake === "Y");
assert("mobile amt_hash", bypass.inicis_v2.P_RESERVED.indexOf("amt_hash=Y") !== -1);
assert("P_CHKFAKE present", !!bypass.inicis_v2.P_CHKFAKE);
assert("centerCd kept", bypass.inicis_v2.acceptmethod.indexOf("centerCd(Y)") !== -1);

var unsigned = createInicisIntegrityPayload({
  oid: "20261014-ABC123",
  amount: 1000,
  signKey: "",
  hashKey: "",
});
assert("unsigned without keys", unsigned.ok && unsigned.signed === false);
var unsignedBypass = buildInicisIntegrityBypass({}, unsigned);
assert(
  "do not enable amt_hash without hash",
  unsignedBypass.inicis_v2.P_RESERVED.indexOf("amt_hash=Y") === -1,
);

if (failed) {
  process.exit(1);
}
console.log("inicis-integrity tests passed");
