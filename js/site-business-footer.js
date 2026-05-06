/**
 * 하단 사업장 정보 영역을 렌더링합니다.
 * 각 페이지에서 DOMContentLoaded 이후 호출하고, `lines`에 문구를 넣으면 됩니다.
 *
 * @param {Object} [options]
 * @param {string[]} [options.lines=[]] - (레거시) 왼쪽에 표시할 줄 단위 문자열 배열
 * @param {string[]} [options.linesKr=[]] - 한국어 줄 단위 문자열 배열
 * @param {string[]} [options.linesEn=[]] - 영어 줄 단위 문자열 배열
 * @param {{ href: string, imgSrc?: string }} [options.instagram] - 첫 줄 위에 인스타 아이콘 링크
 * @param {string} [options.logoSrc='images/LOGO-circle.png'] - 오른쪽 로고 이미지 경로
 * @param {string} [options.logoAlt='GRAFFORD'] - 로고 alt 텍스트
 * @param {boolean} [options.naverMapAddress=false] - true이면 `주소 : …` 줄에서 콜론 뒤만 네이버 지도 검색으로 연결
 */
function initSiteBusinessFooter(options) {
  var roots = Array.prototype.slice.call(
    document.querySelectorAll("[data-site-business-footer-mount]"),
  );
  if (!roots.length) {
    var legacyRoot = document.getElementById("site-business-footer-mount");
    if (legacyRoot) {
      roots.push(legacyRoot);
    }
  }
  if (!roots.length) {
    return;
  }

  options = options || {};
  var lines = options.lines;
  var linesKr = options.linesKr;
  var linesEn = options.linesEn;
  if (!Array.isArray(linesKr)) {
    linesKr = Array.isArray(lines) ? lines : [];
  }
  if (!Array.isArray(linesEn)) {
    linesEn = [];
  }

  var logoSrc = options.logoSrc || "images/LOGO-circle.png";
  var logoAlt = options.logoAlt || "GRAFFORD";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var instaCfg = options.instagram;
  var instaHtml = "";
  if (instaCfg && instaCfg.href) {
    var instaHref = String(instaCfg.href).trim();
    var instaSrc = escapeHtml(instaCfg.imgSrc || "images/insta.png");
    instaHtml =
      '<p class="site-business-footer__text-line site-business-footer__insta-line">' +
      '<a class="site-business-footer__insta-link" href="' +
      escapeHtml(instaHref) +
      '" target="_blank" rel="noopener noreferrer">' +
      '<img class="site-business-footer__insta-icon" src="' +
      instaSrc +
      '" alt="Instagram에서 GRAFFORD 보기" decoding="async" />' +
      "</a></p>";
  }

  var naverMapAddr = options.naverMapAddress === true;

  function naverSearchUrl(query) {
    return (
      "https://map.naver.com/v5/search/" + encodeURIComponent(String(query).trim())
    );
  }

  function resolveCurrentLanguage() {
    if (
      window.GraffordLanguage &&
      typeof window.GraffordLanguage.getCurrentLanguage === "function"
    ) {
      return window.GraffordLanguage.getCurrentLanguage();
    }
    return "kr";
  }

  function renderByLanguage(language) {
    var selectedLines = language === "en" ? linesEn : linesKr;
    if (!Array.isArray(selectedLines) || selectedLines.length === 0) {
      selectedLines = linesKr;
    }

    var textParts = [];
    for (var i = 0; i < selectedLines.length; i++) {
      var line = selectedLines[i];
      if (line === " ") {
        textParts.push(
          '<p class="site-business-footer__text-line site-business-footer__text-line--spacer" aria-hidden="true">&nbsp;</p>',
        );
        continue;
      }
      if (line == null || String(line).trim() === "") {
        continue;
      }
      var lineStr = String(line);
      var addrRegex =
        language === "en" ? /^\s*Address\s*:\s*(.+)$/i : /^\s*주소\s*:\s*(.+)$/;
      var addrLabel = language === "en" ? "Address : " : "주소 : ";
      var addrMatch = addrRegex.exec(lineStr);
      if (naverMapAddr && addrMatch) {
        var addrRight = addrMatch[1].trim();
        var mapHref = naverSearchUrl(addrRight);
        textParts.push(
          '<p class="site-business-footer__text-line site-business-footer__text-line--address">' +
            '<span class="site-business-footer__addr-label">' +
            escapeHtml(addrLabel) +
            "</span>" +
            '<a class="site-business-footer__map-link" href="' +
            escapeHtml(mapHref) +
            '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(addrRight) +
            "</a></p>",
        );
        continue;
      }
      textParts.push(
        '<p class="site-business-footer__text-line">' +
          escapeHtml(lineStr) +
          "</p>",
      );
    }

    var innerText = instaHtml + textParts.join("");
    var textBlock =
      innerText.length > 0
        ? '<div class="site-business-footer__text">' + innerText + "</div>"
        : '<div class="site-business-footer__text site-business-footer__text--empty" aria-hidden="true"></div>';

    roots.forEach(function (root) {
      root.className = "site-footer site-business-footer";
      root.innerHTML =
        '<div class="site-business-footer__rule" aria-hidden="true"></div>' +
        '<div class="site-business-footer__inner">' +
        textBlock +
        '<div class="site-business-footer__logo-wrap">' +
        '<img class="site-business-footer__logo" src="' +
        escapeHtml(logoSrc) +
        '" alt="' +
        escapeHtml(logoAlt) +
        '" decoding="async" />' +
        "</div>" +
        "</div>";
      root.hidden = false;
    });
  }

  renderByLanguage(resolveCurrentLanguage());
  document.addEventListener("grafford:languagechange", function (event) {
    var nextLanguage = event && event.detail ? event.detail.language : "kr";
    renderByLanguage(nextLanguage);
  });
}

window.initSiteBusinessFooter = initSiteBusinessFooter;
