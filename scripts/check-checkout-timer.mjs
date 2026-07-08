import { chromium, devices } from "playwright";
import { createServer } from "http";
import { readFileSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = 8918;
const BASE = `http://127.0.0.1:${PORT}`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".json": "application/json",
};

function startStaticServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      // Fake booking-token API so releaseBookingHold() calls resolve instead of 404-erroring.
      if (urlPath === "/api/booking-token") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          let action = "";
          try {
            action = JSON.parse(body || "{}").action || "";
          } catch (_e) {}
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, action }));
        });
        return;
      }
      const filePath = join(ROOT, urlPath === "/" ? "index.html" : urlPath.slice(1));
      try {
        const data = readFileSync(filePath);
        const ext = extname(filePath);
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
      } catch (_e) {
        res.writeHead(404).end("Not found");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function makeExp(msFromNow) {
  return String(Date.now() + msFromNow);
}

// addInitScript는 해당 page의 이후 모든 내비게이션(리다이렉트 포함)에서 재실행되므로,
// "__testSeeded" 플래그로 최초 1회만 시딩하도록 막아 만료/이탈 후 RESERVATION.html로
// 리다이렉트된 뒤 세션이 다시 채워져 결과가 오염되는 것을 방지한다.
async function seedSession(page, expMs, extra) {
  await page.addInitScript(
    ({ exp, extra }) => {
      if (sessionStorage.getItem("__testSeeded") === "1") {
        return;
      }
      sessionStorage.setItem("__testSeeded", "1");
      sessionStorage.setItem(
        "graffordConfirmDraft",
        JSON.stringify({
          room: "G1",
          checkIn: "2026-08-01",
          checkOut: "2026-08-03",
          extraGuests: "0",
        }),
      );
      sessionStorage.setItem("graffordBookingToken", "test-token");
      sessionStorage.setItem("graffordBookingSessionExp", exp);
      sessionStorage.setItem("graffordCheckoutActive", "1");
      sessionStorage.setItem(
        "graffordPaymentData",
        JSON.stringify({
          room: "G1",
          checkIn: "2026-08-01",
          checkOut: "2026-08-03",
          guestName: "테스트",
          contact: "+821012345678",
          email: "test@example.com",
          bookingToken: "test-token",
        }),
      );
      if (extra) {
        Object.keys(extra).forEach((k) => sessionStorage.setItem(k, extra[k]));
      }
    },
    { exp: expMs, extra: extra || null },
  );
}

async function waitForGuard(page) {
  await page.waitForFunction(() => window.GraffordCheckoutGuard && window.GraffordBookingToken);
  await page.waitForTimeout(200);
}

async function getRemainingSec(page) {
  return page.evaluate(() => {
    const ms = window.GraffordBookingToken.getRemainingMs();
    return ms == null ? null : Math.round(ms / 1000);
  });
}

// ── Test 1: TTL은 confirm -> payment 이동 시 리셋되지 않고 이어져야 함 ──
async function testTtlPersistsAcrossPages(page) {
  await seedSession(page, makeExp(20000));
  await page.goto(`${BASE}/confirm.html`, { waitUntil: "domcontentloaded" });
  await waitForGuard(page);

  const t1 = await getRemainingSec(page);
  await page.waitForTimeout(4000);
  const t1b = await getRemainingSec(page);

  // 실제 confirm→payment 폼 제출 흐름과 동일하게, 이탈로 오인되어
  // booking hold가 drop되지 않도록 allowCheckoutNavigation()을 먼저 호출한다.
  await page.evaluate(() => {
    if (window.GraffordCheckoutGuard) {
      window.GraffordCheckoutGuard.allowCheckoutNavigation();
    }
  });
  await page.goto(`${BASE}/payment.html`, { waitUntil: "domcontentloaded" });
  await waitForGuard(page);
  const t2 = await getRemainingSec(page);

  const expected = t1b; // remaining should carry over, not jump back up
  const diff = Math.abs((t2 ?? -999) - (expected ?? -999));
  const ok = t1 !== null && t2 !== null && t2 < t1 && diff <= 2;

  return {
    ok,
    label: "TTL이 confirm→payment 이동 시 초기화되지 않고 이어짐",
    detail: `confirm 진입 직후=${t1}s, 4초 후=${t1b}s, payment 진입 직후=${t2}s (오차 ${diff}s)`,
  };
}

// ── Test 2: confirm.html에서 15분(테스트에선 단축) 초과 시 팝업 + RESERVATION.html 복귀 + 세션 정리 ──
async function testConfirmExpiryFlow(page) {
  await seedSession(page, makeExp(2500));
  await page.goto(`${BASE}/confirm.html`, { waitUntil: "domcontentloaded" });
  await waitForGuard(page);

  // confirm.html도 payment.html과 동일한 커스텀 오버레이(#confirm-alert-modal)를 사용한다.
  const overlay = page.locator("#confirm-alert-modal");
  await overlay.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  const msgText = await page
    .locator("#confirm-alert-modal-msg")
    .textContent()
    .catch(() => null);
  const visible = await overlay.isVisible().catch(() => false);

  const confirmBtn = page.locator("#confirm-alert-modal-confirm");
  await confirmBtn.click({ timeout: 5000 }).catch(() => {});

  await page.waitForURL(/RESERVATION\.html/i, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);

  const url = page.url();
  const state = await page.evaluate(() => ({
    blocked: sessionStorage.getItem("graffordCheckoutBlocked") === "1",
    token: sessionStorage.getItem("graffordBookingToken"),
    exp: sessionStorage.getItem("graffordBookingSessionExp"),
  }));

  const ok =
    visible &&
    /RESERVATION\.html/i.test(url) &&
    state.blocked &&
    !state.token &&
    !state.exp;

  return {
    ok,
    label: "confirm 페이지 시간 초과 → 팝업 + RESERVATION 복귀 + 세션/타이머 초기화",
    detail: ok
      ? `팝업 표시=${visible}, 메시지="${(msgText || "").trim()}", 이동 후 URL=${url.split("/").pop()}, blocked=${state.blocked}, token=${state.token}, exp=${state.exp}`
      : `visible=${visible}, url=${url}, state=${JSON.stringify(state)}, msg="${msgText}"`,
  };
}

// ── Test 3: payment.html에서 시간 초과 시 커스텀 팝업(overlay) + 확인 클릭 → RESERVATION.html + 세션 정리 ──
async function testPaymentExpiryFlow(page) {
  await seedSession(page, makeExp(2500));
  await page.goto(`${BASE}/payment.html`, { waitUntil: "domcontentloaded" });
  await waitForGuard(page);

  const overlay = page.locator("#payment-alert-modal");
  await overlay.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  const msgText = await page
    .locator("#payment-alert-modal-msg")
    .textContent()
    .catch(() => null);
  const visible = await overlay.isVisible().catch(() => false);

  const confirmBtn = page.locator("#payment-alert-modal-confirm");
  await confirmBtn.click({ timeout: 5000 }).catch(() => {});

  await page.waitForURL(/RESERVATION\.html/i, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);

  const url = page.url();
  const state = await page.evaluate(() => ({
    blocked: sessionStorage.getItem("graffordCheckoutBlocked") === "1",
    token: sessionStorage.getItem("graffordBookingToken"),
    exp: sessionStorage.getItem("graffordBookingSessionExp"),
  }));

  const ok =
    visible &&
    /RESERVATION\.html/i.test(url) &&
    state.blocked &&
    !state.token &&
    !state.exp;

  return {
    ok,
    label: "payment 페이지 시간 초과 → 커스텀 팝업 + RESERVATION 복귀 + 세션/타이머 초기화",
    detail: ok
      ? `팝업 표시=${visible}, 메시지="${(msgText || "").trim()}", 이동 후 URL=${url.split("/").pop()}, blocked=${state.blocked}`
      : `visible=${visible}, url=${url}, state=${JSON.stringify(state)}, msg="${msgText}"`,
  };
}

// ── Test 4: 새로고침(하드 리로드에 준하는 reload 내비게이션) 시 세션 드롭 + RESERVATION.html 복귀 ──
async function testReloadAbandonsCheckout(page, targetPath) {
  await seedSession(page, makeExp(600000)); // 아직 만료 전(10분 남음) 세션인데도 reload 시 드롭되어야 함
  await page.goto(`${BASE}/${targetPath}`, { waitUntil: "domcontentloaded" });
  await waitForGuard(page);

  const releaseCalls = [];
  await page.route("**/api/booking-token", async (route) => {
    const body = route.request().postDataJSON?.() || {};
    releaseCalls.push(body.action);
    await route.continue();
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForURL(/RESERVATION\.html/i, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);

  const url = page.url();
  const state = await page.evaluate(() => ({
    blocked: sessionStorage.getItem("graffordCheckoutBlocked") === "1",
    active: sessionStorage.getItem("graffordCheckoutActive"),
    token: sessionStorage.getItem("graffordBookingToken"),
    exp: sessionStorage.getItem("graffordBookingSessionExp"),
  }));

  const ok =
    /RESERVATION\.html/i.test(url) &&
    state.blocked &&
    !state.active &&
    !state.token &&
    !state.exp &&
    releaseCalls.includes("release");

  return {
    ok,
    label: `${targetPath} 새로고침(reload) 시 booking hold drop + time left 초기화 + RESERVATION 복귀`,
    detail: ok
      ? `url=${url.split("/").pop()}, state=${JSON.stringify(state)}, release API 호출=${releaseCalls.includes("release")}`
      : `url=${url}, state=${JSON.stringify(state)}, releaseCalls=${JSON.stringify(releaseCalls)}`,
  };
}

// ── Test 6: Cmd+Shift+R(강력 새로고침)나 탭 닫기 시 네이티브 "떠나시겠습니까?" 프롬프트가
// 뜨도록 beforeunload가 실제로 preventDefault/returnValue를 세팅하는지 확인.
// (브라우저가 실제 다이얼로그 UI를 띄우는지는 자동화 환경에서 신뢰성 있게 관측할 수 없으므로,
//  가드가 이벤트를 가로채 "이탈을 막으려는 의도"를 표시하는지로 검증한다.)
async function testBeforeUnloadPromptWired(page, targetPath) {
  await seedSession(page, makeExp(600000));
  await page.goto(`${BASE}/${targetPath}`, { waitUntil: "domcontentloaded" });
  await waitForGuard(page);

  const preventedWhileActive = await page.evaluate(() => {
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented || ev.returnValue === "";
  });

  await page.evaluate(() => {
    window.GraffordCheckoutGuard.allowCheckoutNavigation();
  });
  const preventedAfterAllow = await page.evaluate(() => {
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  });

  const ok = preventedWhileActive === true && preventedAfterAllow === false;

  return {
    ok,
    label: `${targetPath} 새로고침/탭 닫기 시 네이티브 이탈 확인 프롬프트 연결`,
    detail: ok
      ? `체크아웃 진행 중 beforeunload 차단=${preventedWhileActive}, 정상 이동 허용 후 차단 해제=${!preventedAfterAllow}`
      : `preventedWhileActive=${preventedWhileActive}, preventedAfterAllow=${preventedAfterAllow}`,
  };
}

async function runProfile(browser, profileName, viewport, isMobile) {
  const context = await browser.newContext({ ...viewport, isMobile, hasTouch: isMobile });
  const results = [];

  {
    const page = await context.newPage();
    results.push(await testTtlPersistsAcrossPages(page));
    await page.close();
  }
  {
    const page = await context.newPage();
    results.push(await testConfirmExpiryFlow(page));
    await page.close();
  }
  {
    const page = await context.newPage();
    results.push(await testPaymentExpiryFlow(page));
    await page.close();
  }
  {
    const page = await context.newPage();
    results.push(await testReloadAbandonsCheckout(page, "confirm.html"));
    await page.close();
  }
  {
    const page = await context.newPage();
    results.push(await testReloadAbandonsCheckout(page, "payment.html"));
    await page.close();
  }
  {
    const page = await context.newPage();
    results.push(await testBeforeUnloadPromptWired(page, "confirm.html"));
    await page.close();
  }
  {
    const page = await context.newPage();
    results.push(await testBeforeUnloadPromptWired(page, "payment.html"));
    await page.close();
  }

  await context.close();
  return { profileName, results };
}

async function main() {
  const server = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const profiles = [];

  try {
    profiles.push(
      await runProfile(browser, "PC Desktop", { viewport: { width: 1440, height: 900 } }, false),
    );
    profiles.push(
      await runProfile(browser, "Mobile (iPhone 13)", devices["iPhone 13"], true),
    );
  } finally {
    await browser.close();
    server.close();
  }

  let pass = 0;
  let fail = 0;

  console.log("\n=== Checkout Timer / 만료 흐름 점검 결과 ===\n");
  for (const profile of profiles) {
    console.log(`[${profile.profileName}]`);
    for (const r of profile.results) {
      const mark = r.ok ? "PASS" : "FAIL";
      if (r.ok) pass += 1;
      else fail += 1;
      console.log(`  ${mark}  ${r.label}`);
      console.log(`        ${r.detail}`);
    }
    console.log("");
  }

  console.log(`총 ${pass + fail}건 — PASS ${pass}, FAIL ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
