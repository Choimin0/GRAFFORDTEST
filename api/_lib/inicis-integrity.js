/**
 * KG이니시스 금액·주문번호 위변조 방지 해시.
 *
 * 웹표준: SHA256 signature / verification (use_chkfake)
 * 모바일·INIpayPRO: SHA512 P_CHKFAKE (amt_hash=Y)
 *
 * 금액은 항상 콤마 없는 10진수 정수 원(예: 111000)으로 해시에 넣고,
 * DB total_amount 도 동일한 BIGINT 원 단위로 저장합니다. 해시는 결제 요청
 * 파라미터일 뿐 저장 값이 아닙니다.
 */
import crypto from "node:crypto";
import { buildInicisCenterCdBypass } from "./inicis-idc-whitelist.js";

export function formatInicisDecimalAmount(raw) {
  if (typeof raw === "string") {
    var trimmed = raw.trim();
    if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) {
      return "";
    }
    raw = trimmed;
  }
  var amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) {
    return "";
  }
  return String(Math.floor(amount));
}

export function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

export function sha512Base64(text) {
  return crypto
    .createHash("sha512")
    .update(String(text), "utf8")
    .digest("base64");
}

export function buildStdpaySignature(oid, price, timestamp) {
  var nvp =
    "oid=" +
    String(oid) +
    "&price=" +
    String(price) +
    "&timestamp=" +
    String(timestamp);
  return sha256Hex(nvp);
}

export function buildStdpayVerification(oid, price, signKey, timestamp) {
  var nvp =
    "oid=" +
    String(oid) +
    "&price=" +
    String(price) +
    "&signKey=" +
    String(signKey) +
    "&timestamp=" +
    String(timestamp);
  return sha256Hex(nvp);
}

export function buildStdpayMKey(signKey) {
  return sha256Hex(String(signKey));
}

export function buildChkfake(amountText, oid, timestamp, hashKey) {
  return sha512Base64(
    String(amountText) + String(oid) + String(timestamp) + String(hashKey),
  );
}

function readSignKey() {
  return String(
    process.env.INICIS_SIGN_KEY || process.env.INICIS_WEB_SIGNKEY || "",
  ).trim();
}

function readHashKey() {
  return String(
    process.env.INICIS_HASH_KEY ||
      process.env.INICIS_MOBILE_HASH_KEY ||
      "",
  ).trim();
}

export function getInicisIntegrityKeyStatus() {
  return {
    signKey: !!readSignKey(),
    hashKey: !!readHashKey(),
  };
}

export function createInicisIntegrityPayload(options) {
  options = options || {};
  var oid = String(options.oid || options.paymentId || "").trim();
  var amountText = formatInicisDecimalAmount(options.amount);
  var timestamp = String(
    options.timestamp != null ? options.timestamp : Date.now(),
  ).trim();
  var signKey = options.signKey != null ? String(options.signKey) : readSignKey();
  var hashKey = options.hashKey != null ? String(options.hashKey) : readHashKey();

  if (!oid || !amountText) {
    return {
      ok: false,
      error: "주문번호 또는 결제금액이 올바르지 않습니다.",
    };
  }

  var pc = null;
  if (signKey) {
    pc = {
      use_chkfake: "Y",
      timestamp: timestamp,
      signature: buildStdpaySignature(oid, amountText, timestamp),
      verification: buildStdpayVerification(oid, amountText, signKey, timestamp),
      mKey: buildStdpayMKey(signKey),
    };
  }

  var mobile = null;
  if (hashKey) {
    mobile = {
      P_TIMESTAMP: timestamp,
      P_CHKFAKE: buildChkfake(amountText, oid, timestamp, hashKey),
    };
  }

  return {
    ok: true,
    oid: oid,
    amount: Number(amountText),
    amountText: amountText,
    timestamp: timestamp,
    signed: !!(pc || mobile),
    pc: pc,
    mobile: mobile,
  };
}

export function buildInicisIntegrityBypass(existingBypass, integrity) {
  var bypass = buildInicisCenterCdBypass(existingBypass);
  if (!integrity || !integrity.ok) {
    return bypass;
  }
  var inicis =
    bypass.inicis_v2 && typeof bypass.inicis_v2 === "object"
      ? Object.assign({}, bypass.inicis_v2)
      : {};

  if (integrity.pc) {
    inicis.use_chkfake = "Y";
    inicis.timestamp = integrity.pc.timestamp;
    inicis.signature = integrity.pc.signature;
    inicis.verification = integrity.pc.verification;
    inicis.mKey = integrity.pc.mKey;
  }

  if (integrity.mobile) {
    inicis.P_TIMESTAMP = integrity.mobile.P_TIMESTAMP;
    inicis.P_CHKFAKE = integrity.mobile.P_CHKFAKE;
    var reserved = Array.isArray(inicis.P_RESERVED)
      ? inicis.P_RESERVED.slice()
      : [];
    var hasAmtHash = reserved.some(function (item) {
      return /amt_hash\s*=\s*y/i.test(String(item));
    });
    if (!hasAmtHash) {
      reserved.push("amt_hash=Y");
    }
    inicis.P_RESERVED = reserved;
  }

  bypass.inicis_v2 = inicis;
  return bypass;
}
