import {
  assertNoUntrustedInicisApprovalFetch,
  buildInicisCenterCdBypass,
  inferInicisModuleFromUrl,
  normalizeInicisApprovalUrl,
  normalizeInicisIdcCode,
  resolveInicisApprovalUrl,
} from "./inicis-idc-whitelist.js";

var failed = 0;

function assert(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error("FAIL", name, detail || "");
    return;
  }
  console.log("ok", name);
}

assert("idc fc", normalizeInicisIdcCode("FC") === "fc");
assert("idc reject other", normalizeInicisIdcCode("evil") === "");
assert(
  "https inicis only",
  normalizeInicisApprovalUrl("https://fcstdpay.inicis.com/api/payAuth") ===
    "https://fcstdpay.inicis.com/api/payAuth",
);
assert(
  "reject http",
  normalizeInicisApprovalUrl("http://fcstdpay.inicis.com/api/payAuth") === "",
);
assert(
  "reject other host",
  normalizeInicisApprovalUrl("https://evil.example/api/payAuth") === "",
);
assert(
  "infer stdpay",
  inferInicisModuleFromUrl("https://ksstdpay.inicis.com/api/payAuth") ===
    "stdpay",
);
assert(
  "infer mobile",
  inferInicisModuleFromUrl("https://fcmobile.inicis.com/smart/payReq.ini") ===
    "mobile",
);
assert(
  "infer inipaypro",
  inferInicisModuleFromUrl(
    "https://stgpaypro.inicis.com/payment/v1/rest/payAppl.ini",
  ) === "inipaypro",
);

var matched = resolveInicisApprovalUrl({
  idcCode: "ks",
  claimedUrl: "https://ksstdpay.inicis.com/api/payAuth",
});
assert("whitelist match uses stored URL", matched.ok && matched.approvalUrl ===
  "https://ksstdpay.inicis.com/api/payAuth");

var mismatched = resolveInicisApprovalUrl({
  idcCode: "ks",
  claimedUrl: "https://evil.inicis.com.attacker.test/api/payAuth",
});
assert("reject host spoof", !mismatched.ok);

var idcMismatch = resolveInicisApprovalUrl({
  idcCode: "fc",
  claimedUrl: "https://ksstdpay.inicis.com/api/payAuth",
});
assert("reject idc/url mismatch", !idcMismatch.ok);

var storedOnly = resolveInicisApprovalUrl({
  idcCode: "stg",
  module: "mobile",
});
assert(
  "no callback url still returns stored",
  storedOnly.ok &&
    storedOnly.approvalUrl ===
      "https://stgmobile.inicis.com/smart/payReq.ini",
);

var bypass = buildInicisCenterCdBypass({
  inicis_v2: { acceptmethod: ["below1000"], P_RESERVED: ["below1000=Y"] },
});
assert(
  "pc centerCd option",
  bypass.inicis_v2.acceptmethod.indexOf("centerCd(Y)") !== -1,
);
assert(
  "mobile centerCd option",
  bypass.inicis_v2.P_RESERVED.indexOf("centerCd=Y") !== -1,
);

var untrusted = assertNoUntrustedInicisApprovalFetch({
  idc_name: "fc",
  authUrl: "https://attacker.test/steal",
});
assert("untrusted callback url blocked", !untrusted.ok);

var trustedIgnored = assertNoUntrustedInicisApprovalFetch({
  idc_name: "fc",
  authUrl: "https://fcstdpay.inicis.com/api/payAuth",
});
assert(
  "trusted callback still ignored for fetch",
  trustedIgnored.ok && trustedIgnored.ignored === true,
);

if (failed) {
  process.exit(1);
}
console.log("inicis-idc-whitelist tests passed");
