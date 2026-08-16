// Fills in the "addon:*" entries of data/loadout-translations.ru.json (RU
// names) and data/loadout-description-ru-raw.json (RU raw descriptions) for
// all ~795 add-ons. Run manually via `npm run sync:loadout-addons`.
//
// Add-ons don't get their own individual RU wiki page the way perks/items/
// offerings do — inspecting the RU wiki by hand found they're grouped onto
// combined pages instead, one per survivor item type or killer power, named
// "<RU item/power name> (улучшения)" (e.g. "Медвежий капкан (улучшения)" —
// "Bear Trap (add-ons)"), mirroring how the English wiki's own Add-ons page
// lays things out under one heading per group (see scripts/scrape-loadout.ts).
// That rules out a per-slug opensearch lookup (scripts/sync-loadout-localization.ts's
// approach) — there's no single matching page to find.
//
// What makes this tractable without guessing which RU row is which EN
// add-on: every row's name cell is formatted "<RU name><br>(англ. <EN name>)"
// — the wiki's own editors already wrote the English cross-reference right
// there (confirmed by inspecting several rows by hand). So instead of
// correlating rows by position or page topic, this fetches every combined
// page (discovered via Категория:Улучшения, not a hand-typed list — a new
// killer's page is picked up automatically next run), extracts every row's
// (RU name, EN name, RU description) triple, and matches purely on the EN
// name against data/addons.json. A handful (3 of 795, checked by hand) of
// add-ons share an English name across two different killers/items
// (coincidence, not a data error — e.g. "Jump Rope" exists for both The
// Nightmare and The Good Guy) — both get the same RU text in that case,
// same as a human translator would naturally produce for an identical name.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import type { Addon } from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const ADDONS_JSON = join(DATA_DIR, "addons.json");
const TRANSLATIONS_JSON = join(DATA_DIR, "loadout-translations.ru.json");
const DESCRIPTION_RU_RAW_JSON = join(DATA_DIR, "loadout-description-ru-raw.json");

const RU_WIKI_API = "https://dead-by-daylight.fandom.com/ru/api.php";
const REQUEST_HEADERS = {
  "User-Agent": "dbd-perk-randomizer localization sync (personal site, contact via github)",
};
const REQUEST_DELAY_MS = 200; // one full page-parse per group, not per add-on — can afford to be extra polite
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: REQUEST_HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json() as Promise<T>;
}

interface CategoryMembersResponse {
  query?: { categorymembers?: { title: string }[] };
  continue?: { cmcontinue?: string };
}

