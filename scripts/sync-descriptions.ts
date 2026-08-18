// Fills in data/description-ru-raw.json — a raw (uncurated) Russian
// description per perk, scraped from that perk's own page on the RU wiki —
// so getPerkDescription() (lib/perk-description.ts) has real Russian text to
// auto-derive from instead of silently falling back to English. Run
// manually via `npm run sync:descriptions`.
//
// Unlike sync-localization.ts/sync-characters.ts, this doesn't need its own
// title lookup: data/translations.ru.json already holds a wiki-confirmed RU
// title per slug (all 282 as of the last sync:localization run) — this just
// fetches that exact page and parses its "Описание" (Description) section.
//
// That section's markup turns out to be a small template, consistent across
// every perk sampled by hand (survivor and killer): a paragraph (sometimes a
// <ul> of clauses) containing one or more `{процентов}`/`{метров}`/etc
// placeholder tokens, followed by a tier table (`I/II/III уровень` columns)
// supplying the values to substitute in — e.g. "{метров}" + a table of
// "20 метров"/"28 метров"/"36 метров" becomes "20/28/36 метров", the same
// combined-tier format lib/perk-description.ts's autoHighlight already knows
// how to bold (it already handles the Cyrillic units, since it was written
// against this exact convention on the English side: "20/28/30 %").
//
// This template can't be assumed to cover every perk (some may have multiple
// independently-tiered stats, or an unrecognized layout) — rather than risk
// silently mis-substituting, anything that doesn't cleanly match (more than
// one table, more than one distinct placeholder name, a placeholder with no
// table or vice versa, a missing "Описание" heading) is skipped and logged,
// leaving that slug to keep falling back to the English text as before.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import type { Perk } from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const PERKS_JSON = join(DATA_DIR, "perks.json");
const TRANSLATIONS_JSON = join(DATA_DIR, "translations.ru.json");
const DESCRIPTION_RU_RAW_JSON = join(DATA_DIR, "description-ru-raw.json");

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

async function fetchPerkPageHtml(title: string): Promise<string | null> {
  const params = new URLSearchParams({ action: "parse", page: title, format: "json", prop: "text" });
  const data = await fetchJson<ParseResponse>(`${RU_WIKI_API}?${params}`);
  return data.parse?.text?.["*"] ?? null;
}

const PLACEHOLDER_RE = /\{([^}]+)\}/g;

function splitTieredCell(cellText: string): { num: string; unit: string } | null {
  const match = cellText.trim().match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!match) return null;
  return { num: match[1], unit: match[2].trim() };
}

/**
 * Picks the unit to print after a combined "64/96/128" value, or null when
 * the tiers disagree in a way that can't be reconciled.
 *
 * Russian unit words decline with the number in front of them, so a
 * perfectly well-formed tier table routinely spells the same unit three
 * different ways — "64 метра / 96 метров / 128 метров", "1 выживший /
 * 2 выживших / 3 выживших", "1 жетон / 2 жетона / 3 жетона". Requiring all
 * three to match exactly rejected six real perks (Empathy, Aftercare,
 * Corrective Action, Head On, Open-Handed, Sole Survivor) whose data was
 * never actually ambiguous.
 *
 * The last tier's form is the one to keep: Russian agreement follows the
 * final numeral that's read aloud, so "64/96/128" takes 128's form
 * ("метров") and the descending "20/22/24" takes 24's ("метра"). Both
 * directions were checked against the real tables.
 *
 * A shared stem is what makes this safe — genuinely different units
 * ("метров" vs "секунд") share no prefix and still return null rather than
 * silently printing one stat's number with another stat's unit. Trailing
 * periods are ignored first so "сек" and "сек." count as the same word.
 */
function resolveTierUnit(units: string[]): string | null {
  const last = units[units.length - 1];
  if (new Set(units).size === 1) return last;

  const bare = units.map((u) => u.replace(/\.+$/, ""));
  let stem = bare[0];
  for (const u of bare.slice(1)) {
    let i = 0;
    while (i < stem.length && i < u.length && stem[i] === u[i]) i++;
    stem = stem.slice(0, i);
  }
  // Three characters is enough to separate declensions of one word from two
  // different words, and short enough to keep "сек"/"сек." together.
  return stem.length >= 3 ? last : null;
}

/** Extracts the "Описание" section's text and, if it uses the
 *  placeholder+tier-table template, substitutes the real values in. Returns
 *  null if the page/section is missing or the structure doesn't cleanly
 *  match the template this script knows how to handle. */
