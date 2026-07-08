/**
 * 결제수단 레지스트리 (프론트엔드)
 * KG이니시스(PortOne) 신용카드 + 간편결제 분기용.
 */
(function (global) {
  var METHODS = {
    card: {
      id: "card",
      category: "card",
      portonePayMethod: "CARD",
      labelKr: "신용카드",
      labelEn: "Credit card",
      descKr: "국내 모든 카드 사용 가능",
      descEn: "All Korean cards accepted",
    },
    samsung: {
      id: "samsung",
      category: "easy_pay",
      portonePayMethod: "EASY_PAY",
      easyPayProvider: "SAMSUNGPAY",
      labelKr: "삼성페이",
      labelEn: "Samsung Pay",
      descKr: "삼성페이 간편결제",
      descEn: "Pay with Samsung Pay",
    },
    naver: {
      id: "naver",
      category: "easy_pay",
      portonePayMethod: "EASY_PAY",
      easyPayProvider: "NAVERPAY",
      labelKr: "네이버페이",
      labelEn: "Naver Pay",
      descKr: "네이버페이 간편결제",
      descEn: "Pay quickly with Naver Pay",
    },
    kakao: {
      id: "kakao",
      category: "easy_pay",
      portonePayMethod: "EASY_PAY",
      easyPayProvider: "KAKAOPAY",
      labelKr: "카카오페이",
      labelEn: "Kakao Pay",
      descKr: "카카오페이 간편결제",
      descEn: "Pay with Kakao Pay",
    },
    toss: {
      id: "toss",
      category: "easy_pay",
      portonePayMethod: "EASY_PAY",
      easyPayProvider: "TOSSPAY",
      labelKr: "토스페이",
      labelEn: "Toss Pay",
      descKr: "토스페이 간편결제",
      descEn: "Pay with Toss Pay",
    },
  };

  function normalizeMethodId(raw) {
    var id = String(raw || "")
      .trim()
      .toLowerCase();
    if (id === "kakaopay") return "kakao";
    if (id === "tosspay") return "toss";
    if (id === "samsungpay") return "samsung";
    if (METHODS[id]) return id;
    return "card";
  }

  function isEasyPayMethodId(methodId) {
    var meta = METHODS[normalizeMethodId(methodId)];
    return meta && meta.category === "easy_pay";
  }

  function getLabel(methodId, locale) {
    var meta = METHODS[normalizeMethodId(methodId)];
    if (!meta) return methodId || "—";
    return String(locale || "").toLowerCase() === "en"
      ? meta.labelEn
      : meta.labelKr;
  }

  function getEnabledMethods(config) {
    var flags =
      (config && config.enabledMethods) ||
      (config && config.paymentMethods) ||
      {};
    return {
      card: flags.card !== false,
      samsung: !!flags.samsung,
      naver: !!flags.naver,
      kakao: !!flags.kakao,
      toss: !!flags.toss,
    };
  }

  /** payment.html GRAFFORD_PAYMENT_OPTIONS (없으면 null) */
  function resolvePagePaymentOptions() {
    var opts =
      typeof global !== "undefined" && global.GRAFFORD_PAYMENT_OPTIONS;
    if (!opts || typeof opts !== "object") {
      return null;
    }
    return {
      card: opts.card !== false,
      samsung: !!opts.samsung,
      naver: !!opts.naver,
      kakao: !!opts.kakao,
      toss: !!opts.toss,
    };
  }

  /** API 설정(storeId 등) + payment.html 결제수단 노출 옵션 병합 */
  function mergePaymentConfig(apiConfig) {
    var api = apiConfig || {};
    var pageEnabled = resolvePagePaymentOptions();
    if (!pageEnabled) {
      return api;
    }
    return Object.assign({}, api, { enabledMethods: pageEnabled });
  }

  function hasEnabledEasyPay(enabled) {
    return !!(enabled.samsung || enabled.naver || enabled.kakao || enabled.toss);
  }

  function resolveActiveChannelKey(_methodId, config) {
    return (config && config.channelKey) || "";
  }

  function buildNaverPayProductItems(orderName, orderNo) {
    return [
      {
        categoryType: "PRODUCT",
        categoryId: "GENERAL",
        uid: orderNo,
        name: orderName,
        count: 1,
      },
    ];
  }

  /**
   * PortOne requestPayment 파라미터 생성.
   * card → KG이니시스 통합결제창(CARD), 간편결제 → EASY_PAY + easyPayProvider
   */
  function buildPortoneParams(methodId, ctx, config) {
    var id = normalizeMethodId(methodId);
    var meta = METHODS[id] || METHODS.card;
    var channelKey = resolveActiveChannelKey(id, config);
    var params = {
      storeId: config.storeId,
      channelKey: channelKey,
      paymentId: ctx.orderNo,
      orderName: ctx.orderName,
      totalAmount: ctx.totalAmount,
      currency: "KRW",
      payMethod: meta.portonePayMethod,
      customer: ctx.customer || {},
      locale: ctx.locale || "KO_KR",
      redirectUrl: ctx.redirectUrl,
      confirmUrl: ctx.confirmUrl,
      noticeUrls: ctx.noticeUrls,
    };

    if (params.redirectUrl) {
      params.forceRedirect = true;
    }

    if (meta.category === "easy_pay" && meta.easyPayProvider) {
      params.easyPay = { easyPayProvider: meta.easyPayProvider };
      if (id === "naver" && ctx.checkOut) {
        params.naverpay = {
          useCfmYmdt: String(ctx.checkOut).replace(/-/g, ""),
          productItems: buildNaverPayProductItems(ctx.orderName, ctx.orderNo),
        };
      }
    }

    return params;
  }

  function resolveVerifiedMethod(verifyData, requestedMethodId) {
    var requested = normalizeMethodId(requestedMethodId);
    if (!verifyData || typeof verifyData !== "object") {
      return { methodId: requested, pgPayProvider: null };
    }
    var verified = normalizeMethodId(verifyData.paymentMethod);
    return {
      methodId: verified || requested,
      pgPayProvider: verifyData.pgPayProvider || null,
    };
  }

  function syncDrawerVisibility(drawerEl, config, locale) {
    if (!drawerEl) return;
    var enabled = getEnabledMethods(config);
    var isEn = String(locale || "").toLowerCase() === "en";

    var easyIds = ["samsung", "naver", "kakao", "toss"];
    for (var i = 0; i < easyIds.length; i++) {
      var methodId = easyIds[i];
      var labels = drawerEl.querySelectorAll(
        '[data-payment-method="' + methodId + '"]',
      );
      if (!labels.length) continue;
      for (var j = 0; j < labels.length; j++) {
        var label = labels[j];
        var isVisible = !!enabled[methodId];
        label.hidden = !isVisible;
        var input = label.querySelector('input[type="radio"]');
        if (input) {
          input.disabled = !isVisible;
          if (!isVisible) input.checked = false;
        }
        var title = label.querySelector(".payment-method-option__title");
        var desc = label.querySelector(".payment-method-option__desc");
        if (title) title.textContent = getLabel(methodId, locale);
        if (desc && METHODS[methodId]) {
          desc.textContent = isEn
            ? METHODS[methodId].descEn
            : METHODS[methodId].descKr;
        }
      }
    }
  }

  function validateMethodForCheckout(methodId, config) {
    var id = normalizeMethodId(methodId);
    var enabled = getEnabledMethods(config);
    if (id === "card" && enabled.card) {
      return { ok: true, methodId: id };
    }
    if (isEasyPayMethodId(id) && enabled[id]) {
      return { ok: true, methodId: id };
    }
    if (id !== "card" && !enabled[id]) {
      return {
        ok: false,
        errorKr:
          getLabel(id, "kr") +
          "는 아직 이용할 수 없습니다. 신용카드로 결제해 주세요.",
        errorEn:
          getLabel(id, "en") +
          " is not available yet. Please pay with a credit card.",
      };
    }
    return { ok: true, methodId: "card" };
  }

  global.GraffordPaymentMethods = {
    METHODS: METHODS,
    normalizeMethodId: normalizeMethodId,
    isEasyPayMethodId: isEasyPayMethodId,
    getLabel: getLabel,
    getEnabledMethods: getEnabledMethods,
    resolvePagePaymentOptions: resolvePagePaymentOptions,
    mergePaymentConfig: mergePaymentConfig,
    hasEnabledEasyPay: hasEnabledEasyPay,
    resolveActiveChannelKey: resolveActiveChannelKey,
    buildPortoneParams: buildPortoneParams,
    resolveVerifiedMethod: resolveVerifiedMethod,
    syncDrawerVisibility: syncDrawerVisibility,
    validateMethodForCheckout: validateMethodForCheckout,
  };
})(typeof window !== "undefined" ? window : globalThis);
