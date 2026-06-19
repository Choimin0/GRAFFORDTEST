/**
 * PortOne v2 결제 완료 처리 (PC 반환값 + 모바일 redirectUrl 복귀 공통)
 */
(function (global) {
  function parsePortoneRedirectFromLocation(loc) {
    loc = loc || global.location;
    try {
      var search = new URLSearchParams(loc.search || "");
      var paymentId = String(search.get("paymentId") || "").trim();
      if (!paymentId) {
        return null;
      }
      return {
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
  }

  function hasPortoneRedirectParams(loc) {
    return !!parsePortoneRedirectFromLocation(loc);
  }

  function clearPortoneRedirectQuery(loc) {
    loc = loc || global.location;
    if (!loc.search) {
      return;
    }
    if (!/(?:^|[?&])(?:paymentId|code)=/.test(loc.search)) {
      return;
    }
    try {
      global.history.replaceState(null, "", loc.pathname + (loc.hash || ""));
    } catch (_e) {}
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
    try {
      sessionStorage.setItem("graffordInPaymentFlow", "1");
      sessionStorage.setItem(
        "graffordPaymentProcessing:" + String(orderNo || "").trim(),
        "1",
      );
    } catch (_e) {}
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
      showError(messages.cancelled || "결제가 취소되었습니다");
      return false;
    }

    var verifiedPgTid = null;
    var verifiedPayMethod = payMethod;
    var verifiedPgPayProvider = null;

    try {
      showPageLoading(messages.verifying || "결제 확인 중입니다...");
      var verifyRes = await fetch("/api/payment-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId: response.paymentId,
          expectedAmount: finalAmount,
          paymentToken: response.paymentToken || null,
          txId: response.txId || null,
          requestedPaymentMethod: payMethod,
        }),
      });
      var verifyData = await verifyRes.json();
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

    var bookingCreatedAtIso = (saveData && saveData.createdAtIso) || "";
    try {
      sessionStorage.removeItem("graffordInPaymentFlow");
      sessionStorage.setItem(paymentSettledKey, "1");
      sessionStorage.removeItem("graffordPaymentProcessing:" + orderNo);
    } catch (_ss) {}
    if (global.GraffordBookingToken) {
      global.GraffordBookingToken.clearCheckoutSession();
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
    buildPortoneRedirectUrl: buildPortoneRedirectUrl,
    isMobileLikeEnvironment: isMobileLikeEnvironment,
    enhancePortoneRequestParams: enhancePortoneRequestParams,
    isRedirectDeferredResponse: isRedirectDeferredResponse,
    isPaymentFinalizeInProgress: isPaymentFinalizeInProgress,
    preparePaymentDeparture: preparePaymentDeparture,
    finalizePortoneCheckout: finalizePortoneCheckout,
  };

  function showEarlyRedirectLoading() {
    if (!hasPortoneRedirectParams()) {
      return;
    }
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
