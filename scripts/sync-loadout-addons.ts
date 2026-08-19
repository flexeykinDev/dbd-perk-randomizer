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

/** How far apart two names may be, as a fraction of the name's length,
 *  before a within-page pairing is refused. 0.34 accepts `Adi Valente
 *  Issue 1` / `Adi Valente #1` (the widest real gap in the corpus) and
 *  still refuses The Ghost Face's `Cinch Straps`, which has no RU row at
 *  all and would otherwise be handed the nearest unrelated leftover. */
const MAX_RELATIVE_DISTANCE = 0.34;
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

/** A form of the English name that both wikis agree on.
 *
 *  The two wikis punctuate the same add-on differently, and the difference
 *  is not one rule. The Wraith's are `"The Beast" - Soot` on wiki.gg and
 *  `The Beast Soot` here, so the quotes and the dash have to *go away*;
 *  but the possessives are `Akito's Crutch` against `Akitos Crutch`, where
 *  the apostrophe has to go away *without leaving a gap* — turning it into
 *  a space gives "akito s" and stops matching.
 *
 *  So the two kinds of punctuation are treated differently on purpose:
 *  quotes and apostrophes are deleted, joining what they separated, and
 *  everything else becomes a space. An earlier version folded dashes to a
 *  literal "-" and kept it, which is why eighteen of The Wraith's twenty
 *  add-ons never matched; deleting all punctuation instead would have
 *  fixed those and broken the nine possessives.
 *
 *  The NFD pass strips diacritics for the same reason — The Spirit's
 *  `Zōri` is written `Zori` on the RU wiki. */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['‘’"“”«»`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Levenshtein distance, used only to pair leftovers within one page (see
 *  matchLeftoversByPage) — never across the whole corpus. */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...(Array(b.length).fill(0) as number[])]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** True when one name is the other with words added on — how a renamed
 *  add-on usually reads (`Caught On Tape` became `"Ghost Face Caught on
 *  Tape"`). Both sides must be several words, so a single shared common
 *  word can't trigger it. */
