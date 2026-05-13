# GRAFFORD Design System & UI Guidelines (v2.0)

## 1. Brand Identity & Design Philosophy

- **Concept:** "Leaning on the Earth" (대지에 기댄다) — 불편함을 정제하여 고요하고 단단한 감성적 경험으로 승화.
- **Tone & Manner:** Minimalist, sophisticated, muted, and earthy.
- **Visual Goal:** 중성적인 샌드 베이지와 흙의 질감을 고유의 타이포그래피와 결합.

## 2. Typography System

폰트 파일 적용 우선순위 및 용도:

- **Navigation (EN):** `OptimaNovaLTProTitlingInit.otf`
  - 대문자 위주의 우아하고 클래식한 내비게이션 바 전용.
- **General English (EN):** `official-font.otf`
  - 본문 영문, 버튼, 캡션 등 전반적인 영문 텍스트.
- **Korean (KR):** `AstaSans-Medium.ttf`
  - 가독성과 현대적 미감을 살린 모든 국문 텍스트.

## 3. Core Color Palette

| Token         | Hex       | Usage                             |
| :------------ | :-------- | :-------------------------------- |
| `--stone-50`  | `#FAF9F7` | 메인 배경, 밝은 패널              |
| `--stone-100` | `#F2EFE9` | 보조 배경, 구분 영역              |
| `--stone-200` | `#E4DDD2` | 보더(Border), 구분선, 비활성 상태 |
| `--stone-400` | `#A89D8E` | 뮤트 텍스트, 보조 아이콘          |
| `--stone-800` | `#211E1A` | 메인 텍스트, 주요 버튼            |
| `--stone-900` | `#0F0D0B` | 내비게이션 바, 딥 액센트          |
| `--gold-500`  | `#A8833E` | 브랜드 스토리텔링 하이라이트      |

## 4. Layout & Spacing Philosophy

- **Spacing Scale:** 4px 배수 시스템 사용. (4, 8, 16, 24, 32, 48, 64, 80px)
- **Safe Zone:** 컨텐츠가 "숨을 쉴 수 있도록" 최소 32px 이상의 여백을 기본으로 함.
- **Grid System:** - **Desktop:** 12-Column (Gutter: 24px)
  - **Mobile:** 4-Column (Gutter: 16px)
- **Corner Radius (Border-radius):**
  - **Sharp (0px):** 메인 이미지 카드, 메인 버튼 (강인하고 단단한 이미지).
  - **Soft (4px):** 모달 창, 입력 폼 필드 (사용자 편의성).

## 5. Responsive & Breakpoints

- **Mobile:** `~ 767px` (Side margin: 16px)
- **Tablet:** `768px ~ 1199px` (Side margin: 32px)
- **Desktop:** `1200px ~` (Max-width: 1440px)

## 6. UI Components

- **Buttons:** - **Primary:** `--stone-800` 배경 / `--stone-50` 텍스트. Radius: 0px.
  - **Secondary:** Transparent / `--stone-800` Border & Text.
- **Cards:** - 그림자 지양, `--stone-200` 실선 보더 사용. 상단에 여유로운 이미지 배치 필수.
- **Line Height:** - 본문: `1.6` (가독성 위주) / 헤드라인: `1.2` (임팩트 위주).
