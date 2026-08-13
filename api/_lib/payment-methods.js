/**
 * 결제수단 레지스트리 (KG이니시스 / PortOne v2)
 *
 * payment_method (DB): card | samsung | naver | kakao | toss | paypal | bank
 * pg_pay_provider (DB): PortOne easyPayProvider 원문 (SAMSUNGPAY, NAVERPAY, …)
 */

export const PAYMENT_METHOD_IDS = [
  "card",
  "samsung",
  "naver",
  "kakao",
  "toss",
  "paypal",
  "bank",
];

export const ALLOWED_PAY = new Set(PAYMENT_METHOD_IDS);

const PROVIDER_TO_METHOD = {
  SAMSUNGPAY: "samsung",
  NAVERPAY: "naver",
  KAKAOPAY: "kakao",
  TOSSPAY: "toss",
  PAYPAL: "paypal",
  PAYPAL_V2: "paypal",
};

const METHOD_TO_PROVIDER = {
  samsung: "SAMSUNGPAY",
  naver: "NAVERPAY",
  kakao: "KAKAOPAY",
  toss: "TOSSPAY",
};

function envFlag(name) {
  return String(process.env[name] || "")
    .trim()
    .toLowerCase() === "true";
}

export function normalizePaymentMethodId(raw) {
  var id = String(raw || "")
    .trim()
    .toLowerCase();
  if (id === "kakaopay") return "kakao";
  if (id === "tosspay") return "toss";
  if (id === "paypal") return "paypal";
  if (id === "samsungpay") return "samsung";
  if (ALLOWED_PAY.has(id)) return id;
  return "";
}

export function isEasyPayMethodId(methodId) {
  return (
    methodId === "samsung" ||
    methodId === "naver" ||
    methodId === "kakao" ||
    methodId === "toss"
  );
}

export function resolvePaymentMethodLabel(methodId, locale) {
  var id = normalizePaymentMethodId(methodId);
  var en = String(locale || "").toLowerCase() === "en";
  if (id === "card") return en ? "Credit card" : "신용카드";
  if (id === "samsung") return en ? "Samsung Pay" : "삼성페이";
  if (id === "naver") return en ? "Naver Pay" : "네이버페이";
  if (id === "kakao") return en ? "Kakao Pay" : "카카오페이";
  if (id === "toss") return en ? "Toss Pay" : "토스페이";
  if (id === "paypal") return en ? "PayPal" : "페이팔";
  if (id === "bank") return en ? "Bank transfer" : "무통장입금";
  return en ? "Unknown" : "결제수단 미확인";
}

export function resolveEnabledPaymentMethods() {
  return {
    card: true,
    samsung: envFlag("PAYMENT_EASY_SAMSUNG_ENABLED"),
    naver: envFlag("PAYMENT_EASY_NAVER_ENABLED"),
    kakao: envFlag("PAYMENT_EASY_KAKAO_ENABLED"),
    toss: envFlag("PAYMENT_EASY_TOSS_ENABLED"),
  };
}

export function providerToMethodId(provider) {
  var key = String(provider || "")
    .trim()
    .toUpperCase();
  return PROVIDER_TO_METHOD[key] || "";
}

export function methodIdToProvider(methodId) {
  return METHOD_TO_PROVIDER[normalizePaymentMethodId(methodId)] || "";
}

/**
 * PortOne 결제 조회 응답에서 실제 결제수단 추출.
 * KG이니시스 통합결제창에서 사용자가 선택한 수단을 반영합니다.
 */
export function extractPaymentMethodFromPortonePayment(payment) {
  if (!payment || typeof payment !== "object") {
    return { methodId: "card", pgPayProvider: null };
  }

  var method = payment.method;
  if (method && typeof method === "object") {
    var methodType = String(method.type || "").trim();
    if (methodType === "PaymentMethodEasyPay") {
      var provider = String(
        method.provider || method.easyPayProvider || "",
      ).toUpperCase();
      var easyId = providerToMethodId(provider);
      if (easyId) {
        return { methodId: easyId, pgPayProvider: provider || null };
      }
      return { methodId: "card", pgPayProvider: provider || null };
    }
    if (methodType === "PaymentMethodCard") {
      return { methodId: "card", pgPayProvider: null };
    }
    if (
      methodType === "PaymentMethodPaypal" ||
      methodType === "PaymentMethodPayPal" ||
      methodType === "PaymentMethodPayPalV2"
    ) {
      return { methodId: "paypal", pgPayProvider: "PAYPAL" };
    }
  }

  var easyPay = payment.easyPay;
  if (easyPay && typeof easyPay === "object") {
    var epProvider = String(
      easyPay.provider || easyPay.easyPayProvider || "",
    ).toUpperCase();
    var epId = providerToMethodId(epProvider);
    if (epId) {
      return { methodId: epId, pgPayProvider: epProvider || null };
    }
  }

  var payMethod = String(payment.payMethod || "").trim().toUpperCase();
  if (payMethod === "EASY_PAY") {
    var fallbackProvider = String(
      (easyPay && (easyPay.provider || easyPay.easyPayProvider)) || "",
    ).toUpperCase();
    var fallbackId = providerToMethodId(fallbackProvider);
    if (fallbackId) {
      return {
        methodId: fallbackId,
        pgPayProvider: fallbackProvider || null,
      };
    }
  }
  if (payMethod.indexOf("PAYPAL") >= 0) {
    return { methodId: "paypal", pgPayProvider: "PAYPAL" };
  }

  var pgProvider = String(
    payment.pgProvider ||
      (payment.channel && payment.channel.pgProvider) ||
      "",
  ).toUpperCase();
  if (pgProvider === "PAYPAL" || pgProvider === "PAYPAL_V2") {
    return { methodId: "paypal", pgPayProvider: pgProvider };
  }

  return { methodId: "card", pgPayProvider: null };
}

export function resolveVerifiedPaymentMethod(verified, requestedMethodId) {
  var requested = normalizePaymentMethodId(requestedMethodId) || "card";
  if (!verified || typeof verified !== "object") {
    return { methodId: requested, pgPayProvider: null };
  }
  var methodId = normalizePaymentMethodId(verified.methodId);
  if (!methodId) {
    methodId = requested;
  }
  if (requested === "paypal" && methodId === "card") {
    methodId = "paypal";
  }
  return {
    methodId: methodId,
    pgPayProvider: verified.pgPayProvider || null,
  };
}
