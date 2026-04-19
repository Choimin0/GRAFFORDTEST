(function () {
  function getScrollY() {
    return (
      window.scrollY ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0
    );
  }

  /** STORY / ROOMS / FACILITIES / RESERVATION: 히어로 페이드와 내비를 같이 */
  function isHeroSyncPage() {
    return document.body.classList.contains("page-hero-nav-sync");
  }

  function updateNavVisibility() {
    if (isHeroSyncPage()) {
      return;
    }
    var hero = document.getElementById("hero");
    var nav = document.querySelector(".top-right-nav");
    if (!hero || !nav) {
      return;
    }
    var y = getScrollY();
    var heroH = hero.offsetHeight;
    var threshold = Math.max(heroH - 48, 0);
    var hide = y < threshold;
    nav.classList.toggle("nav-hero-hidden", hide);
  }

  /** 히어로 배경 첫 페이드인; 히어로 동기 페이지에서는 내비도 같은 타이밍으로 표시 */
  function enableHeroIntroFade() {
    var hero = document.getElementById("hero");
    var nav = document.querySelector(".top-right-nav");
    var sync = isHeroSyncPage();
    var hasSlides = hero && hero.querySelector(".hero-slide");

    function reveal() {
      if (hasSlides && hero) {
        hero.classList.add("hero-intro-visible");
      }
      if (sync && nav) {
        nav.classList.remove("nav-hero-sync-hidden");
      }
    }

    if (!sync) {
      if (!hero || !hasSlides) {
        return;
      }
      requestAnimationFrame(function () {
        requestAnimationFrame(reveal);
      });
      return;
    }

    if (!nav) {
      return;
    }
    if (!hasSlides && !hero) {
      requestAnimationFrame(function () {
        requestAnimationFrame(reveal);
      });
      return;
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(reveal);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    enableHeroIntroFade();
    updateNavVisibility();
  });
  window.addEventListener("scroll", updateNavVisibility, { passive: true });
  document.addEventListener("scroll", updateNavVisibility, {
    passive: true,
    capture: true,
  });
  window.addEventListener("resize", updateNavVisibility, { passive: true });
})();
