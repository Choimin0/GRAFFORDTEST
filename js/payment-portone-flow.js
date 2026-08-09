/**
 * PortOne v2 결제 완료 처리 (PC 반환값 + 모바일 redirectUrl 복귀 공통)
 */
(function (global) {
  function parsePortoneSearchParams(searchLike) {
    var result = {};
    try {
      var search = new URLSearchParams(searchLike || "");
      var paymentId = String(search.get("paymentId") || "").trim();
      if (!paymentId) {
        return null;
      }
      result = {
        paymentId: paymentId,
        code: search.get("code") || undefined,
        message: search.get("message") || undefined,
        paymentToken: search.get("paymentToken") || null,
        txId: search.get("txId") || null,
        pgCode: search.get("pgCode") || null,
        pgMessage: search.get("pgMessage") || null,
      };
    } catch (_e) {
      return null;
    }
    return result;
  }

  function parsePortoneRedirectFromLocation(loc) {
    loc = loc || global.location;
    var fromSearch = parsePortoneSearchParams(loc.search || "");
    if (fromSearch) {
      return fromSearch;
    }
    var hash = String(loc.hash || "");
    if (!hash || hash === "#") {
      return null;
    }
    var hashQuery = hash.charAt(0) === "#" ? hash.slice(1) : hash;
    if (hashQuery.charAt(0) === "?") {
      hashQuery = hashQuery.slice(1);
    }
    var hashIdx = hashQuery.indexOf("?");
    if (hashIdx >= 0) {
      hashQuery = hashQuery.slice(hashIdx + 1);
    }
    return parsePortoneSearchParams(hashQuery);
  }

  function hasPortoneRedirectParams(loc) {
    return !!parsePortoneRedirectFromLocation(loc);
  }

  function clearPortoneRedirectQuery(loc) {
    loc = loc || global.location;
    var hadSearch =
      loc.search &&
      /(?:^|[?&])(?:paymentId|code)=/.test(loc.search);
    var hadHash =
      loc.hash && /(?:^|[#&?])(?:paymentId|code)=/.test(loc.hash);
    if (!hadSearch && !hadHash) {
      return;
    }
    try {
      global.history.replaceState(null, "", loc.pathname);
    } catch (_e) {}
  }

  var PORTONE_GATEWAY_HOST_RE =
    /(?:^|\.)((?:inicis|portone|iamport|kcp|nicepay|tosspayments|kakaopay)\.)/i;

  function isPortoneGatewayUrl(url) {
    try {
      var parsed = new URL(String(url || ""), global.location.href);
      return PORTONE_GATEWAY_HOST_RE.test(parsed.hostname);
    } catch (_e) {
      return PORTONE_GATEWAY_HOST_RE.test(String(url || ""));
    }
  }

  function portoneFallbackUrl(loc) {
    loc = loc || global.location;
    try {
      if (global.sessionStorage.getItem("graffordCheckoutBlocked") === "1") {
        return loc.origin + "/RESERVATION.html";
      }
      var stored = global.sessionStorage.getItem("graffordPortoneFallbackUrl");
      if (stored) {
        return stored;
      }
    } catch (_e) {}
    return loc.origin + loc.pathname;
  }

  function installPortoneGatewayBackGuard() {
    if (global.__graffordPortoneGatewayBackGuard) {
      return;
    }
    global.__graffordPortoneGatewayBackGuard = true;

    if (
      "navigation" in global &&
      global.navigation &&
      typeof global.navigation.addEventListener === "function"
    ) {
      global.navigation.addEventListener("navigate", function (event) {
        if (event.navigationType !== "traverse") {
          return;
        }
        var destUrl =
          event.destination && event.destination.url
            ? event.destination.url
            : "";
        var blockedDestination = false;
        if (
          global.GraffordCheckoutGuard &&
          global.GraffordCheckoutGuard.shouldBlockSealedHistoryDestination
        ) {
          blockedDestination =
            global.GraffordCheckoutGuard.shouldBlockSealedHistoryDestination(
              destUrl,
            );
        }
        if (!blockedDestination && !isPortoneGatewayUrl(destUrl)) {
          return;
        }
        event.preventDefault();
        if (event.canIntercept && typeof event.intercept === "function") {
          event.intercept({
            handler: function () {
              global.location.replace(portoneFallbackUrl());
            },
          });
        }
      });
    }

    if (global.__graffordPortoneLegacyPgSkip) {
      return;
    }
    global.__graffordPortoneLegacyPgSkip = true;

    global.addEventListener("popstate", function () {
      try {
        if (
          global.sessionStorage.getItem("graffordPortonePgBarrier") !== "1"
        ) {
          return;
        }
      } catch (_e) {
        return;
      }
      try {
        global.history.pushState(
          { graffordPortonePgBarrier: true },
          "",
          global.location.pathname,
        );
      } catch (_e2) {}
    });
  }

  function installLegacyPgHistoryBarrier(loc) {
    loc = loc || global.location;
    try {
      global.sessionStorage.setItem("graffordPortonePgBarrier", "1");
    } catch (_e) {
      return;
    }
    try {
      global.history.pushState(
        { graffordPortonePgBarrier: true },
        "",
        loc.pathname,
      );
    } catch (_e2) {}
  }

  function clearLegacyPgHistoryBarrier() {
    try {
      global.sessionStorage.removeItem("graffordPortonePgBarrier");
    } catch (_e) {}
  }

  function sanitizePortoneHistoryAfterReturn(loc) {
    loc = loc || global.location;
    clearPortoneRedirectQuery(loc);
    try {
      global.history.replaceState(
        { graffordPortoneReturn: true },
        "",
        loc.pathname,
      );
    } catch (_e) {}
    try {
      global.sessionStorage.removeItem("graffordPortoneHistoryPendingClean");
    } catch (_e2) {}
    installPortoneGatewayBackGuard();
    installLegacyPgHistoryBarrier(loc);
  }

  function clearPaymentDeparture(orderNo) {
    try {
      global.sessionStorage.removeItem("graffordInPaymentFlow");
      global.sessionStorage.removeItem(
        "graffordPaymentProcessing:" + String(orderNo || "").trim(),
      );
      global.sessionStorage.removeItem("graffordPortoneFallbackUrl");
      global.sessionStorage.removeItem("graffordPortoneHistoryPendingClean");
    } catch (_e) {}
  }

  function isBackForwardNavigation() {
    try {
      var entries = performance.getEntriesByType("navigation");
      if (entries && entries[0] && entries[0].type === "back_forward") {
        return true;
      }
    } catch (_e) {}
    try {
      return !!(performance.navigation && performance.navigation.type === 2);
    } catch (_e2) {
      return false;
    }
  }

  function shouldResetStalePaymentDeparture(loc, orderNo) {
    loc = loc || global.location;
    if (!orderNo) {
      return false;
    }
    if (hasPortoneRedirectParams(loc)) {
      return false;
    }
    if (isPaymentFinalizeInProgress(orderNo)) {
      return false;
    }
    try {
      if (
        global.sessionStorage.getItem(
          "graffordPaymentProcessing:" + String(orderNo || "").trim(),
        ) !== "1"
      ) {
        return false;
      }
    } catch (_e) {
      return false;
    }
    if (isPortoneGatewayUrl(global.document && global.document.referrer)) {
      return true;
    }
    return isBackForwardNavigation();
  }

  function resetStalePaymentDepartureIfNeeded(loc, orderNo) {
    if (!shouldResetStalePaymentDeparture(loc, orderNo)) {
      return false;
    }
    clearPaymentDeparture(orderNo);
    clearLegacyPgHistoryBarrier();
    return true;
  }

  function portoneRedirectStorageKey(orderNo) {
    return "graffordPortoneRedirect:" + String(orderNo || "").trim();
  }

  function persistPortoneRedirectResult(orderNo, redirectResult) {
    if (!orderNo || !redirectResult || !redirectResult.paymentId) {
      return;
    }
    try {
      sessionStorage.setItem(
        portoneRedirectStorageKey(orderNo),
        JSON.stringify(redirectResult),
      );
    } catch (_e) {}
  }

  function loadPersistedPortoneRedirectResult(orderNo) {
    try {
      var raw = sessionStorage.getItem(portoneRedirectStorageKey(orderNo));
      if (!raw) {
        return null;
      }
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.paymentId) {
        return null;
      }
      return parsed;
    } catch (_e) {
      return null;
    }
  }

  function clearPersistedPortoneRedirectResult(orderNo) {
    try {
      sessionStorage.removeItem(portoneRedirectStorageKey(orderNo));
    } catch (_e) {}
  }

  function resolvePortoneRedirectResult(loc, orderNo) {
    var fromLocation = parsePortoneRedirectFromLocation(loc);
    if (fromLocation) {
      if (orderNo && fromLocation.paymentId === orderNo) {
        persistPortoneRedirectResult(orderNo, fromLocation);
      }
      return fromLocation;
    }
    if (!orderNo) {
      return null;
    }
    return loadPersistedPortoneRedirectResult(orderNo);
  }

  async function verifyPortonePaymentWithRetry(body, showPageLoading, messages) {
    if (showPageLoading) {
      showPageLoading(
        (messages && messages.verifying) || "결제 확인 중입니다...",
      );
    }
    var verifyRes = await fetch("/api/payment-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    var verifyData = await verifyRes.json();
    return { verifyRes: verifyRes, verifyData: verifyData };
  }

  function buildPortoneRedirectUrl(loc) {
    loc = loc || global.location;
    return loc.origin + loc.pathname;
  }

  function isMobileLikeEnvironment() {
    try {
      if (global.matchMedia && global.matchMedia("(max-width: 767px)").matches) {
        return true;
      }
    } catch (_e) {}
    var ua = String(
      (global.navigator && global.navigator.userAgent) || "",
    ).toLowerCase();
    return /android|iphone|ipad|ipod|mobile|samsungbrowser|kakaotalk|naver|line\//.test(
      ua,
    );
  }

  /**
   * redirectUrl 사용 시 PC·모바일 모두 동일한 리다이렉트 복귀 흐름을 쓰도록 보강합니다.
   */
  function enhancePortoneRequestParams(params) {
    var next = Object.assign({}, params || {});
    if (next.redirectUrl) {
      next.forceRedirect = true;
    }
    return next;
  }

  /**
   * redirectUrl + forceRedirect 환경에서 requestPayment가 빈 값으로 resolve되거나
   * 곧 페이지가 이탈하는 경우 — 취소로 처리하지 않습니다.
   */
  function isRedirectDeferredResponse(response, params) {
    if (!params || !params.redirectUrl) {
      return false;
    }
    if (response && response.paymentId && !response.code) {
      return false;
    }
    if (response && response.code) {
      return false;
    }
    return true;
  }

  function paymentFinalizeLockKey(orderNo) {
    return "graffordPaymentFinalizing:" + String(orderNo || "").trim();
  }

  function isPaymentFinalizeInProgress(orderNo) {
    try {
      return sessionStorage.getItem(paymentFinalizeLockKey(orderNo)) === "1";
    } catch (_e) {
      return false;
    }
  }

  function markPaymentFinalizeInProgress(orderNo) {
    try {
      sessionStorage.setItem(paymentFinalizeLockKey(orderNo), "1");
    } catch (_e) {}
  }

  function clearPaymentFinalizeInProgress(orderNo) {
    try {
      sessionStorage.removeItem(paymentFinalizeLockKey(orderNo));
    } catch (_e) {}
  }

  function preparePaymentDeparture(orderNo) {
    clearLegacyPgHistoryBarrier();
    try {
      sessionStorage.setItem("graffordInPaymentFlow", "1");
      sessionStorage.setItem(
        "graffordPaymentProcessing:" + String(orderNo || "").trim(),
        "1",
      );
      sessionStorage.setItem(
        "graffordPortoneFallbackUrl",
        global.location.origin + global.location.pathname,
      );
      sessionStorage.setItem("graffordPortoneHistoryPendingClean", "1");
    } catch (_e) {}
    installPortoneGatewayBackGuard();
    if (global.GraffordCheckoutGuard) {
      global.GraffordCheckoutGuard.allowCheckoutNavigation();
    }
  }

  async function finalizePortoneCheckout(opts) {
    var response = opts.response || {};
    var showError =
      typeof opts.showError === "function" ? opts.showError : function () {};
    var showPageLoading =
      typeof opts.showPageLoading === "function"
        ? opts.showPageLoading
        : function () {};
    var resetPaymentGuard =
      typeof opts.resetPaymentGuard === "function"
        ? opts.resetPaymentGuard
        : function () {};
    var persistSaved =
      typeof opts.persistSaved === "function" ? opts.persistSaved : function () {};
    var refreshPaymentMethodUi =
      typeof opts.refreshPaymentMethodUi === "function"
        ? opts.refreshPaymentMethodUi
        : function () {};
    var reservationsApiUrl =
      typeof opts.reservationsApiUrl === "function"
        ? opts.reservationsApiUrl
        : function () {
            return "/api/reservations";
          };

    var GPM = opts.GPM || null;
    var orderNo = opts.orderNo;
    var finalAmount = opts.finalAmount;
    var payMethod = opts.payMethod;
    var saved = opts.saved || {};
    var preSavedCancelToken = opts.preSavedCancelToken || "";
    var bookingToken = opts.bookingToken || "";
    var bookingLocale = opts.bookingLocale || "kr";
    var room = opts.room;
    var checkIn = opts.checkIn;
    var checkOut = opts.checkOut;
    var stayNights = opts.stayNights;
    var extraGuests = opts.extraGuests;
    var guestCount = opts.guestCount;
    var guestName = opts.guestName;
    var contact = opts.contact;
    var email = opts.email;
    var guestRequest = opts.guestRequest;
    var pricingBreakdown = opts.pricingBreakdown || null;
    var paymentSettledKey = opts.paymentSettledKey;
    var processingMsg = opts.processingMsg || null;
    var messages = opts.messages || {};

    if (paymentSettledKey) {
      try {
        if (sessionStorage.getItem(paymentSettledKey) === "1") {
          if (global.GraffordCheckoutGuard) {
            global.GraffordCheckoutGuard.allowCheckoutNavigation();
          }
          global.location.replace("reserve-complete.html");
          return true;
        }
      } catch (_settled) {}
    }

    if (isPaymentFinalizeInProgress(orderNo)) {
      return false;
    }
    markPaymentFinalizeInProgress(orderNo);

    if (!response || response.code) {
      clearPaymentFinalizeInProgress(orderNo);
      clearPaymentDeparture(orderNo);
      showError(messages.cancelled || "결제가 취소되었습니다");
      return false;
    }

    var verifiedPgTid = null;
    var verifiedPayMethod = payMethod;
    var verifiedPgPayProvider = null;

    try {
      showPageLoading(messages.verifying || "결제 확인 중입니다...");
      var verifyOutcome = await verifyPortonePaymentWithRetry(
        {
          paymentId: response.paymentId,
          expectedAmount: finalAmount,
          paymentToken: response.paymentToken || null,
          txId: response.txId || null,
          requestedPaymentMethod: payMethod,
        },
        showPageLoading,
        messages,
      );
      var verifyRes = verifyOutcome.verifyRes;
      var verifyData = verifyOutcome.verifyData;
      if (!verifyRes.ok || !verifyData.ok) {
        var verifyErrMsg = verifyData.error || verifyData.message || "";
        if (verifyData.expected != null && verifyData.actual != null) {
          if (messages.amountMismatchFormat) {
            verifyErrMsg += messages.amountMismatchFormat
              .replace("{expected}", String(verifyData.expected))
              .replace("{actual}", String(verifyData.actual));
          } else {
            verifyErrMsg +=
              "\n(결제 금액: 예상 " +
              verifyData.expected +
              "원 / 실제 " +
              verifyData.actual +
              "원)";
          }
        }
        showError(
          (messages.verifyFailed ||
            "결제 검증에 실패했습니다. 결제가 정상적으로 이루어졌다면 고객센터로 문의해 주세요.\n") +
            verifyErrMsg,
        );
        clearPaymentFinalizeInProgress(orderNo);
        return false;
      }
      verifiedPgTid = verifyData.pgTid || null;
      if (GPM) {
        var verified = GPM.resolveVerifiedMethod(verifyData, payMethod);
        verifiedPayMethod = verified.methodId;
        verifiedPgPayProvider = verified.pgPayProvider;
      } else if (verifyData.paymentMethod) {
        verifiedPayMethod = verifyData.paymentMethod;
        verifiedPgPayProvider = verifyData.pgPayProvider || null;
      }
    } catch (e) {
      showError(
        (messages.verifyNetworkError ||
          "결제 검증 중 네트워크 오류가 발생했습니다. 결제가 정상적으로 이루어졌다면 고객센터로 문의해 주세요.\n(") +
          (e && e.message ? e.message : String(e)) +
          ")",
      );
      clearPaymentFinalizeInProgress(orderNo);
      return false;
    }

    payMethod = verifiedPayMethod;
    saved.payMethod = payMethod;
    persistSaved();
    refreshPaymentMethodUi();

    if (processingMsg) {
      processingMsg.hidden = false;
      processingMsg.textContent =
        messages.savingReservation || "예약 정보를 저장하는 중입니다...";
    }

    var fetchedCancelToken = preSavedCancelToken;
    var saveData;
    try {
      showPageLoading(messages.savingReservation || "예약 정보를 저장하는 중입니다...");
      var saveRes = await fetch(reservationsApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationNumber: orderNo,
          guestName: guestName,
          contact: contact,
          email: email,
          guestRequest: guestRequest,
          roomType: room,
          checkIn: checkIn,
          checkOut: checkOut,
          stayNights: stayNights,
          extraGuests: extraGuests,
          totalAmount: finalAmount,
          paymentMethod: verifiedPayMethod,
          pgPayProvider: verifiedPgPayProvider,
          guestCount: guestCount,
          pgTid: verifiedPgTid,
          bookingToken: bookingToken,
          bookingLocale: bookingLocale,
          pricingBreakdown: pricingBreakdown,
        }),
      });
      saveData = await saveRes.json();

      if (saveData && saveData.unavailable) {
        resetPaymentGuard();
        clearPaymentFinalizeInProgress(orderNo);
        if (global.GraffordBookingToken) {
          global.GraffordBookingToken.showUnavailableModal();
        }
        return false;
      }

      if (saveRes.status !== 409 && (!saveRes.ok || !saveData.ok)) {
        showError(
          (messages.saveFailed ||
            "결제는 완료되었으나 예약 저장에 실패했습니다.\n고객센터로 문의해 주세요.\n(결제번호: ") +
            orderNo +
            ")\n" +
            (saveData.error || ""),
        );
        clearPaymentFinalizeInProgress(orderNo);
        return false;
      }
      fetchedCancelToken =
        (saveData && saveData.cancelToken) || fetchedCancelToken;
    } catch (e) {
      showError(
        (messages.saveNetworkError ||
          "결제는 완료되었으나 예약 저장 중 오류가 발생했습니다.\n고객센터로 문의해 주세요.\n(결제번호: ") +
          orderNo +
          ")\n(" +
          (e && e.message ? e.message : String(e)) +
          ")",
      );
      clearPaymentFinalizeInProgress(orderNo);
      return false;
    }

    clearPaymentFinalizeInProgress(orderNo);
    clearPersistedPortoneRedirectResult(orderNo);
    clearPaymentDeparture(orderNo);
    clearLegacyPgHistoryBarrier();

    var bookingCreatedAtIso = (saveData && saveData.createdAtIso) || "";
    try {
      sessionStorage.setItem(paymentSettledKey, "1");
    } catch (_ss) {}
    if (global.GraffordBookingToken) {
      global.GraffordBookingToken.clearCheckoutSession();
    }

    if (global.GraffordCheckoutGuard &&
        typeof global.GraffordCheckoutGuard.activateCheckoutBackSeal === "function") {
      global.GraffordCheckoutGuard.activateCheckoutBackSeal();
    }

    try {
      sessionStorage.setItem(
        "graffordReserveCompleteData",
        JSON.stringify({
          orderNo: orderNo,
          room: room,
          checkIn: checkIn,
          checkOut: checkOut,
          guestName: guestName,
          contact: contact,
          email: email,
          guestRequest: guestRequest,
          guestCount: String(guestCount),
          extraGuests: String(extraGuests),
          totalAmount: String(finalAmount),
          payMethod: payMethod,
          cancelToken: fetchedCancelToken,
          bookingCreatedAtIso: bookingCreatedAtIso,
          bookingLocale: bookingLocale,
        }),
      );
    } catch (_sd) {}

    if (global.GraffordCheckoutGuard) {
      global.GraffordCheckoutGuard.allowCheckoutNavigation();
    }

    showPageLoading(messages.redirecting || "완료 화면으로 이동하는 중입니다...");
    global.location.href = "reserve-complete.html";
    return true;
  }

  global.GraffordPortoneFlow = {
    parsePortoneRedirectFromLocation: parsePortoneRedirectFromLocation,
    hasPortoneRedirectParams: hasPortoneRedirectParams,
    clearPortoneRedirectQuery: clearPortoneRedirectQuery,
    sanitizePortoneHistoryAfterReturn: sanitizePortoneHistoryAfterReturn,
    clearPaymentDeparture: clearPaymentDeparture,
    resetStalePaymentDepartureIfNeeded: resetStalePaymentDepartureIfNeeded,
    isPortoneGatewayUrl: isPortoneGatewayUrl,
    buildPortoneRedirectUrl: buildPortoneRedirectUrl,
    isMobileLikeEnvironment: isMobileLikeEnvironment,
    enhancePortoneRequestParams: enhancePortoneRequestParams,
    isRedirectDeferredResponse: isRedirectDeferredResponse,
    isPaymentFinalizeInProgress: isPaymentFinalizeInProgress,
    preparePaymentDeparture: preparePaymentDeparture,
    finalizePortoneCheckout: finalizePortoneCheckout,
    resolvePortoneRedirectResult: resolvePortoneRedirectResult,
    persistPortoneRedirectResult: persistPortoneRedirectResult,
    loadPersistedPortoneRedirectResult: loadPersistedPortoneRedirectResult,
    clearPersistedPortoneRedirectResult: clearPersistedPortoneRedirectResult,
    clearLegacyPgHistoryBarrier: clearLegacyPgHistoryBarrier,
  };

  installPortoneGatewayBackGuard();

  function resumePgHistoryBarrierIfNeeded() {
    try {
      if (global.sessionStorage.getItem("graffordPortonePgBarrier") !== "1") {
        return;
      }
    } catch (_e) {
      return;
    }
    installLegacyPgHistoryBarrier(global.location);
  }

  resumePgHistoryBarrierIfNeeded();

  function showEarlyRedirectLoading() {
    if (!hasPortoneRedirectParams()) {
      return;
    }
    try {
      var earlyRedirect = parsePortoneRedirectFromLocation();
      if (earlyRedirect && earlyRedirect.paymentId) {
        var savedRaw = global.sessionStorage.getItem("graffordPaymentData");
        if (savedRaw) {
          var saved = JSON.parse(savedRaw);
          if (saved && saved.orderNo === earlyRedirect.paymentId) {
            persistPortoneRedirectResult(saved.orderNo, earlyRedirect);
          }
        }
      }
    } catch (_persist) {}
    function apply() {
      var overlay = global.document.getElementById("page-loading-overlay");
      var text = global.document.getElementById("page-loading-text");
      if (text) {
        text.textContent = "결제 확인 중입니다...";
      }
      if (overlay) {
        overlay.hidden = false;
      }
    }
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", apply);
    } else {
      apply();
    }
  }

  showEarlyRedirectLoading();
})(typeof window !== "undefined" ? window : globalThis);