async function fetchCombinedPageTitles(): Promise<string[]> {
  const titles: string[] = [];
  let cmcontinue: string | undefined;
  do {
    const params = new URLSearchParams({
      action: "query",
      list: "categorymembers",
      cmtitle: "Категория:Улучшения",
      cmlimit: "500",
      format: "json",
    });
    if (cmcontinue) params.set("cmcontinue", cmcontinue);
    const data = await fetchJson<CategoryMembersResponse>(`${RU_WIKI_API}?${params}`);
    for (const m of data.query?.categorymembers ?? []) titles.push(m.title);
    cmcontinue = data.continue?.cmcontinue;
    if (cmcontinue) await sleep(REQUEST_DELAY_MS);
  } while (cmcontinue);
  return titles;
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

interface ExtractedRow {
  nameRu: string;
  nameEn: string;
  descriptionRu: string;
}

// Deliberately does NOT strip quote characters from the captured name —
// several real add-on names include a literal quoted word as part of the
// name itself (e.g. Doctor's `"Calm" - Class I`), confirmed against
// data/addons.json, so stripping wrapping quotes silently truncated those
// on an earlier version of this regex instead of just being a no-op.
const EN_NAME_RE = /\(англ\.\s*(.+?)\)\s*$/;

function extractRowsFromTable($: cheerio.CheerioAPI, table: Cheerio<AnyNode>): ExtractedRow[] {
  const rows: ExtractedRow[] = [];
  table.find("tr").each((i, tr) => {
    if (i === 0) return; // header row
    const cells = $(tr).find("td, th");
    if (cells.length < 3) return;

    const nameCellText = cells.eq(1).text().replace(/\s+/g, " ").trim();
    const match = nameCellText.match(EN_NAME_RE);
    if (!match) return; // no EN cross-reference — can't safely attribute this row

    const nameEn = match[1].trim();
    const nameRu = nameCellText.slice(0, match.index).replace(/\s+$/, "").trim();
    const descriptionRu = cells.eq(2).text().replace(/\s+/g, " ").trim();
    if (!nameRu || !descriptionRu) return;

    rows.push({ nameRu, nameEn, descriptionRu });
  });
  return rows;
}

/** Only tables whose header row reads "Иконка Название Описание" (icon/
 *  name/description) are add-on data — combined pages also carry unrelated
 *  tables (a rarity-tier legend, a cosmetic gallery, ...) that this must
 *  not mistake for add-on rows. */
function findAddonTables($: cheerio.CheerioAPI): Cheerio<AnyNode>[] {
  const tables: Cheerio<AnyNode>[] = [];
  $("table.article-table, table.wikitable").each((_, el) => {
    const $table = $(el);
    const headerText = $table.find("tr").first().text().replace(/\s+/g, " ").trim();
    if (/Иконка/.test(headerText) && /Название/.test(headerText) && /Описание/.test(headerText)) {
      tables.push($table as Cheerio<AnyNode>);
    }
  });
  return tables;
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
  const addons: Addon[] = loadJson(ADDONS_JSON, []);
  if (addons.length === 0) {
    throw new Error(`No add-ons found at ${ADDONS_JSON} — run \`npm run scrape:loadout\` first.`);
  }

  // Multiple add-ons can share an English name (see header comment) — a
  // map to arrays covers that without losing any of them. Keyed
  // case-insensitively: the RU wiki's own "(англ. X)" cross-reference
  // doesn't consistently preserve the EN wiki's Title Case (spot-checked —
  // e.g. "Iridescent Feather" shows up there as "Iridescent feather"), so
  // matching on exact case silently dropped a large fraction of add-ons on
  // the first run of this script.
  const bySlugForName = new Map<string, Addon[]>();
  for (const addon of addons) {
    const key = addon.name.en.toLowerCase();
    const list = bySlugForName.get(key) ?? [];
    list.push(addon);
    bySlugForName.set(key, list);
  }

  const translations = loadJson<Record<string, string>>(TRANSLATIONS_JSON, {});
  const descriptions = loadJson<Record<string, string>>(DESCRIPTION_RU_RAW_JSON, {});

  console.log("Fetching combined add-on group pages from the RU wiki (Категория:Улучшения)...");
  const pageTitles = await fetchCombinedPageTitles();
  console.log(`  ${pageTitles.length} group pages found`);

  const matchedSlugs = new Set<string>();
  let rowsSeen = 0;
  let pagesFailed = 0;

  for (const [i, title] of pageTitles.entries()) {
    try {
      const html = await fetchPageHtml(title);
      if (!html) {
        pagesFailed++;
      } else {
        const $ = cheerio.load(html.replace(/<br\s*\/?>/gi, "\n"));
        const tables = findAddonTables($);
        for (const table of tables) {
          const rows = extractRowsFromTable($, table);
          rowsSeen += rows.length;
          for (const row of rows) {
            const matches = bySlugForName.get(row.nameEn.toLowerCase());
            if (!matches) continue;
            for (const addon of matches) {
              const key = `addon:${addon.slug}`;
              translations[key] = row.nameRu;
              descriptions[key] = row.descriptionRu;
              matchedSlugs.add(addon.slug);
            }
          }
        }
      }
    } catch (err) {
      pagesFailed++;
      console.warn(`  "${title}": fetch/parse failed (${(err as Error).message})`);
    }
    if (i < pageTitles.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  const { _comment: transComment, ...restTranslations } = translations;
  writeFileSync(TRANSLATIONS_JSON, JSON.stringify({ _comment: transComment, ...restTranslations }, null, 2) + "\n");

  const { _comment: descComment, ...restDescriptions } = descriptions;
  writeFileSync(
    DESCRIPTION_RU_RAW_JSON,
    JSON.stringify(
      {
        _comment:
          descComment ??
          "Raw (uncurated) RU description text per item/offering/add-on, keyed 'kind:slug' — see scripts/sync-loadout-descriptions.ts (items/offerings) and scripts/sync-loadout-addons.ts (add-ons).",
        ...restDescriptions,
      },
      null,
      2,
    ) + "\n",
  );

  const unmatched = addons.filter((a) => !matchedSlugs.has(a.slug));
  console.log(
    `\nDone: ${rowsSeen} rows read across ${pageTitles.length} pages (${pagesFailed} pages failed), ` +
      `${matchedSlugs.size} of ${addons.length} add-ons matched.`,
  );
  if (unmatched.length > 0) {
    console.log(`${unmatched.length} add-ons kept their English fallback (no matching row found):`);
    for (const a of unmatched.slice(0, 20)) console.log(`  [${a.role}/${a.character}] ${a.name.en}`);
    if (unmatched.length > 20) console.log(`  ...and ${unmatched.length - 20} more`);
  }
  console.log(`Wrote ${TRANSLATIONS_JSON} and ${DESCRIPTION_RU_RAW_JSON}`);
  console.log("Run `npm run scrape:loadout` to bake these into data/addons.json.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
