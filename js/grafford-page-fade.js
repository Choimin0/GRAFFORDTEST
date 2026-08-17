/**
 * 페이지 진입 시 베이지 전체 화면 오버레이를 제거합니다.
 * 히어로 이미지가 준비된 뒤 페이드를 시작해 빈 화면·깜빡임을 줄입니다.
 */
(function () {
  function getHeroImage() {
    var active =
      document.querySelector(".hero-slide.is-active") ||
      document.querySelector(".hero-media img") ||
      document.querySelector("#hero img");
    if (active && active.src) {
      return active;
    }
    var critical = document.querySelector(
      'img[data-g-img^="hero."], img[data-g-img="gallery.defaultMainKr"], img[data-g-img="gallery.defaultMainEn"]',
    );
    return critical && critical.src ? critical : null;
  }

  function waitForHeroReady(cb) {
    var hero = getHeroImage();
    if (!hero) {
      cb();
      return;
    }
    if (hero.complete && hero.naturalWidth > 0) {
      cb();
      return;
    }
    var done = false;
    function finish() {
      if (done) {
        return;
      }
      done = true;
      cb();
    }
    hero.addEventListener("load", finish, { once: true });
    hero.addEventListener("error", finish, { once: true });
    window.setTimeout(finish, 2500);
  }

  function run() {
    var el = document.getElementById("grafford-react-fade-root");
    if (!el) {
      return;
    }
    el.setAttribute("aria-hidden", "true");

    function finish() {
      el.classList.add("grafford-page-fade-done");
      function hideOverlay() {
        el.setAttribute("hidden", "");
        el.setAttribute("aria-hidden", "true");
      }
      el.addEventListener("transitionend", hideOverlay, { once: true });
      window.setTimeout(hideOverlay, 1200);
    }

    var reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      finish();
      return;
    }

    waitForHeroReady(function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(finish);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
