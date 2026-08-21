/**
 * reserve-complete / delete-complete 페이지에서 알림톡 발송을 요청합니다.
 * 예약 취소 알림톡은 서버 DB 발송 횟수(cancel_alarm_sent_count)가 1회 이상이면 재발송하지 않습니다.
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

  function storedContactDialCode(contact) {
    var s = String(contact || "").trim();
    if (s.indexOf("+") !== 0) {
      return null;
    }
    var m = s.slice(1).trim().match(/^(\d{1,4})/);
    return m ? m[1] : null;
  }

  function isInternationalStoredContact(contact) {
    var s = String(contact || "").trim();
    return s.indexOf("+") === 0 && !isKoreaStoredContact(s);
  }

  function isKoreaStoredContact(contact) {
    var s = String(contact || "").trim();
    return /^\+82(?:[\s-]|[1-9]|$)/.test(s);
  }

  function resolveEffectiveBookingLocale(bookingLocale, contact) {
    if (isKoreaStoredContact(contact)) {
      return "kr";
    }
    if (isInternationalStoredContact(contact)) {
      return "en";
    }
    return String(bookingLocale || "").toLowerCase() === "en" ? "en" : "kr";
  }

  function shouldSkipAlimtalk(type, payload) {
    if (!payload) {
      return false;
    }
    if (payload.skipAlimtalk === true) {
      return true;
    }
    var isEn =
      resolveEffectiveBookingLocale(payload.bookingLocale, payload.contact) ===
      "en";
    if (!isEn) {
      return false;
    }
    // 영문 예약 확정은 서버에서 관리자 알림톡만 발송하므로 API는 호출한다.
    return type !== "reserve-complete";
  }

  function requestAlimtalk(type, payload) {
    var orderNo = normalizeOrderNo(payload && payload.orderNo);
    if (!orderNo) {
      return Promise.resolve({ ok: false, skipped: true });
    }
    if (shouldSkipAlimtalk(type, payload)) {
      return Promise.resolve({ ok: true, skipped: true, reason: "english_booking" });
    }
    if (
      type === "cancel-complete" &&
      (Number(payload && payload.cancelAlarmSentCount) || 0) >= 1
    ) {
      return Promise.resolve({
        ok: true,
        skipped: true,
        reason: "already_sent",
      });
    }
    var key = storageKey(type, orderNo);
    try {
      if (global.sessionStorage.getItem(key) === "1") {
        return Promise.resolve({ ok: true, skipped: true, duplicate: true });
      }
    } catch (_e) {}

    var apiUrl = resolveApiUrl();
    var requestBody = {
      type: type,
      orderNo: orderNo,
      guestName: payload.guestName || payload.name || "",
      contact: payload.contact || "",
      room: payload.room || "",
      checkIn: payload.checkIn || "",
      checkOut: payload.checkOut || "",
    };

    return fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
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
        return { ok: false, error: err };
      });
  }

  global.GraffordAlimtalkNotify = {
    resolveEffectiveBookingLocale: resolveEffectiveBookingLocale,
    sendReserveComplete: function (payload) {
      return requestAlimtalk("reserve-complete", payload || {});
    },
    sendCancelComplete: function (payload) {
      return requestAlimtalk("cancel-complete", payload || {});
    },
  };
})(window);
