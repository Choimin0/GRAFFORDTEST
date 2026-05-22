/**
 * Solapi 알림톡 발송 단독 테스트 (로컬 .env 로드)
 * Usage: node scripts/test-alimtalk.mjs
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sendBookingAlimtalk } from "../api/lib/solapi-alimtalk.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");

function loadEnv() {
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (e) {
    console.warn("Could not load .env:", e.message);
  }
}

loadEnv();

const result = await sendBookingAlimtalk("reserve-complete", {
  guestName: "테스트",
  contact: "01012345678",
  reservationNumber: "TEST001",
  roomType: "G1",
  checkIn: "2026-05-23",
  checkOut: "2026-05-24",
});

console.log("result:", JSON.stringify(result, null, 2));
process.exit(result.ok || result.skipped ? 0 : 1);
