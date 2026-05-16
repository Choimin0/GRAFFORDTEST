(function () {
  var MOBILE_MQ = window.matchMedia("(max-width: 767px)");

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
      collapsedHeight = Math.max(Math.ceil(fullHeight / 2), 1);
      applyState();
    }

    function applyState() {
      if (!MOBILE_MQ.matches) {
        viewport.style.maxHeight = "";
        block.classList.remove("is-collapsed", "is-expanded");
        btn.hidden = true;
        btn.setAttribute("aria-expanded", "false");
        return;
      }

      btn.hidden = fullHeight <= collapsedHeight + 2;

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
      if (!MOBILE_MQ.matches) {
        return;
      }
      var nextExpanded = !block.classList.contains("is-expanded");
      block.classList.toggle("is-expanded", nextExpanded);
      applyState();
    });

    MOBILE_MQ.addEventListener("change", measure);
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
