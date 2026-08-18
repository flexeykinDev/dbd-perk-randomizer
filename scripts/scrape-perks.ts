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
import { partitionByRelease } from "./release-gate";
import type { LocalizedDescription, Perk, PerkRole, PerksMeta } from "../lib/types";

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
const DESCRIPTION_TRANSLATIONS_JSON = join(DATA_DIR, "description-translations.ru.json");
const DESCRIPTION_RU_RAW_JSON = join(DATA_DIR, "description-ru-raw.json");
const DESCRIPTION_OVERRIDES_EN_JSON = join(DATA_DIR, "description-overrides.en.json");
const NAME_OVERRIDES_EN_JSON = join(DATA_DIR, "name-overrides.en.json");
const ICON_OVERRIDES_JSON = join(DATA_DIR, "icon-overrides.json");
const SUPPLEMENTAL_PERKS_EN_JSON = join(DATA_DIR, "supplemental-perks.en.json");
const CHARACTERS_JSON = join(DATA_DIR, "characters.json");
const PERK_IDS_JSON = join(DATA_DIR, "perk-ids.json");
const ICON_SOURCES_JSON = join(DATA_DIR, "icon-sources.json");

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
  // The wiki's Perks table displays only a character's first name (or, for
  // Killers, their epithet) in the character column — almost always unique
  // enough on its own, until two characters happen to share one (David
  // King and David Tapp both show as bare "David"). Fandom's own markup
  // still disambiguates them via the character link's `title` attribute
  // even though the visible text doesn't, so that's captured here too and
  // only substituted in for `character` when a real collision is detected
  // (see resolveCharacterCollisions) — every non-colliding character keeps
  // its existing short display form unchanged.
  characterFullName: string;
  iconSourceUrl: string;
  characterPortraitUrl: string;
}

function loadTranslations(): Record<string, string> {
  if (!existsSync(TRANSLATIONS_JSON)) return {};
  return JSON.parse(readFileSync(TRANSLATIONS_JSON, "utf8"));
}

function loadDescriptionTranslations(): Record<string, LocalizedDescription> {
  if (!existsSync(DESCRIPTION_TRANSLATIONS_JSON)) return {};
  const raw = JSON.parse(readFileSync(DESCRIPTION_TRANSLATIONS_JSON, "utf8"));
  delete raw._comment;
  return raw;
}

function loadDescriptionRuRaw(): Record<string, string> {
  if (!existsSync(DESCRIPTION_RU_RAW_JSON)) return {};
  const raw = JSON.parse(readFileSync(DESCRIPTION_RU_RAW_JSON, "utf8"));
  delete raw._comment;
  return raw;
}

function loadDescriptionOverridesEn(): Record<string, string> {
  if (!existsSync(DESCRIPTION_OVERRIDES_EN_JSON)) return {};
  const raw = JSON.parse(readFileSync(DESCRIPTION_OVERRIDES_EN_JSON, "utf8"));
  delete raw._comment;
  return raw;
}

function loadNameOverridesEn(): Record<string, string> {
  if (!existsSync(NAME_OVERRIDES_EN_JSON)) return {};
  const raw = JSON.parse(readFileSync(NAME_OVERRIDES_EN_JSON, "utf8"));
  delete raw._comment;
  return raw;
}

function loadPinnedIcons(): Set<string> {
  if (!existsSync(ICON_OVERRIDES_JSON)) return new Set();
  const raw = JSON.parse(readFileSync(ICON_OVERRIDES_JSON, "utf8"));
  return new Set(raw.pinned ?? []);
}

interface SupplementalEntry {
  role: PerkRole;
  character: string;
  characterPortraitUrl: string;
  releasedAt?: string;
  perks: { name: string; description: string; iconSourceUrl: string }[];
}

/** Loads the supplemental entries that are actually live, and reports any
 *  held back — see scripts/release-gate.ts for why wiki.gg-sourced data
 *  needs gating at all. */
function loadSupplementalPerks(): SupplementalEntry[] {
  if (!existsSync(SUPPLEMENTAL_PERKS_EN_JSON)) return [];
  const raw = JSON.parse(readFileSync(SUPPLEMENTAL_PERKS_EN_JSON, "utf8"));
  const entries: SupplementalEntry[] = raw.entries ?? [];
  const { live, pending } = partitionByRelease(
    entries,
    (e) => e.releasedAt,
    (e) => `Supplemental ${e.role} "${e.character}"`,
  );
  for (const { entry, releasedAt } of pending) {
    console.log(`  Holding back ${entry.character} — releases ${releasedAt}`);
  }
  return live;
}

