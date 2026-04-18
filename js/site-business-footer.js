/**
 * 하단 사업장 정보 영역을 렌더링합니다.
 * 각 페이지에서 DOMContentLoaded 이후 호출하고, `lines`에 문구를 넣으면 됩니다.
 *
 * @param {Object} [options]
 * @param {string[]} [options.lines=[]] - 왼쪽에 표시할 줄 단위 문자열 배열
 * @param {{ href: string, imgSrc?: string }} [options.instagram] - 첫 줄 위에 인스타 아이콘 링크
 * @param {string} [options.logoSrc='images/LOGO-circle.png'] - 오른쪽 로고 이미지 경로
 * @param {string} [options.logoAlt='GRAFFORD'] - 로고 alt 텍스트
 */
function initSiteBusinessFooter(options) {
  var root = document.getElementById("site-business-footer-mount");
  if (!root) {
    return;
  }

  options = options || {};
  var lines = options.lines;
  if (!Array.isArray(lines)) {
    lines = [];
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

  var textParts = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line === " ") {
      textParts.push(
        '<p class="site-business-footer__text-line site-business-footer__text-line--spacer" aria-hidden="true">&nbsp;</p>',
      );
      continue;
    }
    if (line == null || String(line).trim() === "") {
      continue;
    }
    textParts.push(
      '<p class="site-business-footer__text-line">' + escapeHtml(line) + "</p>",
    );
  }

  var innerText = instaHtml + textParts.join("");
  var textBlock =
    innerText.length > 0
      ? '<div class="site-business-footer__text">' + innerText + "</div>"
      : '<div class="site-business-footer__text site-business-footer__text--empty" aria-hidden="true"></div>';

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
}

window.initSiteBusinessFooter = initSiteBusinessFooter;
