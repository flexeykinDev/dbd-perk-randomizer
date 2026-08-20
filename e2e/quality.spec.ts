// Site-wide quality guards: nothing may log an error, every control must be
// nameable, and text must stay readable in both themes.
//
// These exist because all three are the kind of regression that ships
// happily. A control that loses its label still works for anyone who can see
// it; a colour that drops to 2:1 still renders; a page that throws on a
// malformed share link still shows a header. The suite only catches them if
// something is actually looking.
import { test, expect, type Page } from "@playwright/test";

/** Resolves any CSS colour — including the lab()/oklab() Tailwind v4 emits,
 *  which a hand-rolled rgb() parser turns into silently wrong ratios — by
 *  making the browser paint it and reading the pixel back. Backgrounds are
 *  composited through their alpha rather than skipped, because most of this
 *  UI sits on translucent layers (bg-black/60, bg-sky-500/10) and treating
 *  those as absent invents failures that aren't there. Anything under a
 *  background *image* is unknowable from the DOM and is skipped outright. */
const CONTRAST_HELPERS = `
  const _c = document.createElement("canvas");
  _c.width = _c.height = 1;
  const _x = _c.getContext("2d", { willReadFrequently: true });
  function toRgb(color) {
    _x.clearRect(0, 0, 1, 1);
    _x.fillStyle = "#000";
    _x.fillStyle = color;
    _x.fillRect(0, 0, 1, 1);
    const d = _x.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }
  function lum(rgb) {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }
  function bgOf(el) {
    const layers = [];
    let node = el;
    while (node) {
      const s = getComputedStyle(node);
      if (s.backgroundImage && s.backgroundImage !== "none") return null;
      const c = toRgb(s.backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 0.999) break;
      node = node.parentElement;
    }
    let base = layers.pop();
    if (!base) return null;
    while (layers.length) {
      const over = layers.pop();
      base = [
        over[0] * over[3] + base[0] * (1 - over[3]),
        over[1] * over[3] + base[1] * (1 - over[3]),
        over[2] * over[3] + base[2] * (1 - over[3]),
        1,
      ];
    }
    return base;
  }
  function ratio(fgColor, bgRgb) {
    const fg = toRgb(fgColor);
    // Text alpha composites over its own background too.
    const solid = [
      fg[0] * fg[3] + bgRgb[0] * (1 - fg[3]),
      fg[1] * fg[3] + bgRgb[1] * (1 - fg[3]),
      fg[2] * fg[3] + bgRgb[2] * (1 - fg[3]),
    ];
    const a = lum(solid), b = lum(bgRgb);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
`;

const PANELS = [
  /^Пул( \d+)?$/,
  /^Статистика пула$/,
  /^Ещё$/,
  /^Оверлей OBS$/,
  /^Выбрать персонажа$/,
];

/** Opens one panel, hands it to `inspect`, closes it, moves on. Opening them
 *  all at once does not work: a modal's backdrop covers the next trigger and
 *  the click waits forever. */
async function eachPanel(page: Page, inspect: (label: string) => Promise<void>): Promise<string[]> {
  const visited: string[] = [];
  await inspect("page");
  for (const name of PANELS) {
    const button = page.getByRole("button", { name }).first();
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(350);
    const label = String(name).replace(/[/^$]/g, "");
    visited.push(label);
    await inspect(label);
    await page.keyboard.press("Escape");
    // Generous on purpose: at 250ms a modal is still in the DOM fading out,
    // which reads as "Escape did nothing".
    await page.waitForTimeout(500);
    if (await page.locator("[role=dialog]").count()) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
  }
  return visited;
}

