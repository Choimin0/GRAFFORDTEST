# -*- coding: utf-8 -*-
"""Write confirm.html and payment.html as UTF-8."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Korean strings as Python unicode escapes (ASCII-safe source)
T = {
    "title_confirm": "\uacb0\uc81c\ud558\uae30 - GRAFFORD",
    "home_aria": "\ud648\uc73c\ub85c \uc774\ub3d9",
    "h1_pay": "\uacb0\uc81c\ud558\uae30",
    "sec_booking": "\uc608\uc57d \uc815\ubcf4",
    "sec_guest": "\uc608\uc57d\uc790 \uc815\ubcf4",
    "guest_note": (
        "\uc608\uc57d \ud655\uc815 \ubc0f \uc548\ub0b4\ub97c \uc704\ud574 \uc815\ud655\ud55c \uc774\ub984\uacfc \uc5f0\ub77d \uac00\ub2a5\ud55c \ubc88\ud638\ub97c "
        "\uc785\ub825\ud574 \uc8fc\uc138\uc694. \uc785\ub825\ud558\uc2e0 \uc815\ubcf4\ub294 \uc608\uc57d \ucc98\ub9ac\xb7\uace0\uac1d \uc751\ub300 \ubaa9\uc801\uc73c\ub85c\ub9cc "
        "\uc0ac\uc6a9\ub418\uba70, \uacb0\uc81c \uc644\ub8cc \ud6c4 \ubcc0\uacbd\uc740 \uace0\uac1d\uc13c\ud130\ub85c \ubb38\uc758\ud574 \uc8fc\uc138\uc694."
    ),
    "label_name": "\uc774\ub984",
    "ph_name": "\ud64d\uae38\ub3d9",
    "label_contact": "\uc5f0\ub77d\ucc98",
    "sec_total": "\ucd5c\uc885 \uae08\uc561",
    "total_label": "\ud569\uacc4",
    "sec_pay": "\uacb0\uc81c \uc218\ub2e8",
    "pay_legend": "\uacb0\uc81c \uc218\ub2e8 \uc120\ud0dd",
    "pay_card": "\uc2e0\uc6a9\uce74\ub4dc",
    "pay_naver": "\ub124\uc774\ubc84\ud398\uc774",
    "pay_bank": "\ubb34\ud1b5\uc7a5\uc785\uae08",
    "sec_agree": "\uc804\uccb4 \ub3d9\uc758",
    "agree_all": "\uc804\uccb4 \ub3d9\uc758",
    "agree_priv": "(\ud544\uc218) \uac1c\uc778\uc815\ubcf4 \uc218\uc9d1 \ubc0f \uc774\uc6a9 \ub3d9\uc758",
    "agree_buy": "(\ud544\uc218) \uad6c\ub9e4\uc870\uac74 \ud655\uc778 \ubc0f \uacb0\uc81c \uc9c4\ud589 \ub3d9\uc758",
    "btn_pay": "\uacb0\uc81c\ud558\uae30",
    "back_link": "\uc608\uc57d\uc73c\ub85c \ub3cc\uc544\uac00\uae30",
    "title_payment": "\uacb0\uc81c \uc9c4\ud589 - GRAFFORD",
    "h1_payment": "\uacb0\uc81c \uc9c4\ud589",
    "payment_note": (
        "\uc2e4\uc81c \uacb0\uc81c \ubaa8\ub4c8\uc744 \uc5f0\uacb0\ud558\uae30 \uc804 \ub2e8\uacc4\uc758 \ub370\ubaa8 \ud398\uc774\uc9c0\uc785\ub2c8\ub2e4. "
        "\uc774\uc804 \ud654\uba74\uc5d0\uc11c \uc804\ub2ec\ub41c \uc608\uc57d\xb7\uacb0\uc81c \uc815\ubcf4\ub294 \uc8fc\uc18c\uc904\uc758 \ucffc\ub9ac \ubb38\uc790\uc5f4\uc5d0\uc11c \ud655\uc778\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4."
    ),
    "nav_res": "\uc608\uc57d\uc73c\ub85c",
    "nav_rooms": "\uac1d\uc2e4 \uc548\ub0b4",
}

SCRIPT = """
    <script>
      document.addEventListener("DOMContentLoaded", function () {
        var ROOM_NIGHTLY = { A: 200000, B: 200000, C: 300000, D: 500000 };
        var ROOM_LABEL = {
          A: "\uac1d\uc2e4 A",
          B: "\uac1d\uc2e4 B",
          C: "\uac1d\uc2e4 C",
          D: "\uac1d\uc2e4 D",
        };

        var params = new URLSearchParams(window.location.search);
        var roomRaw = (params.get("room") || "A").toUpperCase();
        if (!ROOM_NIGHTLY.hasOwnProperty(roomRaw)) {
          roomRaw = "A";
        }
        var checkIn = params.get("checkIn") || "";
        var checkOut = params.get("checkOut") || "";

        function parseYMD(s) {
          if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            return null;
          }
          var p = s.split("-").map(Number);
          return new Date(p[0], p[1] - 1, p[2]);
        }

        function nightsBetween(inStr, outStr) {
          var a = parseYMD(inStr);
          var b = parseYMD(outStr);
          if (!a || !b) {
            return 0;
          }
          var ms = b.getTime() - a.getTime();
          var n = Math.round(ms / (24 * 60 * 60 * 1000));
          return n > 0 ? n : 0;
        }

        function formatKRW(n) {
          return n.toLocaleString("ko-KR") + "\uc6d0";
        }

        function formatDisplayYMD(s) {
          if (!parseYMD(s)) {
            return s || "\u2014";
          }
          var p = s.split("-");
          return p[0] + "." + p[1] + "." + p[2];
        }

        var nights = nightsBetween(checkIn, checkOut);
        var nightly = ROOM_NIGHTLY[roomRaw];
        var total = nights > 0 ? nightly * nights : 0;

        document.getElementById("f-room").value = roomRaw;
        document.getElementById("f-checkin").value = checkIn;
        document.getElementById("f-checkout").value = checkOut;
        document.getElementById("f-nights").value = String(nights);
        document.getElementById("f-total-amount").value = String(total);

        var imgEl = document.getElementById("booking-room-img");
        imgEl.src = "images/" + roomRaw + "00.jpg";
        imgEl.alt = ROOM_LABEL[roomRaw] + " \ub300\ud45c \uc774\ubbf8\uc9c0";

        document.getElementById("booking-room-name").textContent =
          ROOM_LABEL[roomRaw];

        var schedEl = document.getElementById("booking-schedule");
        if (checkIn && checkOut && nights > 0) {
          schedEl.textContent =
            "\uccb4\ud06c\uc778 " +
            formatDisplayYMD(checkIn) +
            " \xb7 \uccb4\ud06c\uc544\uc6c3 " +
            formatDisplayYMD(checkOut) +
            " (" +
            nights +
            "\ubc15)";
        } else {
          schedEl.textContent =
            "\uc77c\uc815\uc774 \uc5c6\uc2b5\ub2c8\ub2e4. \uc608\uc57d \ud398\uc774\uc9c0\uc5d0\uc11c \uc77c\uc815\uc744 \uc120\ud0dd\ud55c \ud6c4 \ub2e4\uc2dc \ub4e4\uc5b4\uc640 \uc8fc\uc138\uc694.";
        }

        document.getElementById("booking-line-price").textContent =
          "1\ubc15 " + formatKRW(nightly);

        var breakdownEl = document.getElementById("confirm-breakdown");
        var totalDisplayEl = document.getElementById("confirm-total-display");
        if (nights > 0) {
          breakdownEl.textContent =
            formatKRW(nightly) +
            " \xd7 " +
            nights +
            "\ubc15 = " +
            formatKRW(total);
          totalDisplayEl.textContent = formatKRW(total);
        } else {
          breakdownEl.textContent =
            "\ud22c\uc219 \uc77c\uc218\ub97c \uacc4\uc0b0\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4. \uccb4\ud06c\uc778\xb7\uccb4\ud06c\uc544\uc6c3\uc744 \ud655\uc778\ud574 \uc8fc\uc138\uc694.";
          totalDisplayEl.textContent = "\u2014";
        }

        var agreeAll = document.getElementById("agree-all");
        var agreePrivacy = document.getElementById("agree-privacy");
        var agreePurchase = document.getElementById("agree-purchase");
        var syncing = false;

        function syncAllFromChildren() {
          if (syncing) {
            return;
          }
          agreeAll.checked =
            agreePrivacy.checked && agreePurchase.checked;
        }

        agreeAll.addEventListener("change", function () {
          syncing = true;
          agreePrivacy.checked = agreeAll.checked;
          agreePurchase.checked = agreeAll.checked;
          syncing = false;
        });

        agreePrivacy.addEventListener("change", syncAllFromChildren);
        agreePurchase.addEventListener("change", syncAllFromChildren);

        syncAllFromChildren();
      });
    </script>
