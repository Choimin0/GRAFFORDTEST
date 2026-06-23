(function () {
  var path = (window.location.pathname || "").replace(/\/+$/, "");
  var isIndexPage =
    !path ||
    path === "/" ||
    /(?:^|\/)index\.html$/i.test(path);
  if (!isIndexPage) {
    return;
  }

  var ADMIN_URL = "gfd-management-2026-v1.html";
  var TAP_COUNT = 5;
  var RESET_MS = 2000;

  var clickCount = 0;
  var resetTimer = null;
  var isShiftPressed = false;
  var isGPressed = false;

  function isTouchDevice() {
    return (
      window.matchMedia("(pointer: coarse)").matches ||
      "ontouchstart" in window
    );
  }

  function isAdminShortcutPressed() {
    return isShiftPressed && isGPressed;
  }

  function resetCount() {
    clickCount = 0;
    if (resetTimer) {
      window.clearTimeout(resetTimer);
      resetTimer = null;
    }
  }

  function registerTap() {
    clickCount += 1;
    if (resetTimer) {
      window.clearTimeout(resetTimer);
    }
    resetTimer = window.setTimeout(resetCount, RESET_MS);
    if (clickCount >= TAP_COUNT) {
      resetCount();
      window.location.href = ADMIN_URL;
    }
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Shift") {
      isShiftPressed = true;
      return;
    }
    if (event.code === "KeyG") {
      isGPressed = true;
    }
  });

  document.addEventListener("keyup", function (event) {
    if (event.key === "Shift") {
      isShiftPressed = false;
      return;
    }
    if (event.code === "KeyG") {
      isGPressed = false;
    }
  });

  window.addEventListener("blur", function () {
    isShiftPressed = false;
    isGPressed = false;
  });

  document.addEventListener("click", function (event) {
    if (event.target.closest(".site-business-footer__logo")) {
      if (!isAdminShortcutPressed()) {
        resetCount();
        return;
      }
      registerTap();
      return;
    }

    if (
      isTouchDevice() &&
      event.target.closest(".site-business-footer__copyright")
    ) {
      registerTap();
    }
  });
})();
