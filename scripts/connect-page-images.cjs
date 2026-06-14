#!/usr/bin/env node
/**
 * HTML 페이지 이미지 경로를 data-g-img + page-images.js 참조로 일괄 변환
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const SCRIPT_TAGS =
  '    <script src="js/page-images.js"></script>\n' +
  '    <script src="js/apply-page-images.js" defer></script>\n';

const FOOTER_IMG_SRC = /imgSrc:\s*"images\/insta\.png"/g;
const FOOTER_IMG_SRC_REPL = (m, prefix) =>
  `${prefix}imgSrc: window.getGraffordFooterImages().instagram`;

const NAV_IMG =
  /<img src="images\/LOGO\.png" alt="([^"]*)" \/>/g;
const NAV_IMG_REPL = '<img data-g-img="nav.logo" alt="$1" />';

const NAV_IMG_GRAFFORD =
  /<img src="images\/LOGO\.png" alt="GRAFFORD" \/>/g;
const NAV_IMG_GRAFFORD_REPL =
  '<img data-g-img="nav.logo" alt="GRAFFORD" />';

function ensureScripts(html) {
  if (html.includes("js/page-images.js")) {
    return html;
  }
  return html.replace(
    /(<meta name="viewport"[^>]*>\n)/,
    `$1${SCRIPT_TAGS}`,
  );
}

function addFooterLogoSrc(html) {
  return html.replace(
    /(window\.initSiteBusinessFooter\(\{[\s\S]*?instagram:\s*\{[\s\S]*?imgSrc:\s*window\.getGraffordFooterImages\(\)\.instagram,?\s*\},?)/g,
    (block) => {
      if (block.includes("logoSrc:")) {
        return block;
      }
      return block.replace(
        /(instagram:\s*\{[\s\S]*?\},?)/,
        `$1\n            logoSrc: window.getGraffordFooterImages().logo,`,
      );
    },
  );
}

const PAGE_REPLACEMENTS = {
  "index.html": [
    [/src="images\/main01\.png"/g, 'data-g-img="hero.kr.0"'],
    [/src="images\/mainimg0\.jpg"/g, 'data-g-img="hero.en.0"'],
    [/src="images\/reservation\.jpeg"/g, 'data-g-img="hero.kr.1"'],
    [/src="images\/rooms\.jpeg"/g, 'data-g-img="hero.kr.2"'],
    [/src="images\/story\.jpeg"/g, 'data-g-img="hero.kr.3"'],
    [
      /const sliderImages = \["images\/A\.jpg", "images\/B\.jpg", "images\/C\.jpg"\];/,
      "const sliderImages = window.getGraffordPageImages().slider;",
    ],
    [
      /var indexFeature3SpaceImages = \[[\s\S]*?\];/,
      "var indexFeature3SpaceImages = window.getGraffordPageImages().spaceGrid;",
    ],
    [
      /src="images\/mainimg1\.jpg"/g,
      'data-g-img="features.aboutImageKr"',
    ],
    [
      /src="images\/mainimg2\.jpg"/g,
      'data-g-img="features.philosophyImageKr"',
    ],
  ],
  "STORY.html": [
    [/src="images\/STORY\.png"/g, 'data-g-img="hero.kr"'],
    [
      /var storyCafeImages = \[[\s\S]*?\];/,
      "var storyCafeImages = window.getGraffordPageImages().features.cafeGalleryKr;",
    ],
    [/src="images\/story\.jpeg"/g, 'data-g-img="features.originKr"'],
    [/src="images\/cafe01\.jpg"/g, 'data-g-img="features.cafeMainKr"'],
  ],
  "GROUND.html": [
    [/src="images\/GROUND\.png"/g, 'data-g-img="hero.kr"'],
    [
      /var roomCarouselImages = \{[\s\S]*?\};/,
      "var roomCarouselImages = window.getGraffordPageImages().roomCarousel;",
    ],
    [/src="images\/A00\.jpg"/g, 'data-g-img="roomThumbs.g1"'],
    [/src="images\/B00\.jpg"/g, 'data-g-img="roomThumbs.g2"'],
    [/src="images\/C00\.jpg"/g, 'data-g-img="roomThumbs.g3"'],
    [/src="images\/D00\.jpg"/g, 'data-g-img="roomThumbs.g4"'],
    [/src="images\/rooms\.jpeg"/g, 'data-g-img="hero.en"'],
  ],
  "FACILITIES.html": [
    [/src="images\/space\.jpeg"/g, 'data-g-img="hero.kr"'],
    [/src="images\/lounge\.jpg"/g, 'data-g-img="features.cafeLoungeKr"'],
    [/src="images\/mainimg2\.jpg"/g, 'data-g-img="features.outdoorJacuzziKr"'],
    [/src="images\/mainimg1\.jpg"/g, 'data-g-img="features.courtyardKr"'],
  ],
  "RESERVATION.html": [
    [/src="images\/reservation\.jpeg"/g, 'data-g-img="hero.kr"'],
    [/src="images\/A00\.jpg"/g, 'data-g-img="gallery.defaultMainKr"'],
    [
      /G1: \["images\/A00\.jpg", "images\/A01\.jpg", "images\/A02\.jpg"\],[\s\S]*?G4: \["images\/D00\.jpg", "images\/D01\.jpg", "images\/D02\.jpg"\],/,
      "G1: window.getGraffordPageImages().gallery.carousel.G1,\n              G2: window.getGraffordPageImages().gallery.carousel.G2,\n              G3: window.getGraffordPageImages().gallery.carousel.G3,\n              G4: window.getGraffordPageImages().gallery.carousel.G4,",
    ],
  ],
  "payment.html": [
    [
      /src="images\/payment\/samsungpay-horizontal\.svg"/g,
      'data-g-img="paymentMethods.kr.samsung"',
    ],
    [
      /src="images\/payment\/naverpay-badge\.svg"/g,
      'data-g-img="paymentMethods.kr.naver"',
    ],
    [
      /src="images\/payment\/kakaopay-extended\.png"/g,
      'data-g-img="paymentMethods.kr.kakao"',
    ],
    [
      /src="images\/payment\/tosspay-logo-blue\.png"/g,
      'data-g-img="paymentMethods.kr.toss"',
    ],
    [
      /src="images\/payment\/kakaopay-extended\.svg"/g,
      'data-g-img="paymentMethods.en.kakao"',
    ],
  ],
  "reserve-check.html": [
    [/src="images\/A00\.jpg"/g, 'data-g-img="gallery.defaultMainKr"'],
    [
      /var images = \[\s*"images\/" \+ prefix \+ "00\.jpg",\s*"images\/" \+ prefix \+ "01\.jpg",\s*"images\/" \+ prefix \+ "02\.jpg",\s*\];/,
      "var images = window.buildGraffordRoomCarousel(prefix);",
    ],
  ],
  "reserve-complete.html": [
    [/src="images\/A00\.jpg"/g, 'data-g-img="gallery.defaultMainKr"'],
    [
      /var images = \[\s*"images\/" \+ prefix \+ "00\.jpg",\s*"images\/" \+ prefix \+ "01\.jpg",\s*"images\/" \+ prefix \+ "02\.jpg",\s*\];/,
      "var images = window.buildGraffordRoomCarousel(prefix);",
    ],
  ],
};

const PAGES = [
  "index.html",
  "STORY.html",
  "GROUND.html",
  "FACILITIES.html",
  "RESERVATION.html",
  "payment.html",
  "reserveinfo.html",
  "confirm.html",
  "reserve-check.html",
  "reserve-complete.html",
  "reserve-delete.html",
  "delete-complete.html",
  "gfd-management-2026-v1.html",
];

for (const page of PAGES) {
  const filePath = path.join(ROOT, page);
  let html = fs.readFileSync(filePath, "utf8");
  html = ensureScripts(html);
  html = html.replace(NAV_IMG, NAV_IMG_REPL);
  html = html.replace(NAV_IMG_GRAFFORD, NAV_IMG_GRAFFORD_REPL);
  html = html.replace(FOOTER_IMG_SRC, 'imgSrc: window.getGraffordFooterImages().instagram');
  html = addFooterLogoSrc(html);

  const reps = PAGE_REPLACEMENTS[page] || [];
  for (const [pattern, replacement] of reps) {
    html = html.replace(pattern, replacement);
  }

  // index.html EN hero slides 1-3 share kr paths in config (hero.kr.1 etc) - fix EN section
  if (page === "index.html") {
    const enHero = html.split('<div class="lang-en">')[1];
    if (enHero) {
      const fixedEn = enHero
        .replace(/data-g-img="hero\.kr\.1"/g, 'data-g-img="hero.en.1"')
        .replace(/data-g-img="hero\.kr\.2"/g, 'data-g-img="hero.en.2"')
        .replace(/data-g-img="hero\.kr\.3"/g, 'data-g-img="hero.en.3"')
        .replace(
          /data-g-img="features\.aboutImageKr"/g,
          'data-g-img="features.aboutImageEn"',
        )
        .replace(
          /data-g-img="features\.philosophyImageKr"/g,
          'data-g-img="features.philosophyImageEn"',
        );
      html = html.split('<div class="lang-en">')[0] + '<div class="lang-en">' + fixedEn;
    }
    // hero logo in EN
    html = html.replace(
      /(<div class="lang-en">[\s\S]*?<img\s+)(data-g-img="nav\.logo")/,
      '$1data-g-img="hero.logoEn"',
    );
    // hero logo in KR section (first hero-title-logo img)
    html = html.replace(
      /(<div class="lang-kr">[\s\S]*?hero-title-logo[\s\S]*?<img\s+)data-g-img="nav\.logo"/,
      '$1data-g-img="hero.logoKr"',
    );
  }

  if (page === "STORY.html") {
    const enPart = html.split('<div class="lang-en">')[1];
    if (enPart) {
      const fixedEn = enPart
        .replace(/data-g-img="hero\.kr"/g, 'data-g-img="hero.en"')
        .replace(
          /data-g-img="features\.originKr"/g,
          'data-g-img="features.originEn"',
        )
        .replace(
          /data-g-img="features\.cafeMainKr"/g,
          'data-g-img="features.cafeMainEn"',
        );
      html = html.split('<div class="lang-en">')[0] + '<div class="lang-en">' + fixedEn;
    }
    // EN story cafe gallery script - need second storyCafeImages if exists
    const enScriptMatch = html.match(
      /<div class="lang-en">[\s\S]*?var storyCafeImages = window\.getGraffordPageImages\(\)\.features\.cafeGalleryKr;/,
    );
    if (enScriptMatch) {
      html = html.replace(
        /(<div class="lang-en">[\s\S]*?)var storyCafeImages = window\.getGraffordPageImages\(\)\.features\.cafeGalleryKr;/,
        "$1var storyCafeImages = window.getGraffordPageImages().features.cafeGalleryEn;",
      );
    }
  }

  if (page === "FACILITIES.html") {
    const enPart = html.split('<div class="lang-en">')[1];
    if (enPart) {
      const fixedEn = enPart
        .replace(/data-g-img="hero\.kr"/g, 'data-g-img="hero.en"')
        .replace(
          /data-g-img="features\.cafeLoungeKr"/g,
          'data-g-img="features.cafeLoungeEn"',
        )
        .replace(
          /data-g-img="features\.outdoorJacuzziKr"/g,
          'data-g-img="features.outdoorJacuzziEn"',
        )
        .replace(
          /data-g-img="features\.courtyardKr"/g,
          'data-g-img="features.courtyardEn"',
        );
      html = html.split('<div class="lang-en">')[0] + '<div class="lang-en">' + fixedEn;
    }
  }

  if (page === "RESERVATION.html") {
    const enPart = html.split('<div class="lang-en">')[1];
    if (enPart) {
      const fixedEn = enPart
        .replace(/data-g-img="hero\.kr"/g, 'data-g-img="hero.en"')
        .replace(
          /data-g-img="gallery\.defaultMainKr"/g,
          'data-g-img="gallery.defaultMainEn"',
        );
      html = html.split('<div class="lang-en">')[0] + '<div class="lang-en">' + fixedEn;
    }
  }

  if (page === "payment.html") {
    const enPart = html.split('<div class="lang-en">')[1];
    if (enPart) {
      const fixedEn = enPart
        .replace(
          /data-g-img="paymentMethods\.kr\.samsung"/g,
          'data-g-img="paymentMethods.en.samsung"',
        )
        .replace(
          /data-g-img="paymentMethods\.kr\.naver"/g,
          'data-g-img="paymentMethods.en.naver"',
        )
        .replace(
          /data-g-img="paymentMethods\.kr\.kakao"/g,
          'data-g-img="paymentMethods.en.kakao"',
        )
        .replace(
          /data-g-img="paymentMethods\.kr\.toss"/g,
          'data-g-img="paymentMethods.en.toss"',
        );
      html = html.split('<div class="lang-en">')[0] + '<div class="lang-en">' + fixedEn;
    }
  }

  if (page === "reserve-check.html" || page === "reserve-complete.html") {
    const enPart = html.split('<div class="lang-en">')[1];
    if (enPart) {
      const fixedEn = enPart.replace(
        /data-g-img="gallery\.defaultMainKr"/g,
        'data-g-img="gallery.defaultMainEn"',
      );
      html = html.split('<div class="lang-en">')[0] + '<div class="lang-en">' + fixedEn;
    }
  }

  if (page === "gfd-management-2026-v1.html") {
    html = html.replace(
      /<img src="images\/LOGO\.png" alt="GRAFFORD" \/>/,
      '<img data-g-img="nav.logo" alt="GRAFFORD" />',
    );
    // gfd-management needs scripts before closing head - no viewport pattern with newline after in same way
    if (!html.includes("js/page-images.js")) {
      html = html.replace(
        /(<link rel="stylesheet" href="css\/style\.css" \/>)/,
        `$1\n    <script src="js/page-images.js"></script>\n    <script src="js/apply-page-images.js" defer></script>`,
      );
    }
  }

  fs.writeFileSync(filePath, html, "utf8");
  console.log("Updated:", page);
}
