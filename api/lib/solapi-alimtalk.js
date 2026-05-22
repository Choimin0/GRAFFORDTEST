import { SolapiMessageService } from "solapi";

const ROOM_LABEL = { G1: "G1", G2: "G2", G3: "G3", G4: "G4" };
const DEFAULT_PROPERTY_ADDRESS = "제주특별자치도 서귀포시 토산중앙로 22";

var messageServiceSingleton = null;

function trimEnv(name) {
  return String(process.env[name] || "").trim();
}

function getSolapiConfig() {
  return {
    apiKey: trimEnv("SOLAPI_API_KEY"),
    apiSecret: trimEnv("SOLAPI_API_SECRET"),
    pfId: trimEnv("SOLAPI_PF_ID"),
    from: normalizePhone(trimEnv("SOLAPI_FROM")),
    templateReserveComplete: trimEnv("SOLAPI_TEMPLATE_RESERVE_COMPLETE"),
    templateCancelComplete: trimEnv("SOLAPI_TEMPLATE_CANCEL_COMPLETE"),
    propertyAddress:
      trimEnv("SOLAPI_PROPERTY_ADDRESS") || DEFAULT_PROPERTY_ADDRESS,
  };
}

function getMessageService(config) {
  if (!messageServiceSingleton) {
    messageServiceSingleton = new SolapiMessageService(
      config.apiKey,
      config.apiSecret,
    );
  }
  return messageServiceSingleton;
}

export function normalizePhone(raw) {
  var digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("82") && digits.length >= 11) {
    digits = "0" + digits.slice(2);
  }
  if (digits.length === 10 && digits.startsWith("1")) {
    digits = "0" + digits;
  }
  return digits;
}

function normalizeRoomLabel(roomType) {
  var room = String(roomType || "")
    .trim()
    .toUpperCase();
  return ROOM_LABEL[room] || room || "—";
}

function formatAlimtalkDate(value) {
  if (!value) {
    return "—";
  }
  var text = String(value).trim();
  if (/^\d{8}$/.test(text)) {
    return (
      text.slice(0, 4) + "." + text.slice(4, 6) + "." + text.slice(6, 8)
    );
  }
  var ymd = text.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return ymd.replace(/-/g, ".");
  }
  var d = new Date(text);
  if (isNaN(d.getTime())) {
    return text;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function buildBaseVariables(payload) {
  var guestName = String(payload.guestName || "").trim() || "고객";
  return {
    "#{고객명}": guestName,
    "#{예약번호}": String(payload.reservationNumber || "").trim() || "—",
    "#{객실명}": normalizeRoomLabel(payload.roomType),
    "#{입실일}": formatAlimtalkDate(payload.checkIn),
    "#{퇴실일}": formatAlimtalkDate(payload.checkOut),
  };
}

function validateConfig(config, templateId, type) {
  if (!config.apiKey || !config.apiSecret) {
    return "SOLAPI_API_KEY / SOLAPI_API_SECRET 환경변수가 필요합니다.";
  }
  if (!config.pfId) {
    return "SOLAPI_PF_ID 환경변수가 필요합니다.";
  }
  if (!config.from) {
    return "SOLAPI_FROM 환경변수가 필요합니다.";
  }
  if (!templateId) {
    return (
      (type === "cancel-complete"
        ? "SOLAPI_TEMPLATE_CANCEL_COMPLETE"
        : "SOLAPI_TEMPLATE_RESERVE_COMPLETE") + " 환경변수가 필요합니다."
    );
  }
  return null;
}

/**
 * 예약 완료 / 예약 취소 완료 카카오 알림톡 발송.
 * Solapi 콘솔에서 대체발송(SMS) 설정 시 disableSms를 지정하지 않으면 자동 적용됩니다.
 *
 * @param {"reserve-complete"|"cancel-complete"} type
 * @param {{
 *   guestName: string,
 *   contact: string,
 *   reservationNumber: string,
 *   roomType: string,
 *   checkIn: string,
 *   checkOut: string,
 * }} payload
 */
export async function sendBookingAlimtalk(type, payload) {
  var config = getSolapiConfig();
  var templateId =
    type === "cancel-complete"
      ? config.templateCancelComplete
      : config.templateReserveComplete;
  var configError = validateConfig(config, templateId, type);
  if (configError) {
    console.warn("[solapi-alimtalk] skipped:", configError, "| type:", type);
    return { ok: false, skipped: true, error: configError };
  }

  var to = normalizePhone(payload && payload.contact);
  if (!/^01\d{8,9}$/.test(to)) {
    console.warn(
      "[solapi-alimtalk] skipped: invalid contact",
      payload && payload.reservationNumber,
    );
    return { ok: false, skipped: true, error: "Invalid contact number" };
  }

  var variables = buildBaseVariables(payload || {});
  if (type === "reserve-complete") {
    variables["#{숙소주소}"] = config.propertyAddress;
  }

  var messageService = getMessageService(config);
  try {
    var result = await messageService.send({
      to: to,
      from: config.from,
      kakaoOptions: {
        pfId: config.pfId,
        templateId: templateId,
        variables: variables,
      },
    });
    console.log(
      "[solapi-alimtalk] sent",
      type,
      payload && payload.reservationNumber,
      "| success:",
      result &&
        result.groupInfo &&
        result.groupInfo.count &&
        result.groupInfo.count.registeredSuccess,
    );
    return { ok: true, result: result };
  } catch (err) {
    console.error(
      "[solapi-alimtalk] failed",
      type,
      payload && payload.reservationNumber,
      err && err.message ? err.message : err,
    );
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
    };
  }
}

/** API 응답을 막지 않도록 백그라운드 발송 */
export function queueBookingAlimtalk(type, payload) {
  sendBookingAlimtalk(type, payload).catch(function (err) {
    console.error("[solapi-alimtalk] queue failed", type, err);
  });
}
