<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GRAFFORD — Footer</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&display=swap');

:root {
--stone-50: #FAF9F7;
--stone-100: #F2EFE9;
--stone-200: #E4DDD2;
--stone-400: #A89D8E;
--stone-800: #211E1A;
--stone-900: #0F0D0B;
--gold-500: #A8833E;
}

_, _::before, \*::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
background: var(--stone-100);
display: flex;
align-items: flex-end;
min-height: 100vh;
font-family: 'AstaSans-Medium', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
}

/_ ── Footer Shell ── _/
footer {
width: 100%;
background: var(--stone-900);
color: var(--stone-400);
padding: 64px 64px 48px;
position: relative;
overflow: hidden;
}

/_ subtle texture overlay _/
footer::before {
content: '';
position: absolute;
inset: 0;
background-image:
repeating-linear-gradient(
90deg,
transparent,
transparent 79px,
rgba(164,152,138,0.04) 79px,
rgba(164,152,138,0.04) 80px
);
pointer-events: none;
}

/_ ── Top rule ── _/
.footer-rule {
width: 100%;
height: 0.5px;
background: var(--stone-800);
margin-bottom: 56px;
}

/_ ── Main grid ── _/
.footer-grid {
display: grid;
grid-template-columns: 1fr 1px 1fr 1px auto;
gap: 0 48px;
align-items: start;
position: relative;
z-index: 1;
}

.divider-v {
width: 0.5px;
background: var(--stone-800);
align-self: stretch;
}

/_ ── Col A: Brand ── _/
.col-brand {}

.brand-wordmark {
font-family: 'IM Fell English', serif;
font-size: 28px;
letter-spacing: 0.12em;
color: var(--stone-50);
text-transform: uppercase;
line-height: 1;
margin-bottom: 16px;
display: block;
}

.brand-sub {
font-size: 10px;
letter-spacing: 0.22em;
text-transform: uppercase;
color: var(--stone-400);
line-height: 1;
margin-bottom: 32px;
display: block;
}

.instagram-link {
display: inline-flex;
align-items: center;
gap: 8px;
text-decoration: none;
color: var(--stone-400);
font-size: 11px;
letter-spacing: 0.14em;
text-transform: uppercase;
transition: color 0.3s ease;
border-bottom: 0.5px solid var(--stone-800);
padding-bottom: 10px;
}

.instagram-link:hover { color: var(--stone-50); }
.instagram-link:hover .ig-icon { stroke: var(--stone-50); }

.ig-icon {
width: 16px;
height: 16px;
stroke: var(--stone-400);
fill: none;
stroke-width: 1.5;
stroke-linecap: round;
stroke-linejoin: round;
transition: stroke 0.3s ease;
flex-shrink: 0;
}

/_ ── Col B: Business info ── _/
.col-info {}

.info-table {
display: grid;
grid-template-columns: auto 1fr;
gap: 10px 20px;
font-size: 11px;
line-height: 1.5;
}

.info-label {
color: var(--stone-400);
opacity: 0.6;
letter-spacing: 0.08em;
white-space: nowrap;
font-size: 10px;
padding-top: 1px;
}

.info-value {
color: var(--stone-400);
letter-spacing: 0.02em;
}

/_ ── Col C: Logo badge ── _/
.col-logo {
display: flex;
flex-direction: column;
align-items: center;
justify-content: center;
gap: 0;
}

.logo-circle {
width: 88px;
height: 88px;
border-radius: 50%;
border: 0.5px solid var(--stone-800);
display: flex;
align-items: center;
justify-content: center;
position: relative;
transition: border-color 0.3s;
}

.logo-circle:hover { border-color: var(--stone-400); }

/_ circular text path _/
.logo-circle svg {
position: absolute;
inset: 0;
width: 100%;
height: 100%;
}

.logo-circle-inner {
font-family: 'IM Fell English', serif;
font-size: 11px;
letter-spacing: 0.06em;
color: var(--stone-50);
text-align: center;
line-height: 1.2;
z-index: 1;
position: relative;
}

.logo-circle-sub {
font-size: 7px;
letter-spacing: 0.18em;
text-transform: uppercase;
color: var(--stone-400);
opacity: 0.7;
display: block;
}

/_ ── Bottom bar ── _/
.footer-bottom {
margin-top: 56px;
padding-top: 20px;
border-top: 0.5px solid var(--stone-800);
display: flex;
align-items: center;
justify-content: space-between;
position: relative;
z-index: 1;
}

