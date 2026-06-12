import crypto from "node:crypto";

/** DB에 저장된 암호문 접두사 (레거시 평문과 구분) */
const ENC_PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKeyBuffer() {
  var raw = String(process.env.CRYPTO_KEY || "").trim();
  if (!raw) {
    return null;
  }
  // CRYPTO_KEY → SHA-256 → AES-256 키 (32바이트)
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function isEncrypted(value) {
  return String(value || "").startsWith(ENC_PREFIX);
}

/**
 * 성함·연락처·이메일 등 개인정보 암호화 (AES-256-GCM, 키는 CRYPTO_KEY의 SHA-256)
 */
export function encryptPii(plaintext) {
  if (plaintext == null || plaintext === "") {
    return plaintext;
  }
  var text = String(plaintext);
  if (isEncrypted(text)) {
    return text;
  }
  var key = getKeyBuffer();
  if (!key) {
    console.warn("[pii-crypto] CRYPTO_KEY 미설정 — 평문 저장");
    return text;
  }
  var iv = crypto.randomBytes(IV_LEN);
  var cipher = crypto.createCipheriv(ALGO, key, iv);
  var enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  var tag = cipher.getAuthTag();
  var packed = Buffer.concat([iv, tag, enc]).toString("base64url");
  return ENC_PREFIX + packed;
}

/**
 * DB에서 읽은 값 복호화. 레거시 평문은 그대로 반환.
 */
export function decryptPii(ciphertext) {
  if (ciphertext == null || ciphertext === "") {
    return ciphertext == null ? null : "";
  }
  var text = String(ciphertext);
  if (!isEncrypted(text)) {
    return text;
  }
  var key = getKeyBuffer();
  if (!key) {
    console.warn("[pii-crypto] CRYPTO_KEY 미설정 — 복호화 불가");
    return "";
  }
  try {
    var packed = Buffer.from(text.slice(ENC_PREFIX.length), "base64url");
    var iv = packed.subarray(0, IV_LEN);
    var tag = packed.subarray(IV_LEN, IV_LEN + TAG_LEN);
    var enc = packed.subarray(IV_LEN + TAG_LEN);
    var decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
      "utf8",
    );
  } catch (e) {
    console.error("[pii-crypto] decrypt failed", e);
    return "";
  }
}

/** INSERT용: guest_name, contact, email 암호화 */
export function encryptBookingPii(fields) {
  var guestName = fields.guestName != null ? fields.guestName : fields.guest_name;
  var contact = fields.contact;
  var email = fields.email;
  return {
    guest_name: encryptPii(guestName),
    contact: encryptPii(contact),
    email:
      email != null && email !== "" ? encryptPii(email) : email == null ? null : "",
  };
}

/** DB row의 PII 컬럼 복호화 (원본 row는 변경하지 않음) */
export function decryptBookingRow(row) {
  if (!row) {
    return row;
  }
  return {
    guest_name:
      row.guest_name != null ? decryptPii(row.guest_name) : row.guest_name,
    contact: row.contact != null ? decryptPii(row.contact) : row.contact,
    email:
      row.email != null && row.email !== ""
        ? decryptPii(row.email)
        : row.email,
  };
}

/** API 응답용 camelCase */
export function decryptBookingPiiResponse(row) {
  var d = decryptBookingRow(row);
  return {
    guestName: d.guest_name,
    contact: d.contact,
    email: d.email != null && d.email !== "" ? d.email : "",
  };
}

export function guestNamesMatch(storedName, plainName, normalizeFn) {
  var dec = decryptPii(storedName);
  return normalizeFn(dec) === normalizeFn(plainName);
}