// See data/supplemental-perks.en.json's own comment — turns each curated
// entry into the same ScrapedRow shape the Fandom table parser produces, so
// everything downstream (icon/portrait download, name overrides, perk-id
// assignment) treats a supplemental character exactly like a scraped one.
function supplementalRows(entries: SupplementalEntry[], role: PerkRole): ScrapedRow[] {
  return entries
    .filter((entry) => entry.role === role)
    .flatMap((entry) =>
      entry.perks.map((perk) => ({
        name: perk.name,
        slug: slugify(perk.name),
        description: cleanDescription(perk.description),
        character: entry.character,
        characterFullName: entry.character,
        iconSourceUrl: perk.iconSourceUrl,
        characterPortraitUrl: entry.characterPortraitUrl,
      })),
    );
}

// Almost every character's wiki-table display name (first name, or a
// Killer's bare epithet) is unique on its own — until it isn't (David King
// vs David Tapp, both shown as just "David"). Only swap in the longer,
// disambiguated name for rows whose short display name is actually shared
// by more than one distinct character; every other row's `character` is
// left exactly as scraped, so this can't change any of the ~80 already-
// correct display values sitewide.
function resolveCharacterCollisions(rows: ScrapedRow[]): void {
  const fullNamesByDisplay = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.character) continue;
    const set = fullNamesByDisplay.get(row.character) ?? new Set();
    set.add(row.characterFullName);
    fullNamesByDisplay.set(row.character, set);
  }
  for (const row of rows) {
    const fullNames = fullNamesByDisplay.get(row.character);
    if (fullNames && fullNames.size > 1) {
      row.character = row.characterFullName;
    }
  }
}

function loadPerkIds(): Record<string, number> {
  if (!existsSync(PERK_IDS_JSON)) return {};
  try {
    return JSON.parse(readFileSync(PERK_IDS_JSON, "utf8"));
  } catch {
    return {};
  }
}

// Keyed "perk:<role>/<slug>" or "character:<name>" -> the iconSourceUrl (or
// characterPortraitUrl) used the last time that icon was actually
// downloaded. downloadIcon/downloadPortrait below compare against this
// (not just "did a file already land on disk") so a wiki-side icon rework
// gets picked up on the next scrape instead of the local copy silently
// going stale forever the first time it's cached.
function loadIconSources(): Record<string, string> {
  if (!existsSync(ICON_SOURCES_JSON)) return {};
  try {
    return JSON.parse(readFileSync(ICON_SOURCES_JSON, "utf8"));
  } catch {
    return {};
  }
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
    const character = cleanText(characterCell.text());
    const characterFullName = characterCell.find("a").first().attr("title") || character;

    rows.push({
      name,
      slug: slugify(name),
      description: cleanDescription(descriptionCell.text()),
      character,
      characterFullName,
      iconSourceUrl: iconSourceUrl.split("/revision/")[0], // strip cache-buster path segment
      characterPortraitUrl: portraitSrc ? portraitSrc.split("/revision/")[0] : "",
    });
  });

  return rows;
}

