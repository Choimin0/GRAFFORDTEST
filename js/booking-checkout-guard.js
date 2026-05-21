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
    var onExpired =
      typeof options.onExpired === "function"
        ? options.onExpired
        : function () {
            if (root.GraffordBookingToken) {
              root.GraffordBookingToken.showExpiredModal();
            }
          };
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

    markCheckoutActive();
    clearCheckoutNavigationAllowance();

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

      root.addEventListener("beforeunload", function (e) {
        if (
          !isCheckoutActive() ||
          leaveConfirmed ||
          isCheckoutNavigationAllowed()
        ) {
          return;
        }
        e.preventDefault();
        e.returnValue = "";
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
    markCheckoutActive: markCheckoutActive,
    isCheckoutActive: isCheckoutActive,
    allowCheckoutNavigation: allowCheckoutNavigation,
    clearCheckoutNavigationAllowance: clearCheckoutNavigationAllowance,
  };
})(typeof window !== "undefined" ? window : this);
