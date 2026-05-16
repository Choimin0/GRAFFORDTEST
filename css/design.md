# GRAFFORD — Brand & UI Design Principles

> 이 문서는 새로운 대화에서도 GRAFFORD 홈페이지 디자인의 브랜드 감성을 일관되게 유지하기 위한 참조 문서입니다.

---

## 1. 브랜드 아이덴티티

### 핵심 철학

- **브랜드 컨셉:** "대지에 기댄다 (Leaning on the Earth)"
- **Tone & Manner:** 절제되고 단정하며, 서두르지 않는다. 럭셔리하되 과시하지 않는다.
- **한 줄 무드:** 제주의 느린 시간, 붉은 화산송이 중정, 골든 오크 가구 위로 스미는 오후 빛

### 숙소 물성 (인터랙션과 시각 언어의 모티프 원천)

- **외/내부 인테리어:** 짙은 테라코타 컬러
- **가구:** Golden Oak — 따뜻한 나무결, 빛이 스칠 때 생기는 광택
- **중정:** 붉은 화산송이 바닥, 발이 닿으면 퍼지는 작은 파문
- **욕실/자쿠지:** 테라코타 계열 타일
- **객실마다 중정 보유** — 내부와 외부가 만나는 경계의 감각

---

## 2. 컬러 팔레트 (엄격히 준수)

| Token           | Hex       | 용도                                                                                   |
| :-------------- | :-------- | :------------------------------------------------------------------------------------- |
| `--stone-50`    | `#FAF9F7` | 메인 배경, 카드 배경, 밝은 패널                                                        |
| `--stone-100`   | `#F2EFE9` | 보조 배경, 페이지 배경, 구분 영역                                                      |
| `--stone-200`   | `#E4DDD2` | 보더, 구분선, 비활성 상태, 체크박스                                                    |
| `--stone-400`   | `#A89D8E` | 뮤트 텍스트, 보조 설명, placeholder                                                    |
| `--stone-800`   | `#211E1A` | 메인 텍스트, Primary 버튼 배경                                                         |
| `--stone-900`   | `#0F0D0B` | 내비게이션 바, 호버 딥 액센트, 오버레이                                                |
| `--gold-500`    | `#A8833E` | **유일한 포인트 컬러.** 섹션 eyebrow, 구분 라인 액센트, 인터랙션 하이라이트, 중요 뱃지 |
| `--stone-red`   | `#8c2b21` | 경고 텍스트                                                                            |
| `--stone-green` | `#4a522a` | 위험한 내용은 아니나 이용자가 알아두면 좋은 내용 담는 텍스트                           |

**절대 규칙:**

- 팔레트 외 색상 사용 금지
- `gold-500`은 포인트 전용. 배경 전체에 깔거나 텍스트 본문에 남용하지 않는다
- `gold-dim`(rgba(168,131,62,0.09~0.18))은 gold-500의 배경 틴트 전용으로 허용

---

## 3. 타이포그래피

### 폰트 사용 규칙

| 용도                         | 폰트                             |
| :--------------------------- | :------------------------------- |
| 내비게이션 영문              | `OptimaNovaLTProTitlingInit.otf` |
| 일반 영문 (버튼, 캡션, 본문) | `official-font.otf`              |
| 모든 국문                    | `AstaSans-Medium.ttf`            |

### 타이포 위계 시스템

```
Eyebrow   — 9px / letter-spacing 0.42–0.45em / uppercase / gold-500
           예: "About This Room", "Booking Info", "Option 01"

Heading   — 18–36px / font-weight 300 / letter-spacing 0.06–0.08em / stone-900
           line-height 1.2

Body      — 12–14px / line-height 1.85–1.95 / letter-spacing 0.03–0.05em / stone-800

Muted     — 10–12px / stone-400 / letter-spacing 0.04–0.08em

Caption   — 9–10px / letter-spacing 0.3–0.45em / uppercase / stone-400
```

### 텍스트 원칙

- 본문 `line-height: 1.6` (가독성), 헤드라인 `line-height: 1.2` (임팩트)
- 영문 레이블은 항상 **uppercase + wide letter-spacing**
- 본문 텍스트에 **bold 남용 금지** — 강조는 컬러(stone-900)와 font-weight 500으로 절제

---

## 4. 레이아웃 & 스페이싱

### 스페이싱 스케일 (4px 배수)

`4 / 8 / 12 / 16 / 24 / 28 / 32 / 40 / 48 / 56 / 64 / 80px`

### 기본 여백 원칙

- 콘텐츠 최소 여백: **32px 이상** ("숨을 쉴 수 있는" 공간)
- Desktop 페이지 좌우 패딩: **80px**
- Tablet: **32–40px**, Mobile: **16–24px**
- Max-width: **1440px**, 중앙 정렬

### 그리드

- Desktop: 12-column, gutter 24px
- Mobile: 4-column, gutter 16px
- 2분할 레이아웃 (정보 + 예약 패널)이 기본 페이지 구조

### Corner Radius

