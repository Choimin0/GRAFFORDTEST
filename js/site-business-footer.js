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

var SITE_LEGAL_MODAL_CONTENT = {
  kr: {
    terms: {
      title: "이용약관",
      bodyHtml:
        "<p>본 약관은 '그라포드(GRAFFORD)'가 제공하는 숙박 예약 서비스의 이용 조건 및 절차, 이용자와 당사의 권리, 의무 및 책임 사항을 규정함을 목적으로 합니다.</p>" +
        '<h3>제1조 목적</h3><p>이 약관은 그라포드(이하 "사업자")가 운영하는 숙박 예약 관련 웹사이트 및 부대 서비스(이하 "서비스")의 이용과 관련하여 사업자와 이용자 간의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.</p>' +
        '<h3>제2조 정의</h3><p>"이용자"란 본 약관에 따라 사업자가 제공하는 서비스를 이용하는 회원 및 비회원을 말합니다. "예약"이란 이용자가 사업자가 정한 절차에 따라 객실 또는 부대 시설 이용을 신청하는 행위를 말합니다.</p>' +
        "<h3>제3조 약관의 효력 및 변경</h3><p>사업자는 관련 법령을 위배하지 않는 범위에서 약관을 개정할 수 있으며, 개정 시 시행일 및 사유를 서비스 내 공지합니다. 이용자가 개정 약관 시행 후에도 서비스를 계속 이용하는 경우 변경에 동의한 것으로 봅니다.</p>" +
        "<h3>제4조 서비스의 제공</h3><p>사업자는 예약 안내, 결제 연동, 고객 문의 등 사업자가 정한 범위에서 서비스를 제공합니다. 천재지변, 시스템 점검 등 불가피한 사유가 있는 경우 서비스 제공이 일시 중단될 수 있습니다.</p>" +
        "<h3>제5조 예약 및 결제</h3><p>이용자는 예약 시 정확한 정보를 제공해야 하며, 허위 정보로 인해 발생하는 불이익에 대해 사업자는 책임을 지지 않습니다. 결제·취소·환불 조건은 별도 안내 또는 예약 확정 시 고지되는 정책에 따릅니다.</p>" +
        "<h3>제6조 이용자의 의무</h3><p>이용자는 관련 법령, 본 약관, 공지사항을 준수하여야 하며, 타인의 권리를 침해하거나 서비스 운영을 방해하는 행위를 하여서는 안 됩니다.</p>" +
        "<h3>제7조 면책</h3><p>사업자는 이용자 간 또는 이용자와 제3자 간에 발생한 분쟁에 개입하지 않으며, 사업자의 고의 또는 중대한 과실이 없는 한 일부 손해에 대해 책임을 지지 않을 수 있습니다. 본 조는 관련 법령이 정한 한도 내에서 적용됩니다.</p>" +
        "<h3>제8조 준거법 및 관할</h3><p>본 약관은 대한민국 법령에 따르며, 분쟁 발생 시 관할 법원은 민사소송법 등 관련 법령에 따릅니다.</p>",
    },
    privacy: {
      title: "개인정보 처리방침",
      bodyHtml:
        "<p>본 개인정보 처리방침은 예시 문구입니다. 실제 수집·이용 항목에 맞게 수정·공개해야 합니다.</p>" +
        "<h3>1. 수집하는 개인정보 항목</h3><p>예약 및 문의 과정에서 성명, 연락처, 이메일, 결제에 필요한 최소 정보 등이 수집될 수 있습니다. 구체적인 항목은 예약 화면 및 별도 동의 절차에서 안내됩니다.</p>" +
        "<h3>2. 개인정보의 이용 목적</h3><p>예약 접수·확인, 고객 응대, 서비스 품질 개선, 법령상 의무 이행, 분쟁 대응 등의 목적으로 이용됩니다.</p>" +
        "<h3>3. 보유 및 이용 기간</h3><p>관련 법령(전자상거래 등에서의 소비자보호에 관한 법률 등)에 따른 보존 의무가 있는 경우 해당 기간까지 보관하며, 그 외에는 수집 목적 달성 후 지체 없이 파기합니다.</p>" +
        "<h3>4. 제3자 제공 및 처리 위탁</h3><p>이용자의 동의가 있거나 법령에 근거가 있는 경우에 한하여 제공할 수 있으며, 결제·예약 시스템 운영 등 필요한 범위에서 수탁사에 처리를 위탁할 수 있습니다. 위탁 시에는 위탁 업무 내용과 수탁자를 방침에 공개합니다.</p>" +
        "<h3>5. 이용자의 권리</h3><p>이용자는 개인정보 열람·정정·삭제·처리 정지 등을 요청할 수 있으며, 요청 방법은 고객센터 안내에 따릅니다.</p>" +
        "<h3>6. 안전성 확보 조치</h3><p>개인정보의 분실·도난·유출·변조를 방지하기 위해 접근 권한 관리, 저장 시 암호화(해당 시), 접속 기록 보관 등 합리적인 조치를 취합니다.</p>" +
        "<h3>7. 문의</h3><p>개인정보 보호와 관련한 문의는 웹사이트에 게시된 연락처로 연락해 주시기 바랍니다.</p>",
    },
  },
  en: {
    terms: {
      title: "Terms of Use",
      bodyHtml:
        "<p>This is sample text only. Replace with counsel-reviewed terms before launch.</p>" +
        "<h3>Article 1 (Purpose)</h3><p>These Terms govern use of the GRAFFORD website and related lodging reservation services.</p>" +
        '<h3>Article 2 (Definitions)</h3><p>"User" means any person who uses the services. "Reservation" means a request for accommodation made through the procedures we provide.</p>' +
        "<h3>Article 3 (Changes)</h3><p>We may update these Terms as permitted by law and will post effective dates and summaries of material changes on the site.</p>" +
        "<h3>Article 4 (Service)</h3><p>We provide reservation information, payment flows, and customer support as described on the site. Service may pause for maintenance or force majeure.</p>" +
        "<h3>Article 5 (Reservations)</h3><p>You must provide accurate information. Payment, cancellation, and refund rules follow the policies shown at booking.</p>" +
        "<h3>Article 6 (Conduct)</h3><p>You must comply with applicable law and must not harm other users, our systems, or third parties.</p>" +
        "<h3>Article 7 (Disclaimer)</h3><p>To the extent allowed by law, we are not liable for certain indirect or consequential damages unless caused by our willful misconduct or gross negligence.</p>" +
        "<h3>Article 8 (Governing Law)</h3><p>These Terms are governed by the laws of the Republic of Korea, subject to mandatory consumer protections.</p>",
    },
    privacy: {
      title: "Privacy Policy",
      bodyHtml:
        "<p>This is sample text only. Update it to match your actual data practices.</p>" +
        "<h3>1. Information We Collect</h3><p>We may collect name, contact details, email, and limited payment-related data needed to complete reservations.</p>" +
        "<h3>2. How We Use Information</h3><p>We use data to process bookings, respond to inquiries, improve services, and meet legal obligations.</p>" +
        "<h3>3. Retention</h3><p>We retain information as required by law (for example, transaction records) and otherwise only as long as needed for the purposes described.</p>" +
        "<h3>4. Sharing and Processors</h3><p>We share data with processors (such as payment providers) as needed to operate the service, and otherwise only with consent or legal basis.</p>" +
        "<h3>5. Your Rights</h3><p>Depending on applicable law, you may request access, correction, deletion, or restriction. Contact us using the details posted on the site.</p>" +
        "<h3>6. Security</h3><p>We apply reasonable safeguards designed to protect personal information from unauthorized access or disclosure.</p>" +
        "<h3>7. Contact</h3><p>For privacy questions, please use the contact information shown on the website.</p>",
    },
  },
};

