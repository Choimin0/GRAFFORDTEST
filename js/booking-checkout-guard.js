(function (root) {
  var CHECKOUT_ACTIVE_KEY = "graffordCheckoutActive";
  var ALLOW_NAV_KEY = "graffordCheckoutAllowNav";
  var CHECKOUT_BLOCKED_KEY = "graffordCheckoutBlocked";
  var CHECKOUT_SEAL_BACK_KEY = "graffordCheckoutSealBack";
  var BLOCK_PAYMENT_FORWARD_KEY = "graffordBlockPaymentForward";
  var PAYMENT_NAV_KEY = "graffordCheckoutPaymentNav";
  var CHECKOUT_SEAL_REDIRECT = "RESERVATION.html";
  var ALLOWED_PATH_RE =
    /(?:^|\/)(?:confirm|payment)\.html(?:[?#].*)?$/i;
  var PORTONE_GATEWAY_HOST_RE =
    /(?:^|\.)((?:inicis|portone|iamport|kcp|nicepay|tosspayments|kakaopay|paypal|paypalobjects)\.)/i;
  var allowCheckoutNavigationFn = null;
  var disallowCheckoutNavigationFn = null;
  var allowNavigateToPaymentFn = null;

  function isCheckoutPath(url) {
    try {
      var path = new URL(url, root.location.href).pathname;
      return ALLOWED_PATH_RE.test(path);
    } catch (_e) {
      return ALLOWED_PATH_RE.test(String(url || ""));
    }
  }

  function isPortoneGatewayUrl(url) {
    if (
      root.GraffordPortoneFlow &&
      root.GraffordPortoneFlow.isPortoneGatewayUrl
    ) {
      return root.GraffordPortoneFlow.isPortoneGatewayUrl(url);
    }
    try {
      var parsed = new URL(String(url || ""), root.location.href);
      return PORTONE_GATEWAY_HOST_RE.test(parsed.hostname);
    } catch (_e) {
      return PORTONE_GATEWAY_HOST_RE.test(String(url || ""));
    }
  }

  function isCheckoutHistorySealed() {
    try {
      return sessionStorage.getItem(CHECKOUT_BLOCKED_KEY) === "1";
    } catch (_e) {
      return false;
    }
  }

  function isCheckoutBackSealActive() {
    try {
      return sessionStorage.getItem(CHECKOUT_SEAL_BACK_KEY) === "1";
    } catch (_e) {
      return false;
    }
  }

  function shouldBlockSealedHistoryDestination(url) {
    if (!isCheckoutHistorySealed()) {
      return false;
    }
    return isCheckoutPath(url) || isPortoneGatewayUrl(url);
  }

  function checkoutSealRedirectUrl() {
    try {
      return new URL(CHECKOUT_SEAL_REDIRECT, root.location.href).href;
    } catch (_e) {
      return CHECKOUT_SEAL_REDIRECT;
    }
  }

  function activateCheckoutBackSeal() {
    try {
      sessionStorage.setItem(CHECKOUT_BLOCKED_KEY, "1");
      sessionStorage.setItem(CHECKOUT_SEAL_BACK_KEY, "1");
    } catch (_e) {}
    if (
      root.GraffordPortoneFlow &&
      root.GraffordPortoneFlow.clearLegacyPgHistoryBarrier
    ) {
      root.GraffordPortoneFlow.clearLegacyPgHistoryBarrier();
    }
    pushCheckoutBackSealState();
  }

  function clearCheckoutBackSeal() {
    try {
      sessionStorage.removeItem(CHECKOUT_SEAL_BACK_KEY);
    } catch (_e) {}
  }

  function isReservationPage(loc) {
    loc = loc || root.location;
    return /(?:^|\/)RESERVATION\.html$/i.test(loc.pathname || "");
  }

  function pushCheckoutBackSealState() {
    if (!isCheckoutBackSealActive()) {
      return;
    }
    try {
      root.history.pushState(
        { graffordCheckoutSeal: true },
        "",
        root.location.href,
      );
    } catch (_e) {}
  }

  function installCheckoutBlockedPageshowGuard() {
    if (root.__graffordCheckoutBlockedPageshow) {
      return;
    }
    root.__graffordCheckoutBlockedPageshow = true;
    root.addEventListener("pageshow", function () {
      if (!isCheckoutPath(root.location.href)) {
        return;
      }
      if (redirectIfPaymentForwardBlocked()) {
        return;
      }
      if (
        sessionStorage.getItem(CHECKOUT_BLOCKED_KEY) === "1" &&
        !hasPortoneRedirectReturn() &&
        !isPaymentInProgress()
      ) {
        try {
          sessionStorage.setItem(CHECKOUT_SEAL_BACK_KEY, "1");
        } catch (_e) {}
        root.location.replace(checkoutSealRedirectUrl());
      }
    });
  }

  function installCheckoutHistorySealGuard() {
    if (root.__graffordCheckoutHistorySealGuard) {
      return;
    }
    root.__graffordCheckoutHistorySealGuard = true;

    if (
      "navigation" in root &&
      root.navigation &&
      typeof root.navigation.addEventListener === "function"
    ) {
      root.navigation.addEventListener("navigate", function (event) {
        if (!isCheckoutHistorySealed()) {
          return;
        }
        if (event.navigationType !== "traverse") {
          return;
        }
        if (!root.navigation.currentEntry) {
          return;
        }
        var destUrl =
          event.destination && event.destination.url
            ? event.destination.url
            : "";
        var isBack =
          event.destination.index < root.navigation.currentEntry.index;
        var isForward =
          event.destination.index > root.navigation.currentEntry.index;
        if (!isBack && !isForward) {
          return;
        }
        if (!shouldBlockSealedHistoryDestination(destUrl)) {
          return;
        }
        event.preventDefault();
        if (event.canIntercept && typeof event.intercept === "function") {
          event.intercept({
            handler: function () {
              root.location.replace(checkoutSealRedirectUrl());
            },
          });
        }
      });
    }

    root.addEventListener("popstate", function () {
      if (!isCheckoutBackSealActive()) {
        return;
      }
      if (isReservationPage()) {
        pushCheckoutBackSealState();
        return;
      }
      if (shouldBlockSealedHistoryDestination(root.location.href)) {
        root.location.replace(checkoutSealRedirectUrl());
      }
    });
  }

  function maybeActivateCheckoutBackSealOnPage() {
    if (!isCheckoutBackSealActive()) {
      return;
    }
    installCheckoutHistorySealGuard();
    if (isReservationPage()) {
      pushCheckoutBackSealState();
    }
  }

  function markCheckoutActive() {
    try {
      sessionStorage.setItem(CHECKOUT_ACTIVE_KEY, "1");
    } catch (_e) {}
  }

  function isCheckoutActive() {
    try {
      return sessionStorage.getItem(CHECKOUT_ACTIVE_KEY) === "1";
    } catch (_e) {
      return false;
    }
  }

  function isCheckoutNavigationAllowed() {
    try {
      return sessionStorage.getItem(ALLOW_NAV_KEY) === "1";
    } catch (_e) {
      return false;
    }
  }

  function isPaymentInProgress() {
    try {
      var keys = Object.keys(sessionStorage);
      for (var i = 0; i < keys.length; i++) {
        if (
          keys[i].indexOf("graffordPaymentProcessing:") === 0 &&
          sessionStorage.getItem(keys[i]) === "1"
        ) {
          return true;
        }
      }
    } catch (_e) {}
    return false;
  }

  function clearAllPaymentProcessingFlags() {
    try {
      var keys = Object.keys(sessionStorage);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf("graffordPaymentProcessing:") === 0) {
          sessionStorage.removeItem(keys[i]);
        }
      }
      sessionStorage.removeItem("graffordInPaymentFlow");
    } catch (_e) {}
    if (
      root.GraffordPortoneFlow &&
      root.GraffordPortoneFlow.clearPortoneDepartureStarted
    ) {
      root.GraffordPortoneFlow.clearPortoneDepartureStarted();
    }
  }

  function isLikelyPortonePaymentDeparture() {
    if (
      root.GraffordPortoneFlow &&
      root.GraffordPortoneFlow.isPortoneDepartureRecent
    ) {
      return root.GraffordPortoneFlow.isPortoneDepartureRecent(15000);
    }
    return false;
  }

  function shouldSkipHoldReleaseOnPageExit(page) {
    if (isLikelyPortonePaymentDeparture()) {
      return true;
    }
    if (isPaymentInProgress()) {
      return true;
    }
    if (isPaymentNavigationAllowed() && page === "confirm") {
      return true;
    }
    if (isCheckoutNavigationAllowed()) {
      return false;
    }
    return false;
  }

  function hasPortoneRedirectReturn() {
    if (
      root.GraffordPortoneFlow &&
      root.GraffordPortoneFlow.hasPortoneRedirectParams
    ) {
      return root.GraffordPortoneFlow.hasPortoneRedirectParams(root.location);
    }
    try {
      return !!new URLSearchParams(root.location.search || "").get("paymentId");
    } catch (_e) {
      return false;
    }
  }

  function confirmPageUrl() {
    try {
      return new URL("confirm.html", root.location.href).href;
    } catch (_e) {
      return "confirm.html";
    }
  }

  function redirectIfPaymentForwardBlocked() {
    try {
      if (
        sessionStorage.getItem(BLOCK_PAYMENT_FORWARD_KEY) === "1" &&
        /\/payment\.html$/i.test(root.location.pathname || "") &&
        !isCheckoutNavigationAllowed() &&
        !isPaymentNavigationAllowed() &&
        !hasPortoneRedirectReturn() &&
        !isPaymentInProgress()
      ) {
        root.location.replace(confirmPageUrl());
        return true;
      }
    } catch (_e) {}
    return false;
  }

  function clearPaymentForwardBlock() {
    try {
      sessionStorage.removeItem(BLOCK_PAYMENT_FORWARD_KEY);
    } catch (_e) {}
  }

  function markPaymentForwardBlocked() {
    try {
      sessionStorage.setItem(BLOCK_PAYMENT_FORWARD_KEY, "1");
    } catch (_e) {}
  }

  function isPaymentNavigationAllowed() {
    try {
      return sessionStorage.getItem(PAYMENT_NAV_KEY) === "1";
    } catch (_e) {
      return false;
    }
  }

  function clearPaymentNavigationAllowance() {
    try {
      sessionStorage.removeItem(PAYMENT_NAV_KEY);
    } catch (_e) {}
  }

  function clearCheckoutNavigationAllowance() {
    try {
      sessionStorage.removeItem(ALLOW_NAV_KEY);
    } catch (_e) {}
    clearPaymentNavigationAllowance();
  }

  function allowNavigateToPayment() {
    allowCheckoutNavigation();
    try {
      sessionStorage.setItem(PAYMENT_NAV_KEY, "1");
    } catch (_e) {}
    if (allowNavigateToPaymentFn) {
      allowNavigateToPaymentFn();
    }
  }

  function allowCheckoutNavigation() {
    if (allowCheckoutNavigationFn) {
      allowCheckoutNavigationFn();
    }
    try {
      sessionStorage.setItem(ALLOW_NAV_KEY, "1");
      sessionStorage.removeItem(BLOCK_PAYMENT_FORWARD_KEY);
    } catch (_e) {}
  }

  function disallowCheckoutNavigation() {
    if (disallowCheckoutNavigationFn) {
      disallowCheckoutNavigationFn();
    }
    clearCheckoutNavigationAllowance();
  }

  function isPageReload() {
    try {
      var entries = performance.getEntriesByType("navigation");
      if (entries && entries[0] && entries[0].type === "reload") {
        return true;
      }
    } catch (_e) {}
    try {
      return !!(performance.navigation && performance.navigation.type === 1);
    } catch (_e2) {
      return false;
    }
  }

  function hasActiveCheckoutSession() {
    if (isCheckoutActive()) {
      return true;
    }
    if (root.GraffordBookingToken && root.GraffordBookingToken.hasIssuedCheckoutSession) {
      return root.GraffordBookingToken.hasIssuedCheckoutSession();
    }
    return false;
  }

  function abandonCheckoutOnReload(redirectTo) {
    var target = redirectTo || "RESERVATION.html";
    if (
      hasPortoneRedirectReturn() ||
      isPaymentInProgress() ||
      !isPageReload() ||
      !hasActiveCheckoutSession()
    ) {
      return false;
    }
    clearCheckoutNavigationAllowance();
    if (root.GraffordBookingToken) {
      root.GraffordBookingToken.abandonCheckoutSession(target);
    } else {
      try {
        sessionStorage.removeItem(CHECKOUT_ACTIVE_KEY);
      } catch (_e) {}
      root.location.replace(target);
    }
    return true;
  }

  function redirectIfCheckoutBlocked(redirectTo) {
    if (root.GraffordBookingToken && root.GraffordBookingToken.redirectIfCheckoutBlocked) {
      return root.GraffordBookingToken.redirectIfCheckoutBlocked(redirectTo);
    }
    try {
      if (sessionStorage.getItem("graffordCheckoutBlocked") === "1") {
        root.location.replace(redirectTo || "RESERVATION.html");
        return true;
      }
    } catch (_e) {}
    return false;
  }

  function init(options) {
    options = options || {};
    var page = options.page || "confirm";
    var showLeaveOverlay =
      typeof options.showLeaveOverlay === "function"
        ? options.showLeaveOverlay
        : function () {};
    var hideLeaveOverlay =
      typeof options.hideLeaveOverlay === "function"
        ? options.hideLeaveOverlay
        : function () {};
    var onExpiredOption =
      typeof options.onExpired === "function"
        ? options.onExpired
        : function () {
            if (root.GraffordBookingToken) {
              root.GraffordBookingToken.showExpiredModal();
            }
          };
    function onExpired() {
      if (isLikelyPortonePaymentDeparture()) {
        return;
      }
      if (isPaymentInProgress()) {
        clearAllPaymentProcessingFlags();
      }
      onExpiredOption();
    }
    var ttlElementIds = options.ttlElementIds || [];
    var leaveConfirmButtons = options.leaveConfirmButtons || [];
    var leaveCancelButtons = options.leaveCancelButtons || [];
    var guardEnabled = options.guardEnabled !== false;
    var pendingLeaveUrl = "";
    var leaveConfirmed = false;
    var checkoutPageUrl = root.location.href;
    var beforeUnloadHandler = null;

    allowCheckoutNavigationFn = function () {
      leaveConfirmed = true;
    };
    disallowCheckoutNavigationFn = function () {
      leaveConfirmed = false;
    };
    allowNavigateToPaymentFn = function () {
      leaveConfirmed = true;
      if (beforeUnloadHandler) {
        root.removeEventListener("beforeunload", beforeUnloadHandler);
        beforeUnloadHandler = null;
      }
    };

    function rememberCheckoutReferrer() {
      try {
        var ref = root.document.referrer || "";
        if (ref) {
          var refPath = new URL(ref, root.location.href).pathname;
          if (isCheckoutPath(ref)) {
            sessionStorage.setItem("graffordCheckoutPrevPath", refPath);
            return;
          }
        }
        if (
          page === "payment" &&
          sessionStorage.getItem("graffordInPaymentFlow") === "1"
        ) {
          sessionStorage.setItem(
            "graffordCheckoutPrevPath",
            new URL("confirm.html", root.location.href).pathname,
          );
          return;
        }
        sessionStorage.removeItem("graffordCheckoutPrevPath");
      } catch (_e) {
        try {
          sessionStorage.removeItem("graffordCheckoutPrevPath");
        } catch (_e2) {}
      }
    }

    function readCheckoutReferrerPath() {
      try {
        return String(sessionStorage.getItem("graffordCheckoutPrevPath") || "");
      } catch (_e) {
        return "";
      }
    }

    function isAllowedCheckoutBack() {
      if (page !== "payment") {
        return false;
      }
      try {
        var currentPath = new URL(root.location.href).pathname;
        if (!/\/payment\.html$/i.test(currentPath)) {
          return false;
        }
      } catch (_e) {
        return false;
      }
      var prevPath = readCheckoutReferrerPath();
      if (prevPath && /\/confirm\.html$/i.test(prevPath)) {
        return true;
      }
      try {
        return sessionStorage.getItem("graffordInPaymentFlow") === "1";
      } catch (_e2) {
        return false;
      }
    }

    function isBlockedForwardToPayment(url) {
      if (page !== "confirm") {
        return false;
      }
      if (
        leaveConfirmed ||
        isCheckoutNavigationAllowed() ||
        isPaymentNavigationAllowed()
      ) {
        return false;
      }
      try {
        return /\/payment\.html$/i.test(
          new URL(url, root.location.href).pathname,
        );
      } catch (_e) {
        return false;
      }
    }

    function isConfirmToPaymentUrl(url) {
      if (page !== "confirm") {
        return false;
      }
      try {
        return /\/payment\.html$/i.test(
          new URL(url, root.location.href).pathname,
        );
      } catch (_e) {
        return false;
      }
    }

    function returnToConfirmFromPayment() {
      clearAllPaymentProcessingFlags();
      markPaymentForwardBlocked();
      clearCheckoutNavigationAllowance();
      allowCheckoutNavigation();
      try {
        root.location.replace(confirmPageUrl());
      } catch (_e2) {
        root.location.href = confirmPageUrl();
      }
    }

    function showLeaveOverlayForBack(destinationUrl) {
      history.pushState(
        { checkoutGuard: true, page: page },
        "",
        checkoutPageUrl,
      );
      pendingLeaveUrl = destinationUrl || "RESERVATION.html";
      showLeaveOverlay();
    }

    function isAllowedCheckoutDestination(url) {
      if (page !== "payment") {
        return false;
      }
      try {
        return /\/confirm\.html$/i.test(
          new URL(url, root.location.href).pathname,
        );
      } catch (_e) {
        return false;
      }
    }

    function showLeaveOverlayForNavigation(url) {
      pendingLeaveUrl = url || checkoutSealRedirectUrl();
      showLeaveOverlay();
    }

    function setupCheckoutNavigateGuard() {
      if (!guardEnabled) {
        return false;
      }
      if (
        !("navigation" in root) ||
        !root.navigation ||
        typeof root.navigation.addEventListener !== "function"
      ) {
        return false;
      }

      root.navigation.addEventListener("navigate", function (event) {
        if (leaveConfirmed) {
          return;
        }
        if (event.navigationType !== "traverse") {
          return;
        }
        if (!root.navigation.currentEntry) {
          return;
        }
        var destUrl =
          event.destination && event.destination.url
            ? event.destination.url
            : "";
        var isBack =
          event.destination.index < root.navigation.currentEntry.index;
        var isForward =
          event.destination.index > root.navigation.currentEntry.index;

        if (isForward && isBlockedForwardToPayment(destUrl)) {
          if (event.canIntercept && typeof event.intercept === "function") {
            event.intercept({
              handler: function () {
                showLeaveOverlayForNavigation(checkoutSealRedirectUrl());
              },
            });
          } else if (event.cancelable !== false) {
            event.preventDefault();
            showLeaveOverlayForNavigation(checkoutSealRedirectUrl());
          }
          return;
        }

        if (!isBack) {
          return;
        }

        if (isCheckoutPath(destUrl)) {
          if (isAllowedCheckoutDestination(destUrl)) {
            return;
          }
          if (event.canIntercept && typeof event.intercept === "function") {
            event.intercept({
              handler: function () {
                showLeaveOverlayForNavigation(checkoutSealRedirectUrl());
              },
            });
          } else if (event.cancelable !== false) {
            event.preventDefault();
            showLeaveOverlayForNavigation(checkoutSealRedirectUrl());
          }
          return;
        }
        if (!hasActiveCheckoutSession() || isPaymentInProgress()) {
          return;
        }
        if (event.canIntercept && typeof event.intercept === "function") {
          event.intercept({
            handler: function () {
              pendingLeaveUrl = destUrl;
              showLeaveOverlay();
            },
          });
        } else if (event.cancelable !== false) {
          event.preventDefault();
          pendingLeaveUrl = destUrl || "RESERVATION.html";
          showLeaveOverlay();
        }
      });
      return true;
    }

    function setupCheckoutPopstateTrap() {
      if (!guardEnabled || (page !== "confirm" && page !== "payment")) {
        return;
      }

      history.pushState(
        { checkoutGuard: true, page: page },
        "",
        checkoutPageUrl,
      );

      root.addEventListener("popstate", function (e) {
        if (leaveConfirmed) {
          return;
        }
        if (e.state && e.state.checkoutGuard === true) {
          return;
        }
        if (isAllowedCheckoutBack()) {
          returnToConfirmFromPayment();
          return;
        }
        if (
          page === "confirm" &&
          isBlockedForwardToPayment(root.location.href)
        ) {
          showLeaveOverlayForNavigation(checkoutSealRedirectUrl());
          history.pushState(
            { checkoutGuard: true, page: page },
            "",
            checkoutPageUrl,
          );
          return;
        }
        showLeaveOverlayForBack("RESERVATION.html");
      });
    }

    rememberCheckoutReferrer();

    if (redirectIfPaymentForwardBlocked()) {
      return {
        confirmLeaveAndGo: function () {},
        shouldGuardNavigation: function () {
          return false;
        },
        allowCheckoutNavigation: allowCheckoutNavigation,
        abortedOnPaymentForwardBlock: true,
      };
    }

    if (redirectIfCheckoutBlocked(options.redirectTo)) {
      return {
        confirmLeaveAndGo: function () {},
        shouldGuardNavigation: function () {
          return false;
        },
        allowCheckoutNavigation: allowCheckoutNavigation,
        abortedOnBlockedCheckout: true,
      };
    }

    root.addEventListener("pageshow", function (e) {
      if (redirectIfPaymentForwardBlocked()) {
        return;
      }
      if (e.persisted) {
        if (redirectIfCheckoutBlocked(options.redirectTo)) {
          return;
        }
        if (leaveConfirmed && isCheckoutNavigationAllowed()) {
          leaveConfirmed = false;
          clearCheckoutNavigationAllowance();
        }
        if (
          !isCheckoutActive() &&
          !hasPortoneRedirectReturn() &&
          !isPaymentInProgress()
        ) {
          root.location.replace(options.redirectTo || CHECKOUT_SEAL_REDIRECT);
        }
      }
    });

    if (abandonCheckoutOnReload(options.redirectTo)) {
      return {
        confirmLeaveAndGo: function () {},
        shouldGuardNavigation: function () {
          return false;
        },
        allowCheckoutNavigation: allowCheckoutNavigation,
        abortedOnReload: true,
      };
    }

    markCheckoutActive();
    if (hasPortoneRedirectReturn() || isPaymentInProgress()) {
      allowCheckoutNavigation();
    } else {
      clearCheckoutNavigationAllowance();
    }

    if (
      page === "confirm" &&
      sessionStorage.getItem("graffordInPaymentFlow") === "1"
    ) {
      markPaymentForwardBlocked();
    }

    var timerStop = null;
    function startTtlTimer() {
      if (timerStop || !root.GraffordBookingToken || !ttlElementIds.length) {
        return;
      }
      timerStop = root.GraffordBookingToken.mountTtlTimer(ttlElementIds, {
        onExpired: onExpired,
        pendingLabel: options.pendingLabel || "--:--",
      });
    }

    startTtlTimer();

    var sessionReady = options.sessionReady;
    if (sessionReady && typeof sessionReady.then === "function") {
      sessionReady
        .then(function () {
          markCheckoutActive();
        })
        .catch(function (err) {
          console.warn("[checkout-guard] session init failed:", err);
        });
    }

    function confirmLeaveAndGo(url) {
      leaveConfirmed = true;
      hideLeaveOverlay();
      activateCheckoutBackSeal();
      clearPaymentForwardBlock();
      var target = url || CHECKOUT_SEAL_REDIRECT;
      if (root.GraffordBookingToken) {
        root.GraffordBookingToken.abandonCheckoutSession(target);
      } else {
        try {
          sessionStorage.setItem(CHECKOUT_BLOCKED_KEY, "1");
        } catch (_e) {}
        root.location.replace(target);
      }
    }

    leaveConfirmButtons.forEach(function (btn) {
      if (!btn) {
        return;
      }
      btn.addEventListener("click", function () {
        confirmLeaveAndGo(pendingLeaveUrl || "RESERVATION.html");
      });
    });

    leaveCancelButtons.forEach(function (btn) {
      if (!btn) {
        return;
      }
      btn.addEventListener("click", function () {
        pendingLeaveUrl = "";
        hideLeaveOverlay();
      });
    });

    function shouldGuardNavigation(url) {
      if (!guardEnabled || leaveConfirmed) {
        return false;
      }
      if (isPaymentInProgress()) {
        return false;
      }
      if (!hasActiveCheckoutSession()) {
        return false;
      }
      if (
        isConfirmToPaymentUrl(url) &&
        (isCheckoutNavigationAllowed() || isPaymentNavigationAllowed())
      ) {
        return false;
      }
      if (isCheckoutPath(url)) {
        if (isAllowedCheckoutDestination(url)) {
          return false;
        }
        if (isBlockedForwardToPayment(url)) {
          return true;
        }
        return true;
      }
      return true;
    }

    function interceptNavigation(event, url) {
      if (!shouldGuardNavigation(url)) {
        return false;
      }
      event.preventDefault();
      event.stopPropagation();
      pendingLeaveUrl = url;
      showLeaveOverlay();
      return true;
    }

    function abandonCheckoutOnPageExit() {
      if (
        root.GraffordBookingToken &&
        typeof root.GraffordBookingToken.abandonCheckoutSessionKeepalive ===
          "function"
      ) {
        root.GraffordBookingToken.abandonCheckoutSessionKeepalive();
      } else if (
        root.GraffordBookingToken &&
        typeof root.GraffordBookingToken.releaseBookingHoldKeepalive ===
          "function"
      ) {
        root.GraffordBookingToken.releaseBookingHoldKeepalive();
      }
      try {
        sessionStorage.removeItem(CHECKOUT_ACTIVE_KEY);
      } catch (_e) {}
    }

    root.document.addEventListener(
      "click",
      function (e) {
        var link = e.target && e.target.closest ? e.target.closest("a[href]") : null;
        if (!link) {
          return;
        }
        var href = link.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
          return;
        }
        interceptNavigation(e, link.href);
      },
      true,
    );

    setupCheckoutNavigateGuard();
    setupCheckoutPopstateTrap();

    if (guardEnabled) {
      beforeUnloadHandler = function (e) {
        if (
          !hasActiveCheckoutSession() ||
          leaveConfirmed ||
          isCheckoutNavigationAllowed() ||
          isPaymentNavigationAllowed() ||
          isPaymentInProgress()
        ) {
          return;
        }
        e.preventDefault();
        e.returnValue = "";
      };
      root.addEventListener("beforeunload", beforeUnloadHandler);

    root.addEventListener("pagehide", function () {
      if (leaveConfirmed) {
        return;
      }
      if (!hasActiveCheckoutSession()) {
        return;
      }
      if (shouldSkipHoldReleaseOnPageExit(page)) {
        return;
      }
      abandonCheckoutOnPageExit();
    });
    }

    try {
      root.__graffordCheckoutGuardReady = true;
    } catch (_readyErr) {}

    return {
      confirmLeaveAndGo: confirmLeaveAndGo,
      shouldGuardNavigation: shouldGuardNavigation,
      allowCheckoutNavigation: allowCheckoutNavigation,
      allowNavigateToPayment: allowNavigateToPayment,
      disallowCheckoutNavigation: disallowCheckoutNavigation,
    };
  }

  root.GraffordCheckoutGuard = {
    init: init,
    isCheckoutPath: isCheckoutPath,
    isPortoneGatewayUrl: isPortoneGatewayUrl,
    isCheckoutHistorySealed: isCheckoutHistorySealed,
    isCheckoutBackSealActive: isCheckoutBackSealActive,
    shouldBlockSealedHistoryDestination: shouldBlockSealedHistoryDestination,
    activateCheckoutBackSeal: activateCheckoutBackSeal,
    clearCheckoutBackSeal: clearCheckoutBackSeal,
    maybeActivateCheckoutBackSealOnPage: maybeActivateCheckoutBackSealOnPage,
    isPageReload: isPageReload,
    shouldSkipHoldReleaseOnPageExit: shouldSkipHoldReleaseOnPageExit,
    abandonCheckoutOnReload: abandonCheckoutOnReload,
    markCheckoutActive: markCheckoutActive,
    isCheckoutActive: isCheckoutActive,
    allowCheckoutNavigation: allowCheckoutNavigation,
    allowNavigateToPayment: allowNavigateToPayment,
    disallowCheckoutNavigation: disallowCheckoutNavigation,
    clearCheckoutNavigationAllowance: clearCheckoutNavigationAllowance,
    clearPaymentNavigationAllowance: clearPaymentNavigationAllowance,
    isPaymentNavigationAllowed: isPaymentNavigationAllowed,
    redirectIfPaymentForwardBlocked: redirectIfPaymentForwardBlocked,
    clearPaymentForwardBlock: clearPaymentForwardBlock,
    markPaymentForwardBlocked: markPaymentForwardBlocked,
    isPaymentInProgress: isPaymentInProgress,
    clearAllPaymentProcessingFlags: clearAllPaymentProcessingFlags,
    hasPortoneRedirectReturn: hasPortoneRedirectReturn,
  };

  installCheckoutBlockedPageshowGuard();
  installCheckoutHistorySealGuard();
  if (isCheckoutPath(root.location.href)) {
    redirectIfPaymentForwardBlocked();
  }
  if (root.document && root.document.readyState === "loading") {
    root.document.addEventListener(
      "DOMContentLoaded",
      maybeActivateCheckoutBackSealOnPage,
    );
  } else {
    maybeActivateCheckoutBackSealOnPage();
  }
})(typeof window !== "undefined" ? window : this);