.footer-copy {
font-size: 10px;
letter-spacing: 0.12em;
text-transform: uppercase;
color: var(--stone-400);
opacity: 0.5;
}

.footer-links {
display: flex;
gap: 28px;
}

.footer-links a {
font-size: 10px;
letter-spacing: 0.1em;
text-transform: uppercase;
text-decoration: none;
color: var(--stone-400);
opacity: 0.6;
transition: opacity 0.25s;
position: relative;
}

.footer-links a::after {
content: '';
position: absolute;
left: 0;
bottom: -3px;
width: 0;
height: 0.5px;
background: var(--stone-400);
transition: width 0.3s ease;
}

.footer-links a:hover { opacity: 1; }
.footer-links a:hover::after { width: 100%; }

/_ ── gold accent line at very bottom ── _/
.footer-gold-bar {
position: absolute;
bottom: 0;
left: 64px;
right: 64px;
height: 1px;
background: linear-gradient(
90deg,
transparent 0%,
var(--gold-500) 30%,
var(--gold-500) 70%,
transparent 100%
);
opacity: 0.35;
}

/_ ── Mobile ── _/
@media (max-width: 767px) {
footer { padding: 48px 20px 40px; }

    .footer-grid {
      grid-template-columns: 1fr;
      gap: 40px 0;
    }

    .divider-v { display: none; }

    .col-logo {
      flex-direction: row;
      justify-content: flex-start;
      gap: 20px;
    }

    .footer-bottom {
      flex-direction: column;
      align-items: flex-start;
      gap: 16px;
    }

    .footer-gold-bar { left: 20px; right: 20px; }

}

/_ ── Tablet ── _/
@media (min-width: 768px) and (max-width: 1199px) {
footer { padding: 56px 40px 44px; }

    .footer-grid {
      grid-template-columns: 1fr 1px 1fr;
      gap: 0 40px;
    }

    .footer-grid .divider-v:last-of-type,
    .footer-grid .col-logo { display: none; }

    .footer-gold-bar { left: 40px; right: 40px; }

}
</style>

</head>
<body>

<footer>
  <div class="footer-rule"></div>

  <div class="footer-grid">

    <!-- A: Brand -->
    <div class="col-brand">
      <span class="brand-wordmark">GRAffORD</span>
      <span class="brand-sub">Ground Aford · Jeju</span>

      <a class="instagram-link" href="https://www.instagram.com/grafford_official" target="_blank" rel="noopener noreferrer">
        <!-- Instagram SVG icon -->
        <svg class="ig-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
          <circle cx="12" cy="12" r="4"/>
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
        </svg>
        Instagram
      </a>
    </div>

    <div class="divider-v"></div>

    <!-- B: Business info -->
    <div class="col-info">
      <div class="info-table">
        <span class="info-label">대표</span>
        <span class="info-value">GRAFFORD</span>

        <span class="info-label">주소</span>
        <span class="info-value">제주특별자치도 서귀포시 토산중앙로 22</span>

        <span class="info-label">사업자</span>
        <span class="info-value">587-23-00957</span>

        <span class="info-label">전화</span>
        <span class="info-value">010-6830-1105</span>

        <span class="info-label">이메일</span>
        <span class="info-value">tilkoas35@naver.com</span>
      </div>
    </div>

    <div class="divider-v"></div>

    <!-- C: Logo badge -->
    <div class="col-logo">
      <div class="logo-circle">
        <!-- circular text -->
        <svg viewBox="0 0 88 88" aria-hidden="true">
          <defs>
            <path id="circ" d="M 44,44 m -32,0 a 32,32 0 1,1 64,0 a 32,32 0 1,1 -64,0"/>
          </defs>
          <text font-size="7" fill="#A89D8E" letter-spacing="3.2" font-family="'IM Fell English', serif">
            <textPath href="#circ" startOffset="0%">GRAFFORD · GROUND AFORD · JEJU ·</textPath>
          </text>
        </svg>
        <div class="logo-circle-inner">
          GR<br>
          <span class="logo-circle-sub">est. 2026</span>
        </div>
      </div>
    </div>

  </div>

  <!-- Bottom bar -->
  <div class="footer-bottom">
    <span class="footer-copy">© 2026 GRAFFORD</span>
    <div class="footer-links">
      <a href="#">이용약관</a>
      <a href="#">개인정보 처리방침</a>
    </div>
  </div>

  <div class="footer-gold-bar"></div>
</footer>

</body>
</html>
