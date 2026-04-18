(function () {
  function getScrollY() {
    return (
      window.scrollY ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0
    );
  }

  function updateNavVisibility() {
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

  document.addEventListener("DOMContentLoaded", updateNavVisibility);
  window.addEventListener("scroll", updateNavVisibility, { passive: true });
  document.addEventListener("scroll", updateNavVisibility, {
    passive: true,
    capture: true,
  });
  window.addEventListener("resize", updateNavVisibility, { passive: true });
})();
