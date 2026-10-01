// Renders docs/social-preview.html to the PNG GitHub wants for a repo's
// social preview (Settings -> General -> Social preview).
//
// Same shape as capture-screenshots.mjs: Playwright's chromium, already a
// devDependency, pointed at a file:// URL. No new toolchain — the
// steam-guide covers are hand-authored HTML rendered the same way, and
// this is a third one of those.
//
// The one thing it does that those do not: the perk count comes from
// data/perks.json, so "321 perks, one roll" cannot drift the way
// cover.html's hardcoded "315 перков" did.
import { chromium } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SOURCE = join(ROOT, "docs", "social-preview.html");
const OUT = join(ROOT, "docs", "social-preview.png");

// GitHub's own recommendation. Not a suggestion to round off: the card is
// re-cropped on some surfaces, and starting at the documented ratio is what
// keeps those crops predictable.
const SIZE = { width: 1280, height: 640 };

// GitHub rejects a social preview over 1MB. Worth failing on here rather
// than at the upload, which is a manual step somebody does once.
const MAX_BYTES = 1024 * 1024;

const debug = process.argv.includes("--debug");

function perkCount() {
  const perks = JSON.parse(readFileSync(join(ROOT, "data", "perks.json"), "utf8"));
  if (!Array.isArray(perks) || perks.length === 0) {
    throw new Error("data/perks.json is not a non-empty array — has its shape changed?");
  }
  return perks.length;
}

async function main() {
  const count = perkCount();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: SIZE,
    // 1 on purpose. The PNG is 1280px wide and GitHub shows it at roughly
    // half that, so it is already serving a 2x image; rendering at 2x again
    // would quadruple the bytes for nothing.
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });

  const query = `?perks=${count}${debug ? "&debug=1" : ""}`;
  await page.goto(`file:///${SOURCE.replace(/\\/g, "/")}${query}`, { waitUntil: "load" });

  // Oswald and IBM Plex Mono come from Google Fonts, same as the steam-guide
  // covers. Without this the screenshot can land on the fallback face, which
  // looks like a slightly wrong design rather than like a failed render.
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() =>
    document.fonts.check('700 104px Oswald') && document.fonts.check('400 20px "IBM Plex Mono"'),
  );
  if (!loaded) {
    throw new Error(
      "Oswald or IBM Plex Mono did not load — the render needs network access to Google Fonts.",
    );
  }

  // The perk icons are <image> inside SVG, which document.fonts says nothing
  // about. A missing one renders as an empty well, which is easy to miss.
  const icons = await page.evaluate(async () => {
    const sources = [...document.querySelectorAll("svg image")].map((el) => el.getAttribute("href"));
    const results = await Promise.all(
      sources.map(
        (src) =>
          new Promise((resolve) => {
            const probe = new Image();
            probe.onload = () => resolve({ src, ok: probe.naturalWidth > 0 });
            probe.onerror = () => resolve({ src, ok: false });
            probe.src = src;
          }),
      ),
    );
    return results;
  });
  const missing = icons.filter((i) => !i.ok).map((i) => i.src);
  if (missing.length > 0) {
    throw new Error(`perk icons did not load: ${missing.join(", ")}`);
  }

  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, ...SIZE } });
  await browser.close();

  const bytes = statSync(OUT).size;
  console.log(`docs/social-preview.png — ${SIZE.width}x${SIZE.height}, ${(bytes / 1024).toFixed(0)} KB`);
  console.log(`  ${count} perks, ${icons.length} icons`);
  if (bytes > MAX_BYTES) {
    console.error(`\nOver GitHub's 1MB limit for a social preview by ${((bytes - MAX_BYTES) / 1024).toFixed(0)} KB.`);
    process.exitCode = 1;
    return;
  }
  console.log("\nUpload it at Settings -> General -> Social preview -> Edit -> Upload an image.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
