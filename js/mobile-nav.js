document.addEventListener("DOMContentLoaded", function () {
  var nav = document.querySelector(".site-nav.top-right-nav");
  if (!nav) {
    return;
  }

  var menuBtn = nav.querySelector(".mobile-menu-btn");
  var drawer = nav.querySelector(".mobile-nav-drawer");
  var backdrop = nav.querySelector(".mobile-nav-backdrop");
  if (!menuBtn || !drawer || !backdrop) {
    return;
  }

  var reservationLink = drawer.querySelector('a[href="RESERVATION.html"]');
  if (reservationLink && !drawer.querySelector(".mobile-nav-sub-link")) {
    var reserveInfoLink = document.createElement("a");
    reserveInfoLink.href = "reserveinfo.html";
    reserveInfoLink.className = "mobile-nav-sub-link";
    reserveInfoLink.textContent = "예약 조회";
    reservationLink.insertAdjacentElement("afterend", reserveInfoLink);
  }

  function ensureDrawerLayout() {
    function enhanceNavLink(link, index) {
      if (link.querySelector(".mobile-nav-label")) {
        return;
      }
      var labelText = link.textContent.trim();
      link.textContent = "";

      var indexEl = document.createElement("span");
      indexEl.className = "mobile-nav-index";
      indexEl.textContent = String(index).padStart(2, "0");

      var labelEl = document.createElement("span");
      labelEl.className = "mobile-nav-label";
      labelEl.textContent = labelText;

      var arrowEl = document.createElement("span");
      arrowEl.className = "mobile-nav-arrow";
      arrowEl.setAttribute("aria-hidden", "true");
      arrowEl.textContent = "→";

      link.appendChild(indexEl);
      link.appendChild(labelEl);
      link.appendChild(arrowEl);
    }

    if (!drawer.querySelector(".mobile-nav-drawer__header")) {
      var header = document.createElement("div");
      header.className = "mobile-nav-drawer__header";
      header.innerHTML =
        '<a href="index.html" class="mobile-nav-drawer__logo" aria-label="홈으로 이동">' +
        '<img src="images/LOGO.png" alt="GRAFFORD LOGO" />' +
        "</a>" +
        '<button type="button" class="mobile-nav-close-btn" aria-label="메뉴 닫기"></button>';
      drawer.insertBefore(header, drawer.firstChild);
    }

    if (!drawer.querySelector(".mobile-nav-links")) {
      var links = document.createElement("div");
      links.className = "mobile-nav-links";
      var linkIndex = 1;
      Array.prototype.slice.call(drawer.children).forEach(function (child) {
        if (
          child.tagName === "A" &&
          !child.classList.contains("mobile-nav-sub-link")
        ) {
          enhanceNavLink(child, linkIndex);
          linkIndex += 1;
          links.appendChild(child);
        }
      });
      drawer.appendChild(links);
    }

    if (!drawer.querySelector(".mobile-nav-secondary")) {
      var secondary = document.createElement("div");
      secondary.className = "mobile-nav-secondary";
      var subLink = drawer.querySelector(".mobile-nav-sub-link");
      if (subLink) {
        secondary.appendChild(subLink);
      }
      drawer.appendChild(secondary);
    }

    if (!drawer.querySelector(".mobile-nav-drawer__footer")) {
      var footer = document.createElement("div");
      footer.className = "mobile-nav-drawer__footer";
      footer.innerHTML =
        '<div class="mobile-nav-footer-links" aria-label="외부 링크">' +
        '<a href="https://map.naver.com/p/search/%ED%86%A0%EC%82%B0%EC%A4%91%EC%95%99%EB%A1%9C22" class="mobile-nav-footer-link" data-mobile-map-link target="_blank" rel="noopener noreferrer">오시는 길</a>' +
        '<a href="https://www.instagram.com/grafford_tosan/" class="mobile-nav-footer-link" target="_blank" rel="noopener noreferrer">INSTAGRAM</a>' +
        "</div>";
      drawer.appendChild(footer);
    }
  }

  function updateMapLink(lang) {
    var mapLink = drawer.querySelector("[data-mobile-map-link]");
    if (!mapLink) {
      return;
    }
    if (lang === "en") {
      mapLink.href =
        "https://www.google.com/maps/search/?api=1&query=%ED%86%A0%EC%82%B0%EC%A4%91%EC%95%99%EB%A1%9C22";
      return;
    }
    mapLink.href =
      "https://map.naver.com/p/search/%ED%86%A0%EC%82%B0%EC%A4%91%EC%95%99%EB%A1%9C22";
  }

  ensureDrawerLayout();
  updateMapLink(
    window.GraffordLanguage && window.GraffordLanguage.getCurrentLanguage
      ? window.GraffordLanguage.getCurrentLanguage()
      : "kr",
  );

  var backdropTimer = null;

  function setOpen(isOpen) {
    if (backdropTimer) {
      window.clearTimeout(backdropTimer);
      backdropTimer = null;
    }
    if (isOpen) {
      backdrop.hidden = false;
      // Let the color bands render once before the open transition starts.
      backdrop.offsetWidth;
    }
    menuBtn.setAttribute("aria-expanded", String(isOpen));
    drawer.setAttribute("aria-hidden", String(!isOpen));
    drawer.classList.toggle("is-open", isOpen);
    backdrop.classList.toggle("is-open", isOpen);
    if (!isOpen) {
      backdropTimer = window.setTimeout(function () {
        backdrop.hidden = true;
        backdropTimer = null;
      }, 460);
    }
    document.body.classList.toggle("mobile-nav-open", isOpen);
  }

  menuBtn.addEventListener("click", function () {
    var isOpen = menuBtn.getAttribute("aria-expanded") === "true";
    setOpen(!isOpen);
  });

  backdrop.addEventListener("click", function () {
    setOpen(false);
  });

  drawer.addEventListener("click", function (event) {
    var target = event.target;
    if (target && target.closest(".mobile-nav-close-btn")) {
      setOpen(false);
      return;
    }
    if (target && target.closest("a")) {
      setOpen(false);
    }
  });

  document.addEventListener("grafford:languagechange", function (event) {
    updateMapLink(event.detail && event.detail.language);
  });

  document.addEventListener("click", function (event) {
    if (menuBtn.getAttribute("aria-expanded") !== "true") {
      return;
    }
    var target = event.target;
    if (drawer.contains(target) || menuBtn.contains(target)) {
      return;
    }
    setOpen(false);
  });

  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      setOpen(false);
    }
  });
});
