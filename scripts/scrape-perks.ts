// Scheduled data pipeline: reads the official DBD wiki's Perks page and turns
// it into data/perks.json + public/perks/<role>/<slug>.webp. Run manually via
// `npm run scrape:perks`, and on a schedule by .github/workflows/update-perks.yml.
// This replaces the old approach of hand-editing a perk array + hand-importing
// icon files every time a DLC ships.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import sharp from "sharp";
import { slugify } from "../lib/slugify";
import type { Perk, PerkRole, PerksMeta } from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIKI_PAGE_URL = "https://deadbydaylight.fandom.com/wiki/Perks";
// The plain page URL sits behind a Cloudflare JS challenge that blocks
// non-browser HTTP clients. The MediaWiki parse API returns the same
// rendered HTML (same tables, same data-src icon URLs) without it.
const SOURCE_URL =
  "https://deadbydaylight.fandom.com/api.php?action=parse&page=Perks&format=json&prop=text";
const DATA_DIR = join(__dirname, "../data");
const PUBLIC_PERKS_DIR = join(__dirname, "../public/perks");
const PUBLIC_CHARACTERS_DIR = join(__dirname, "../public/characters");
const PERKS_JSON = join(DATA_DIR, "perks.json");
const META_JSON = join(DATA_DIR, "meta.json");
const TRANSLATIONS_JSON = join(DATA_DIR, "translations.ru.json");
const CHARACTERS_JSON = join(DATA_DIR, "characters.json");

const ICON_SIZE = 128;
const TABLE_INDEX_BY_ROLE: Record<PerkRole, number> = {
  survivor: 0,
  killer: 1,
};

interface ScrapedRow {
  name: string;
  slug: string;
  description: string;
  character: string;
  iconSourceUrl: string;
  characterPortraitUrl: string;
}

function loadPreviousCharacters(): Record<string, string> {
  if (!existsSync(CHARACTERS_JSON)) return {};
  try {
    return JSON.parse(readFileSync(CHARACTERS_JSON, "utf8"));
  } catch {
    return {};
  }
}

function loadTranslations(): Record<string, string> {
  if (!existsSync(TRANSLATIONS_JSON)) return {};
  return JSON.parse(readFileSync(TRANSLATIONS_JSON, "utf8"));
}

function loadPreviousPerks(): Perk[] {
  if (!existsSync(PERKS_JSON)) return [];
  try {
    return JSON.parse(readFileSync(PERKS_JSON, "utf8"));
  } catch {
    return [];
  }
}

const REQUEST_HEADERS = {
  "User-Agent": "vortex-info-next perk scraper (personal site, contact via github)",
};

interface MediaWikiParseResponse {
  parse?: { text?: { "*"?: string } };
  error?: { info?: string };
}

async function fetchWikiPageHtml(): Promise<string> {
  const res = await fetch(SOURCE_URL, { headers: REQUEST_HEADERS });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${SOURCE_URL}: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as MediaWikiParseResponse;
  const html = json.parse?.text?.["*"];
  if (!html) {
    throw new Error(
      `Unexpected MediaWiki API response: ${json.error?.info ?? "no parse.text.*"}`,
    );
  }
  return html;
}

// The wiki prepends this notice, with no separating whitespace, to any perk
// whose numbers are previewed for an upcoming patch — e.g. "...Patch
// 7.7.0You are fuelled by...". Strip it; it's wiki-editorial metadata, not
// part of the perk's actual description.
const UPCOMING_PATCH_NOTICE =
  /^This description is based on the changes announced for or featured in the upcoming Patch [\d.]+\s*/;

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cleanDescription(text: string): string {
  return cleanText(text).replace(UPCOMING_PATCH_NOTICE, "");
}

function parseRole($: cheerio.CheerioAPI, role: PerkRole): ScrapedRow[] {
  const table = $("table.wikitable").eq(TABLE_INDEX_BY_ROLE[role]);
  const rows: ScrapedRow[] = [];

  table.find("tr").each((i, tr) => {
    if (i === 0) return; // header row
    const cells = $(tr).find("th, td");
    if (cells.length < 4) return;

    const iconCell = cells.eq(0);
    const nameCell = cells.eq(1);
    const descriptionCell = cells.eq(2);
    const characterCell = cells.eq(3);

    const name = cleanText(nameCell.text());
    const iconSourceUrl = iconCell.find("img").attr("data-src") ?? "";
    if (!name || !iconSourceUrl) return;

    const portraitSrc = characterCell.find(".charPortraitWrapper img").attr("data-src") ?? "";

    rows.push({
      name,
      slug: slugify(name),
      description: cleanDescription(descriptionCell.text()),
      character: cleanText(characterCell.text()),
      iconSourceUrl: iconSourceUrl.split("/revision/")[0], // strip cache-buster path segment
      characterPortraitUrl: portraitSrc ? portraitSrc.split("/revision/")[0] : "",
    });
  });

  return rows;
}