function extractDescription(html: string): string | null {
  // cheerio's .text() drops <br> entirely rather than treating it as
  // whitespace, which glues adjacent lines together with no separator —
  // seen on pages with a <br><br>-separated flavor-text aside inside the
  // Описание section (e.g. Sloppy Butcher). Normalize it to a space first.
  const $ = cheerio.load(html.replace(/<br\s*\/?>/gi, " "));
  const heading = $('.mw-headline[id="Описание"]');
  if (heading.length === 0) return null;

  const siblings = heading.closest("h2").nextUntil("h2");
  const tables = siblings.filter("table.article-table");
  if (tables.length > 1) return null;

  const contentParts: string[] = [];
  siblings.each((_, el) => {
    const $el = $(el);
    if ($el.is("table")) return;
    if ($el.is("ul, ol")) {
      $el.find("li").each((__, li) => {
        let text = $(li).text().trim();
        if (!text) return;
        if (!/[.!?;]$/.test(text)) text += ".";
        contentParts.push(text);
      });
      return;
    }
    const text = $el.text().trim();
    if (text) contentParts.push(text);
  });

  let text = contentParts.join(" ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const placeholderNames = new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]));

  if (placeholderNames.size === 0) {
    // Fixed-value perk (no tiers) — table, if any, would be unexplained.
    return tables.length === 0 ? text : null;
  }
  if (placeholderNames.size > 1 || tables.length !== 1) {
    // Multiple independently-tiered stats, or a placeholder with nothing to
    // fill it from — outside what this script trusts itself to combine.
    return null;
  }

  const rows = tables.find("tr");
  if (rows.length !== 2) return null;
  const labelCells = rows.eq(0).find("td, th");
  const valueCells = rows.eq(1).find("td, th");
  if (labelCells.length === 0 || labelCells.length !== valueCells.length) return null;

  const parsed = valueCells
    .map((_, td) => splitTieredCell($(td).text()))
    .get() as ({ num: string; unit: string } | null)[];
  if (parsed.some((v) => v === null)) return null;
  const cells = parsed as { num: string; unit: string }[];

  const unit = resolveTierUnit(cells.map((c) => c.unit));
  if (unit === null) return null; // genuinely different units — don't guess
  const combined = cells.map((c) => c.num).join("/") + (unit ? (unit === "%" ? "%" : ` ${unit}`) : "");

  text = text.replace(PLACEHOLDER_RE, combined);
  if (text.includes("{")) return null; // safety net against a missed token form

  return text;
}

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const perks: Perk[] = loadJson(PERKS_JSON, []);
  if (perks.length === 0) {
    throw new Error(`No perks found at ${PERKS_JSON} — run \`npm run scrape:perks\` first.`);
  }

  const ruNames = loadJson<Record<string, string>>(TRANSLATIONS_JSON, {});
  delete ruNames._comment;

  const existing = loadJson<Record<string, string>>(DESCRIPTION_RU_RAW_JSON, {});
  delete existing._comment;

  console.log(`Syncing raw RU descriptions for ${perks.length} perks...`);

  let extracted = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const [i, perk] of perks.entries()) {
    const ruTitle = ruNames[perk.slug];
    const previous = existing[perk.slug];

    if (!ruTitle || ruTitle === perk.name.en) {
      // No confirmed RU page title to fetch — leave whatever we already had.
      if (previous) unchanged++;
      else skipped++;
    } else {
      try {
        const html = await fetchPerkPageHtml(ruTitle);
        const description = html ? extractDescription(html) : null;
        if (description) {
          if (description !== previous) {
            console.log(`  [${perk.role}] ${perk.name.en} (${ruTitle}): extracted`);
          }
          existing[perk.slug] = description;
          if (description === previous) unchanged++;
          else extracted++;
        } else {
          console.log(`  [${perk.role}] ${perk.name.en} (${ruTitle}): unrecognized page structure, skipped`);
          skipped++;
        }
      } catch (err) {
        console.warn(`  [${perk.role}] ${perk.name.en} (${ruTitle}): fetch failed (${(err as Error).message})`);
        skipped++;
      }
      if (i < perks.length - 1) await sleep(REQUEST_DELAY_MS);
    }
  }

  const output = {
    _comment:
      "Raw (uncurated) RU description text per perk slug, scraped from each perk's own RU wiki page — see scripts/sync-descriptions.ts. getPerkDescription() runs this through the same auto-highlight/sentence-split pipeline used for the English fallback. A hand-authored entry in description-translations.ru.json always takes priority over this file.",
    ...existing,
  };
  writeFileSync(DESCRIPTION_RU_RAW_JSON, JSON.stringify(output, null, 2) + "\n");

  console.log(
    `\nDone: ${extracted} extracted (${unchanged} unchanged), ${skipped} skipped (kept English fallback).`,
  );
  console.log(`Wrote ${DESCRIPTION_RU_RAW_JSON}`);
  console.log("Run `npm run scrape:perks` to bake these into data/perks.json.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
