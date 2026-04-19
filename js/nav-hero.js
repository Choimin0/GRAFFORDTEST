(function () {
  function getScrollY() {
    var se = document.scrollingElement;
    return Math.max(
      window.scrollY || 0,
      (se && se.scrollTop) || 0,
      document.documentElement.scrollTop || 0,
      document.body.scrollTop || 0
    );
  }

  /**
   * STORY / ROOMS / FACILITIES / RESERVATION: 히어로 페이드와 내비를 같이.
   * body 클래스만으로 판별하면 배포 HTML이 구버전일 때 깨지므로
   * 마크업에 있는 .nav-hero-sync-hidden 으로도 판별합니다.
   */
  function isHeroSyncPage() {
    if (document.body.classList.contains("page-hero-nav-sync")) {
      return true;
    }
    return !!document.querySelector(".top-right-nav.nav-hero-sync-hidden");
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
    /* 구 배포 HTML에 body 클래스만 빠진 경우: 내비 마크업으로 보정해 스크롤 시 다시 숨겨지지 않게 함 */
    if (
      document.querySelector(".top-right-nav.nav-hero-sync-hidden") &&
      !document.body.classList.contains("page-hero-nav-sync")
    ) {
      document.body.classList.add("page-hero-nav-sync");
    }
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
