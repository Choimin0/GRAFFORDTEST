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

  drawer.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      setOpen(false);
    });
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
