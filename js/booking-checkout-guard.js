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
      if (sessionStorage.getItem("graffordInPaymentFlow") === "1") {
        return true;
      }
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
    var inPaymentFlow = !!options.inPaymentFlow;
    var guardEnabled = options.guardEnabled !== false;
    var guardPopstate = options.guardPopstate !== false;
    var pendingLeaveUrl = "";
    var leaveConfirmed = false;
    var popstateReady = false;

    allowCheckoutNavigationFn = function () {
      leaveConfirmed = true;
    };

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

    if (guardEnabled && guardPopstate) {
      if (page === "confirm" && !inPaymentFlow) {
        history.pushState({ checkoutGuard: true, page: page }, "", root.location.href);
      } else if (page === "payment") {
        history.pushState({ checkoutGuard: true, page: page }, "", root.location.href);
      }

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
        if (page === "confirm" && inPaymentFlow) {
          return;
        }
        history.pushState({ checkoutGuard: true, page: page }, "", root.location.href);
        pendingLeaveUrl = "RESERVATION.html";
        showLeaveOverlay();
      });

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
        if (
          root.GraffordBookingToken &&
          typeof root.GraffordBookingToken.releaseBookingHoldKeepalive ===
            "function"
        ) {
          root.GraffordBookingToken.releaseBookingHoldKeepalive();
        }
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
