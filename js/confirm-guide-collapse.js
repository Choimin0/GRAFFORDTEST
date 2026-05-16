(function () {
  function debounce(fn, ms) {
    var timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  function initConfirmGuideCollapse(block) {
    var viewport = block.querySelector(".confirm-guide-collapse__viewport");
    var content = block.querySelector(".confirm-guide-collapse__content");
    var btn = block.querySelector(".confirm-guide-expand-btn");
    if (!viewport || !content || !btn) {
      return;
    }

    var fullHeight = 0;
    var collapsedHeight = 0;

    function measure() {
      block.classList.remove("is-collapsed", "is-expanded");
      viewport.style.maxHeight = "none";
      fullHeight = content.scrollHeight;
      collapsedHeight = getCollapsedHeight(content, fullHeight);
      applyState();
    }

    function getCollapsedHeight(target, fallbackHeight) {
      var rows = Array.prototype.slice.call(
        target.querySelectorAll(".payment-kv__row--confirm-guide"),
      );
      var marker = rows.find(function (row) {
        var title = row.querySelector("dd");
        return (
          title &&
          /변상 규정|Damage and Liability/i.test(title.textContent.trim())
        );
      });

      if (!marker) {
        return Math.max(Math.ceil(fallbackHeight / 2), 1);
      }

      return Math.max(
        Math.ceil(marker.offsetTop + marker.offsetHeight * 0.5),
        1,
      );
    }

    function applyState() {
      btn.hidden =
        fullHeight <= collapsedHeight + 2 ||
        block.classList.contains("is-expanded");

      if (block.classList.contains("is-expanded")) {
        viewport.style.maxHeight = fullHeight + "px";
        block.classList.remove("is-collapsed");
        btn.setAttribute("aria-expanded", "true");
      } else {
        viewport.style.maxHeight = collapsedHeight + "px";
        block.classList.add("is-collapsed");
        block.classList.remove("is-expanded");
        btn.setAttribute("aria-expanded", "false");
      }
    }

    btn.addEventListener("click", function () {
      block.classList.add("is-expanded");
      applyState();
    });

    window.addEventListener("resize", debounce(measure, 150));
    measure();

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(measure).catch(function () {});
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    document
      .querySelectorAll("[data-confirm-guide-collapse]")
      .forEach(initConfirmGuideCollapse);
  });
})();
