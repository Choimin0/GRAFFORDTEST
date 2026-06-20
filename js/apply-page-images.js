/**
 * GRAFFORD_PAGE_IMAGES 설정을 HTML 요소에 적용합니다.
 * img[data-g-img="nav.logo"] 형태의 dot-path 키를 해석해 src/href를 설정합니다.
 *
 * defer 로드 시점(HTML 파싱 직후)에 히어로 preload·src를 먼저 적용해 LCP를 앞당깁니다.
 */
(function () {
  "use strict";

  var CRITICAL_PATH_PREFIXES = ["hero.", "nav.logo", "gallery.defaultMain"];

  function isCriticalPath(path) {
    if (!path) {
      return false;
    }
    if (path === "nav.logo") {
      return true;
    }
    for (var i = 0; i < CRITICAL_PATH_PREFIXES.length; i++) {
      var prefix = CRITICAL_PATH_PREFIXES[i];
      if (prefix.endsWith(".") && path.indexOf(prefix) === 0) {
        return true;
      }
      if (path === prefix) {
        return true;
      }
    }
    return false;
  }

  function collectPreloadPaths(imgs) {
    var paths = [];
    if (!imgs) {
      return paths;
    }
    if (imgs.nav && imgs.nav.logo) {
      paths.push("nav.logo");
    }
    if (imgs.hero) {
      if (typeof imgs.hero.kr === "string") {
        paths.push("hero.kr");
      } else if (Array.isArray(imgs.hero.kr)) {
        imgs.hero.kr.forEach(function (_, index) {
          paths.push("hero.kr." + index);
        });
      }
      if (typeof imgs.hero.en === "string") {
        paths.push("hero.en");
      } else if (Array.isArray(imgs.hero.en)) {
        imgs.hero.en.forEach(function (_, index) {
          paths.push("hero.en." + index);
        });
      }
    }
    if (imgs.gallery) {
      if (imgs.gallery.defaultMainKr) {
        paths.push("gallery.defaultMainKr");
      }
      if (imgs.gallery.defaultMainEn) {
        paths.push("gallery.defaultMainEn");
      }
    }
    if (imgs.features && imgs.features.cafeMainKr) {
      paths.push("features.cafeMainKr");
    }
    return paths;
  }

  function injectPreloads(pageName) {
    var imgs = window.getGraffordPageImages(pageName);
    var seen = {};
    collectPreloadPaths(imgs).forEach(function (path) {
      var src = window.getGraffordImage(path, pageName);
      if (!src || seen[src]) {
        return;
      }
      seen[src] = true;
      var link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = src;
      if (path.indexOf("hero.") === 0) {
        link.setAttribute("fetchpriority", "high");
      }
      document.head.appendChild(link);
    });
  }

  function applyHeadMeta(pageName) {
    var imgs = window.getGraffordPageImages(pageName);
    if (!imgs) {
      return;
    }
    if (imgs.favicon) {
      var icon = document.querySelector('link[rel="icon"]');
      if (icon) {
        icon.href = imgs.favicon;
      }
    }
    if (imgs.ogImage) {
      var og = document.querySelector('meta[property="og:image"]');
      if (og) {
        og.content = imgs.ogImage;
      }
    }
  }

  function configureImg(el, path) {
    var critical = isCriticalPath(path);
    if (critical) {
      el.setAttribute("fetchpriority", "high");
      el.setAttribute("decoding", "async");
      el.removeAttribute("loading");
    } else if (!el.hasAttribute("loading")) {
      el.setAttribute("loading", "lazy");
      el.setAttribute("decoding", "async");
    }
  }

  function applyDataGImg(pageName, onlyCritical) {
    document.querySelectorAll("[data-g-img]").forEach(function (el) {
      var path = el.getAttribute("data-g-img");
      if (onlyCritical && !isCriticalPath(path)) {
        return;
      }
      var src = window.getGraffordImage(path, pageName);
      if (!src) {
        return;
      }
      if (el.tagName === "IMG") {
        configureImg(el, path);
        el.src = src;
      } else if (el.tagName === "LINK") {
        el.href = src;
      }
    });
  }

  function applyPageImages() {
    var pageName = window.getGraffordPageName();
    applyHeadMeta(pageName);
    applyDataGImg(pageName, false);
  }

  var pageName = window.getGraffordPageName();
  injectPreloads(pageName);
  applyHeadMeta(pageName);

  if (document.body) {
    applyDataGImg(pageName, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyPageImages);
  } else {
    applyPageImages();
  }
})();
