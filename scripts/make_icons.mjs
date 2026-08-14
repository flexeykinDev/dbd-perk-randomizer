// One-off: rasterizes app/icon.svg into the PNG sizes Next.js/iOS/PWA need.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const svg = readFileSync(new URL("../app/icon.svg", import.meta.url));

const targets = [
  { out: "../app/apple-icon.png", size: 180 },
  { out: "../public/icons/icon-192.png", size: 192 },
  { out: "../public/icons/icon-512.png", size: 512 },
];

for (const { out, size } of targets) {
  const dest = fileURLToPath(new URL(out, import.meta.url));
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(dest);
  console.log(`wrote ${out} (${size}x${size})`);
}
