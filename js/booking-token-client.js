(function (root) {
  var UNAVAILABLE_MSG =
    "해당 날짜에 예약이 불가합니다. 예약을 다시 확인해주세요";
  var EXPIRED_MSG = "유효 시간이 만료되었습니다";
  var PAYMENT_EXPIRED_MSG = "결제 가능 시간이 만료되었습니다";
  var SESSION_EXP_KEY = "graffordBookingSessionExp";
  var HOLD_ID_KEY = "graffordBookingHoldId";
  var CHECKOUT_BLOCKED_KEY = "graffordCheckoutBlocked";
  var VALIDATE_CACHE_KEY = "graffordLastBookingValidateAt";
  var VALIDATE_FETCH_TIMEOUT_MS = 15000;
  var validateInflightByKey = Object.create(null);

  function apiBase() {
    if (typeof root !== "undefined" && root.__GRAFFORD_API_BASE__) {
      return String(root.__GRAFFORD_API_BASE__).replace(/\/$/, "");
    }
    return "";
  }

  function bookingTokenApiUrl() {
    return apiBase() + "/api/booking-token";
  }

  function markBookingValidated() {
    try {
      sessionStorage.setItem(VALIDATE_CACHE_KEY, String(Date.now()));
    } catch (_e) {}
  }

  function isBookingRecentlyValidated(maxAgeMs) {
    try {
      var at = Number(sessionStorage.getItem(VALIDATE_CACHE_KEY) || "0");
      var limit = maxAgeMs != null ? maxAgeMs : 180000;
      return at > 0 && Date.now() - at < limit;
    } catch (_e) {
      return false;
    }
  }

  function validateRequestKey(payload) {
    return [
      String(payload.bookingToken || readStoredToken() || "").trim(),
      String(payload.room || "")
        .trim()
        .toUpperCase(),
      String(payload.checkIn || "").trim(),
      String(payload.checkOut || "").trim(),
      String(payload.reservationNumber || payload.orderNo || "").trim(),
    ].join("|");
  }

  async function fetchJsonWithTimeout(url, options, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs || VALIDATE_FETCH_TIMEOUT_MS);
    try {
      var res = await fetch(
        url,
        Object.assign({}, options || {}, { signal: controller.signal }),
      );
      var data = await res.json();
      return { res: res, data: data };
    } catch (e) {
      if (e && e.name === "AbortError") {
        throw new Error(
          "요청 시간이 초과되었습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  function readStoredToken() {
    try {
      return String(sessionStorage.getItem("graffordBookingToken") || "").trim();
    } catch (_e) {
      return "";
    }
  }

  function writeStoredToken(token) {
    try {
      if (token) {
        sessionStorage.setItem("graffordBookingToken", token);
      } else {
        sessionStorage.removeItem("graffordBookingToken");
      }
    } catch (_e) {}
  }

  function readStoredHoldId() {
    try {
      return String(sessionStorage.getItem(HOLD_ID_KEY) || "").trim();
    } catch (_e) {
      return "";
    }
  }

  function writeStoredHoldId(holdId) {
    try {
      if (holdId) {
        sessionStorage.setItem(HOLD_ID_KEY, String(holdId));
      } else {
        sessionStorage.removeItem(HOLD_ID_KEY);
      }
    } catch (_e) {}
  }

  function readDraftTokenMeta() {
    try {
      return JSON.parse(
        sessionStorage.getItem("graffordBookingTokenMeta") || "null",
      );
    } catch (_e) {
      return null;
    }
  }

  function writeDraftTokenMeta(meta) {
    try {
      if (meta) {
        sessionStorage.setItem("graffordBookingTokenMeta", JSON.stringify(meta));
      } else {
        sessionStorage.removeItem("graffordBookingTokenMeta");
      }
    } catch (_e) {}
  }

  function writeSessionExp(expiresAt) {
    try {
      if (expiresAt) {
        sessionStorage.setItem(SESSION_EXP_KEY, String(expiresAt));
      } else {
        sessionStorage.removeItem(SESSION_EXP_KEY);
      }
    } catch (_e) {}
  }

  function readSessionExp() {
    try {
      var raw = sessionStorage.getItem(SESSION_EXP_KEY);
      var n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch (_e) {
      return 0;
    }
  }

  function b64urlDecode(str) {
    var s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    var padLen = (4 - (s.length % 4)) % 4;
    s += "====".slice(0, padLen);
    return atob(s);
  }

  function decodeTokenPayload(token) {
    var parts = String(token || "").split(".");
    if (parts.length !== 2) {
      return null;
    }
    try {
      return JSON.parse(b64urlDecode(parts[0]));
    } catch (_e) {
      return null;
    }
  }

  function getTokenExpiresAt(token) {
    var payload = decodeTokenPayload(token);
    var exp = payload && payload.exp ? Number(payload.exp) : 0;
    return Number.isFinite(exp) && exp > 0 ? exp : 0;
  }

  function getHoldIdFromToken(token) {
    var payload = decodeTokenPayload(token);
    return payload && payload.nonce ? String(payload.nonce) : "";
  }

  function tokenMatchesDraft(tokenMeta, room, checkIn, checkOut) {
    if (!tokenMeta) {
      return false;
    }
    return (
      String(tokenMeta.room || "").toUpperCase() ===
        String(room || "").toUpperCase() &&
      String(tokenMeta.checkIn || "") === String(checkIn || "") &&
      String(tokenMeta.checkOut || "") === String(checkOut || "")
    );
  }

  async function postBookingTokenAction(body) {
    var res = await fetch(bookingTokenApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    var data = await res.json();
    return { ok: res.ok && data.ok, status: res.status, data: data };
  }

  async function issueBookingToken(room, checkIn, checkOut, reservationNumber, options) {
    options = options || {};
    var result = await postBookingTokenAction({
      action: "issue",
      room: room,
      checkIn: checkIn,
      checkOut: checkOut,
      reservationNumber: reservationNumber || "",
      replaceOverlapping: !!options.replaceOverlapping,
    });
    if (!result.ok || !result.data.bookingToken) {
      throw new Error(
        (result.data && result.data.error) || "예약 토큰을 발급하지 못했습니다.",
      );
    }
    writeStoredToken(result.data.bookingToken);
    writeDraftTokenMeta({ room: room, checkIn: checkIn, checkOut: checkOut });
    writeSessionExp(
      result.data.expiresAt || getTokenExpiresAt(result.data.bookingToken),
    );
    writeStoredHoldId(
      result.data.holdId || getHoldIdFromToken(result.data.bookingToken),
    );
    return result.data.bookingToken;
  }

  async function ensureBookingToken(room, checkIn, checkOut, options) {
    options = options || {};
    var forceNew = !!options.forceNew;
    var reservationNumber = options.reservationNumber || "";
    var existing = readStoredToken();
    var meta = readDraftTokenMeta();
    if (
      !forceNew &&
      existing &&
      tokenMatchesDraft(meta, room, checkIn, checkOut) &&
      getTokenExpiresAt(existing) > Date.now()
    ) {
      writeStoredHoldId(
        readStoredHoldId() || getHoldIdFromToken(existing),
      );
      writeSessionExp(readSessionExp() || getTokenExpiresAt(existing));
      return existing;
    }
    if (forceNew) {
      await releaseBookingHold(existing || readStoredToken());
    }
    return issueBookingToken(room, checkIn, checkOut, reservationNumber, {
      replaceOverlapping: forceNew,
    });
  }

  function clearCheckoutTokenState() {
    writeStoredToken("");
    writeDraftTokenMeta(null);
    writeSessionExp(0);
    writeStoredHoldId("");
  }

  async function prepareCheckoutSession(room, checkIn, checkOut, options) {
    options = options || {};
    if (options.reset) {
      await releaseBookingHold();
      clearCheckoutTokenState();
    }
    var token = await ensureBookingToken(room, checkIn, checkOut, {
      forceNew: !!options.reset,
      reservationNumber: options.reservationNumber || "",
    });
    if (root.GraffordCheckoutGuard) {
      root.GraffordCheckoutGuard.markCheckoutActive();
    }
    return token;
  }

  async function bindBookingToken(payload) {
    var bookingToken = payload.bookingToken || readStoredToken() || "";
    if (!bookingToken) {
      throw new Error("booking token missing");
    }
    var result = await postBookingTokenAction({
      action: "bind",
      bookingToken: bookingToken,
      room: payload.room,
      checkIn: payload.checkIn,
      checkOut: payload.checkOut,
      reservationNumber: payload.reservationNumber || payload.orderNo || "",
    });
    if (!result.ok) {
      throw new Error(
        (result.data && result.data.error) || "예약 토큰 연결에 실패했습니다.",
      );
    }
    return bookingToken;
  }

  async function releaseBookingHold(token) {
    var bookingToken = token || readStoredToken();
    var holdId = readStoredHoldId() || getHoldIdFromToken(bookingToken);
    if (!bookingToken && !holdId) {
      return;
    }
    try {
      await postBookingTokenAction({
        action: "release",
        bookingToken: bookingToken || "",
        holdId: holdId || "",
      });
    } catch (_e) {}
    writeStoredHoldId("");
  }

  function releaseBookingHoldKeepalive(token) {
    var bookingToken = token || readStoredToken();
    var holdId = readStoredHoldId() || getHoldIdFromToken(bookingToken);
    if (!bookingToken && !holdId) {
      return;
    }
    try {
      root.fetch(bookingTokenApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "release",
          bookingToken: bookingToken || "",
          holdId: holdId || "",
        }),
        keepalive: true,
      });
    } catch (_e) {}
  }

  async function validateBookingToken(payload) {
    var cacheKey = validateRequestKey(payload || {});
    if (validateInflightByKey[cacheKey]) {
      return validateInflightByKey[cacheKey];
    }

    var bookingToken = payload.bookingToken || readStoredToken() || "";
    var task = (async function () {
      var outcome = await fetchJsonWithTimeout(
        bookingTokenApiUrl(),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "validate",
            bookingToken: bookingToken,
            room: payload.room,
            checkIn: payload.checkIn,
            checkOut: payload.checkOut,
            reservationNumber:
              payload.reservationNumber || payload.orderNo || "",
          }),
        },
        VALIDATE_FETCH_TIMEOUT_MS,
      );
      var res = outcome.res;
      var data = outcome.data;
      var result = {
        ok: !!(res.ok && data.ok),
        status: res.status,
        data: data,
        unavailable: !!(data && data.unavailable),
        alreadyBooked: !!(data && data.alreadyBooked),
        tokenValid: data && data.tokenValid !== false,
        expired: !!(
          data &&
          (data.expired || data.error === "booking_token_expired")
        ),
      };
      if (result.ok) {
        markBookingValidated();
      }
      return result;
    })();

    validateInflightByKey[cacheKey] = task;
    try {
      return await task;
    } finally {
      delete validateInflightByKey[cacheKey];
    }
  }

  function clearCheckoutSession() {
    clearCheckoutTokenState();
    try {
      sessionStorage.removeItem("graffordInPaymentFlow");
      sessionStorage.removeItem("graffordPaymentData");
      sessionStorage.removeItem("graffordCheckoutActive");
    } catch (_e) {}
  }

  function markCheckoutBlocked() {
    try {
      sessionStorage.setItem(CHECKOUT_BLOCKED_KEY, "1");
    } catch (_e) {}
  }

  function clearCheckoutBlocked() {
    try {
      sessionStorage.removeItem(CHECKOUT_BLOCKED_KEY);
    } catch (_e) {}
    if (root.GraffordCheckoutGuard) {
      root.GraffordCheckoutGuard.clearCheckoutBackSeal();
    }
  }

  function isCheckoutBlocked() {
    try {
      return sessionStorage.getItem(CHECKOUT_BLOCKED_KEY) === "1";
    } catch (_e) {
      return false;
    }
  }

  function redirectIfCheckoutBlocked(redirectTo) {
    if (!isCheckoutBlocked()) {
      return false;
    }
    if (root.GraffordCheckoutGuard) {
      root.GraffordCheckoutGuard.activateCheckoutBackSeal();
    }
    root.location.replace(redirectTo || "RESERVATION.html");
    return true;
  }

  async function abandonCheckoutSession(redirectTo) {
    await releaseBookingHold();
    clearCheckoutSession();
    markCheckoutBlocked();
    if (root.GraffordCheckoutGuard) {
      root.GraffordCheckoutGuard.activateCheckoutBackSeal();
    } else if (
      root.GraffordPortoneFlow &&
      root.GraffordPortoneFlow.clearLegacyPgHistoryBarrier
    ) {
      root.GraffordPortoneFlow.clearLegacyPgHistoryBarrier();
    }
    if (redirectTo) {
      root.location.replace(redirectTo);
    }
  }

  function abandonCheckoutSessionKeepalive() {
    releaseBookingHoldKeepalive();
    clearCheckoutSession();
    markCheckoutBlocked();
    if (root.GraffordCheckoutGuard) {
      root.GraffordCheckoutGuard.activateCheckoutBackSeal();
    } else if (
      root.GraffordPortoneFlow &&
      root.GraffordPortoneFlow.clearLegacyPgHistoryBarrier
    ) {
      root.GraffordPortoneFlow.clearLegacyPgHistoryBarrier();
    }
  }

  function openModal(message, onConfirm, confirmLabel) {
    var modalApi = root.GraffordPaymentModal;
    if (modalApi && typeof modalApi.open === "function") {
      modalApi.open({
        message: message,
        confirmLabel: confirmLabel || "확인",
        onConfirm: onConfirm,
      });
      return;
    }
    root.alert(message);
    if (typeof onConfirm === "function") {
      onConfirm();
    }
  }

  function showUnavailableModal(options) {
    options = options || {};
    markCheckoutBlocked();
    openModal(
      options.message || UNAVAILABLE_MSG,
      function () {
        abandonCheckoutSession(options.redirectTo || "RESERVATION.html");
      },
      options.confirmLabel || "확인",
    );
  }

  function showExpiredModal(options) {
    options = options || {};
    markCheckoutBlocked();
    var redirectTo = options.redirectTo || "RESERVATION.html";
    if (options.releaseHoldOnOpen) {
      releaseBookingHold();
    }
    var modalOptions = {
      message: options.message || EXPIRED_MSG,
      confirmLabel: options.confirmLabel || "확인",
      heading: options.heading,
      eyebrow: options.eyebrow,
      confirmHint: options.confirmHint,
      dismissible: options.dismissible,
      onConfirm: function () {
        if (options.releaseHoldOnOpen) {
          clearCheckoutSession();
          markCheckoutBlocked();
          root.location.replace(redirectTo);
          return;
        }
        abandonCheckoutSession(redirectTo);
      },
    };
    var modalApi = root.GraffordPaymentModal;
    if (modalApi && typeof modalApi.open === "function") {
      modalApi.open(modalOptions);
      return;
    }
    root.alert(modalOptions.message);
    modalOptions.onConfirm();
  }

  function showPaymentExpiredModal() {
    showExpiredModal({
      message: PAYMENT_EXPIRED_MSG,
      heading: "",
      eyebrow: "",
      confirmLabel: "확인",
      confirmHint: "",
      dismissible: false,
      redirectTo: "RESERVATION.html",
      releaseHoldOnOpen: true,
    });
  }

  function getRemainingMs() {
    var token = readStoredToken();
    if (!token) {
      return null;
    }
    var exp = readSessionExp() || getTokenExpiresAt(token);
    if (!exp) {
      return null;
    }
    return Math.max(0, exp - Date.now());
  }

  function hasIssuedCheckoutSession() {
    var token = readStoredToken();
    if (!token) {
      return false;
    }
    var exp = readSessionExp() || getTokenExpiresAt(token);
    return !!(exp && exp > Date.now());
  }

  function formatRemaining(ms) {
    var totalSec = Math.max(0, Math.ceil(ms / 1000));
    var min = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    return String(min).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }

  function mountTtlTimer(elementIds, options) {
    options = options || {};
    var ids = Array.isArray(elementIds) ? elementIds : [elementIds];
    var timerId = null;
    var expiredHandled = false;
    var pendingLabel = options.pendingLabel || "--:--";

    function render() {
      var remaining = getRemainingMs();
      var pending = remaining == null;
      var text = pending ? pendingLabel : formatRemaining(remaining);
      ids.forEach(function (id) {
        var el = root.document.getElementById(id);
        if (!el) {
          return;
        }
        el.textContent = text;
        el.classList.toggle(
          "is-warning",
          !pending && remaining > 0 && remaining <= 120000,
        );
        el.classList.toggle("is-expired", !pending && remaining <= 0);
        el.classList.toggle("is-pending", pending);
      });
      if (!pending && remaining <= 0 && !expiredHandled && readStoredToken()) {
        expiredHandled = true;
        if (typeof options.onExpired === "function") {
          options.onExpired();
        }
      }
    }

    render();
    timerId = root.setInterval(render, 1000);
    return function stop() {
      if (timerId) {
        root.clearInterval(timerId);
        timerId = null;
      }
    };
  }

  root.GraffordBookingToken = {
    UNAVAILABLE_MSG: UNAVAILABLE_MSG,
    EXPIRED_MSG: EXPIRED_MSG,
    PAYMENT_EXPIRED_MSG: PAYMENT_EXPIRED_MSG,
    bookingTokenApiUrl: bookingTokenApiUrl,
    readStoredToken: readStoredToken,
    writeStoredToken: writeStoredToken,
    getTokenExpiresAt: getTokenExpiresAt,
    getRemainingMs: getRemainingMs,
    hasIssuedCheckoutSession: hasIssuedCheckoutSession,
    formatRemaining: formatRemaining,
    mountTtlTimer: mountTtlTimer,
    clearStoredToken: clearCheckoutTokenState,
    clearCheckoutSession: clearCheckoutSession,
    markCheckoutBlocked: markCheckoutBlocked,
    clearCheckoutBlocked: clearCheckoutBlocked,
    isCheckoutBlocked: isCheckoutBlocked,
    redirectIfCheckoutBlocked: redirectIfCheckoutBlocked,
    abandonCheckoutSession: abandonCheckoutSession,
    abandonCheckoutSessionKeepalive: abandonCheckoutSessionKeepalive,
    prepareCheckoutSession: prepareCheckoutSession,
    ensureBookingToken: ensureBookingToken,
    bindBookingToken: bindBookingToken,
    releaseBookingHold: releaseBookingHold,
    releaseBookingHoldKeepalive: releaseBookingHoldKeepalive,
    validateBookingToken: validateBookingToken,
    markBookingValidated: markBookingValidated,
    isBookingRecentlyValidated: isBookingRecentlyValidated,
    showUnavailableModal: showUnavailableModal,
    showExpiredModal: showExpiredModal,
    showPaymentExpiredModal: showPaymentExpiredModal,
  };
})(typeof window !== "undefined" ? window : this);
