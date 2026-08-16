// Refreshes the Item and Offering RU names in data/loadout-translations.ru.json
// from the official Russian DBD wiki, the same opensearch+category-verify
// approach scripts/sync-localization.ts uses for perks — see that file's
// header comment for why a direct EN->RU title lookup is reliable here
// (Fandom's search index resolves an English title to its RU article via
// `action=opensearch`, then the result is cross-checked against the wiki's
// own category listing before being trusted).
//
// Add-ons are deliberately NOT handled here — unlike perks/items/offerings,
// they don't have one wiki page each; the RU wiki groups them onto shared
// pages per item type / killer power (e.g. "Медвежий капкан (улучшения)"),
// mirroring the English Add-ons page's own table layout. See
// scripts/sync-loadout-addons.ts for that different (page-scrape, not
// per-slug lookup) approach.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Item, Offering } from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const ITEMS_JSON = join(DATA_DIR, "items.json");
const OFFERINGS_JSON = join(DATA_DIR, "offerings.json");
const TRANSLATIONS_JSON = join(DATA_DIR, "loadout-translations.ru.json");

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

interface CategoryInfoResponse {
  query?: { pages?: Record<string, { title: string; length?: number }> };
  continue?: { gcmcontinue?: string };
}

// Genuine item/offering articles run a few KB on this wiki; a stray hub/
// index page would run much larger — same safety margin sync-localization.ts
// uses for perks' "all perks" hub pages.
const MAX_PLAUSIBLE_PAGE_BYTES = 15_000;

async function fetchCategoryTitles(category: string): Promise<Set<string>> {
  const titles = new Set<string>();
  let gcmcontinue: string | undefined;
  do {
    const params = new URLSearchParams({
      action: "query",
      generator: "categorymembers",
      gcmtitle: category,
      gcmlimit: "500",
      prop: "info",
      format: "json",
    });
    if (gcmcontinue) params.set("gcmcontinue", gcmcontinue);
    const data = await fetchJson<CategoryInfoResponse>(`${RU_WIKI_API}?${params}`);
    for (const page of Object.values(data.query?.pages ?? {})) {
      if ((page.length ?? 0) <= MAX_PLAUSIBLE_PAGE_BYTES) titles.add(page.title);
    }
    gcmcontinue = data.continue?.gcmcontinue;
    if (gcmcontinue) await sleep(REQUEST_DELAY_MS);
  } while (gcmcontinue);
  return titles;
}

type OpenSearchResponse = [string, string[], string[], string[]];

async function searchRuTitle(englishName: string): Promise<string | null> {
  const params = new URLSearchParams({ action: "opensearch", search: englishName, format: "json", limit: "1" });
  const [, titles] = await fetchJson<OpenSearchResponse>(`${RU_WIKI_API}?${params}`);
  return titles[0] ?? null;
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

  const rawTranslations = loadJson<Record<string, string>>(TRANSLATIONS_JSON, {});
  const { _comment, ...translations } = rawTranslations;

  console.log("Fetching item/offering categories from the RU wiki...");
  const [itemTitles, survivorOfferingTitles, killerOfferingTitles, generalOfferingTitles] = await Promise.all([
    fetchCategoryTitles("Категория:Предметы"),
    fetchCategoryTitles("Категория:Подношения выживших"),
    fetchCategoryTitles("Категория:Подношения убийц"),
    fetchCategoryTitles("Категория:Общие подношения"),
  ]);
  const offeringTitles = new Set([...survivorOfferingTitles, ...killerOfferingTitles, ...generalOfferingTitles]);
  console.log(`  ${itemTitles.size} item / ${offeringTitles.size} offering titles categorized on the wiki`);

  const targets: SyncTarget[] = [
    ...items.map((i): SyncTarget => ({ kind: "item", slug: i.slug, nameEn: i.name.en })),
    ...offerings.map((o): SyncTarget => ({ kind: "offering", slug: o.slug, nameEn: o.name.en })),
  ];

  let matched = 0;
  let unchanged = 0;
  let keptExisting = 0;
  let fellBackToEnglish = 0;

  for (const [i, target] of targets.entries()) {
    const key = `${target.kind}:${target.slug}`;
    const categoryTitles = target.kind === "item" ? itemTitles : offeringTitles;
    const previous = translations[key];

    let ruName: string;
    try {
      const found = await searchRuTitle(target.nameEn);
      if (found && categoryTitles.has(found)) {
        ruName = found;
        if (found !== previous) console.log(`  [${target.kind}] ${target.nameEn}: "${previous ?? "(none)"}" -> "${found}"`);
        matched++;
      } else {
        ruName = previous ?? target.nameEn;
        if (previous) keptExisting++;
        else fellBackToEnglish++;
      }
    } catch (err) {
      console.warn(`  [${target.kind}] ${target.nameEn}: lookup failed (${(err as Error).message})`);
      ruName = previous ?? target.nameEn;
      if (previous) keptExisting++;
      else fellBackToEnglish++;
    }

    if (ruName === previous) unchanged++;
    translations[key] = ruName;

    if (i < targets.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  const output = { _comment, ...translations };
  writeFileSync(TRANSLATIONS_JSON, JSON.stringify(output, null, 2) + "\n");

  console.log(
    `\nDone: ${matched} confirmed via the wiki (${unchanged} unchanged), ` +
      `${keptExisting} kept their existing translation, ${fellBackToEnglish} fell back to English.`,
  );
  console.log(`Wrote ${TRANSLATIONS_JSON}`);
  console.log("Run `npm run scrape:loadout` to bake these into data/items.json / data/offerings.json.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