"""

SCRIPT_OUT = SCRIPT


def main():
    c = T
    confirm_html = f'''<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{c["title_confirm"]}</title>
    <link rel="stylesheet" href="css/style.css" />
  </head>
  <body>
    <nav class="site-nav top-right-nav">
      <a href="index.html" class="nav-logo" aria-label="{c["home_aria"]}">
        <img src="images/LOGO.png" alt="GRAFFORD LOGO" />
      </a>
      <a href="STORY.html">STORY</a>
      <a href="ROOMS.html">ROOMS</a>
      <a href="FACILITIES.html">FACILITIES</a>
      <a href="RESERVATION.html">RESERVATION</a>
    </nav>

    <main class="content-section confirm-page">
      <h1 class="confirm-title">{c["h1_pay"]}</h1>

      <form
        class="confirm-form checkout-form"
        id="confirm-form"
        action="payment.html"
        method="get"
      >
        <input type="hidden" name="room" id="f-room" />
        <input type="hidden" name="checkIn" id="f-checkin" />
        <input type="hidden" name="checkOut" id="f-checkout" />
        <input type="hidden" name="nights" id="f-nights" value="0" />
        <input type="hidden" name="totalAmount" id="f-total-amount" value="0" />

        <section class="confirm-section" aria-labelledby="sec-booking">
          <h2 class="confirm-section-title" id="sec-booking">{c["sec_booking"]}</h2>
          <div class="confirm-booking-card">
            <img
              class="confirm-room-thumb"
              id="booking-room-img"
              src="images/A00.jpg"
              alt=""
              width="120"
              height="90"
              decoding="async"
            />
            <div class="confirm-booking-details">
              <p class="confirm-room-name" id="booking-room-name"></p>
              <p class="confirm-schedule" id="booking-schedule"></p>
              <p class="confirm-line-price" id="booking-line-price"></p>
            </div>
          </div>
        </section>

        <section class="confirm-section" aria-labelledby="sec-guest">
          <h2 class="confirm-section-title" id="sec-guest">{c["sec_guest"]}</h2>
          <p class="confirm-info-text">{c["guest_note"]}</p>
          <label class="confirm-label">
            {c["label_name"]}
            <input
              type="text"
              name="guestName"
              id="f-name"
              required
              autocomplete="name"
              placeholder="{c["ph_name"]}"
            />
          </label>
          <label class="confirm-label">
            {c["label_contact"]}
            <input
              type="tel"
              name="contact"
              id="f-contact"
              required
              autocomplete="tel"
              placeholder="010-0000-0000"
            />
          </label>
        </section>

        <section class="confirm-section" aria-labelledby="sec-total">
          <h2 class="confirm-section-title" id="sec-total">{c["sec_total"]}</h2>
          <div class="confirm-total-box">
            <p class="confirm-total-line" id="confirm-breakdown"></p>
            <p class="confirm-total-amount-wrap">
              <span class="confirm-total-label">{c["total_label"]}</span>
              <strong class="confirm-total-amount" id="confirm-total-display">—</strong>
            </p>
          </div>
        </section>

        <section class="confirm-section" aria-labelledby="sec-pay">
          <h2 class="confirm-section-title" id="sec-pay">{c["sec_pay"]}</h2>
          <fieldset class="confirm-fieldset">
            <legend class="visually-hidden">{c["pay_legend"]}</legend>
            <label class="confirm-radio">
              <input
                type="radio"
                name="paymentMethod"
                value="card"
                required
              />
              {c["pay_card"]}
            </label>
            <label class="confirm-radio">
              <input type="radio" name="paymentMethod" value="naver" />
              {c["pay_naver"]}
            </label>
            <label class="confirm-radio">
              <input type="radio" name="paymentMethod" value="bank" />
              {c["pay_bank"]}
            </label>
          </fieldset>
        </section>

        <section class="confirm-section" aria-labelledby="sec-agree">
          <h2 class="confirm-section-title" id="sec-agree">{c["sec_agree"]}</h2>
          <label class="confirm-check confirm-check--all">
            <input type="checkbox" id="agree-all" />
            {c["agree_all"]}
          </label>
          <div class="confirm-agree-list">
            <label class="confirm-check">
              <input
                type="checkbox"
                name="agreePrivacy"
                id="agree-privacy"
                value="1"
                required
              />
              {c["agree_priv"]}
            </label>
            <label class="confirm-check">
              <input
                type="checkbox"
                name="agreePurchase"
                id="agree-purchase"
                value="1"
                required
              />
              {c["agree_buy"]}
            </label>
          </div>
        </section>

        <div class="confirm-actions">
          <button type="submit" class="btn confirm-pay-submit">{c["btn_pay"]}</button>
        </div>
      </form>

      <p class="confirm-back">
        <a href="RESERVATION.html">{c["back_link"]}</a>
      </p>

      <footer class="site-footer">© 2026 GRAFFORD. all rights reserved.</footer>
    </main>

{SCRIPT_OUT}
  </body>
</html>
'''

    payment_html = f'''<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{c["title_payment"]}</title>
    <link rel="stylesheet" href="css/style.css" />
  </head>
  <body>
    <nav class="site-nav top-right-nav">
      <a href="index.html" class="nav-logo" aria-label="{c["home_aria"]}">
        <img src="images/LOGO.png" alt="GRAFFORD LOGO" />
      </a>
      <a href="STORY.html">STORY</a>
      <a href="ROOMS.html">ROOMS</a>
      <a href="FACILITIES.html">FACILITIES</a>
      <a href="RESERVATION.html">RESERVATION</a>
    </nav>

    <main class="content-section confirm-page payment-page">
      <h1 class="confirm-title">{c["h1_payment"]}</h1>
      <p class="confirm-summary">{c["payment_note"]}</p>
      <p class="confirm-back">
        <a href="RESERVATION.html">{c["nav_res"]}</a>
        ·
        <a href="ROOMS.html">{c["nav_rooms"]}</a>
      </p>
      <footer class="site-footer">© 2026 GRAFFORD. all rights reserved.</footer>
    </main>
  </body>
</html>
'''

    (ROOT / "confirm.html").write_text(confirm_html, encoding="utf-8")
    (ROOT / "payment.html").write_text(payment_html, encoding="utf-8")
    print("Wrote confirm.html, payment.html")


if __name__ == "__main__":
    main()
