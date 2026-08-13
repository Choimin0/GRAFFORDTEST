 (function () {
  var STORAGE_KEY = "graffordPreferredLanguage";
  var DEFAULT_LANG = "kr";
  var currentLang = DEFAULT_LANG;

  function normalizeLanguage(value) {
    if (value === "en") return "en";
    return "kr";
  }

  function getSavedLanguage() {
    try {
      return normalizeLanguage(localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      return DEFAULT_LANG;
    }
  }

  function saveLanguage(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (error) {
      // Ignore storage failures (private mode etc).
    }
  }

  function applyHtmlLanguage(lang) {
    document.documentElement.setAttribute("lang", lang === "en" ? "en" : "ko");
    document.body.setAttribute("data-site-language", lang);
  }

  function applyI18nAttributes(lang) {
    var selector = "[data-i18n-kr], [data-i18n-en], [data-i18n-html-kr], [data-i18n-html-en]";
    var nodes = document.querySelectorAll(selector);

    nodes.forEach(function (node) {
      var textKey = lang === "en" ? "i18nEn" : "i18nKr";
      var fallbackTextKey = lang === "en" ? "i18nKr" : "i18nEn";
      var htmlKey = lang === "en" ? "i18nHtmlEn" : "i18nHtmlKr";
      var fallbackHtmlKey = lang === "en" ? "i18nHtmlKr" : "i18nHtmlEn";
      var originalHtmlKey = "i18nOriginalHtml";
      var originalTextKey = "i18nOriginalText";

      if (node.dataset[originalHtmlKey] == null) {
        node.dataset[originalHtmlKey] = node.innerHTML;
      }
      if (node.dataset[originalTextKey] == null) {
        node.dataset[originalTextKey] = node.textContent;
      }

      if (node.dataset[htmlKey] != null || node.dataset[fallbackHtmlKey] != null) {
        var htmlValue = node.dataset[htmlKey];
        if (htmlValue == null || htmlValue === "") {
          htmlValue = node.dataset[fallbackHtmlKey];
        }
        if (htmlValue == null || htmlValue === "") {
          htmlValue = node.dataset[originalHtmlKey] || "";
        }
        node.innerHTML = htmlValue;
        return;
      }

      if (node.dataset[textKey] != null || node.dataset[fallbackTextKey] != null) {
        var textValue = node.dataset[textKey];
        if (textValue == null || textValue === "") {
          textValue = node.dataset[fallbackTextKey];
        }
        if (textValue == null || textValue === "") {
          textValue = node.dataset[originalTextKey] || "";
        }
        node.textContent = textValue;
      }
    });
  }

  function languageSwitchDisabled() {
    return (
      document.body &&
      document.body.hasAttribute("data-disable-language-switch")
    );
  }

  function hideLanguageSwitches() {
    document.querySelectorAll("[data-language-switch]").forEach(function (node) {
      node.hidden = true;
    });
  }

  function updateSwitchState(lang) {
    if (languageSwitchDisabled()) {
      hideLanguageSwitches();
      return;
    }
    var switchNodes = document.querySelectorAll("[data-language-switch]");
    switchNodes.forEach(function (container) {
      var isMobileSwitch = container.classList.contains("mobile-lang-switch");
      var nextLang = lang === "en" ? "kr" : "en";
      var buttons = container.querySelectorAll("[data-lang-option]");
      buttons.forEach(function (btn) {
        var isActive = btn.getAttribute("data-lang-option") === lang;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
      if (isMobileSwitch) {
        container.removeAttribute("role");
        container.removeAttribute("tabindex");
        container.removeAttribute("aria-pressed");
        container.setAttribute("aria-label", "Language switch");
        return;
      }
      container.setAttribute("role", "button");
      container.setAttribute("tabindex", "0");
      container.setAttribute("aria-pressed", "false");
      container.setAttribute(
        "aria-label",
        nextLang === "en" ? "Switch language to EN" : "Switch language to KR",
      );
      container.setAttribute("title", nextLang === "en" ? "EN" : "KR");
    });
  }

  function ensureMobileLanguageSwitch() {
    if (languageSwitchDisabled()) {
      hideLanguageSwitches();
      return;
    }
    var navs = document.querySelectorAll(".site-nav");
    navs.forEach(function (nav) {
      var drawerFooter = nav.querySelector(".mobile-nav-drawer__footer");
      if (!drawerFooter) return;
      if (nav.querySelector(".mobile-lang-switch")) return;

      var wrapper = document.createElement("div");
      wrapper.className = "lang-switch mobile-lang-switch";
      wrapper.setAttribute("data-language-switch", "");
      wrapper.setAttribute("aria-label", "Language switch");
      wrapper.innerHTML =
        '<button type="button" class="lang-switch__btn" data-lang-option="kr">KR</button>' +
        '<span class="lang-switch__divider" aria-hidden="true">|</span>' +
        '<button type="button" class="lang-switch__btn" data-lang-option="en">EN</button>';
      drawerFooter.insertBefore(wrapper, drawerFooter.firstChild);
    });
  }

  function ensureEnglishHeroSlides() {
    var enHeroes = document.querySelectorAll(".lang-en .hero-media");
    enHeroes.forEach(function (heroMedia) {
      var slides = heroMedia.querySelectorAll(".hero-slide");
      if (!slides.length) return;
      var hasActive = false;
      slides.forEach(function (slide) {
        if (slide.classList.contains("is-active")) {
          hasActive = true;
        }
      });
      if (!hasActive) {
        slides[0].classList.add("is-active");
      }
    });
  }

  function revealEnglishScrollFadeSections() {
    var fadeBlocks = document.querySelectorAll(".lang-en .scroll-fade");
    fadeBlocks.forEach(function (node) {
      node.classList.add("is-visible");
    });
  }

  function handleScrollDownClick(event) {
    var button = event.target.closest(".scroll-down-btn");
    if (!button) return;

    var wrapperSelector = currentLang === "en" ? ".lang-en" : ".lang-kr";
    var wrapper = document.querySelector(wrapperSelector);
    if (!wrapper || !wrapper.contains(button)) return;

    var nextSection = wrapper.querySelector("main.content-section");
    if (!nextSection) return;

    event.preventDefault();
    nextSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyLanguage(lang) {
    currentLang = normalizeLanguage(lang);
    applyHtmlLanguage(currentLang);
    updateSwitchState(currentLang);
    if (currentLang === "en") {
      ensureEnglishHeroSlides();
      revealEnglishScrollFadeSections();
    }
    applyI18nAttributes(currentLang);
    document.dispatchEvent(
      new CustomEvent("grafford:languagechange", {
        detail: { language: currentLang },
      }),
    );
  }

  function handleSwitchClick(event) {
    if (languageSwitchDisabled()) return;
    var switchContainer = event.target.closest("[data-language-switch]");
    if (!switchContainer) return;

    var isMobileSwitch = switchContainer.classList.contains("mobile-lang-switch");
    if (isMobileSwitch) {
      var btn = event.target.closest("[data-lang-option]");
      if (!btn) return;
      var lang = normalizeLanguage(btn.getAttribute("data-lang-option"));
      if (lang === currentLang) return;
      saveLanguage(lang);
      applyLanguage(lang);
      return;
    }

    var toggledLang = currentLang === "en" ? "kr" : "en";
    saveLanguage(toggledLang);
    applyLanguage(toggledLang);
  }

  function handleDesktopSwitchKeydown(event) {
    if (languageSwitchDisabled()) return;
    var switchContainer = event.target.closest("[data-language-switch]");
    if (!switchContainer) return;
    if (switchContainer.classList.contains("mobile-lang-switch")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    var toggledLang = currentLang === "en" ? "kr" : "en";
    saveLanguage(toggledLang);
    applyLanguage(toggledLang);
  }

  function initLanguageSwitch() {
    if (languageSwitchDisabled()) {
      hideLanguageSwitches();
    }
    ensureMobileLanguageSwitch();
    document.addEventListener("click", handleScrollDownClick);
    document.addEventListener("click", handleSwitchClick);
    document.addEventListener("keydown", handleDesktopSwitchKeydown);
    applyLanguage(getSavedLanguage());
  }

  window.GraffordLanguage = {
    getCurrentLanguage: function () {
      return currentLang;
    },
    setLanguage: function (lang) {
      var normalized = normalizeLanguage(lang);
      saveLanguage(normalized);
      applyLanguage(normalized);
    },
  };

  if (document.body) {
    applyLanguage(getSavedLanguage());
  }
  document.addEventListener("DOMContentLoaded", initLanguageSwitch);
})();
