/**
 * 페이지 진입 시 베이지 전체 화면 오버레이를 1초에 걸쳐 제거합니다.
 * React/Framer 번들에 의존하지 않아 Vercel·첫 방문 index에서도 동일하게 동작합니다.
 */
(function () {
  function run() {
    var el = document.getElementById("grafford-react-fade-root");
    if (!el) {
      return;
    }
    el.setAttribute("aria-hidden", "true");

    function finish() {
      el.classList.add("grafford-page-fade-done");
    }

    var reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      finish();
      return;
    }

    requestAnimationFrame(function () {
      requestAnimationFrame(finish);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
