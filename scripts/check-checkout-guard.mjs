import { chromium, devices } from "playwright";
import { createServer } from "http";
import { readFileSync, statSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = 8917;
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

function futureExp() {
  return String(Date.now() + 60 * 60 * 1000);
}

async function seedCheckoutSession(page, kind) {
  await page.addInitScript(({ exp, kind }) => {
    if (sessionStorage.getItem("__graffordTestSeeded") === "1") {
      return;
    }
    sessionStorage.clear();
    sessionStorage.setItem("__graffordTestSeeded", "1");
    if (kind === "confirm") {
      sessionStorage.setItem("graffordConfirmDraft", JSON.stringify({
        room: "G1",
        checkIn: "2026-08-01",
        checkOut: "2026-08-03",
        extraGuests: "0",
      }));
    } else {
      sessionStorage.setItem("graffordPaymentData", JSON.stringify({
        room: "G1",
        checkIn: "2026-08-01",
        checkOut: "2026-08-03",
        guestName: "테스트",
        contact: "+821012345678",
        email: "test@example.com",
        bookingToken: "test-token",
      }));
    }
    sessionStorage.setItem("graffordBookingToken", "test-token");
    sessionStorage.setItem("graffordBookingSessionExp", exp);
    sessionStorage.setItem("graffordCheckoutActive", "1");
  }, { exp: futureExp(), kind });
}

async function waitForGuard(page) {
  await page.waitForFunction(() => window.__graffordCheckoutGuardReady === true);
  await page.waitForTimeout(200);
}

async function openCheckoutPage(page, targetPath) {
  await page.goto(`${BASE}/RESERVATION.html`, { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/${targetPath}`, { waitUntil: "domcontentloaded" });
  await waitForGuard(page);
}

function overlaySelector(pageName) {
  return pageName === "confirm"
    ? "#confirm-leave-overlay.is-visible, #confirm-leave-overlay-en.is-visible"
    : "#checkout-leave-overlay.is-visible";
}

function leaveButtonSelector(pageName) {
  return pageName === "confirm"
    ? "#confirm-leave-confirm, #confirm-leave-confirm-en"
    : "#checkout-leave-confirm";
}

async function assertOverlayVisible(page, pageName, label) {
  const sel = overlaySelector(pageName);
  const visible = await page.locator(sel).first().isVisible().catch(() => false);
  return { ok: visible, label, detail: visible ? "오버레이 표시됨" : "오버레이 미표시" };
}

async function testLinkLeavePopup(page, pageName, targetPath) {
  await openCheckoutPage(page, targetPath);

  const navLink = page.locator('a[href="index.html"]').first();
  await navLink.click({ timeout: 5000 }).catch(() => {});

  await page.waitForTimeout(400);
  return assertOverlayVisible(page, pageName, `${pageName} 링크 클릭 이탈 팝업`);
}

async function testBackLeavePopup(page, pageName, targetPath) {
  await openCheckoutPage(page, targetPath);

  await page.goBack();
  await page.waitForTimeout(600);

  const onCheckout = /\/(confirm|payment)\.html/i.test(page.url());
  const overlayVisible = await page.locator(overlaySelector(pageName)).first().isVisible().catch(() => false);
  const ok = onCheckout && overlayVisible;
  return {
    ok,
    label: `${pageName} 뒤로가기 이탈 팝업`,
    detail: ok
      ? `confirm/payment 페이지 유지 + 오버레이 표시 (${page.url().split("/").pop()})`
      : `url=${page.url()}, overlay=${overlayVisible}`,
  };
}

async function testLeaveAndBackBlock(page, pageName, targetPath) {
  await openCheckoutPage(page, targetPath);

  await page.locator('a[href="index.html"]').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForSelector(overlaySelector(pageName), { state: "visible", timeout: 5000 }).catch(() => {});

  const leaveBtn = page.locator(leaveButtonSelector(pageName)).first();
  if (!(await leaveBtn.isVisible().catch(() => false))) {
    return {
      ok: false,
      label: `${pageName} 나가기 후 confirm/payment 재진입 차단`,
      detail: "나가기 버튼/오버레이 미표시",
    };
  }
  await leaveBtn.click({ timeout: 5000 });

  await page.waitForTimeout(1200);

  const afterLeave = await page.evaluate(() => ({
    url: location.href,
    blocked: sessionStorage.getItem("graffordCheckoutBlocked"),
    sealBack: sessionStorage.getItem("graffordCheckoutSealBack"),
  }));

  await page.goBack();
  await page.waitForTimeout(700);

  const afterBackUrl = page.url();
  const blockedReentry = !/\/(confirm|payment)\.html/i.test(afterBackUrl);

  const ok =
    afterLeave.blocked === "1" &&
    afterLeave.sealBack === "1" &&
    blockedReentry;

  return {
    ok,
    label: `${pageName} 나가기 후 confirm/payment 재진입 차단`,
    detail: ok
      ? `seal 적용, 이탈=${afterLeave.url.split("/").pop()}, 뒤로가기=${afterBackUrl.split("/").pop()}`
      : `seal=${JSON.stringify(afterLeave)}, 뒤로가기=${afterBackUrl}`,
  };
}

async function testDirectBlockedReentry(page, pageName, targetPath) {
  const context = page.context();
  const blockedPage = await context.newPage();
  await blockedPage.addInitScript(() => {
    sessionStorage.clear();
    sessionStorage.setItem("graffordCheckoutBlocked", "1");
    sessionStorage.setItem("graffordCheckoutSealBack", "1");
  });
  await blockedPage.goto(`${BASE}/${targetPath}`, { waitUntil: "domcontentloaded" });
  await blockedPage.waitForTimeout(700);

  const url = blockedPage.url();
  const ok = /RESERVATION\.html/i.test(url);
  await blockedPage.close();
  return {
    ok,
    label: `${pageName} seal 상태 직접 재진입 차단`,
    detail: ok ? "RESERVATION.html로 리다이렉트됨" : `현재 URL: ${url}`,
  };
}

async function runSingleTest(browser, viewport, isMobile, fn) {
  const context = await browser.newContext({
    ...viewport,
    isMobile,
    hasTouch: isMobile,
  });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

async function testReloadAbandon(page, pageName, targetPath) {
  await openCheckoutPage(page, targetPath);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  const url = page.url();
  const ok = /RESERVATION\.html/i.test(url);
  return {
    ok,
    label: `${pageName} 새로고침 시 RESERVATION 이동`,
    detail: ok ? "RESERVATION.html로 이동됨" : `현재 URL: ${url}`,
  };
}

async function allowNavToPayment(page) {
  await page.evaluate(() => {
    if (window.GraffordCheckoutGuard) {
      window.GraffordCheckoutGuard.allowCheckoutNavigation();
    }
    sessionStorage.setItem("graffordInPaymentFlow", "1");
  });
}

async function testPaymentBackToConfirm(page) {
  await seedCheckoutSession(page, "payment");
  await page.goto(`${BASE}/RESERVATION.html`, { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/confirm.html`, { waitUntil: "domcontentloaded" });
  await waitForGuard(page);
  await allowNavToPayment(page);
  await page.goto(`${BASE}/payment.html`, { waitUntil: "domcontentloaded" });
  await waitForGuard(page);

  await page.goBack();
  await page.waitForTimeout(700);

  const url = page.url();
  const ok = /confirm\.html/i.test(url);
  return {
    ok,
    label: "payment → confirm 뒤로가기 허용",
    detail: ok ? "confirm.html로 이동됨" : `현재 URL: ${url}`,
  };
}

async function testConfirmCannotReturnToPayment(page) {
  await seedCheckoutSession(page, "confirm");
  await page.goto(`${BASE}/RESERVATION.html`, { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/confirm.html`, { waitUntil: "domcontentloaded" });
  await waitForGuard(page);
  await allowNavToPayment(page);
  await page.goto(`${BASE}/payment.html`, { waitUntil: "domcontentloaded" });
  await waitForGuard(page);
  await page.goBack();
  await page.waitForTimeout(700);
  await waitForGuard(page);

  await page.goBack();
  await page.waitForTimeout(700);

  const url = page.url();
  const overlayVisible = await page
    .locator("#confirm-leave-overlay.is-visible, #confirm-leave-overlay-en.is-visible")
    .first()
    .isVisible()
    .catch(() => false);
  const ok = /confirm\.html/i.test(url) && overlayVisible && !/payment\.html/i.test(url);
  return {
    ok,
    label: "confirm → payment 뒤로가기 차단",
    detail: ok
      ? "confirm 유지 + 이탈 팝업 표시"
      : `url=${url}, overlay=${overlayVisible}`,
  };
}

async function testForwardToPaymentBlocked(page) {
  await seedCheckoutSession(page, "confirm");
  await page.goto(`${BASE}/RESERVATION.html`, { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/confirm.html`, { waitUntil: "domcontentloaded" });
  await waitForGuard(page);
  await allowNavToPayment(page);
  await page.goto(`${BASE}/payment.html`, { waitUntil: "domcontentloaded" });
  await waitForGuard(page);
  await page.goBack();
  await page.waitForTimeout(700);
  await waitForGuard(page);

  await page.goForward();
  await page.waitForTimeout(700);

  const url = page.url();
  const ok = /confirm\.html/i.test(url) && !/\/payment\.html/i.test(url);
  return {
    ok,
    label: "confirm → payment 앞으로가기 차단",
    detail: ok ? "confirm 유지" : `현재 URL: ${url}`,
  };
}

async function runProfile(browser, profileName, viewport, isMobile) {
  const results = [];

  for (const target of [
    { pageName: "confirm", path: "confirm.html" },
    { pageName: "payment", path: "payment.html" },
  ]) {
    results.push(
      await runSingleTest(browser, viewport, isMobile, async (page) => {
        await seedCheckoutSession(page, target.pageName);
        return testLinkLeavePopup(page, target.pageName, target.path);
      }),
    );
    results.push(
      await runSingleTest(browser, viewport, isMobile, async (page) => {
        await seedCheckoutSession(page, target.pageName);
        return testBackLeavePopup(page, target.pageName, target.path);
      }),
    );
    results.push(
      await runSingleTest(browser, viewport, isMobile, async (page) => {
        await seedCheckoutSession(page, target.pageName);
        return testLeaveAndBackBlock(page, target.pageName, target.path);
      }),
    );
    results.push(
      await runSingleTest(browser, viewport, isMobile, async (page) => {
        await seedCheckoutSession(page, target.pageName);
        return testDirectBlockedReentry(page, target.pageName, target.path);
      }),
    );
    results.push(
      await runSingleTest(browser, viewport, isMobile, async (page) => {
        await seedCheckoutSession(page, target.pageName);
        return testReloadAbandon(page, target.pageName, target.path);
      }),
    );
  }

  results.push(
    await runSingleTest(browser, viewport, isMobile, async (page) => {
      return testPaymentBackToConfirm(page);
    }),
  );
  results.push(
    await runSingleTest(browser, viewport, isMobile, async (page) => {
      return testConfirmCannotReturnToPayment(page);
    }),
  );
  results.push(
    await runSingleTest(browser, viewport, isMobile, async (page) => {
      return testForwardToPaymentBlocked(page);
    }),
  );

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
      await runProfile(
        browser,
        "Mobile (iPhone 13)",
        devices["iPhone 13"],
        true,
      ),
    );
    profiles.push(
      await runProfile(
        browser,
        "Mobile (Pixel 7)",
        devices["Pixel 7"],
        true,
      ),
    );
  } finally {
    await browser.close();
    server.close();
  }

  let pass = 0;
  let fail = 0;

  console.log("\n=== Checkout Guard 점검 결과 ===\n");
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