- **Primary (0px):** 메인 이미지, CTA 버튼, 카드, 모달 → **Sharp**
- **Soft (4px):** 입력 폼 내부, 모달 컨테이너에만 허용
- **원칙:** 대부분의 UI 요소는 0px. 둥글게 처리하지 않는다

---

## 5. UI 컴포넌트 규칙

### 버튼

**Primary Button**

```
배경: --stone-800
텍스트: --stone-50
border-radius: 0px
호버: 배경 --stone-900 전환
호버 모션: 하단에 gold-500 라인이 왼→오른으로 scaleX(0→1)
화살표(→): 호버 시 translateX(+4px)
transition: 0.45–0.55s cubic-bezier(0.76, 0, 0.24, 1)
```

**Secondary (Ghost) Button**

```
배경: transparent
보더: 1px solid --stone-800
텍스트: --stone-800
호버: background rgba(33,30,26,0.04–0.06)
```

**Danger Ghost Button** (취소, 나가기 등)

```
배경: transparent
보더: 1px solid --stone-200
텍스트: --stone-400
호버: 보더 gold-500 계열, 텍스트 gold-500
→ 경고이되, 강압적이지 않게
```

**비활성(Disabled) 버튼**

```
배경: --stone-200
텍스트: --stone-400
cursor: not-allowed
→ 조건 충족 시 Primary로 애니메이션 전환
```

### 버튼 인터랙션 옵션 (상황에 따라 선택)

1. **골드 그라운드 라인** — 호버 시 배경 stone-900 + 하단 gold 라인 스윕 (기본 권장)
2. **릴 텍스트 교체** — 호버 시 한국어 → 영문으로 롤링 교체 (luxury CTA 전용)
3. **오크 광택 스윕** — 호버 시 gold 빛줄기가 사선으로 통과 (secondary 강조용)
4. **화산송이 리플** — 클릭 시 gold 원이 번짐 (제주 맥락 강조 시)
5. **중정 프레임** — 호버 시 네 모서리 gold L자 라인 확장 (예약 확정 등 의례적 순간)

### 카드

```
배경: --stone-50
보더: 1px solid --stone-200
box-shadow: 없음 (그림자 지양)
border-radius: 0px
상단 이미지 영역: 필수
```

### 입력 필드 (Form Input)

```
배경: transparent
보더: 없음, 하단 border-bottom: 1px solid --stone-200만 사용
포커스: border-bottom --stone-800
포커스 모션: gold-500 언더라인이 scaleX(0→1) 왼→오른
font-size: 14px / color: --stone-900
placeholder: color --stone-200
```

### 섹션 구분

```
Eyebrow 텍스트 (gold-500 uppercase) + 가로 룰(--stone-200)
룰 좌측에 gold-500 accent 28–32px 선 오버레이
```

### 정보 테이블/리스트

```
- key: 9.5–11px / uppercase / letter-spacing 0.2–0.35em / --stone-400
- value: 13–14px / --stone-900 / letter-spacing 0.04em
- 행 구분: 1px solid --stone-200
- box-shadow 없음
```

---

## 6. 모션 & 인터랙션 원칙

### 속도 철학

> "제주의 느린 시간처럼. 빠르지 않게, 그러나 분명하게."

```
일반 트랜지션:  0.30–0.35s ease
버튼 호버:      0.45–0.55s cubic-bezier(0.76, 0, 0.24, 1)
페이지 진입:    0.50–0.75s cubic-bezier(0.76, 0, 0.24, 1)
모달 진입:      0.40s cubic-bezier(0.76, 0, 0.24, 1)
슬라이더 전환:  0.70–0.80s ease
```

### 애니메이션 모티프

- **스윕(Sweep):** 왼쪽에서 오른쪽으로 선이 그어지는 모션 → 브랜드 전반
- **롤(Roll/Reel):** 텍스트가 위로 말려 올라가며 교체 → 고급 CTA
- **블룸(Bloom):** 중심에서 원형으로 퍼지는 리플 → 클릭 피드백
- **슬라이드업(Slide-up):** 숫자/텍스트 교체 시 → 카운터, 수량 변경

### 금지 모션

- 빠른 튀기는 bounce 효과
- 과도한 scale 확대 (1.05 이상)
- 복수 요소의 동시 복잡한 애니메이션

---

## 7. 공간 모티프 시스템

인터랙션 디자인은 숙소의 물성에서 모티프를 가져온다.

| 모티프             | 연결되는 공간/물성                | 사용 맥락                 |
| :----------------- | :-------------------------------- | :------------------------ |
| 골드 그라운드 라인 | 대지 / 지면에서 올라오는 선       | 기본 버튼 호버            |
| 오크 광택 스윕     | 골든 오크 가구에 빛이 스치는 순간 | 보조 버튼, 프로모션 카드  |
| 화산송이 리플      | 중정 화산송이에 발이 닿을 때 파문 | 클릭 피드백, 확인 액션    |
| 중정 프레임        | 창호·문틀의 L자 경계 구조         | 예약 확정, 중요 선택 순간 |
| 세로 쓰기 텍스트   | 한국 전통 건축 편액               | 비주얼 패널 장식 텍스트   |