async function downloadIcon(
  row: ScrapedRow,
  role: PerkRole,
  iconSources: Record<string, string>,
  pinnedIcons: Set<string>,
): Promise<string> {
  const destRelative = `/perks/${role}/${row.slug}.webp`;
  const destAbsolute = join(PUBLIC_PERKS_DIR, role, `${row.slug}.webp`);
  const cacheKey = `perk:${role}/${row.slug}`;

  if (pinnedIcons.has(`${role}/${row.slug}`) && existsSync(destAbsolute)) {
    // A manually-sourced icon (see data/icon-overrides.json) — the wiki's
    // own URL for this one is wrong/missing, so never re-fetch it.
    return destRelative;
  }

  if (iconSources[cacheKey] === row.iconSourceUrl && existsSync(destAbsolute)) {
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

  iconSources[cacheKey] = row.iconSourceUrl;
  return destRelative;
}

async function downloadPortrait(
  characterName: string,
  sourceUrl: string,
  iconSources: Record<string, string>,
): Promise<string> {
  const slug = slugify(characterName);
  const destRelative = `/characters/${slug}.webp`;
  const destAbsolute = join(PUBLIC_CHARACTERS_DIR, `${slug}.webp`);
  const cacheKey = `character:${characterName}`;

  if (iconSources[cacheKey] === sourceUrl && existsSync(destAbsolute)) {
    // Skip re-downloading when the source URL hasn't changed since last run.
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

  iconSources[cacheKey] = sourceUrl;
  return destRelative;
}

async function main() {
  console.log(`Fetching ${WIKI_PAGE_URL} via MediaWiki API ...`);
  const html = await fetchWikiPageHtml();
  const $ = cheerio.load(html);

  const translations = loadTranslations();
  const descriptionTranslations = loadDescriptionTranslations();
  const descriptionRuRaw = loadDescriptionRuRaw();
  const descriptionOverridesEn = loadDescriptionOverridesEn();
  const nameOverridesEn = loadNameOverridesEn();
  const pinnedIcons = loadPinnedIcons();
  const supplementalEntries = loadSupplementalPerks();
  const previous = new Map(
    loadPreviousPerks().map((p) => [`${p.role}/${p.slug}`, p]),
  );
  const iconSources = loadIconSources();
  const scrapedAt = new Date().toISOString();

  const rowsByRole = new Map<PerkRole, ScrapedRow[]>();
  for (const role of Object.keys(TABLE_INDEX_BY_ROLE) as PerkRole[]) {
    const scraped = parseRole($, role);
    const scrapedSlugs = new Set(scraped.map((r) => r.slug));
    // A supplemental entry is redundant (and skipped) once Fandom's own
    // table catches up and starts producing the same perk slug on its
    // own — no need to hand-remove the data/supplemental-perks.en.json
    // entry the moment that happens, just eventually for tidiness.
    const supplemental = supplementalRows(supplementalEntries, role).filter(
      (r) => !scrapedSlugs.has(r.slug),
    );
    const rows = [...scraped, ...supplemental];
    console.log(
      `Found ${scraped.length} ${role} perks` +
        (supplemental.length ? ` (+${supplemental.length} supplemental)` : ""),
    );
    rowsByRole.set(role, rows);
  }
  resolveCharacterCollisions([...rowsByRole.values()].flat());

  const perks: Perk[] = [];
  const characterPortraitUrls = new Map<string, string>();
  for (const role of Object.keys(TABLE_INDEX_BY_ROLE) as PerkRole[]) {
    const rows = rowsByRole.get(role)!;

    for (const row of rows) {
      const icon = await downloadIcon(row, role, iconSources, pinnedIcons);
      const prev = previous.get(`${role}/${row.slug}`);
      const nameEn = nameOverridesEn[row.slug] ?? row.name;
      // A name override implies the wiki's own spelling of that name is
      // unwanted (see data/name-overrides.en.json) — scrub any literal
      // mention of it out of the description too, or a perk's own body
      // text would keep citing the un-overridden spelling (e.g. Deja Vu's
      // description name-drops itself as "Déjà Vu").
      const rawDescription = descriptionOverridesEn[row.slug] ?? row.description;
      const description =
        nameEn === row.name ? rawDescription : rawDescription.replaceAll(row.name, nameEn);
      perks.push({
        slug: row.slug,
        role,
        name: { en: nameEn, ru: translations[row.slug] ?? nameEn },
        description,
        descriptionRu: descriptionTranslations[row.slug],
        descriptionRuRaw: descriptionRuRaw[row.slug],
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
    characters[characterName] = await downloadPortrait(characterName, sourceUrl, iconSources);
  }
  console.log(`Found ${characterPortraitUrls.size} unique characters`);

  if (perks.length === 0) {
    throw new Error("Scraped 0 perks — the wiki's table structure may have changed.");
  }

  // Short numeric IDs for compact share URLs (?p=42,105,12,8). Existing
  // slugs keep their assigned ID forever — only genuinely new slugs get the
  // next free number — so an old shared link stays valid across rescrapes.
  const perkIds = loadPerkIds();
  let nextId = Object.values(perkIds).reduce((max, id) => Math.max(max, id), 0) + 1;
  for (const perk of perks) {
    if (!(perk.slug in perkIds)) perkIds[perk.slug] = nextId++;
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
  writeFileSync(PERK_IDS_JSON, JSON.stringify(perkIds, null, 2) + "\n");
  writeFileSync(ICON_SOURCES_JSON, JSON.stringify(iconSources, null, 2) + "\n");

  console.log(
    `Wrote ${perks.length} perks (${meta.survivorCount} survivor / ${meta.killerCount} killer) -> ${PERKS_JSON}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