async function downloadIcon(
  row: ScrapedRow,
  role: PerkRole,
  previous: Map<string, Perk>,
): Promise<string> {
  const destRelative = `/perks/${role}/${row.slug}.webp`;
  const destAbsolute = join(PUBLIC_PERKS_DIR, role, `${row.slug}.webp`);

  const prev = previous.get(`${role}/${row.slug}`);
  if (prev && existsSync(destAbsolute)) {
    // Skip re-downloading when the source URL hasn't changed since last run.
    return destRelative;
  }

  const res = await fetch(row.iconSourceUrl, { headers: REQUEST_HEADERS });
  if (!res.ok) {
    throw new Error(
      `Failed to download icon for ${row.name}: ${res.status} ${res.statusText}`,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  mkdirSync(dirname(destAbsolute), { recursive: true });
  await sharp(buffer)
    .resize(ICON_SIZE, ICON_SIZE, { fit: "cover" })
    .webp({ quality: 90 })
    .toFile(destAbsolute);

  return destRelative;
}

async function downloadPortrait(
  characterName: string,
  sourceUrl: string,
  previous: Record<string, string>,
): Promise<string> {
  const slug = slugify(characterName);
  const destRelative = `/characters/${slug}.webp`;
  const destAbsolute = join(PUBLIC_CHARACTERS_DIR, `${slug}.webp`);

  if (previous[characterName] === destRelative && existsSync(destAbsolute)) {
    // Skip re-downloading when we already have this character's portrait.
    return destRelative;
  }

  const res = await fetch(sourceUrl, { headers: REQUEST_HEADERS });
  if (!res.ok) {
    throw new Error(
      `Failed to download portrait for ${characterName}: ${res.status} ${res.statusText}`,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  mkdirSync(dirname(destAbsolute), { recursive: true });
  await sharp(buffer)
    .resize(256, 256, { fit: "cover" })
    .webp({ quality: 90 })
    .toFile(destAbsolute);

  return destRelative;
}

async function main() {
  console.log(`Fetching ${WIKI_PAGE_URL} via MediaWiki API ...`);
  const html = await fetchWikiPageHtml();
  const $ = cheerio.load(html);

  const translations = loadTranslations();
  const previous = new Map(
    loadPreviousPerks().map((p) => [`${p.role}/${p.slug}`, p]),
  );
  const previousCharacters = loadPreviousCharacters();
  const scrapedAt = new Date().toISOString();

  const perks: Perk[] = [];
  const characterPortraitUrls = new Map<string, string>();
  for (const role of Object.keys(TABLE_INDEX_BY_ROLE) as PerkRole[]) {
    const rows = parseRole($, role);
    console.log(`Found ${rows.length} ${role} perks`);

    for (const row of rows) {
      const icon = await downloadIcon(row, role, previous);
      const prev = previous.get(`${role}/${row.slug}`);
      perks.push({
        slug: row.slug,
        role,
        name: { en: row.name, ru: translations[row.slug] ?? row.name },
        description: row.description,
        character: row.character,
        icon,
        addedAt: prev?.addedAt ?? scrapedAt,
      });
      if (row.character && row.characterPortraitUrl && !characterPortraitUrls.has(row.character)) {
        characterPortraitUrls.set(row.character, row.characterPortraitUrl);
      }
    }
  }

  const characters: Record<string, string> = {};
  for (const [characterName, sourceUrl] of characterPortraitUrls) {
    characters[characterName] = await downloadPortrait(characterName, sourceUrl, previousCharacters);
  }
  console.log(`Found ${characterPortraitUrls.size} unique characters`);

  if (perks.length === 0) {
    throw new Error("Scraped 0 perks — the wiki's table structure may have changed.");
  }

  const meta: PerksMeta = {
    scrapedAt,
    sourceUrl: WIKI_PAGE_URL,
    survivorCount: perks.filter((p) => p.role === "survivor").length,
    killerCount: perks.filter((p) => p.role === "killer").length,
  };

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PERKS_JSON, JSON.stringify(perks, null, 2) + "\n");
  writeFileSync(META_JSON, JSON.stringify(meta, null, 2) + "\n");
  writeFileSync(CHARACTERS_JSON, JSON.stringify(characters, null, 2) + "\n");

  console.log(
    `Wrote ${perks.length} perks (${meta.survivorCount} survivor / ${meta.killerCount} killer) -> ${PERKS_JSON}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
