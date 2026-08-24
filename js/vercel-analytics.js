/**
 * Vercel Web Analytics (정적 HTML).
 * 대시보드에서 Analytics를 켠 뒤 배포하면 /_vercel/insights/* 로 페이지뷰가 전송됩니다.
 */
(function () {
  "use strict";

  var SENSITIVE_QUERY_KEYS = [
    "bookingToken",
    "token",
    "paymentId",
    "paymentToken",
    "merchant_uid",
    "imp_uid",
    "txId",
    "code",
    "error_code",
    "message",
    "error_msg",
    "pgCode",
    "pgMessage",
  ];

  window.va =
    window.va ||
    function () {
      (window.vaq = window.vaq || []).push(arguments);
    };

  window.va("beforeSend", function (event) {
    if (!event || !event.url) {
      return event;
    }
    try {
      if (
        typeof localStorage !== "undefined" &&
        localStorage.getItem("va-disable")
      ) {
        return null;
      }

      var url = new URL(event.url, window.location.origin);
      var path = String(url.pathname || "").toLowerCase();
      if (path.indexOf("gfd-management") !== -1) {
        return null;
      }

      for (var i = 0; i < SENSITIVE_QUERY_KEYS.length; i++) {
        url.searchParams.delete(SENSITIVE_QUERY_KEYS[i]);
      }

      var hash = String(url.hash || "").replace(/^#/, "");
      if (
        hash &&
        /paymentId=|merchant_uid=|imp_uid=|paymentToken=|bookingToken=|token=/.test(
          hash,
        )
      ) {
        url.hash = "";
      }

      return Object.assign({}, event, { url: url.toString() });
    } catch (_err) {
      return event;
    }
  });

  var script = document.createElement("script");
  script.defer = true;
  script.src = "/_vercel/insights/script.js";
  document.head.appendChild(script);
})();
