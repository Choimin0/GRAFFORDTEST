/**
 * KG이니시스 IDC 센터코드 승인 URL 화이트리스트.
 *
 * 인증결과의 authUrl / P_REQ_URL / P_IDCNAME 을 그대로 파싱해 승인 요청하면
 * 리다이렉트 URL 파싱 공격에 노출됩니다. 가맹점은 아래 고정 URL만 사용하고,
 * 인증결과 센터코드와 비교한 뒤에만 승인 요청해야 합니다.
 *
 * 이 프로젝트는 PortOne v2가 실제 승인 API를 호출하므로, 가맹점 서버는
 * 콜백에 실린 이니시스 승인 URL로 fetch 하지 않습니다. 이 모듈은
 * (1) 결제 요청 시 centerCd 옵션, (2) 만약 승인 URL이 들어오면 화이트리스트
 * 검증만 통과한 고정 URL을 쓰도록 강제합니다.
 */

export var INICIS_IDC_CODES = ["fc", "ks", "stg"];

export var INICIS_APPROVAL_URLS = {
  inipaypro: {
    fc: "https://fcpaypro.inicis.com/payment/v1/rest/payAppl.ini",
    ks: "https://kspaypro.inicis.com/payment/v1/rest/payAppl.ini",
    stg: "https://stgpaypro.inicis.com/payment/v1/rest/payAppl.ini",
  },
  stdpay: {
    fc: "https://fcstdpay.inicis.com/api/payAuth",
    ks: "https://ksstdpay.inicis.com/api/payAuth",
    stg: "https://stgstdpay.inicis.com/api/payAuth",
  },
  mobile: {
    fc: "https://fcmobile.inicis.com/smart/payReq.ini",
    ks: "https://ksmobile.inicis.com/smart/payReq.ini",
    stg: "https://stgmobile.inicis.com/smart/payReq.ini",
  },
};

var CALLBACK_URL_KEYS = [
  "authUrl",
  "authurl",
  "P_REQ_URL",
  "p_req_url",
  "netCancelUrl",
  "netcancelurl",
  "P_NEXT_URL",
  "p_next_url",
];

export function normalizeInicisIdcCode(raw) {
  var code = String(raw == null ? "" : raw)
    .trim()
    .toLowerCase();
  if (INICIS_IDC_CODES.indexOf(code) === -1) {
    return "";
  }
  return code;
}

export function normalizeInicisApprovalUrl(raw) {
  var text = String(raw == null ? "" : raw).trim();
  if (!text) {
    return "";
  }
  var parsed;
  try {
    parsed = new URL(text);
  } catch (_e) {
    return "";
  }
  if (parsed.protocol !== "https:") {
    return "";
  }
  var host = parsed.hostname.toLowerCase();
  if (host !== "inicis.com" && !host.endsWith(".inicis.com")) {
    return "";
  }
  var path = parsed.pathname.replace(/\/+$/, "") || "/";
  return "https://" + host + path;
}

export function inferInicisModuleFromUrl(url) {
  var normalized = normalizeInicisApprovalUrl(url).toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized.indexOf("/payment/v1/rest/payappl.ini") !== -1) {
    return "inipaypro";
  }
  if (normalized.indexOf("/api/payauth") !== -1) {
    return "stdpay";
  }
  if (normalized.indexOf("/smart/payreq.ini") !== -1) {
    return "mobile";
  }
  return "";
}

function lookupStoredUrl(moduleId, idcCode) {
  var table = INICIS_APPROVAL_URLS[moduleId];
  if (!table) {
    return "";
  }
  return table[idcCode] || "";
}

/**
 * 인증결과 센터코드와 (선택) 콜백 URL을 가맹점 고정 properties와 비교합니다.
 * 일치할 때만 가맹점이 저장한 승인 URL을 반환하고, 콜백 URL 원문은 절대 반환하지 않습니다.
 */
export function resolveInicisApprovalUrl(options) {
  options = options || {};
  var idcCode = normalizeInicisIdcCode(
    options.idcCode || options.idc_name || options.P_IDCNAME || "",
  );
  if (!idcCode) {
    return {
      ok: false,
      error: "IDC 센터코드가 없거나 허용 값(fc, ks, stg)이 아닙니다.",
    };
  }

  var claimedUrl = String(
    options.claimedUrl ||
      options.authUrl ||
      options.P_REQ_URL ||
      options.approvalUrl ||
      "",
  ).trim();
  var moduleId = String(options.module || "").trim().toLowerCase();
  if (!moduleId && claimedUrl) {
    moduleId = inferInicisModuleFromUrl(claimedUrl);
  }
  if (!moduleId) {
    moduleId = "stdpay";
  }
  if (!INICIS_APPROVAL_URLS[moduleId]) {
    return { ok: false, error: "알 수 없는 이니시스 결제 모듈입니다." };
  }

  var storedUrl = lookupStoredUrl(moduleId, idcCode);
  if (!storedUrl) {
    return { ok: false, error: "IDC 센터코드에 해당하는 승인 URL이 없습니다." };
  }

  if (claimedUrl) {
    var normalizedClaimed = normalizeInicisApprovalUrl(claimedUrl).toLowerCase();
    var normalizedStored = normalizeInicisApprovalUrl(storedUrl).toLowerCase();
    if (!normalizedClaimed || normalizedClaimed !== normalizedStored) {
      return {
        ok: false,
        error:
          "인증결과 승인 URL이 가맹점 화이트리스트와 일치하지 않습니다.",
        idcCode: idcCode,
        module: moduleId,
      };
    }
  }

  return {
    ok: true,
    idcCode: idcCode,
    module: moduleId,
    approvalUrl: storedUrl,
  };
}

