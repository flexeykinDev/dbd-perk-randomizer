// Refreshes data/translations.ru.json from the *official* Russian DBD wiki
// (a separate Fandom instance, not a language variant of the English one —
// see the note below) instead of hand-typing perk names. Run manually via
// `npm run sync:localization`; scrape-perks.ts picks up whatever this
// writes on its next run, same as any other hand-edit to that file.
//
// Why this isn't a category-scrape-and-fuzzy-match pipeline: an EN->RU
// title lookup turns out to be one direct call per perk. Fandom's search
// index resolves the *English* perk name to the correct Russian article via
// `action=opensearch` (it indexes each article's alternate/redirect titles,
// and RU perk pages redirect from their English name) — confirmed by hand
// against ~10 perks including deliberately generic-sounding ones
// (Deliverance, Distortion, No Way Out) with zero false positives. That
// top-1 result is then cross-checked against the wiki's own two perk
// categories, fetched separately, before being trusted — belt-and-suspenders
// against the rare case where opensearch's top hit is a non-perk page.
//
// That belt-and-suspenders check caught a real bug during development: each
// category also contains one "all perks in this role" overview/hub article
// (title "Навыки выживших" / "Навыки убийц" — filed under its own category
// alongside the individual perks it lists), and for a few short/common perk
// names (Bond, Agitation) opensearch ranked that hub page above the actual
// perk article. Individual perk articles run a few KB; the hub pages run
// 20+ — fetchCategoryTitles excludes anything over that size so the
// whitelist only ever contains genuine single-perk pages.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Perk } from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const PERKS_JSON = join(DATA_DIR, "perks.json");
const TRANSLATIONS_JSON = join(DATA_DIR, "translations.ru.json");

// dead-by-daylight.fandom.com/ru/ (hyphenated domain, /ru/ path) is an
// independently-run community wiki — NOT a language variant reachable via
// deadbydaylight.fandom.com's (no hyphen) own interwiki `langlinks`, which
// only cover de/es/fr/it/pl/pt/zh (checked directly against the API; ru is
// absent). Hence looking it up as its own site rather than following a
// language link from the English wiki.
const RU_WIKI_API = "https://dead-by-daylight.fandom.com/ru/api.php";

// The literal, official category names on that wiki — NOT a transliteration
// of "Перки_убийц"/"Перки_выживших" (that category doesn't exist; the site
// categorizes perks under "abilities", matching the pattern of the English
// wiki's own interwiki labels, e.g. German "Talente", French "Compétences" —
// none of which transliterate "Perks" either). Verified via
// `action=query&list=allcategories&acprefix=Перк`, which returned nothing,
// then by checking a known perk page's own `prop=categories`.
const RU_CATEGORY: Record<Perk["role"], string> = {
  survivor: "Категория:Умения Выживших",
  killer: "Категория:Умения Убийц",
};

const REQUEST_HEADERS = {
  "User-Agent": "dbd-perk-randomizer localization sync (personal site, contact via github)",
};

// Be a polite API citizen — this makes on the order of ~280 sequential
// requests (one per perk) plus two category dumps, unlike scrape-perks.ts's
// single table-parse call.
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

// A genuine single-perk article runs roughly 1-6KB on this wiki (checked
// across a dozen samples); the per-role "all perks" hub page runs 20+KB.
// 10KB gives a wide margin on both sides.
const MAX_PLAUSIBLE_PERK_PAGE_BYTES = 10_000;

/** All page titles the wiki itself has filed under a perk category — the
 *  authoritative "this is really a perk page" whitelist opensearch matches
 *  get checked against. Uses `generator=categorymembers` (rather than
 *  `list=categorymembers`) specifically so `prop=info`'s page length comes
 *  back in the same request, letting the hub-page exclusion above happen
 *  here instead of costing an extra round trip per matched perk. */
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
      if ((page.length ?? 0) <= MAX_PLAUSIBLE_PERK_PAGE_BYTES) titles.add(page.title);
    }
    gcmcontinue = data.continue?.gcmcontinue;
    if (gcmcontinue) await sleep(REQUEST_DELAY_MS);
  } while (gcmcontinue);
  return titles;
}

type OpenSearchResponse = [string, string[], string[], string[]];

/** Looks up an English perk name against the RU wiki's search index and
 *  returns the top-matching page title, or null if nothing came back. */
async function searchRuTitle(englishName: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: "opensearch",
    search: englishName,
    format: "json",
    limit: "1",
  });
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

async function main() {
  const perks: Perk[] = loadJson(PERKS_JSON, []);
  if (perks.length === 0) {
    throw new Error(`No perks found at ${PERKS_JSON} — run \`npm run scrape:perks\` first.`);
  }

  const rawTranslations = loadJson<Record<string, string>>(TRANSLATIONS_JSON, {});
  // The file carries a "_comment" documentation key alongside real
  // slug->name entries (see data/translations.ru.json) — keep it, but don't
  // let it get mistaken for a perk's translation.
  const { _comment, ...translations } = rawTranslations;

  console.log("Fetching perk categories from the RU wiki...");
  const [survivorTitles, killerTitles] = await Promise.all([
    fetchCategoryTitles(RU_CATEGORY.survivor),
    fetchCategoryTitles(RU_CATEGORY.killer),
  ]);
  console.log(
    `  ${survivorTitles.size} survivor / ${killerTitles.size} killer titles categorized on the wiki`,
  );

  let matched = 0;
  let unchanged = 0;
  let keptExisting = 0;
  let fellBackToEnglish = 0;

  for (const [i, perk] of perks.entries()) {
    const categoryTitles = perk.role === "survivor" ? survivorTitles : killerTitles;
    const previous = translations[perk.slug];

    let ruName: string;
    try {
      const found = await searchRuTitle(perk.name.en);
      if (found && categoryTitles.has(found)) {
        ruName = found;
        if (found !== previous) {
          console.log(
            `  [${perk.role}] ${perk.name.en}: "${previous ?? "(none)"}" -> "${found}"`,
          );
        }
        matched++;
      } else {
        // opensearch found nothing, or found something the wiki doesn't
        // actually categorize as this perk (e.g. a character/item page) —
        // don't trust it. Keep whatever we already had.
        ruName = previous ?? perk.name.en;
        if (previous) keptExisting++;
        else fellBackToEnglish++;
      }
    } catch (err) {
      // A single perk's lookup failing (network hiccup, API hiccup) must
      // not take down the whole sync — keep the existing translation and
      // move on, same fallback as "not found".
      console.warn(`  [${perk.role}] ${perk.name.en}: lookup failed (${(err as Error).message})`);
      ruName = previous ?? perk.name.en;
      if (previous) keptExisting++;
      else fellBackToEnglish++;
    }

    if (ruName === previous) unchanged++;
    translations[perk.slug] = ruName;

    if (i < perks.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  const output = { _comment, ...translations };
  writeFileSync(TRANSLATIONS_JSON, JSON.stringify(output, null, 2) + "\n");

  console.log(
    `\nDone: ${matched} confirmed via the wiki (${unchanged} unchanged), ` +
      `${keptExisting} kept their existing translation, ${fellBackToEnglish} fell back to English.`,
  );
  console.log(`Wrote ${TRANSLATIONS_JSON}`);
  console.log("Run `npm run scrape:perks` to bake these into data/perks.json.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
