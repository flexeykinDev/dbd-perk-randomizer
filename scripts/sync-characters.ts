// Refreshes data/character-translations.ru.json from the official Russian
// DBD wiki, same approach and same wiki as sync-localization.ts (see that
// file for why it's a separate site, not a language variant). Run manually
// via `npm run sync:characters`.
//
// Survivor character pages are titled "First Last" (e.g. "Дуайт
// Фэйрфилд") — perk.character only ever holds the first name ("Dwight"),
// so the match gets truncated to its first word. Killer pages are titled
// with their (often multi-word) epithet as-is ("Торговка черепами") and
// used verbatim. Which rule applies is derived from data/perks.json itself
// (a character's role is whatever role the perks naming them have) rather
// than guessed, so this doesn't need its own hardcoded character/role list.
//
// Validation is fussier here than sync-localization.ts's, for two reasons
// found by hand while building this:
//   1. A character's own DLC chapter page ("Подглава: Гоуст Фейс",
//      "Событие. Вечный Мор") often outranks the actual character page in
//      opensearch relevance for that character's name, on top of the
//      "Выжившие"/"Убийца" hub-page trap sync-localization.ts already
//      handles for perks — so this fetches the top 5 candidates, not just
//      the top 1, and walks them for the first one that isn't a chapter/hub
//      page.
//   2. Perk pages run a fairly tight 1-6KB; character lore pages don't —
//      "Мор" (Blight's *correct* page) is 24KB, well past where the hub
//      pages sit (14-17KB), so length can't separate real character pages
//      from hub pages the way it does for perks. Category membership
//      (Категория:Персонажи) is used instead — except the hub pages are
//      *themselves* filed under that same category, so title-prefix
//      exclusion (Глава:/Подглава/Событие, plus the two hub titles by name)
//      still has to carry the rest of the weight.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Perk, PerkRole } from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const PERKS_JSON = join(DATA_DIR, "perks.json");
const CHARACTER_TRANSLATIONS_JSON = join(DATA_DIR, "character-translations.ru.json");

const RU_WIKI_API = "https://dead-by-daylight.fandom.com/ru/api.php";
const CHARACTER_CATEGORY = "Категория:Персонажи";
const NON_CHARACTER_PREFIXES = ["Глава:", "Глава ", "Подглава", "Событие"];
const NON_CHARACTER_TITLES = new Set(["Выжившие", "Убийца", "Убийцы"]);

// The EN wiki displays every survivor "Given Family" (Western order), which
// is where perk.character's first-word convention comes from — but the RU
// wiki titles a couple of pages "Family Given" instead (confirmed by hand:
// Yun-Jin Lee's RU page is "Ли Юнчин", family name first, even though her
// EN page is the usual "Yun-Jin Lee"). Taking the RU title's first word for
// those specific survivors would silently grab the surname instead of the
// given name, so they're special-cased to the *second* word instead.
const RU_TITLE_SURNAME_FIRST = new Set(["Yun-Jin"]);

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
  query?: { pages?: Record<string, { title: string }> };
  continue?: { gcmcontinue?: string };
}

async function fetchCategoryTitles(category: string): Promise<Set<string>> {
  const titles = new Set<string>();
  let gcmcontinue: string | undefined;
  do {
    const params = new URLSearchParams({
      action: "query",
      generator: "categorymembers",
      gcmtitle: category,
      gcmlimit: "500",
      format: "json",
    });
    if (gcmcontinue) params.set("gcmcontinue", gcmcontinue);
    const data = await fetchJson<CategoryInfoResponse>(`${RU_WIKI_API}?${params}`);
    for (const page of Object.values(data.query?.pages ?? {})) titles.add(page.title);
    gcmcontinue = data.continue?.gcmcontinue;
    if (gcmcontinue) await sleep(REQUEST_DELAY_MS);
  } while (gcmcontinue);
  return titles;
}

type OpenSearchResponse = [string, string[], string[], string[]];

function looksLikeCharacterPage(title: string): boolean {
  if (NON_CHARACTER_TITLES.has(title)) return false;
  return !NON_CHARACTER_PREFIXES.some((prefix) => title.startsWith(prefix));
}

/** Top-5 opensearch candidates, not just the top-1 sync-localization.ts
 *  uses for perks — chapter/event pages routinely outrank the actual
 *  character page for that character's own name, so the caller needs
 *  somewhere to fall through to. */
async function searchRuTitleCandidates(englishName: string): Promise<string[]> {
  const params = new URLSearchParams({
    action: "opensearch",
    search: englishName,
    format: "json",
    limit: "5",
  });
  const [, titles] = await fetchJson<OpenSearchResponse>(`${RU_WIKI_API}?${params}`);
  return titles;
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

  // Derive each character's role from the perks that name them — role
  // tells us whether to truncate the RU match to its first word
  // (survivors) or keep it whole (killers).
  const roleByCharacter = new Map<string, PerkRole>();
  for (const perk of perks) {
    if (perk.character === ".All") continue;
    roleByCharacter.set(perk.character, perk.role);
  }

  const rawTranslations = loadJson<Record<string, string>>(CHARACTER_TRANSLATIONS_JSON, {});
  const { _comment, ...translations } = rawTranslations;

  console.log("Fetching the character category from the RU wiki...");
  const characterTitles = await fetchCategoryTitles(CHARACTER_CATEGORY);
  console.log(`  ${characterTitles.size} titles categorized as characters`);

  const characters = [...roleByCharacter.keys()].sort((a, b) => a.localeCompare(b));
  console.log(`Syncing ${characters.length} characters against the RU wiki...`);

  let matched = 0;
  let unchanged = 0;
  let keptExisting = 0;

  for (const [i, character] of characters.entries()) {
    const role = roleByCharacter.get(character)!;
    const previous = translations[character];

    let ruName: string;
    try {
      const searchTerm = character === "Trapper" ? "The Trapper" : character;
      const candidates = await searchRuTitleCandidates(searchTerm);
      const found = candidates.find(
        (title) => characterTitles.has(title) && looksLikeCharacterPage(title),
      );

      if (found) {
        const words = found.split(" ");
        const givenNameIndex = RU_TITLE_SURNAME_FIRST.has(character) ? 1 : 0;
        ruName = role === "survivor" ? (words[givenNameIndex] ?? found) : found;
        if (ruName !== previous) {
          console.log(`  [${role}] ${character}: "${previous ?? "(none)"}" -> "${ruName}"`);
        }
        matched++;
      } else {
        ruName = previous ?? character;
        keptExisting++;
      }
    } catch (err) {
      console.warn(`  [${role}] ${character}: lookup failed (${(err as Error).message})`);
      ruName = previous ?? character;
      keptExisting++;
    }

    if (ruName === previous) unchanged++;
    translations[character] = ruName;

    if (i < characters.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  const output = { _comment, ...translations };
  writeFileSync(CHARACTER_TRANSLATIONS_JSON, JSON.stringify(output, null, 2) + "\n");

  console.log(
    `\nDone: ${matched} confirmed via the wiki (${unchanged} unchanged), ` +
      `${keptExisting} kept their existing translation.`,
  );
  console.log(`Wrote ${CHARACTER_TRANSLATIONS_JSON}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
