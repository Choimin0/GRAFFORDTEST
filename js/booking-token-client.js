(function (root) {
  var UNAVAILABLE_MSG =
    "해당 날짜에 예약이 불가합니다. 예약을 다시 확인해주세요";
  var EXPIRED_MSG = "유효 시간이 만료되었습니다";
  var SESSION_EXP_KEY = "graffordBookingSessionExp";
  var HOLD_ID_KEY = "graffordBookingHoldId";

  function apiBase() {
    if (typeof root !== "undefined" && root.__GRAFFORD_API_BASE__) {
      return String(root.__GRAFFORD_API_BASE__).replace(/\/$/, "");
    }
    return "";
  }

  function bookingTokenApiUrl() {
    return apiBase() + "/api/booking-token";
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
    while (s.length % 4) {
      s += "=";
    }
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(s), function (c) {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(""),
    );
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

  async function prepareCheckoutSession(room, checkIn, checkOut, options) {
    options = options || {};
    if (options.reset) {
      await releaseBookingHold();
      clearCheckoutSession();
    }
    return ensureBookingToken(room, checkIn, checkOut, {
      forceNew: !!options.reset,
      reservationNumber: options.reservationNumber || "",
    });
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

  async function validateBookingToken(payload) {
    var bookingToken = payload.bookingToken || readStoredToken() || "";
    var res = await fetch(bookingTokenApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "validate",
        bookingToken: bookingToken,
        room: payload.room,
        checkIn: payload.checkIn,
        checkOut: payload.checkOut,
        reservationNumber: payload.reservationNumber || payload.orderNo || "",
      }),
    });
    var data = await res.json();
    return {
      ok: !!(res.ok && data.ok),
      status: res.status,
      data: data,
      unavailable: !!(data && data.unavailable),
      alreadyBooked: !!(data && data.alreadyBooked),
      tokenValid: data && data.tokenValid !== false,
      expired: !!(data && (data.expired || data.error === "booking_token_expired")),
    };
  }

  function clearCheckoutSession() {
    writeStoredToken("");
    writeDraftTokenMeta(null);
    writeSessionExp(0);
    writeStoredHoldId("");
    try {
      sessionStorage.removeItem("graffordInPaymentFlow");
      sessionStorage.removeItem("graffordPaymentData");
      sessionStorage.removeItem("graffordCheckoutActive");
    } catch (_e) {}
  }

  async function abandonCheckoutSession(redirectTo) {
    await releaseBookingHold();
    clearCheckoutSession();
    if (redirectTo) {
      root.location.replace(redirectTo);
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
    openModal(
      options.message || EXPIRED_MSG,
      function () {
        abandonCheckoutSession(options.redirectTo || "RESERVATION.html");
      },
      options.confirmLabel || "확인",
    );
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
    bookingTokenApiUrl: bookingTokenApiUrl,
    readStoredToken: readStoredToken,
    writeStoredToken: writeStoredToken,
    getTokenExpiresAt: getTokenExpiresAt,
    getRemainingMs: getRemainingMs,
    hasIssuedCheckoutSession: hasIssuedCheckoutSession,
    formatRemaining: formatRemaining,
    mountTtlTimer: mountTtlTimer,
    clearStoredToken: function () {
      writeStoredToken("");
      writeDraftTokenMeta(null);
      writeSessionExp(0);
      writeStoredHoldId("");
    },
    clearCheckoutSession: clearCheckoutSession,
    abandonCheckoutSession: abandonCheckoutSession,
    prepareCheckoutSession: prepareCheckoutSession,
    ensureBookingToken: ensureBookingToken,
    bindBookingToken: bindBookingToken,
    releaseBookingHold: releaseBookingHold,
    validateBookingToken: validateBookingToken,
    showUnavailableModal: showUnavailableModal,
    showExpiredModal: showExpiredModal,
  };
})(typeof window !== "undefined" ? window : this);
