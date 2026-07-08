(function (root) {
  var CHECKOUT_ACTIVE_KEY = "graffordCheckoutActive";
  var ALLOW_NAV_KEY = "graffordCheckoutAllowNav";
  var ALLOWED_PATH_RE =
    /(?:^|\/)(?:confirm|payment)\.html(?:[?#].*)?$/i;
  var allowCheckoutNavigationFn = null;

  function isCheckoutPath(url) {
    try {
      var path = new URL(url, root.location.href).pathname;
      return ALLOWED_PATH_RE.test(path);
    } catch (_e) {
      return ALLOWED_PATH_RE.test(String(url || ""));
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

  function allowCheckoutNavigation() {
    if (allowCheckoutNavigationFn) {
      allowCheckoutNavigationFn();
    }
    try {
      sessionStorage.setItem(ALLOW_NAV_KEY, "1");
    } catch (_e) {}
  }

  function clearCheckoutNavigationAllowance() {
    try {
      sessionStorage.removeItem(ALLOW_NAV_KEY);
    } catch (_e) {}
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
      isCheckoutNavigationAllowed() ||
      !hasActiveCheckoutSession()
    ) {
      return false;
    }
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
      if (isPaymentInProgress()) {
        return;
      }
      onExpiredOption();
    }
    var ttlElementIds = options.ttlElementIds || [];
    var leaveConfirmButtons = options.leaveConfirmButtons || [];
    var leaveCancelButtons = options.leaveCancelButtons || [];
    var guardEnabled = options.guardEnabled !== false;
    var pendingLeaveUrl = "";
    var leaveConfirmed = false;
    var popstateReady = false;
    var checkoutPageUrl = root.location.href;

    allowCheckoutNavigationFn = function () {
      leaveConfirmed = true;
    };

    function rememberCheckoutReferrer() {
      try {
        var ref = root.document.referrer || "";
        if (!ref) {
          sessionStorage.removeItem("graffordCheckoutPrevPath");
          return;
        }
        var refPath = new URL(ref, root.location.href).pathname;
        if (isCheckoutPath(ref)) {
          sessionStorage.setItem("graffordCheckoutPrevPath", refPath);
        } else {
          sessionStorage.removeItem("graffordCheckoutPrevPath");
        }
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

    function isInternalCheckoutBack() {
      var prevPath = readCheckoutReferrerPath();
      if (!prevPath || !isCheckoutPath(prevPath)) {
        return false;
      }
      try {
        var currentPath = new URL(root.location.href).pathname;
        return prevPath !== currentPath;
      } catch (_e) {
        return true;
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
        if (
          !root.navigation.currentEntry ||
          event.destination.index >= root.navigation.currentEntry.index
        ) {
          return;
        }
        if (isCheckoutPath(event.destination.url)) {
          return;
        }
        if (!hasActiveCheckoutSession() || isPaymentInProgress()) {
          return;
        }
        if (typeof event.intercept !== "function") {
          return;
        }

        event.intercept({
          handler: function () {
            pendingLeaveUrl = event.destination.url;
            showLeaveOverlay();
          },
        });
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

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          popstateReady = true;
        });
      });

      root.addEventListener("popstate", function (e) {
        if (!popstateReady || leaveConfirmed) {
          return;
        }
        if (e.state && e.state.checkoutGuard === true) {
          return;
        }
        if (isInternalCheckoutBack()) {
          allowCheckoutNavigation();
          root.history.go(-1);
          return;
        }
        showLeaveOverlayForBack("RESERVATION.html");
      });
    }

    rememberCheckoutReferrer();

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
      if (e.persisted) {
        redirectIfCheckoutBlocked(options.redirectTo);
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
      var target = url || "RESERVATION.html";
      if (root.GraffordBookingToken) {
        root.GraffordBookingToken.abandonCheckoutSession(target);
      } else {
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
      if (!isCheckoutActive()) {
        return false;
      }
      return !isCheckoutPath(url);
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

    if (!setupCheckoutNavigateGuard()) {
      setupCheckoutPopstateTrap();
    }

    if (guardEnabled) {
      root.addEventListener("beforeunload", function (e) {
        if (
          !hasActiveCheckoutSession() ||
          leaveConfirmed ||
          isCheckoutNavigationAllowed() ||
          isPaymentInProgress()
        ) {
          return;
        }
        e.preventDefault();
        e.returnValue = "";
      });

      root.addEventListener("pagehide", function () {
        if (
          !hasActiveCheckoutSession() ||
          leaveConfirmed ||
          isCheckoutNavigationAllowed() ||
          isPaymentInProgress()
        ) {
          return;
        }
        abandonCheckoutOnPageExit();
      });
    }

    return {
      confirmLeaveAndGo: confirmLeaveAndGo,
      shouldGuardNavigation: shouldGuardNavigation,
      allowCheckoutNavigation: allowCheckoutNavigation,
    };
  }

  root.GraffordCheckoutGuard = {
    init: init,
    isCheckoutPath: isCheckoutPath,
    isPageReload: isPageReload,
    abandonCheckoutOnReload: abandonCheckoutOnReload,
    markCheckoutActive: markCheckoutActive,
    isCheckoutActive: isCheckoutActive,
    allowCheckoutNavigation: allowCheckoutNavigation,
    clearCheckoutNavigationAllowance: clearCheckoutNavigationAllowance,
    isPaymentInProgress: isPaymentInProgress,
    hasPortoneRedirectReturn: hasPortoneRedirectReturn,
  };
})(typeof window !== "undefined" ? window : this);
