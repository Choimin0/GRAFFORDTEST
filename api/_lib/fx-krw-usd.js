/**
 * USD per KRW quote for PayPal (PayPal does not support KRW).
 */

var FALLBACK_KRW_PER_USD = 1400;

async function fetchJson(url, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, timeoutMs || 4000);
  try {
    var res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchKrwPerUsd() {
  var frankfurter = await fetchJson(
    "https://api.frankfurter.app/latest?from=USD&to=KRW",
    4000,
  );
  var frankRate = Number(frankfurter && frankfurter.rates && frankfurter.rates.KRW);
  if (Number.isFinite(frankRate) && frankRate > 0) {
    return frankRate;
  }

  var openEr = await fetchJson("https://open.er-api.com/v6/latest/USD", 4000);
  var openRate = Number(openEr && openEr.rates && openEr.rates.KRW);
  if (Number.isFinite(openRate) && openRate > 0) {
    return openRate;
  }

  return FALLBACK_KRW_PER_USD;
}

export function krwToUsdCents(krwAmount, krwPerUsd) {
  var krw = Number(krwAmount);
  var rate = Number(krwPerUsd);
  if (!Number.isFinite(krw) || krw <= 0 || !Number.isFinite(rate) || rate <= 0) {
    return 0;
  }
  return Math.max(1, Math.round((krw / rate) * 100));
}