function resolveFooterLanguage() {
  if (
    window.GraffordLanguage &&
    typeof window.GraffordLanguage.getCurrentLanguage === "function"
  ) {
    return window.GraffordLanguage.getCurrentLanguage();
  }
  return "kr";
}

function isFooterEmailLine(lineStr, language) {
  var s = String(lineStr || "");
  if (language === "en") {
    return /^\s*Email\s*:/i.test(s);
  }
  return /^\s*이메일\s*:/.test(s);
}

function buildFooterLegalRowHtml(language) {
  var isEn = language === "en";
  var termsLabel = isEn ? "Terms of Use" : "이용약관";
  var privacyLabel = isEn ? "Privacy Policy" : "개인정보 처리방침";
  return (
    '<p class="site-business-footer__text-line site-business-footer__legal-line">' +
    '<button type="button" class="site-business-footer__legal-btn" data-site-legal-open="terms">' +
    termsLabel +
    "</button>" +
    '<span class="site-business-footer__legal-sep" aria-hidden="true"> | </span>' +
    '<button type="button" class="site-business-footer__legal-btn" data-site-legal-open="privacy">' +
    privacyLabel +
    "</button>" +
    "</p>"
  );
}

function ensureSiteLegalModal() {
  if (document.getElementById("site-legal-modal")) {
    return;
  }
  var wrap = document.createElement("div");
  wrap.id = "site-legal-modal";
  wrap.className = "site-legal-modal";
  wrap.setAttribute("hidden", "");
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML =
    '<div class="site-legal-modal__backdrop" aria-hidden="true"></div>' +
    '<div class="site-legal-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="site-legal-modal-title">' +
    '<div class="site-legal-modal__header">' +
    '<h2 id="site-legal-modal-title" class="site-legal-modal__title"></h2>' +
    '<button type="button" class="site-legal-modal__close" aria-label="닫기">X</button>' +
    "</div>" +
    '<div class="site-legal-modal__body"></div>' +
    "</div>";
  document.body.appendChild(wrap);

  var titleEl = wrap.querySelector("#site-legal-modal-title");
  var bodyEl = wrap.querySelector(".site-legal-modal__body");
  var closeBtn = wrap.querySelector(".site-legal-modal__close");

  function currentLang() {
    return resolveFooterLanguage() === "en" ? "en" : "kr";
  }

  function closeModal() {
    wrap.setAttribute("hidden", "");
    wrap.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (closeBtn) {
      closeBtn.setAttribute(
        "aria-label",
        currentLang() === "en" ? "Close" : "닫기",
      );
    }
  }

  function openModal(kind) {
    var lang = currentLang();
    var pack = SITE_LEGAL_MODAL_CONTENT[lang] || SITE_LEGAL_MODAL_CONTENT.kr;
    var entry = pack[kind];
    if (!entry) {
      return;
    }
    if (titleEl) {
      titleEl.textContent = entry.title;
    }
    if (bodyEl) {
      bodyEl.innerHTML = entry.bodyHtml;
      bodyEl.scrollTop = 0;
    }
    if (closeBtn) {
      closeBtn.setAttribute("aria-label", lang === "en" ? "Close" : "닫기");
    }
    wrap.removeAttribute("hidden");
    wrap.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    if (bodyEl) {
      window.requestAnimationFrame(function () {
        bodyEl.scrollTop = 0;
      });
    }
    if (closeBtn) {
      closeBtn.focus();
    }
  }

  document.addEventListener("click", function (event) {
    var opener =
      event.target && event.target.closest
        ? event.target.closest("[data-site-legal-open]")
        : null;
    if (!opener) {
      return;
    }
    event.preventDefault();
    var k = opener.getAttribute("data-site-legal-open");
    if (k === "terms" || k === "privacy") {
      openModal(k);
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      closeModal();
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !wrap.hasAttribute("hidden")) {
      closeModal();
    }
  });
}

function initSiteBusinessFooter(options) {
  ensureSiteLegalModal();

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
      "https://map.naver.com/v5/search/" +
      encodeURIComponent(String(query).trim())
    );
  }

  function renderByLanguage(language) {
    var selectedLines = language === "en" ? linesEn : linesKr;
    if (!Array.isArray(selectedLines) || selectedLines.length === 0) {
      selectedLines = linesKr;
    }

    var textParts = [];
    var legalRowInserted = false;
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
      if (isFooterEmailLine(lineStr, language)) {
        textParts.push(buildFooterLegalRowHtml(language));
        legalRowInserted = true;
      }
    }

    if (!legalRowInserted && textParts.length > 0) {
      textParts.push(buildFooterLegalRowHtml(language));
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

  renderByLanguage(resolveFooterLanguage());
  document.addEventListener("grafford:languagechange", function (event) {
    var nextLanguage =
      event && event.detail && event.detail.language
        ? event.detail.language
        : resolveFooterLanguage();
    renderByLanguage(nextLanguage);
  });
}

window.initSiteBusinessFooter = initSiteBusinessFooter;
