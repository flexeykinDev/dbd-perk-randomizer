// One-off README screenshot capture — not part of the app or e2e suite,
// just a convenience script run by hand when the UI changes enough to
// warrant refreshing docs/screenshots/*.png. Assumes `npm run dev` is
// already running on :3000 (does not manage the dev server itself).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "../docs/screenshots");
const BASE = "http://localhost:3000";

mkdirSync(OUT_DIR, { recursive: true });

async function shot(page, path, name, opts = {}) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  if (opts.hideTrailer) {
    const btn = page.getByRole("button", { name: "Скрыть трейлер" });
    if (await btn.isVisible().catch(() => false)) await btn.click();
    await page.waitForTimeout(300);
  }
  if (opts.setup) await opts.setup(page);
  await page.waitForTimeout(500); // let any modal open/close animation settle
  await page.screenshot({ path: join(OUT_DIR, name), fullPage: !!opts.fullPage });
  console.log(`  wrote ${name}`);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1180, height: 900 },
    locale: "ru-RU",
    colorScheme: "dark",
  });
  const page = await context.newPage();

  console.log("Capturing dark theme shots...");
  await shot(page, "/?role=survivor", "board-dark.png", { hideTrailer: true });
  await shot(page, "/?role=killer&mode=loadout", "loadout-killer-dark.png", {
    hideTrailer: true,
    setup: async (p) => {
      // Pick a specific killer so the Power slot + portrait badge both
      // render deterministically instead of whatever the initial random
      // roll happened to land on.
      await p.getByRole("button", { name: "Выбрать персонажа" }).click();
      await p.getByRole("button", { name: "Случайный", exact: true }).click();
    },
  });
  await shot(page, "/?role=survivor", "character-picker.png", {
    hideTrailer: true,
    setup: async (p) => {
      await p.getByRole("button", { name: "Выбрать персонажа" }).click();
    },
  });
  await shot(page, "/?role=survivor", "manage-pool.png", {
    hideTrailer: true,
    setup: async (p) => {
      await p.getByRole("button", { name: "Пул", exact: true }).click();
    },
  });
  await shot(page, "/?role=survivor&perks=pharmacy", "perk-modal.png", {
    hideTrailer: true,
    setup: async (p) => {
      await p.getByRole("button", { name: "Описание: Аптекарь" }).first().click();
    },
  });
  await shot(page, "/?role=survivor", "stats.png", {
    hideTrailer: true,
    setup: async (p) => {
      await p.getByRole("button", { name: "Сгенерировать новый билд" }).click();
      await p.waitForTimeout(300);
      await p.getByRole("button", { name: "Статистика", exact: true }).click();
    },
  });

  console.log("Capturing light theme shot...");
  await page.emulateMedia({ colorScheme: "light" });
  await shot(page, "/?role=survivor", "board-light.png", {
    hideTrailer: true,
    setup: async (p) => {
      const toggle = p.getByRole("button", { name: "Переключить тему" });
      await toggle.click();
      await p.waitForTimeout(200);
    },
  });

  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
