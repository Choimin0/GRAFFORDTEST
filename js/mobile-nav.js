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
    reserveInfoLink.textContent = "> 예약 조회";
    reservationLink.insertAdjacentElement("afterend", reserveInfoLink);
  }

  function setOpen(isOpen) {
    menuBtn.setAttribute("aria-expanded", String(isOpen));
    drawer.setAttribute("aria-hidden", String(!isOpen));
    drawer.classList.toggle("is-open", isOpen);
    backdrop.hidden = !isOpen;
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
    if (target && target.closest("a")) {
      setOpen(false);
    }
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