function oneContainsTheOther(a: string, b: string): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.split(" ").length < 2) return false;
  return longer === shorter || longer.startsWith(`${shorter} `) || longer.endsWith(` ${shorter}`) ||
    longer.includes(` ${shorter} `);
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
    const key = normalizeName(addon.name.en);
    const list = bySlugForName.get(key) ?? [];
    list.push(addon);
    bySlugForName.set(key, list);
  }

  const translations = loadJson<Record<string, string>>(TRANSLATIONS_JSON, {});
  const descriptions = loadJson<Record<string, string>>(DESCRIPTION_RU_RAW_JSON, {});

  console.log("Fetching combined add-on group pages from the RU wiki (Категория:Улучшения)...");
  const pageTitles = await fetchCombinedPageTitles();
  console.log(`  ${pageTitles.length} group pages found`);

  let pagesFailed = 0;
  const allRows: (ExtractedRow & { page: string })[] = [];

  for (const [i, title] of pageTitles.entries()) {
    try {
      const html = await fetchPageHtml(title);
      if (!html) {
        pagesFailed++;
      } else {
        const $ = cheerio.load(html.replace(/<br\s*\/?>/gi, "\n"));
        for (const table of findAddonTables($)) {
          for (const row of extractRowsFromTable($, table)) allRows.push({ ...row, page: title });
        }
      }
    } catch (err) {
      pagesFailed++;
      console.warn(`  "${title}": fetch/parse failed (${(err as Error).message})`);
    }
    if (i < pageTitles.length - 1) await sleep(REQUEST_DELAY_MS);
  }
  const rowsSeen = allRows.length;

  const matchedSlugs = new Set<string>();
  const usedRows = new Set<(typeof allRows)[number]>();
  const apply = (addon: Addon, row: ExtractedRow) => {
    const key = `addon:${addon.slug}`;
    translations[key] = row.nameRu;
    descriptions[key] = row.descriptionRu;
    matchedSlugs.add(addon.slug);
  };

  // --- pass 1: the English names agree once punctuation is set aside ---
  // Which page belongs to which killer is recorded as a side effect, since
  // pass 2 needs it and this is the only thing that knows it for certain.
  const pageOwners = new Map<string, Set<string>>();
  for (const row of allRows) {
    const matches = bySlugForName.get(normalizeName(row.nameEn));
    if (!matches) continue;
    usedRows.add(row);
    for (const addon of matches) {
      apply(addon, row);
      pageOwners.set(row.page, (pageOwners.get(row.page) ?? new Set()).add(addon.character));
    }
  }
  console.log(`  ${matchedSlugs.size} matched on the English name`);

  // --- pass 2: leftovers, paired within a single page ---
  //
  // The rest are the RU wiki's own typos and spelling drift, which no
  // normalization rule can be written against: `Granma's heart`,
  // `Infared Upgrade`, `Air Freshner`, `Pussy willow catking`, plus
  // British/American pairs that only appeared when the data moved to
  // wiki.gg (`Sulphuric`/`Sulfuric`, `Jewellery`/`Jewelry`, `Theatre`/
  // `Theater`).
  //
  // Fuzzy matching those across all 912 add-ons would be reckless. Scoped
  // to one page it is not: a page is one killer's power, pass 1 has
  // already established whose, and the leftovers on both sides are a
  // handful of names that are mutually very distinct. Assignment is
  // strictly one-to-one and best-first, so a row can't be handed to two
  // add-ons, and anything that stays ambiguous is left in English.
  const fuzzy: string[] = [];
  for (const [page, owners] of pageOwners) {
    // A page can belong to more than one killer — The Hillbilly and The
    // Cannibal both swing a chainsaw, so their add-ons share a page. That
    // only widens the pool to both killers' leftovers; it doesn't weaken
    // the scoping, because the pairing below is by name and best-first.
    // "Tuned Carburettor" and "Carburettor Tuning Guide" sit on those very
    // pages and both contain the same word, and each still lands on its
    // own row because the one-character match is claimed before any
    // looser one is considered.
    const rowPool = allRows.filter((r) => r.page === page && !usedRows.has(r));
    const addonPool = addons.filter((a) => owners.has(a.character) && !matchedSlugs.has(a.slug));
    if (rowPool.length === 0 || addonPool.length === 0) continue;

    const candidates = addonPool
      .flatMap((addon) =>
        rowPool.map((row) => {
          const [an, rn] = [normalizeName(addon.name.en), normalizeName(row.nameEn)];
          return { addon, row, distance: editDistance(an, rn), contained: oneContainsTheOther(an, rn) };
        }),
      )
      // Best first: a containment counts as a very close match, since a
      // renamed add-on can gain several words and still be the same thing.
      .sort((a, b) => (a.contained ? 0 : a.distance) - (b.contained ? 0 : b.distance));

    for (const c of candidates) {
      if (matchedSlugs.has(c.addon.slug) || usedRows.has(c.row)) continue;
      const relative = c.distance / Math.max(normalizeName(c.addon.name.en).length, 1);
      if (!c.contained && relative > MAX_RELATIVE_DISTANCE) continue;
      usedRows.add(c.row);
      apply(c.addon, c.row);
      fuzzy.push(
        `    [${c.addon.character}] "${c.addon.name.en}" <- "${c.row.nameEn}" = "${c.row.nameRu}"` +
          (c.contained ? " (renamed)" : ` (${c.distance} chars apart)`),
      );
    }
  }
  if (fuzzy.length > 0) {
    // Printed in full rather than counted: every one of these is a
    // judgement the script made on its own, and the list is short enough
    // to actually read before committing the result.
    console.log(`  ${fuzzy.length} more matched within a single group page:`);
    for (const line of fuzzy) console.log(line);
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
