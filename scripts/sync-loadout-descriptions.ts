// Fills in data/loadout-description-ru-raw.json — a raw (uncurated) Russian
// description per item/offering, scraped from that piece's own page on the
// RU wiki, so getLoadoutPieceDescription() (lib/perk-description.ts) has
// real Russian text to auto-derive from instead of silently falling back to
// English. Run manually via `npm run sync:loadout-descriptions`, after
// `npm run sync:loadout-localization` has confirmed a RU page title per
// slug (same "run localization first" dependency scripts/sync-descriptions.ts
// has on scripts/sync-localization.ts for perks).
//
// Unlike perks, item/offering pages don't have a "Описание" heading —
// inspecting several by hand found two different layouts instead:
//   - Offerings consistently use a "Использование" (Usage) heading.
//   - Items *usually* use a "Особенности" (Features) heading, but several
//     (Broken Key, Skeleton Key, ...) have no heading at all — their
//     description just sits in the lead paragraphs, right after the
//     infobox and before the first h2 (Список изменений / Changelog).
// extractSection() below tries the heading first and falls back to the
// lead, rather than assuming every page uses one specific layout.
//
// Add-ons are handled separately by scripts/sync-loadout-addons.ts, which
// gets their RU name *and* description from the same combined-page scrape
// in one pass — see that file for why individual add-on pages don't exist
// on this wiki the way item/offering pages do.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import type { Item, Offering } from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const ITEMS_JSON = join(DATA_DIR, "items.json");
const OFFERINGS_JSON = join(DATA_DIR, "offerings.json");
const TRANSLATIONS_JSON = join(DATA_DIR, "loadout-translations.ru.json");
const DESCRIPTION_RU_RAW_JSON = join(DATA_DIR, "loadout-description-ru-raw.json");

const RU_WIKI_API = "https://dead-by-daylight.fandom.com/ru/api.php";
const REQUEST_HEADERS = {
  "User-Agent": "dbd-perk-randomizer localization sync (personal site, contact via github)",
};
const REQUEST_DELAY_MS = 150;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: REQUEST_HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json() as Promise<T>;
}

interface ParseResponse {
  parse?: { text?: { "*"?: string } };
  error?: { info?: string };
}

async function fetchPageHtml(title: string): Promise<string | null> {
  const params = new URLSearchParams({ action: "parse", page: title, format: "json", prop: "text" });
  const data = await fetchJson<ParseResponse>(`${RU_WIKI_API}?${params}`);
  return data.parse?.text?.["*"] ?? null;
}

function nodeToText($: cheerio.CheerioAPI, el: cheerio.Cheerio<import("domhandler").AnyNode>): string[] {
  const parts: string[] = [];
  el.each((_, node) => {
    const $node = $(node);
    if ($node.is("table, aside")) return;
    if ($node.is("ul, ol")) {
      $node.find("li").each((__, li) => {
        let text = $(li).text().trim();
        if (!text) return;
        if (!/[.!?;]$/.test(text)) text += ".";
        parts.push(text);
      });
      return;
    }
    if ($node.is("p, div")) {
      const text = $node.clone().children("table, aside, ul, ol").remove().end().text().trim();
      if (text) parts.push(text);
    }
  });
  return parts;
}

/** Item/offering pages don't share perks' single "Описание" heading — see
 *  the header comment above for the two layouts this handles. Returns null
 *  only if neither produced any usable text. */
function extractSection(html: string): string | null {
  const $ = cheerio.load(html.replace(/<br\s*\/?>/gi, " "));

  const heading = $('.mw-headline[id="Особенности"], .mw-headline[id="Использование"]').first();
  if (heading.length > 0) {
    const siblings = heading.closest("h2").nextUntil("h2");
    const parts = nodeToText($, siblings);
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    if (text) return text;
  }

  // Fall back to the lead: every top-level element between the infobox and
  // the first h2 (or the whole body, if there's no h2 at all), skipping
  // Fandom's empty spacer paragraphs.
  const root = $(".mw-parser-output").first();
  const container = root.length > 0 ? root : $("body");
  const firstH2 = container.children("h2").first();
  const lead = firstH2.length > 0 ? container.children().slice(0, container.children().index(firstH2)) : container.children();
  const leadParts = nodeToText($, lead);
  const leadText = leadParts.join(" ").replace(/\s+/g, " ").trim();
  return leadText || null;
}

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

interface SyncTarget {
  kind: "item" | "offering";
  slug: string;
  nameEn: string;
}

async function main() {
  const items: Item[] = loadJson(ITEMS_JSON, []);
  const offerings: Offering[] = loadJson(OFFERINGS_JSON, []);
  if (items.length === 0 || offerings.length === 0) {
    throw new Error(`No items/offerings found — run \`npm run scrape:loadout\` first.`);
  }

  const ruNames = loadJson<Record<string, string>>(TRANSLATIONS_JSON, {});
  delete ruNames._comment;

  const existing = loadJson<Record<string, string>>(DESCRIPTION_RU_RAW_JSON, {});
  delete existing._comment;

  const targets: SyncTarget[] = [
    ...items.map((i): SyncTarget => ({ kind: "item", slug: i.slug, nameEn: i.name.en })),
    ...offerings.map((o): SyncTarget => ({ kind: "offering", slug: o.slug, nameEn: o.name.en })),
  ];

  console.log(`Syncing raw RU descriptions for ${targets.length} items/offerings...`);

  let extracted = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const [i, target] of targets.entries()) {
    const key = `${target.kind}:${target.slug}`;
    const ruTitle = ruNames[key];
    const previous = existing[key];

    if (!ruTitle || ruTitle === target.nameEn) {
      if (previous) unchanged++;
      else skipped++;
    } else {
      try {
        const html = await fetchPageHtml(ruTitle);
        const description = html ? extractSection(html) : null;
        if (description) {
          if (description !== previous) console.log(`  [${target.kind}] ${target.nameEn} (${ruTitle}): extracted`);
          existing[key] = description;
          if (description === previous) unchanged++;
          else extracted++;
        } else {
          console.log(`  [${target.kind}] ${target.nameEn} (${ruTitle}): no usable text found, skipped`);
          skipped++;
        }
      } catch (err) {
        console.warn(`  [${target.kind}] ${target.nameEn} (${ruTitle}): fetch failed (${(err as Error).message})`);
        skipped++;
      }
      if (i < targets.length - 1) await sleep(REQUEST_DELAY_MS);
    }
  }

  const output = {
    _comment:
      "Raw (uncurated) RU description text per item/offering, keyed 'kind:slug', scraped from each piece's own RU wiki page — see scripts/sync-loadout-descriptions.ts. getLoadoutPieceDescription() runs this through the same auto-highlight/sentence-split pipeline the perk system uses for its own RU-raw fallback.",
    ...existing,
  };
  writeFileSync(DESCRIPTION_RU_RAW_JSON, JSON.stringify(output, null, 2) + "\n");

  console.log(`\nDone: ${extracted} extracted (${unchanged} unchanged), ${skipped} skipped (kept English fallback).`);
  console.log(`Wrote ${DESCRIPTION_RU_RAW_JSON}`);
  console.log("Run `npm run scrape:loadout` to bake these into data/items.json / data/offerings.json.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
