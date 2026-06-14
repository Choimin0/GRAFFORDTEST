/**
 * GRAFFORD 페이지별 이미지 목록
 *
 * 이미지 교체·등록 시 이 파일에서 해당 페이지 섹션만 수정하세요.
 * 동일 파일이 여러 페이지에 쓰여도, 페이지별로 독립 항목으로 관리합니다.
 *
 * 사용 예)
 *   const imgs = window.GRAFFORD_PAGE_IMAGES["index.html"];
 *   const heroKr = imgs.hero.kr;
 */
(function (global) {
  "use strict";

  global.GRAFFORD_PAGE_IMAGES = {
    /* ─────────────────────────────────────────────
     * index.html — 메인 홈
     * ───────────────────────────────────────────── */
    "index.html": {
      favicon: "images/LOGO-transparent.png",
      ogImage: "https://www.grafford.kr/images/main01.png",
      nav: {
        logo: "images/LOGO.png",
      },
      hero: {
        kr: [
          "images/main01.png",
          "images/reservation.jpeg",
          "images/rooms.jpeg",
          "images/story.jpeg",
        ],
        en: [
          "images/mainimg0.jpg",
          "images/reservation.jpeg",
          "images/rooms.jpeg",
          "images/story.jpeg",
        ],
        logoKr: "images/LOGO.png",
        logoEn: "images/LOGO.png",
      },
      features: {
        aboutImageKr: "images/mainimg1.jpg",
        aboutImageEn: "images/mainimg1.jpg",
        philosophyImageKr: "images/mainimg1.jpg",
        philosophyImageEn: "images/mainimg1.jpg",
      },
      spaceGrid: [
        "images/space02.jpg",
        "images/A01.jpg",
        "images/reservation.jpeg",
        "images/rooms.jpeg",
        "images/GROUND.png",
        "images/D00.jpg",
      ],
      slider: ["images/A.jpg", "images/B.jpg", "images/C.jpg"],
      footer: {
        instagram: "images/insta.png",
        logo: "images/LOGO-circle-transparent.png",
      },
    },

    /* ─────────────────────────────────────────────
     * STORY.html — 브랜드 스토리
     * ───────────────────────────────────────────── */
    "STORY.html": {
      favicon: "images/LOGO-transparent.png",
      nav: {
        logo: "images/LOGO.png",
      },
      hero: {
        kr: "images/STORY.png",
        en: "images/story.jpeg",
      },
      features: {
        originKr: "images/story.jpeg",
        originEn: "images/story.jpeg",
        cafeGalleryKr: [
          "images/cafe01.jpg",
          "images/cafe02.jpg",
          "images/cafe03.jpg",
          "images/cafe04.jpg",
          "images/cafe05.jpg",
          "images/cafe06.jpg",
        ],
        cafeGalleryEn: [
          "images/cafe01.jpg",
          "images/cafe02.jpg",
          "images/cafe03.jpg",
          "images/cafe04.jpg",
          "images/cafe05.jpg",
          "images/cafe06.jpg",
        ],
        cafeMainKr: "images/cafe01.jpg",
        cafeMainEn: "images/cafe01.jpg",
      },
      footer: {
        instagram: "images/insta.png",
        logo: "images/LOGO-circle-transparent.png",
      },
    },

    /* ─────────────────────────────────────────────
     * GROUND.html — 객실 소개
     * ───────────────────────────────────────────── */
    "GROUND.html": {
      favicon: "images/LOGO-transparent.png",
      nav: {
        logo: "images/LOGO.png",
      },
      hero: {
        kr: "images/GROUND.png",
        en: "images/rooms.jpeg",
      },
      roomThumbs: {
        g1: "images/A00.jpg",
        g2: "images/B00.jpg",
        g3: "images/C00.jpg",
        g4: "images/D00.jpg",
      },
      roomCarousel: {
        G1: ["images/A00.jpg", "images/A01.jpg", "images/A02.jpg"],
        G2: ["images/B00.jpg", "images/B01.jpg", "images/B02.jpg"],
        G3: ["images/C00.jpg", "images/C01.jpg", "images/C02.jpg"],
        G4: ["images/D00.jpg", "images/D01.jpg", "images/D02.jpg"],
      },
      footer: {
        instagram: "images/insta.png",
        logo: "images/LOGO-circle-transparent.png",
      },
    },

    /* ─────────────────────────────────────────────
     * FACILITIES.html — 시설 소개
     * ───────────────────────────────────────────── */
    "FACILITIES.html": {
      favicon: "images/LOGO-transparent.png",
      nav: {
        logo: "images/LOGO.png",
      },
      hero: {
        kr: "images/space.jpeg",
        en: "images/space.jpeg",
      },
      features: {
        cafeLoungeKr: "images/lounge.jpg",
        cafeLoungeEn: "images/lounge.jpg",
        outdoorJacuzziKr: "images/mainimg2.jpg",
        outdoorJacuzziEn: "images/mainimg2.jpg",
        courtyardKr: "images/mainimg1.jpg",
        courtyardEn: "images/mainimg1.jpg",
      },
      footer: {
        instagram: "images/insta.png",
        logo: "images/LOGO-circle-transparent.png",
      },
    },

    /* ─────────────────────────────────────────────
     * RESERVATION.html — 예약 (객실 선택)
     * ───────────────────────────────────────────── */
    "RESERVATION.html": {
      favicon: "images/LOGO-transparent.png",
      nav: {
        logo: "images/LOGO.png",
      },
      hero: {
        kr: "images/reservation.jpeg",
        en: "images/reservation.jpeg",
      },
      gallery: {
        defaultMainKr: "images/A00.jpg",
        defaultMainEn: "images/A00.jpg",
        carousel: {
          G1: ["images/A00.jpg", "images/A01.jpg", "images/A02.jpg"],
          G2: ["images/B00.jpg", "images/B01.jpg", "images/B02.jpg"],
          G3: ["images/C00.jpg", "images/C01.jpg", "images/C02.jpg"],
          G4: ["images/D00.jpg", "images/D01.jpg", "images/D02.jpg"],
        },
      },
      footer: {
        instagram: "images/insta.png",
        logo: "images/LOGO-circle-transparent.png",
      },
    },

    /* ─────────────────────────────────────────────
     * payment.html — 결제
     * ───────────────────────────────────────────── */
    "payment.html": {
      favicon: "images/LOGO-transparent.png",
      nav: {
        logo: "images/LOGO.png",
      },
      paymentMethods: {
        kr: {
          samsung: "images/payment/samsungpay-horizontal.svg",
          naver: "images/payment/naverpay-badge.svg",
          kakao: "images/payment/kakaopay-extended.png",
          toss: "images/payment/tosspay-logo-blue.png",
        },
        en: {
          samsung: "images/payment/samsungpay-horizontal.svg",
          naver: "images/payment/naverpay-badge.svg",
          kakao: "images/payment/kakaopay-extended.svg",
          toss: "images/payment/tosspay-logo-blue.png",
        },
      },
      footer: {
        instagram: "images/insta.png",
        logo: "images/LOGO-circle-transparent.png",
      },
    },

    /* ─────────────────────────────────────────────
     * reserveinfo.html — 예약 정보 입력
     * ───────────────────────────────────────────── */
    "reserveinfo.html": {
      favicon: "images/LOGO-transparent.png",
      nav: {
        logo: "images/LOGO.png",
      },
      footer: {
        instagram: "images/insta.png",
        logo: "images/LOGO-circle-transparent.png",
      },
    },

    /* ─────────────────────────────────────────────
     * confirm.html — 예약 확인
     * ───────────────────────────────────────────── */
    "confirm.html": {
      favicon: "images/LOGO-transparent.png",
      nav: {
        logo: "images/LOGO.png",
      },
      footer: {
        instagram: "images/insta.png",
        logo: "images/LOGO-circle-transparent.png",
      },
    },

    /* ─────────────────────────────────────────────
     * reserve-check.html — 예약 조회
     * ───────────────────────────────────────────── */
    "reserve-check.html": {
      favicon: "images/LOGO-transparent.png",
      nav: {
        logo: "images/LOGO.png",
      },
      gallery: {
        defaultMainKr: "images/A00.jpg",
        defaultMainEn: "images/A00.jpg",
        carouselPattern: [
          "images/{room}00.jpg",
          "images/{room}01.jpg",
          "images/{room}02.jpg",
        ],
      },
      footer: {
        instagram: "images/insta.png",
        logo: "images/LOGO-circle-transparent.png",
      },
    },

    /* ─────────────────────────────────────────────
     * reserve-complete.html — 예약 완료
     * ───────────────────────────────────────────── */
    "reserve-complete.html": {
      favicon: "images/LOGO-transparent.png",
      nav: {
        logo: "images/LOGO.png",
      },
      gallery: {
        defaultMainKr: "images/A00.jpg",
        defaultMainEn: "images/A00.jpg",
        carouselPattern: [
          "images/{room}00.jpg",
          "images/{room}01.jpg",
          "images/{room}02.jpg",
        ],
      },
      footer: {
        instagram: "images/insta.png",
        logo: "images/LOGO-circle-transparent.png",
      },
    },

    /* ─────────────────────────────────────────────
     * reserve-delete.html — 예약 취소
     * ───────────────────────────────────────────── */
    "reserve-delete.html": {
      favicon: "images/LOGO-transparent.png",
      nav: {
        logo: "images/LOGO.png",
      },
      footer: {
        instagram: "images/insta.png",
        logo: "images/LOGO-circle-transparent.png",
      },
    },

    /* ─────────────────────────────────────────────
     * delete-complete.html — 취소 완료
     * ───────────────────────────────────────────── */
    "delete-complete.html": {
      favicon: "images/LOGO-transparent.png",
      nav: {
        logo: "images/LOGO.png",
      },
      footer: {
        instagram: "images/insta.png",
        logo: "images/LOGO-circle-transparent.png",
      },
    },

    /* ─────────────────────────────────────────────
     * gfd-management-2026-v1.html — 관리자
     * ───────────────────────────────────────────── */
    "gfd-management-2026-v1.html": {
      favicon: "images/LOGO-transparent.png",
      nav: {
        logo: "images/LOGO.png",
      },
      footer: {
        instagram: "images/insta.png",
      },
    },

    /* ─────────────────────────────────────────────
     * 공통 JS (페이지 HTML 외부)
     * ───────────────────────────────────────────── */
    _shared: {
      "js/mobile-nav.js": {
        drawerLogo: "images/LOGO.png",
      },
      "js/site-business-footer.js": {
        defaultFooterLogo: "images/LOGO-circle-transparent.png",
      },
    },

    /* ─────────────────────────────────────────────
     * images/ 폴더 내 미사용 파일 (참고용)
     * ───────────────────────────────────────────── */
    _unused: [
      "images/A-groundplan.png",
      "images/B-groundplan.png",
      "images/C-groundplan.png",
      "images/D-groundplan.png",
      "images/D03.jpg",
      "images/icons/confirm.png",
      "images/icons/language.png",
      "images/mainimg3.jpg",
      "images/op-img.png",
      "images/story02.jpg",
      "images/view.png",
    ],
  };

  function getGraffordPageName() {
    var path = global.location && global.location.pathname;
    if (!path) {
      return "index.html";
    }
    var name = path.split("/").pop();
    return name || "index.html";
  }

  function resolveGraffordImagePath(root, path) {
    if (!root || !path) {
      return null;
    }
    var parts = String(path).split(".");
    var current = root;
    for (var i = 0; i < parts.length; i++) {
      if (current == null) {
        return null;
      }
      var part = parts[i];
      var index = Number(part);
      if (!Number.isNaN(index) && String(index) === part) {
        current = current[index];
      } else {
        current = current[part];
      }
    }
    return typeof current === "string" ? current : null;
  }

  global.getGraffordPageName = getGraffordPageName;

  global.getGraffordPageImages = function (pageFile) {
    var page = pageFile || getGraffordPageName();
    return global.GRAFFORD_PAGE_IMAGES[page] || null;
  };

  global.getGraffordImage = function (path, pageFile) {
    var imgs = global.getGraffordPageImages(pageFile);
    return resolveGraffordImagePath(imgs, path);
  };

  global.getGraffordSharedImage = function (scriptKey, imageKey) {
    var shared = global.GRAFFORD_PAGE_IMAGES._shared;
    if (!shared || !shared[scriptKey]) {
      return null;
    }
    return shared[scriptKey][imageKey] || null;
  };

  global.getGraffordFooterImages = function (pageFile) {
    var imgs = global.getGraffordPageImages(pageFile);
    return (imgs && imgs.footer) || {};
  };

  global.buildGraffordRoomCarousel = function (roomPrefix, pattern, pageFile) {
    var imgs = global.getGraffordPageImages(pageFile);
    var source =
      pattern || (imgs && imgs.gallery && imgs.gallery.carouselPattern);
    if (!Array.isArray(source)) {
      return [];
    }
    return source.map(function (entry) {
      return String(entry).replace("{room}", roomPrefix);
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
