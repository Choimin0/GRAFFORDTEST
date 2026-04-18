# -*- coding: utf-8 -*-
"""Fix A room-rate line; insert B, C, D room-rate before service icons."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "ROOMS.html"
text = path.read_text(encoding="utf-8")

text = re.sub(
    r"<p class=\"room[^\n]*20만원 · A동</p>",
    "            <p class=\"room-rate\">1\ubc15 20\ub9cc\uc6d0 \xb7 A\ub3d9</p>",
    text,
    count=1,
)

NEEDLE = "</p>\n            <div\n              class=\"room-service-icons\""
PRICES = {
    "B": "1\ubc15 20\ub9cc\uc6d0 \xb7 B\ub3d9",
    "C": "1\ubc15 30\ub9cc\uc6d0 \xb7 C\ub3d9",
    "D": "1\ubc15 50\ub9cc\uc6d0 \xb7 D\ub3d9",
}

for letter, price in PRICES.items():
    anchor = "<h3>%s</h3>" % letter
    pos = text.find(anchor)
    if pos < 0:
        raise SystemExit("missing " + anchor)
    j = text.find(NEEDLE, pos)
    if j < 0:
        raise SystemExit("missing needle after " + letter)
    chunk = text[pos : j + len(NEEDLE)]
    if "room-rate" in chunk:
        continue
    insert = (
        "</p>\n            <p class=\"room-rate\">"
        + price
        + "</p>\n            <div\n              class=\"room-service-icons\""
    )
    text = text[:j] + insert + text[j + len(NEEDLE) :]

path.write_text(text, encoding="utf-8")
print("patched ROOMS.html")