export function extractInicisCallbackUrls(source) {
  var found = [];
  if (!source || typeof source !== "object") {
    return found;
  }
  CALLBACK_URL_KEYS.forEach(function (key) {
    if (source[key]) {
      found.push(String(source[key]));
    }
  });
  return found;
}

export function extractInicisIdcCode(source) {
  if (!source || typeof source !== "object") {
    return "";
  }
  return normalizeInicisIdcCode(
    source.idc_name ||
      source.idcName ||
      source.P_IDCNAME ||
      source.P_IDCCODE ||
      "",
  );
}

/**
 * 클라이언트/콜백이 이니시스 승인 URL을 실어 보내도 그 URL로 요청하지 않습니다.
 * PortOne 결제 확정만 사용합니다.
 */
export function assertNoUntrustedInicisApprovalFetch(source) {
  var urls = extractInicisCallbackUrls(source);
  if (!urls.length) {
    return { ok: true, ignored: false };
  }
  var idcCode = extractInicisIdcCode(source);
  for (var i = 0; i < urls.length; i++) {
    var checked = resolveInicisApprovalUrl({
      idcCode: idcCode,
      claimedUrl: urls[i],
    });
    if (!checked.ok) {
      return {
        ok: false,
        error: checked.error,
        claimedUrl: urls[i],
      };
    }
  }
  return { ok: true, ignored: true };
}

var PORTONE_INICIS_KEYS = {
  logo_url: true,
  logo_2nd: true,
  parentemail: true,
  Ini_SSGPAY_MDN: true,
  acceptmethod: true,
  P_CARD_OPTION: true,
  P_MNAME: true,
  P_RESERVED: true,
};

function isPortoneAcceptmethod(value) {
  var text = String(value || "");
  if (
    text === "below1000" ||
    text === "ocb" ||
    text === "paypopup" ||
    text === "hidebar" ||
    text === "noeasypay"
  ) {
    return true;
  }
  return (
    /^SKIN\(#[0-9A-Fa-f]{6}\)$/.test(text) ||
    /^slimquota\(.+\)$/.test(text) ||
    /^mallpoint\(.+\)$/.test(text)
  );
}

function isPortoneReserved(value) {
  var text = String(value || "");
  return (
    text === "below1000=Y" ||
    text === "noeasypay=Y" ||
    text === "global_visa3d=Y" ||
    text === "apprun_check=Y"
  );
}

/**
 * PortOne v2 SDK가 허용하는 inicis_v2 필드만 남깁니다.
 * centerCd(Y), amt_hash, P_CHKFAKE, signature 등은 SDK 스키마에 없어
 * requestPayment가 거절됩니다. IDC/해시 검증은 PortOne·서버 금액 대조로 처리합니다.
 */
export function sanitizePortoneInicisBypass(existingBypass) {
  if (!existingBypass || typeof existingBypass !== "object") {
    return undefined;
  }
  var next = Object.assign({}, existingBypass);
  var inicis = next.inicis_v2;
  if (!inicis || typeof inicis !== "object") {
    if (!Object.keys(next).length) {
      return undefined;
    }
    return next;
  }
  var cleaned = {};
  Object.keys(inicis).forEach(function (key) {
    if (!PORTONE_INICIS_KEYS[key]) {
      return;
    }
    cleaned[key] = inicis[key];
  });
  if (Array.isArray(cleaned.acceptmethod)) {
    cleaned.acceptmethod = cleaned.acceptmethod.filter(isPortoneAcceptmethod);
    if (!cleaned.acceptmethod.length) {
      delete cleaned.acceptmethod;
    }
  }
  if (Array.isArray(cleaned.P_RESERVED)) {
    cleaned.P_RESERVED = cleaned.P_RESERVED.filter(isPortoneReserved);
    if (!cleaned.P_RESERVED.length) {
      delete cleaned.P_RESERVED;
    }
  }
  if (!Object.keys(cleaned).length) {
    delete next.inicis_v2;
  } else {
    next.inicis_v2 = cleaned;
  }
  if (!Object.keys(next).length) {
    return undefined;
  }
  return next;
}

export function buildInicisCenterCdBypass(existingBypass) {
  return sanitizePortoneInicisBypass(existingBypass);
}
