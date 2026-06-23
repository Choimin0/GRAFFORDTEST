(function () {
  document.addEventListener("DOMContentLoaded", function () {
    var adminPage = document.querySelector(".admin-page");
    var categoryNav = document.getElementById("admin-category-nav");
    var openBtn = document.getElementById("admin-sidebar-open-btn");
    var collapseLabel = document.querySelector("[data-admin-sidebar-collapse]");
    var mq = window.matchMedia("(max-width: 980px)");

    if (!adminPage || !categoryNav || !openBtn) {
      return;
    }

    function isMobile() {
      return mq.matches;
    }

    function syncOpenBtn() {
      var collapsed = adminPage.classList.contains("is-sidebar-collapsed");
      openBtn.hidden = !isMobile() || categoryNav.hidden || !collapsed;
    }

    function setCollapsed(collapsed) {
      adminPage.classList.toggle("is-sidebar-collapsed", collapsed && isMobile());
      syncOpenBtn();
    }

    if (collapseLabel) {
      collapseLabel.addEventListener("click", function () {
        if (!isMobile() || categoryNav.hidden) {
          return;
        }
        setCollapsed(true);
      });
    }

    openBtn.addEventListener("click", function () {
      setCollapsed(false);
    });

    mq.addEventListener("change", function () {
      if (!isMobile()) {
        adminPage.classList.remove("is-sidebar-collapsed");
      }
      syncOpenBtn();
    });

    var observer = new MutationObserver(syncOpenBtn);
    observer.observe(categoryNav, {
      attributes: true,
      attributeFilter: ["hidden"],
    });

    syncOpenBtn();
  });
})();
