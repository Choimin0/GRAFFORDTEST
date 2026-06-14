/**
 * GRAFFORD_PAGE_IMAGES 설정을 HTML 요소에 적용합니다.
 * img[data-g-img="nav.logo"] 형태의 dot-path 키를 해석해 src/href를 설정합니다.
 */
(function () {
  "use strict";

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

  function applyDataGImg(pageName) {
    document.querySelectorAll("[data-g-img]").forEach(function (el) {
      var path = el.getAttribute("data-g-img");
      var src = window.getGraffordImage(path, pageName);
      if (!src) {
        return;
      }
      if (el.tagName === "IMG") {
        el.src = src;
      } else if (el.tagName === "LINK") {
        el.href = src;
      }
    });
  }

  function applyPageImages() {
    var pageName = window.getGraffordPageName();
    applyHeadMeta(pageName);
    applyDataGImg(pageName);
  }

  applyHeadMeta(window.getGraffordPageName());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyPageImages);
  } else {
    applyPageImages();
  }
})();
