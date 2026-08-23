/**
 * PortOne v2 결제 완료 처리 (PC 반환값 + 모바일 redirectUrl 복귀 공통)
 */
(function (global) {
  function isFalseFlag(value) {
    var raw = String(value == null ? "" : value)
      .trim()
      .toLowerCase();
    return raw === "false" || raw === "0" || raw === "fail" || raw === "failed";
  }

  function parsePortoneSearchParams(searchLike) {
    var result = {};
    try {
      var search = new URLSearchParams(searchLike || "");
      var paymentId = String(
        search.get("paymentId") || search.get("merchant_uid") || "",
      ).trim();
      if (!paymentId) {
        return null;
      }
      var failed =
        isFalseFlag(search.get("imp_success")) ||
        isFalseFlag(search.get("success"));
      var code = search.get("code") || undefined;
      if (failed && !code) {
        code = search.get("error_code") || "FAILED";
      }
      result = {
        paymentId: paymentId,
        code: code,
        message:
          search.get("message") || search.get("error_msg") || undefined,
        paymentToken: search.get("paymentToken") || null,
        txId: search.get("txId") || search.get("imp_uid") || null,
        pgCode: search.get("pgCode") || null,
        pgMessage: search.get("pgMessage") || null,
      };
    } catch (_e) {
      return null;
    }
    return result;
  }

  function mapIamportCallbackToPortoneResult(rsp) {
    if (!rsp || typeof rsp !== "object") {
      return {
        paymentId: "",
        code: "FAILED",
        message: "Payment was cancelled",
      };
    }
    var paymentId = String(rsp.merchant_uid || rsp.paymentId || "").trim();
    var failed =
      rsp.success === false ||
      isFalseFlag(rsp.success) ||
      (!!rsp.error_code && !rsp.imp_uid);
    if (failed) {
      return {
        paymentId: paymentId,
        code: rsp.error_code || rsp.code || "FAILED",
        message: rsp.error_msg || rsp.message || "Payment was cancelled",
        txId: rsp.imp_uid || rsp.txId || null,
      };
    }
    return {
      paymentId: paymentId,
      txId: rsp.imp_uid || rsp.txId || null,
    };
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
      /(?:^|[?&])(?:paymentId|merchant_uid|imp_uid|code|imp_success)=/.test(
        loc.search,
      );
    var hadHash =
      loc.hash &&
      /(?:^|[#&?])(?:paymentId|merchant_uid|imp_uid|code|imp_success)=/.test(
        loc.hash,
      );
    if (!hadSearch && !hadHash) {
      return;
    }
    try {
      global.history.replaceState(null, "", loc.pathname);
    } catch (_e) {}
  }

  var PORTONE_GATEWAY_HOST_RE =
    /(?:^|\.)((?:inicis|portone|iamport|kcp|nicepay|tosspayments|kakaopay|paypal|paypalobjects)\.)/i;

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

  async function lookupPortonePaymentStatus(orderNo, expectedAmount) {
    var verifyRes = await fetch("/api/payment-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentId: orderNo,
        expectedAmount: expectedAmount,
        statusOnly: true,
      }),
    });
    var verifyData = await verifyRes.json();
    return verifyData || {};
  }

  function shouldRecoverSilentPortoneReturn(orderNo) {
    if (hasPortoneRedirectParams()) {
      return false;
    }
    try {
      if (
        sessionStorage.getItem(
          "graffordPaymentProcessing:" + String(orderNo || "").trim(),
        ) === "1"
      ) {
        return true;
      }
    } catch (_e) {}
    if (isPortoneDepartureRecent(30 * 60 * 1000)) {
      return true;
    }
    return isBackForwardNavigation();
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
      if (
        global.matchMedia &&
        global.matchMedia("(max-width: 899px)").matches
      ) {
        return true;
      }
    } catch (_e) {}
    try {
      if (
        global.matchMedia &&
        global.matchMedia("(pointer: coarse)").matches
      ) {
        return true;
      }
    } catch (_e2) {}
    var ua = String(
      (global.navigator && global.navigator.userAgent) || "",
    ).toLowerCase();
    return /android|iphone|ipad|ipod|mobile|samsungbrowser|kakaotalk|naver|line\//.test(
      ua,
    );
  }

  /**
   * redirectUrl 사용 시 PC·모바일 모두 동일한 리다이렉트 복귀 흐름을 쓰도록 보강합니다.
   * 모바일은 KG이니시스 기본값(IFRAME/POPUP)이면 결제 UI가 안 뜨므로 REDIRECTION을 강제합니다.
   * DevTools 좁은 화면은 UA가 PC라 windowType.pc를 쓰므로, 모바일형 환경에서는 pc도 REDIRECTION입니다.
   */
  function enhancePortoneRequestParams(params) {
    var next = Object.assign({}, params || {});
    if (next.redirectUrl) {
      next.forceRedirect = true;
    }
    var windowType = Object.assign({}, next.windowType || {});
    if (!windowType.mobile) {
      windowType.mobile = "REDIRECTION";
    }
    if (isMobileLikeEnvironment() && !windowType.pc) {
      windowType.pc = "REDIRECTION";
    }
    next.windowType = windowType;
    return next;
  }

  /**
   * forceRedirect 이후에도 페이지가 그대로면 결제창이 열리지 않은 것으로 보고 가드를 해제합니다.
   */
  function defaultRedirectWatchdogMs() {
    return isMobileLikeEnvironment() ? 20000 : 8000;
  }

  function armRedirectWatchdog(onStuck, waitMs, orderNo) {
    var fired = false;
    var timer = global.setTimeout(function () {
      if (fired) {
        return;
      }
      if (global.document && global.document.visibilityState === "hidden") {
        return;
      }
      fired = true;
      if (typeof onStuck === "function") {
        onStuck();
      }
    }, waitMs || defaultRedirectWatchdogMs());
    function cancel() {
      fired = true;
      global.clearTimeout(timer);
    }
    global.addEventListener("pagehide", cancel, { once: true });
    return cancel;
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

  var PORTONE_DEPARTURE_AT_KEY = "graffordPortoneDepartingAt";

  function markPortoneDepartureStarted(orderNo) {
    try {
      sessionStorage.setItem(PORTONE_DEPARTURE_AT_KEY, String(Date.now()));
      sessionStorage.setItem(
        "graffordPortoneDepartingOrder",
        String(orderNo || "").trim(),
      );
    } catch (_e) {}
  }

  function clearPortoneDepartureStarted() {
    try {
      sessionStorage.removeItem(PORTONE_DEPARTURE_AT_KEY);
      sessionStorage.removeItem("graffordPortoneDepartingOrder");
    } catch (_e) {}
  }

  function isPortoneDepartureRecent(maxAgeMs) {
    try {
      var at = Number(sessionStorage.getItem(PORTONE_DEPARTURE_AT_KEY) || "0");
      var limit = maxAgeMs != null ? maxAgeMs : 15000;
      return at > 0 && Date.now() - at < limit;
    } catch (_e) {
      return false;
    }
  }

  var PAYMENT_DATA_BACKUP_KEY = "graffordPaymentDataBackup";

  function persistPaymentDataBackup() {
    try {
      var raw = sessionStorage.getItem("graffordPaymentData");
      if (raw) {
        global.localStorage.setItem(PAYMENT_DATA_BACKUP_KEY, raw);
      }
    } catch (_e) {}
  }

  function restorePaymentDataBackup() {
    try {
      var existing = sessionStorage.getItem("graffordPaymentData");
      if (existing) {
        return JSON.parse(existing);
      }
    } catch (_e) {}
    try {
      var backup = global.localStorage.getItem(PAYMENT_DATA_BACKUP_KEY);
      if (!backup) {
        return null;
      }
      var parsed = JSON.parse(backup);
      if (parsed && parsed.orderNo) {
        sessionStorage.setItem("graffordPaymentData", backup);
        return parsed;
      }
    } catch (_e2) {}
    return null;
  }

  function clearPaymentDataBackup() {
    try {
      global.localStorage.removeItem(PAYMENT_DATA_BACKUP_KEY);
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
    persistPaymentDataBackup();
    installPortoneGatewayBackGuard();
  }

  /**
   * sessionStorage 플래그는 동기라 user gesture를 깨지 않습니다.
   * 모바일 REDIRECTION은 requestPayment 직후 pagehide가 뜨므로
   * 플래그를 먼저 남겨 hold/세션이 풀리지 않게 합니다.
   */
  function launchPortonePayment(portone, params, orderNo, handlers) {
    handlers = handlers || {};
    if (!portone || typeof portone.requestPayment !== "function") {
      if (typeof handlers.onError === "function") {
        handlers.onError(new Error("PortOne SDK unavailable"));
      }
      return null;
    }
    var enhanced = enhancePortoneRequestParams(params);
    markPortoneDepartureStarted(orderNo);
    preparePaymentDeparture(orderNo);
    var promise;
    try {
      promise = portone.requestPayment(enhanced);
    } catch (syncErr) {
      clearPortoneDepartureStarted();
      clearPaymentDeparture(orderNo);
      if (typeof handlers.onError === "function") {
        handlers.onError(syncErr);
      }
      return null;
    }
    if (promise && typeof promise.then === "function") {
      promise
        .then(function (response) {
          if (typeof handlers.onSuccess === "function") {
            handlers.onSuccess(response, enhanced);
          }
        })
        .catch(function (err) {
          clearPortoneDepartureStarted();
          clearPaymentDeparture(orderNo);
          if (typeof handlers.onError === "function") {
            handlers.onError(err);
          }
        });
    }
    return promise;
  }

  var RESERVE_COMPLETE_DATA_KEY = "graffordReserveCompleteData";

  function completeValueIsEmpty(key, value) {
    if (value == null) {
      return true;
    }
    var text = String(value).trim();
    if (text === "") {
      return true;
    }
    if (key === "totalAmount" && text === "0") {
      return true;
    }
    return false;
  }

  function buildReserveCompletePayload(source) {
    source = source || {};
    return {
      orderNo: String(
        source.orderNo || source.reservationNumber || source.paymentId || "",
      ).trim(),
      room: String(source.room || source.roomType || "")
        .trim()
        .toUpperCase(),
      checkIn: String(source.checkIn || "").slice(0, 10),
      checkOut: String(source.checkOut || "").slice(0, 10),
      guestName: String(source.guestName || ""),
      contact: String(source.contact || ""),
      email: String(source.email || ""),
      guestRequest: String(source.guestRequest || ""),
      guestCount: String(source.guestCount != null ? source.guestCount : ""),
      extraGuests: String(source.extraGuests != null ? source.extraGuests : "0"),
      totalAmount: String(source.totalAmount != null ? source.totalAmount : "0"),
      payMethod: String(source.payMethod || source.paymentMethod || ""),
      cancelToken: String(source.cancelToken || ""),
      bookingCreatedAtIso: String(
        source.bookingCreatedAtIso || source.createdAtIso || "",
      ),
      bookingLocale: String(source.bookingLocale || "kr"),
    };
  }

  function mergeReserveCompletePayload() {
    var merged = {};
    for (var i = 0; i < arguments.length; i++) {
      var part = arguments[i];
      if (!part) {
        continue;
      }
      var built = buildReserveCompletePayload(part);
      Object.keys(built).forEach(function (key) {
        if (
          completeValueIsEmpty(key, merged[key]) &&
          !completeValueIsEmpty(key, built[key])
        ) {
          merged[key] = built[key];
        } else if (merged[key] == null) {
          merged[key] = built[key];
        }
      });
    }
    return buildReserveCompletePayload(merged);
  }

  function isReserveCompletePayloadReady(payload) {
    if (!payload) {
      return false;
    }
    var next = buildReserveCompletePayload(payload);
    return !!(
      next.orderNo &&
      next.room &&
      next.checkIn &&
      next.checkOut &&
      next.guestName
    );
  }

  function persistReserveCompleteData(payload) {
    var next = buildReserveCompletePayload(payload);
    try {
      sessionStorage.setItem(RESERVE_COMPLETE_DATA_KEY, JSON.stringify(next));
    } catch (_e) {}
    return next;
  }

  function readReserveCompleteData() {
    try {
      var raw = sessionStorage.getItem(RESERVE_COMPLETE_DATA_KEY);
      if (!raw) {
        return null;
      }
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.orderNo) {
        return null;
      }
      return buildReserveCompletePayload(parsed);
    } catch (_e) {
      return null;
    }
  }

  function goToReserveComplete(payload) {
    persistReserveCompleteData(payload);
    if (global.GraffordCheckoutGuard) {
      global.GraffordCheckoutGuard.allowCheckoutNavigation();
    }
    global.location.replace("reserve-complete.html");
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
    var expectedAmount =
      opts.expectedAmount != null ? opts.expectedAmount : finalAmount;
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
          goToReserveComplete(
            buildReserveCompletePayload({
              orderNo: orderNo,
              room: room,
              checkIn: checkIn,
              checkOut: checkOut,
              guestName: guestName,
              contact: contact,
              email: email,
              guestRequest: guestRequest,
              guestCount: guestCount,
              extraGuests: extraGuests,
              totalAmount: finalAmount,
              payMethod: payMethod,
              cancelToken: preSavedCancelToken,
              bookingLocale: bookingLocale,
            }),
          );
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
    var verifiedReservation = null;

    try {
      showPageLoading(messages.verifying || "결제 확인 중입니다...");
      var verifyOutcome = await verifyPortonePaymentWithRetry(
        {
          paymentId: response.paymentId,
          expectedAmount: expectedAmount,
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
      if (verifyData && verifyData.reservation) {
        verifiedReservation = verifyData.reservation;
      }
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
    clearPaymentDataBackup();
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

    showPageLoading(messages.redirecting || "완료 화면으로 이동하는 중입니다...");
    goToReserveComplete(
      mergeReserveCompletePayload(
        {
          orderNo: orderNo,
          room: room,
          checkIn: checkIn,
          checkOut: checkOut,
          guestName: guestName,
          contact: contact,
          email: email,
          guestRequest: guestRequest,
          guestCount: guestCount,
          extraGuests: extraGuests,
          totalAmount: finalAmount,
          payMethod: payMethod,
          cancelToken: fetchedCancelToken,
          bookingCreatedAtIso: bookingCreatedAtIso,
          bookingLocale: bookingLocale,
        },
        verifiedReservation,
      ),
    );
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
    armRedirectWatchdog: armRedirectWatchdog,
    isRedirectDeferredResponse: isRedirectDeferredResponse,
    isPaymentFinalizeInProgress: isPaymentFinalizeInProgress,
    preparePaymentDeparture: preparePaymentDeparture,
    launchPortonePayment: launchPortonePayment,
    lookupPortonePaymentStatus: lookupPortonePaymentStatus,
    shouldRecoverSilentPortoneReturn: shouldRecoverSilentPortoneReturn,
    isBackForwardNavigation: isBackForwardNavigation,
    persistPaymentDataBackup: persistPaymentDataBackup,
    restorePaymentDataBackup: restorePaymentDataBackup,
    clearPaymentDataBackup: clearPaymentDataBackup,
    buildReserveCompletePayload: buildReserveCompletePayload,
    mergeReserveCompletePayload: mergeReserveCompletePayload,
    isReserveCompletePayloadReady: isReserveCompletePayloadReady,
    persistReserveCompleteData: persistReserveCompleteData,
    readReserveCompleteData: readReserveCompleteData,
    goToReserveComplete: goToReserveComplete,
    defaultRedirectWatchdogMs: defaultRedirectWatchdogMs,
    markPortoneDepartureStarted: markPortoneDepartureStarted,
    clearPortoneDepartureStarted: clearPortoneDepartureStarted,
    isPortoneDepartureRecent: isPortoneDepartureRecent,
    finalizePortoneCheckout: finalizePortoneCheckout,
    mapIamportCallbackToPortoneResult: mapIamportCallbackToPortoneResult,
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