---

## 8. 페이지별 레이아웃 패턴

### 공통 네비게이션

```
배경: --stone-900 (고정 fixed)
높이: 56px
로고: 좌측, uppercase letter-spacing 0.38em, --stone-50
언어 스위치: KR | EN, --stone-400, 활성만 --stone-50
메뉴: 우측, 10px uppercase letter-spacing 0.32em
현재 페이지: --stone-50, 나머지: --stone-400
```

### 페이지 헤더 밴드

```
배경: --stone-50
하단 보더: 1px solid --stone-200
패딩: 32–40px 80px
좌측: Eyebrow + 제목 + 설명
우측: 현재 예약번호 / 스텝 인디케이터 등
```

### 2분할 레이아웃 (예약 관련 페이지)

```
왼쪽: 콘텐츠/입력 영역 (유동적 너비)
오른쪽: 예약 패널 (고정 400–440px, sticky)
구분: 1px solid --stone-200
```

### 정보 전달 페이지 (예약 조회, 확인)

```
왼쪽: 비주얼 패널 (stone-800 배경, 브랜드 카피)
오른쪽: 폼/정보 패널 (stone-50 배경)
```

### 공통 푸터

```
배경: --stone-900
구성: 브랜드 정보(좌) / 사업자 정보(중) / 엠블럼(우)
엠블럼: 원형 thin border, 내부 "GRAffORD / Ground a Ford"
하단: 저작권 / 이용약관·개인정보처리방침
```

---

## 9. 정보 위계 & 가시성 원칙

### 중요도 3단계

```
Level 1 — 규정 위반/즉시 퇴실 위험
  → gold-500 바(2px) + stone-900 텍스트 + gold-500 뱃지
  → 아코디언 기본 open 상태 권장

Level 2 — 참고 안내 / 일반 정보
  → stone-200 바(2px) + stone-400 텍스트
  → 아코디언 기본 closed

Level 3 — 보조 정보 / muted
  → 별도 구분 없음, stone-400 컬러만 사용
```

### 제한 사항 표시 (취사 불가 등)

```
배경: gold-dim (rgba(168,131,62,0.09))
테두리: 1px solid rgba(168,131,62,0.25)
텍스트: gold-500
크기: 8–9px / letter-spacing 0.15em
→ 괄호 처리 절대 금지. 반드시 별도 뱃지로 분리
```

---

## 10. CTA & 넛지 디자인 원칙

### 결제/예약 흐름에서의 넛지

1. **진행 체크리스트** — 미완료 항목을 stone-200, 완료 시 gold-500으로 시각적 전환
2. **넛지 메시지** — 무엇이 남았는지 구체적으로 안내. gold-500 left-border 박스
3. **CTA 버튼 상태 전환** — disabled(stone-200) → ready(stone-800) 애니메이션
4. **금액 표시** — 결제 버튼 활성화 시 "결제하기" → "672,500원 결제하기"로 금액 표시
5. **보안 안내** — CTA 하단에 자물쇠 아이콘 + "SSL 보안 결제" 표시

### 경고 모달 원칙

```
오버레이: rgba(15,13,11,0.72) + backdrop-filter blur(3px)
경고 바: stone-800→gold-500→stone-800 흐르는 그라데이션 (애니메이션)
아이콘: 중정 프레임 모티프 (네 모서리 gold L자) + ! 글리프
카피: 손실의 실체를 구체적으로 명시
버튼 위계: "머무는 선택" Primary / "나가는 선택" Ghost
힌트 텍스트: 버튼 하단에 결과 명시 ("작성 내용 삭제" 등)
```

---

## 11. 금지 사항 (Do Not)

- `border-radius` 4px 초과 사용 금지 (모달/폼 제외)
- `box-shadow` 사용 금지
- 팔레트 외 색상 사용 금지 (특히 밝은 골드, 흰색에 가까운 크림 등)
- 동등한 가중치의 버튼 2개 나란히 배치 금지 (반드시 위계 부여)
- 제한/주의 사항을 괄호 처리하거나 일반 텍스트로 나열 금지
- 빠른 애니메이션 (0.2s 이하 주요 트랜지션) 금지
- 그라데이션 배경을 UI 카드/버튼에 사용 금지 (경고 바 등 예외적 경우만 허용)
- bold(font-weight 700) 남용 금지 — 강조는 컬러와 500 weight로

---

## 12. 브랜드 카피 & 어조

- **영문 레이블:** 항상 uppercase, wide letter-spacing
- **한국어 본문:** 경어체, 간결하되 차갑지 않게
- **브랜드 태그라인:** "대지가 내어주는 그라운드가 당신을 기다립니다"
- **서브 슬로건:** "Ground · Afford · Jeju"
- **Eyebrow 텍스트 예시:** About This Room / Booking Info / Stay Guide / Guest Info / Reservation Confirmed
- **피해야 할 어조:** 과도한 친근함, 감탄사, 과장된 수식어

---
