/**
 * reserve-complete / delete-complete 페이지에서 1회만 알림톡 발송을 요청합니다.
 * 실제 발송은 서버(/api/alimtalk-notify)에서 DB 검증 후 처리합니다.
 */
(function (global) {
  function normalizeOrderNo(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, "")
      .toUpperCase()
      .replace(/^GRF-/, "");
  }

  function storageKey(type, orderNo) {
    return "graffordAlimtalkSent:" + type + ":" + orderNo;
  }

  function resolveApiUrl() {
    var base = String(global.location.pathname || "").replace(/\/[^/]*$/, "");
    if (base.endsWith("/api")) {
      return base + "/alimtalk-notify";
    }
    return base + "/api/alimtalk-notify";
  }

  function requestAlimtalk(type, payload) {
    var orderNo = normalizeOrderNo(payload && payload.orderNo);
    if (!orderNo) {
      return Promise.resolve({ ok: false, skipped: true });
    }
    var key = storageKey(type, orderNo);
    try {
      if (global.sessionStorage.getItem(key) === "1") {
        return Promise.resolve({ ok: true, skipped: true, duplicate: true });
      }
    } catch (_e) {}

    return fetch(resolveApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: type,
        orderNo: orderNo,
        guestName: payload.guestName || payload.name || "",
        contact: payload.contact || "",
        room: payload.room || "",
        checkIn: payload.checkIn || "",
        checkOut: payload.checkOut || "",
      }),
    })
      .then(function (resp) {
        return resp
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            return { ok: resp.ok, data: data };
          });
      })
      .then(function (result) {
        if (
          result.ok &&
          result.data &&
          (result.data.ok || result.data.skipped || result.data.duplicate)
        ) {
          try {
            global.sessionStorage.setItem(key, "1");
          } catch (_e2) {}
        }
        return result;
      })
      .catch(function (err) {
        console.warn("[alimtalk-notify]", type, err);
        return { ok: false, error: err };
      });
  }

  global.GraffordAlimtalkNotify = {
    sendReserveComplete: function (payload) {
      return requestAlimtalk("reserve-complete", payload || {});
    },
    sendCancelComplete: function (payload) {
      return requestAlimtalk("cancel-complete", payload || {});
    },
  };
})(window);
