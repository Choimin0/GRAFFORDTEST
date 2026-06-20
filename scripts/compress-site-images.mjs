#!/usr/bin/env node
/**
 * 히어로 PNG·공동·커피 day/night JPEG 등 페이지에서 쓰는 대용량 이미지를 웹용으로 압축합니다.
 * 목표: 200~500KB, 최대 변 1920px (히어로 PNG는 2400px까지 허용)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const IMAGES = path.join(ROOT, "images");

const MIN_BYTES = 200 * 1024;
const MAX_BYTES = 500 * 1024;
const HERO_MAX_BYTES = 600 * 1024;
const DIMS = [2400, 1920, 1600, 1400, 1200];

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

async function compressToJpeg(inputPath, outputPath, maxBytes) {
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

      if (size > maxBytes) {
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

    const pick = bestInRange || bestUnderMax;
    if (pick) {
      await fs.writeFile(outputPath, pick.buffer);
      return {
        status: bestInRange ? "ok" : "low",
        dim: pick.dim,
        quality: pick.quality,
        origBytes,
        outBytes: pick.size,
      };
    }
  }

  const fallback = await encode(inputPath, 1200, 35);
  await fs.writeFile(outputPath, fallback);
  return {
    status: "high",
    dim: 1200,
    quality: 35,
    origBytes,
    outBytes: fallback.length,
  };
}

async function compressJpegInPlace(inputPath) {
  const tmp = inputPath + ".tmp.jpg";
  const result = await compressToJpeg(inputPath, tmp, MAX_BYTES);
  await fs.rename(tmp, inputPath);
  return result;
}

async function listJpegs(dir) {
  const entries = await fs.readdir(dir);
  return entries
    .filter((name) => /\.jpe?g$/i.test(name))
    .map((name) => path.join(dir, name))
    .sort();
}

function formatKb(bytes) {
  return `${Math.round(bytes / 1024)}KB`;
}

async function processFolder(label, dir) {
  let files;
  try {
    files = await listJpegs(dir);
  } catch {
    return null;
  }
  if (!files.length) {
    return null;
  }

  const stats = { label, count: 0, origBytes: 0, outBytes: 0 };
  console.log(`=== ${label} (${files.length} files) ===`);

  for (const file of files) {
    stats.count += 1;
    const result = await compressJpegInPlace(file);
    stats.origBytes += result.origBytes;
    stats.outBytes += result.outBytes;
    const tag = result.status === "ok" ? "OK  " : result.status === "low" ? "LOW " : "HIGH";
    console.log(
      `  ${tag} ${path.basename(file)}  ${result.dim}px q${result.quality}  ${formatKb(result.origBytes)} -> ${formatKb(result.outBytes)}`,
    );
  }
  console.log("");
  return stats;
}

async function convertHeroPng(pngName, jpgName) {
  const input = path.join(IMAGES, pngName);
  const output = path.join(IMAGES, jpgName);
  try {
    await fs.access(input);
  } catch {
    console.log(`Skip ${pngName} (not found)`);
    return null;
  }

  console.log(`=== Hero ${pngName} -> ${jpgName} ===`);
  const result = await compressToJpeg(input, output, HERO_MAX_BYTES);
  const tag = result.status === "ok" ? "OK  " : result.status === "low" ? "LOW " : "HIGH";
  console.log(
    `  ${tag} ${result.dim}px q${result.quality}  ${formatKb(result.origBytes)} -> ${formatKb(result.outBytes)}`,
  );
  console.log("");
  return { label: jpgName, count: 1, origBytes: result.origBytes, outBytes: result.outBytes };
}

async function main() {
  const allStats = [];

  for (const [png, jpg] of [
    ["GROUND.png", "GROUND.jpg"],
    ["STORY.png", "STORY.jpg"],
  ]) {
    const s = await convertHeroPng(png, jpg);
    if (s) {
      allStats.push(s);
    }
  }

  const coffeeRoot = path.join(IMAGES, "그라포드커피");
  for (const folder of ["day", "night", "coffeeing", "roasting"]) {
    const s = await processFolder(`coffee/${folder}`, path.join(coffeeRoot, folder));
    if (s) {
      allStats.push(s);
    }
  }

  const s = await processFolder("공동", path.join(IMAGES, "공동"));
  if (s) {
    allStats.push(s);
  }

  for (const name of ["space.jpeg", "reservation.jpeg", "story.jpeg", "rooms.jpeg"]) {
    const file = path.join(IMAGES, name);
    try {
      await fs.access(file);
    } catch {
      continue;
    }
    console.log(`=== root/${name} ===`);
    const result = await compressJpegInPlace(file);
    allStats.push({
      label: name,
      count: 1,
      origBytes: result.origBytes,
      outBytes: result.outBytes,
    });
    console.log(
      `  ${path.basename(file)}  ${result.dim}px q${result.quality}  ${formatKb(result.origBytes)} -> ${formatKb(result.outBytes)}`,
    );
    console.log("");
  }

  const origBytes = allStats.reduce((n, s) => n + s.origBytes, 0);
  const outBytes = allStats.reduce((n, s) => n + s.outBytes, 0);
  const saved = origBytes - outBytes;
  const pct = origBytes ? Math.round((saved * 100) / origBytes) : 0;

  console.log("========== SUMMARY ==========");
  console.log(`Files processed : ${allStats.reduce((n, s) => n + s.count, 0)}`);
  console.log(`Original size   : ${Math.round(origBytes / 1024 / 1024)} MB`);
  console.log(`Compressed size : ${Math.round(outBytes / 1024 / 1024)} MB`);
  console.log(`Saved           : ${Math.round(saved / 1024 / 1024)} MB (${pct}%)`);
  console.log("=============================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
