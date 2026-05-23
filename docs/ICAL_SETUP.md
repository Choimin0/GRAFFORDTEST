# iCal Integration Setup (GRAFFORD ↔ Airbnb)

> **현재 모드: Cron 없음 (on-demand)**  
> Airbnb iCal은 예약 페이지 조회·결제 시점에 **실시간 fetch**로 반영됩니다.  
> Vercel Cron 이용 가능 시 `vercel.json`에 cron을 추가하면 DB 백업 sync도 활성화할 수 있습니다.

## 1) 지원 기능

### Export (GRAFFORD → Airbnb)

- `GET /api/reservations?ical=1&room=G1&token=TOKEN`
  - 확정 예약 + 관리자 방막기를 `.ics`로 내보냄
  - Airbnb listing → Calendar sync → **Import calendar**에 URL 등록

### Import (Airbnb → GRAFFORD) — 실시간

- `GET /api/reservations?availability=1&room=G1`
  - Airbnb iCal URL을 **요청 시 fetch** (10분 인메모리 캐시)
  - fetch 실패 시 `external_booking` DB fallback (수동 sync 데이터)
- `POST /api/booking-token`, `POST /api/reservations`
  - 결제/예약 확정 시 Airbnb iCal을 **캐시 없이** 재조회 후 차단

### 수동 sync (선택, DB 백업용)

- `GET /api/ical-sync?token=SECRET` — 전체 방
- `GET /api/ical-sync?token=SECRET&room=G1` — 특정 방
  - `external_booking` 테이블에 Airbnb 이벤트 저장
  - **필수 아님** — live fetch가 주력, DB는 fetch 실패 시 fallback

## 2) 환경변수 (Vercel)

### 필수

| 변수 | 설명 |
|------|------|
| `ICAL_EXPORT_TOKEN` | Grafford → Airbnb export URL 보호 |
| `ICAL_IMPORT_URLS_G1` ~ `G4` | Airbnb **Export calendar** URL (방별) |

예시:
```
ICAL_EXPORT_TOKEN=your-random-secret
ICAL_IMPORT_URLS_G1=https://www.airbnb.com/calendar/ical/12345.ics?s=SECRET
ICAL_IMPORT_URLS_G2=https://www.airbnb.com/calendar/ical/67890.ics?s=SECRET
```

### 선택

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `ICAL_SYNC_SECRET` | — | 수동 `/api/ical-sync` 보호 (DB 백업 sync 시) |
| `ICAL_CACHE_TTL_MS` | `600000` (10분) | 캘린더 UI용 fetch 캐시 |
| `ICAL_FETCH_TIMEOUT_MS` | `8000` | Airbnb iCal fetch 타임아웃 |

`ICAL_IMPORT_URLS` (대안): `G1@https://...,G2@https://...` 형식도 지원

## 3) Airbnb 설정

### A. GRAFFORD → Airbnb

각 listing (G1–G4) → Availability → Calendar sync → **Import calendar**:

```
https://YOUR-DOMAIN/api/reservations?ical=1&room=G1&token=YOUR_EXPORT_TOKEN
```

### B. Airbnb → GRAFFORD

각 listing → Calendar sync → **Export calendar** URL 복사 → Vercel env:

```
ICAL_IMPORT_URLS_G1=<Airbnb export URL>
```

### C. (선택) DB 백업 sync

1. Migration 024 실행 (`external_booking` 테이블)
2. `ICAL_SYNC_SECRET` 설정
3. 수동 호출: `/api/ical-sync?token=SECRET`

## 4) 검증 체크리스트

1. `/api/reservations?ical=1&token=TOKEN` → `.ics`에 VEVENT 확인
2. Grafford 테스트 예약 → `.ics`에 반영 확인
3. `ICAL_IMPORT_URLS_G1` 설정 후 예약 페이지 → Airbnb 차단일 표시 확인
4. Airbnb 차단일로 Grafford 예약 시도 → `reason: "external"` 거부 확인
5. Airbnb listing에 Grafford export URL 등록 → Airbnb 쪽 차단 확인 (15–60분 지연 가능)

## 5) 추후 Cron 활성화 (Vercel Pro 이상)

`vercel.json`에 추가:

```json
"crons": [
  { "path": "/api/ical-sync", "schedule": "*/15 * * * *" }
]
```

`CRON_SECRET` 또는 `ICAL_SYNC_SECRET` 설정 필요.

## 6) 알아두어야 할 맹점

| 맹점 | 설명 | 완화 방법 |
|------|------|-----------|
| **양쪽 sync 지연** | iCal은 pull 방식. Airbnb↔Grafford 모두 15–60분+ 지연 | 중요한 날짜는 한쪽에서만 예약 받기, 수동 확인 |
| **Airbnb fetch 실패 시 fail-open** | Airbnb iCal fetch가 실패하면 Grafford 예약이 **통과할 수 있음** (DB fallback 없을 때) | `ICAL_SYNC_SECRET`로 수동 sync + migration 024, 또는 Cron 추후 활성화 |
| **서버리스 캐시 한계** | 10분 캐시는 **같은 Vercel 인스턴스**에서만 유효. cold start 시 재fetch | 결제/예약 확정 시 캐시 없이 재조회 (이미 적용) |
| **게스트 정보 없음** | Airbnb ICS에는 이름·연락처 없음, 날짜만 | 외부 예약은 Grafford admin에 직접 예약으로 안 보임 |
| **방-리스팅 1:1 필수** | G1 export를 G2 listing에 넣으면 교차 차단 | 방별 URL·env 꼭 분리 |
| **Export token 유출** | token 노출 시 예약 현황 노출 | 강한 token, Airbnb import URL에만 사용 |
| **Import URL secret 유출** | Airbnb export URL의 `?s=` 노출 시 타인이 캘린더 조회 가능 | env에만 저장, 코드/로그에 노출 금지 |
| **동시 예약 race** | Grafford 결제 진행 중 Airbnb 예약 들어오면 양쪽 통과 가능 | iCal 한계 — 완벽 방지 불가, 중요 시 수동 모니터링 |

## 7) Troubleshooting

| 증상 | 확인 |
|------|------|
| Grafford 캘린더에 Airbnb 날짜 안 보임 | `ICAL_IMPORT_URLS_G*` env, URL 유효성 |
| Grafford 예약이 Airbnb에 안 막힘 | Airbnb import URL, export token, Airbnb sync 상태 |
| Airbnb 예약인데 Grafford 예약됨 | fetch 실패 여부 (Vercel 로그), DB fallback 데이터 |
| `/api/ical-sync` 401 | `ICAL_SYNC_SECRET` 설정 및 token 일치 |
