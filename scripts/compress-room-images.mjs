#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIN_BYTES = 200 * 1024;
const MAX_BYTES = 500 * 1024;
const DIMS = [1920, 1600, 1400, 1200];

async function listRoomImages(roomDir) {
  const entries = await fs.readdir(roomDir);
  return entries
    .filter((name) => /\.jpe?g$/i.test(name))
    .map((name) => path.join(roomDir, name))
    .sort();
}

async function encode(inputPath, dim, quality) {
  return sharp(inputPath)
    .rotate()
    .resize({
      width: dim,
      height: dim,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

async function compressOne(inputPath) {
  const origBytes = (await fs.stat(inputPath)).size;

  for (const dim of DIMS) {
    let lo = 35;
    let hi = 85;
    let bestInRange = null;
    let bestUnderMax = null;

    while (lo <= hi) {
      const quality = Math.floor((lo + hi) / 2);
      const buffer = await encode(inputPath, dim, quality);
      const size = buffer.length;

      if (size > MAX_BYTES) {
        hi = quality - 1;
        continue;
      }

      if (!bestUnderMax || size > bestUnderMax.size) {
        bestUnderMax = { dim, quality, size, buffer };
      }

      if (size >= MIN_BYTES) {
        bestInRange = { dim, quality, size, buffer };
        lo = quality + 1;
      } else {
        lo = quality + 1;
      }
    }

    if (bestInRange) {
      await fs.writeFile(inputPath, bestInRange.buffer);
      return {
        status: "ok",
        dim: bestInRange.dim,
        quality: bestInRange.quality,
        origBytes,
        outBytes: bestInRange.size,
      };
    }

    if (bestUnderMax) {
      await fs.writeFile(inputPath, bestUnderMax.buffer);
      return {
        status: "low",
        dim: bestUnderMax.dim,
        quality: bestUnderMax.quality,
        origBytes,
        outBytes: bestUnderMax.size,
      };
    }
  }

  const fallback = await encode(inputPath, 1200, 35);
  await fs.writeFile(inputPath, fallback);
  return {
    status: "high",
    dim: 1200,
    quality: 35,
    origBytes,
    outBytes: fallback.length,
  };
}

function formatKb(bytes) {
  return `${Math.round(bytes / 1024)}KB`;
}

async function main() {
  const rooms = ["G1", "G2", "G3", "G4"];
  const summary = {
    total: 0,
    ok: 0,
    low: 0,
    high: 0,
    origBytes: 0,
    outBytes: 0,
    byRoom: {},
  };

  console.log("Compressing room images...");
  console.log(`Target: ${formatKb(MIN_BYTES)} ~ ${formatKb(MAX_BYTES)}\n`);

  for (const room of rooms) {
    const roomDir = path.join(ROOT, "images", room);
    let files;
    try {
      files = await listRoomImages(roomDir);
    } catch {
      continue;
    }

    summary.byRoom[room] = { count: 0, ok: 0, low: 0, high: 0, origBytes: 0, outBytes: 0 };
    console.log(`=== ${room} (${files.length} files) ===`);

    for (const file of files) {
      summary.total += 1;
      summary.byRoom[room].count += 1;
      const result = await compressOne(file);
      summary.origBytes += result.origBytes;
      summary.outBytes += result.outBytes;
      summary.byRoom[room].origBytes += result.origBytes;
      summary.byRoom[room].outBytes += result.outBytes;
      summary[result.status] += 1;
      summary.byRoom[room][result.status] += 1;

      const tag = result.status === "ok" ? "OK  " : result.status === "low" ? "LOW " : "HIGH";
      console.log(
        `  ${tag} ${path.basename(file)}  ${result.dim}px q${result.quality}  ${formatKb(result.origBytes)} -> ${formatKb(result.outBytes)}`,
      );
    }
    console.log("");
  }

  const savedBytes = summary.origBytes - summary.outBytes;
  const savedPct = summary.origBytes
    ? Math.round((savedBytes * 100) / summary.origBytes)
    : 0;

  console.log("========== SUMMARY ==========");
  console.log(`Files processed : ${summary.total}`);
  console.log(`Within target   : ${summary.ok}`);
  console.log(`Below 200KB     : ${summary.low}`);
  console.log(`Above 500KB     : ${summary.high}`);
  console.log(`Original size   : ${Math.round(summary.origBytes / 1024 / 1024)} MB`);
  console.log(`Compressed size : ${Math.round(summary.outBytes / 1024 / 1024)} MB`);
  console.log(`Saved           : ${Math.round(savedBytes / 1024 / 1024)} MB (${savedPct}%)`);
  console.log("");
  for (const room of rooms) {
    const r = summary.byRoom[room];
    if (!r || !r.count) continue;
    console.log(
      `${room}: ${r.count} files, ${Math.round(r.origBytes / 1024 / 1024)}MB -> ${Math.round(r.outBytes / 1024 / 1024)}MB (${r.ok} ok, ${r.low} low, ${r.high} high)`,
    );
  }
  console.log("=============================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