test("no URL, however malformed, produces an error or a blank page", async ({ browser }) => {
  // Share links are pasted, edited and truncated by hand and by chat
  // clients. Every one of these has to degrade to a working randomiser
  // rather than an exception.
  const urls = [
    "/", "/?role=survivor", "/?role=killer",
    "/?role=survivor&mode=loadout", "/?role=killer&mode=loadout",
    "/?role=survivor&mode=all", "/?role=killer&mode=all",
    "/?obs=1", "/?obs=1#/obs", "/?room=TESTROOM&obs=1",
    "/?role=nonsense", "/?mode=nonsense",
    "/?r=s&p=999999,888888", "/?r=x&p=", "/?r=s&p=abc,def",
    "/?seed=" + "x".repeat(500),
    "/?role=survivor&perks=not-a-real-perk",
    "/?r=s&p=1,1,1,1", "/?role=survivor&count=99", "/?%zz=1",
    "/?r=s&p=" + Array.from({ length: 200 }, (_, i) => i).join(","),
  ];
  const findings: string[] = [];
  for (const url of urls) {
    // A fresh context per URL: sharing one page means the previous
    // navigation's in-flight requests are cancelled by the next goto and
    // surface as ERR_ABORTED noise that has nothing to do with the site.
    const context = await browser.newContext({ locale: "ru-RU" });
    const page = await context.newPage();
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`UNCAUGHT ${e.message.slice(0, 140)}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`CONSOLE ${m.text().slice(0, 140)}`);
    });
    page.on("response", (r) => {
      if (r.status() >= 400 && r.url().startsWith("http://localhost"))
        problems.push(`HTTP ${r.status()} ${r.url().slice(-50)}`);
    });
    await page.goto(url).catch((e) => problems.push(`NAV FAILED ${String(e).slice(0, 80)}`));
    await page.waitForTimeout(600);
    const text = (await page.locator("body").innerText().catch(() => "")).trim();
    if (!url.includes("obs=1") && text.length < 50)
      problems.push(`PAGE EMPTY (${text.length} chars of text)`);
    if (problems.length) findings.push(`${url.slice(0, 55)} :: ${[...new Set(problems)].join(" ;; ")}`);
    await context.close();
  }
  expect(findings, `${findings.length} URLs misbehaved`).toEqual([]);
});

test("every control can be named, on the page and in every panel", async ({ page }) => {
  const findings: string[] = [];
  for (const url of ["/?role=survivor", "/?role=killer&mode=all"]) {
    await page.goto(url);
    await expect(page.locator("[data-perk-card]").first()).toBeVisible();
    await eachPanel(page, async (label) => {
      const found: string[] = await page.evaluate(() => {
        const out: string[] = [];
        const named = (el: Element) =>
          el.getAttribute("aria-label") ||
          el.getAttribute("aria-labelledby") ||
          el.getAttribute("title") ||
          (el.textContent ?? "").trim();
        for (const el of document.querySelectorAll("button, a, [role=button], [role=switch]")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (!named(el))
            out.push(`unnamed <${el.tagName.toLowerCase()}> class="${el.className.toString().slice(0, 45)}"`);
        }
        for (const img of document.querySelectorAll("img"))
          if (!img.hasAttribute("alt")) out.push(`<img> with no alt: ${img.getAttribute("src")}`);
        for (const field of document.querySelectorAll("input, select, textarea")) {
          const r = field.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const id = field.getAttribute("id");
          // A placeholder is deliberately not accepted: support for using it
          // as the accessible name varies by screen reader, and it vanishes
          // the moment anything is typed.
          const ok =
            field.getAttribute("aria-label") ||
            field.getAttribute("aria-labelledby") ||
            (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
            field.closest("label");
          if (!ok) {
            const hint =
              field.tagName === "SELECT"
                ? (field as HTMLSelectElement).options[0]?.text
                : field.getAttribute("placeholder") ?? field.getAttribute("type") ?? "";
            out.push(`unlabelled <${field.tagName.toLowerCase()}> (${hint})`);
          }
        }
        const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
        const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
        if (dup.length) out.push(`duplicate DOM ids: ${dup.join(", ")}`);
        if (!document.documentElement.getAttribute("lang")) out.push("<html> has no lang");
        if (!document.querySelector("main")) out.push("no <main> landmark");
        const h1 = document.querySelectorAll("h1").length;
        if (h1 !== 1) out.push(`h1 count = ${h1}`);
        return out;
      });
      for (const f of found) findings.push(`${url} [${label}] ${f}`);
    });
  }
  expect([...new Set(findings)], `${findings.length} accessibility problems`).toEqual([]);
});

test("text clears WCAG AA in both themes", async ({ page }) => {
  const findings: string[] = [];
  for (const theme of ["dark", "light"] as const) {
    await page.goto("/?role=survivor");
    await expect(page.locator("[data-perk-card]")).toHaveCount(4);
    const current = await page.evaluate(() => document.documentElement.dataset.theme ?? "dark");
    if (current !== theme) {
      await page.getByRole("button", { name: "Переключить тему" }).click();
      await page.waitForTimeout(400);
    }
    await eachPanel(page, async (label) => {
      const found = (await page.evaluate(`(() => {
        ${CONTRAST_HELPERS}
        const out = [];
        const seen = new Set();
        for (const el of document.querySelectorAll("p,span,a,button,h1,h2,h3,li,label,option,div,td,th,b,i,em,strong,kbd")) {
          const text = (el.textContent || "").trim();
          if (!text || el.children.length) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const s = getComputedStyle(el);
          if (Number(s.opacity) < 0.5 || s.visibility === "hidden") continue;
          // The share card and the OBS overlay paint their own dark ground
          // on purpose and never follow the site theme (same reason
          // globals.css scopes .icon-art), so measuring them against the
          // page background says nothing.
          if (el.closest("[aria-hidden=true]") || el.closest(".obs-overlay-root")) continue;
          const bg = bgOf(el);
          if (!bg) continue;
          const size = parseFloat(s.fontSize);
          const bold = Number(s.fontWeight) >= 700;
          const floor = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
          const got = ratio(s.color, bg);
          if (got >= floor) continue;
          const key = s.color + "|" + size;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push('"' + text.slice(0, 24) + '" ' + got.toFixed(2) + ':1 (needs ' + floor + ') color=' + s.color + ' ' + size + 'px');
        }
        return out;
      })()`)) as string[];
      for (const f of found) findings.push(`${theme} [${label}] ${f}`);
    });
  }
  expect([...new Set(findings)], `${findings.length} text colours below WCAG AA`).toEqual([]);
});
