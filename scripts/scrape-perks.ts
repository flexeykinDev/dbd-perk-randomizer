// Scheduled data pipeline: reads the official DBD wiki's Perks page and turns
// it into data/perks.json + public/perks/<role>/<slug>.webp. Run manually via
// `npm run scrape:perks`, and on a schedule by .github/workflows/update-perks.yml.
// This replaces the old approach of hand-editing a perk array + hand-importing
// icon files every time a DLC ships.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { slugify } from "../lib/slugify";
import { gateScrapedRows, partitionByRelease } from "./release-gate";
import {
  cleanText,
  parsePerkTables,
  resolveCharacterCollisions,
  type ScrapedRow,
} from "./wiki-perk-table";
import type { LocalizedDescription, Perk, PerkRole, PerksMeta } from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Which wiki the EN perk data comes from.
 *
 *  Kept as one object rather than loose constants because moving to
 *  wiki.gg is a live question (run `npm run compare:sources` for what it
 *  would change) and the parts that have to move together are exactly
 *  these: the page URL, the API URL, the origin used to absolutise
 *  relative image URLs, and — most importantly — whether the source can be
 *  trusted to only document released content.
 *
 *  `publishesPreRelease` is the safety switch. Fandom documents a
 *  character once it is live, so a new one can flow straight in, as it
 *  always has. wiki.gg publishes a full Chapter page as soon as it is
 *  announced, weeks early, so on that source every unrecognised character
 *  is held until someone writes down its release date (see
 *  gateScrapedRows in scripts/release-gate.ts). Flipping the source
 *  without flipping this would publish an unreleased Chapter on the next
 *  scheduled run, with nobody watching. */
const SOURCE = {
  pageUrl: "https://deadbydaylight.fandom.com/wiki/Perks",
  // The plain page URL sits behind a Cloudflare JS challenge that blocks
  // non-browser HTTP clients. The MediaWiki parse API returns the same
  // rendered HTML (same tables, same icon URLs) without it.
  apiUrl:
    "https://deadbydaylight.fandom.com/api.php?action=parse&page=Perks&format=json&prop=text",
  origin: "https://deadbydaylight.fandom.com",
  publishesPreRelease: false,
} as const;

const WIKI_PAGE_URL = SOURCE.pageUrl;
const SOURCE_URL = SOURCE.apiUrl;
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
const CHARACTER_RELEASE_DATES_JSON = join(DATA_DIR, "character-release-dates.json");
const CHARACTER_ALIASES_JSON = join(DATA_DIR, "character-aliases.json");
const CHARACTERS_JSON = join(DATA_DIR, "characters.json");
const PERK_IDS_JSON = join(DATA_DIR, "perk-ids.json");
const ICON_SOURCES_JSON = join(DATA_DIR, "icon-sources.json");

const ICON_SIZE = 128;
const ROLES: PerkRole[] = ["survivor", "killer"];

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

/** Replacement icon URLs keyed "role/slug" — see data/icon-overrides.json.
 *  Separate from `pinned`: pinning freezes whatever is already on disk,
 *  which is useless when the file on disk is itself the wrong image. This
 *  swaps the URL *before* download, so the corrected icon goes through the
 *  same fetch/resize/webp path as every other one and keeps updating if
 *  the replacement source ever changes. */
function loadIconSourceOverrides(): Record<string, string> {
  if (!existsSync(ICON_OVERRIDES_JSON)) return {};
  const raw = JSON.parse(readFileSync(ICON_OVERRIDES_JSON, "utf8"));
  return raw.sources ?? {};
}

interface SupplementalEntry {
  role: PerkRole;
  character: string;
  characterPortraitUrl: string;
  releasedAt?: string;
  perks: { name: string; description: string; iconSourceUrl: string }[];
}

/** A source's spelling of a character -> the one the data already uses.
 *  See data/character-aliases.json; inert on a source that doesn't differ. */
function loadCharacterAliases(): Record<string, string> {
  if (!existsSync(CHARACTER_ALIASES_JSON)) return {};
  const raw = JSON.parse(readFileSync(CHARACTER_ALIASES_JSON, "utf8"));
  return raw.aliases ?? {};
}

/** character -> YYYY-MM-DD for characters not yet in the shipped data.
 *  Empty when the file is absent, which is fine: gateScrapedRows treats a
 *  missing date as "hold", so the safe direction is the default. */
function loadCharacterReleaseDates(): Record<string, string> {
  if (!existsSync(CHARACTER_RELEASE_DATES_JSON)) return {};
  const raw = JSON.parse(readFileSync(CHARACTER_RELEASE_DATES_JSON, "utf8"));
  return raw.characters ?? {};
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
        description: cleanText(perk.description),
        character: entry.character,
        characterFullName: entry.character,
        iconSourceUrl: perk.iconSourceUrl,
        characterPortraitUrl: entry.characterPortraitUrl,
        // Hand-curated entries are gated on their own releasedAt (see
        // loadSupplementalPerks), so by the time one gets here it is live
        // by definition — the wiki's own "upcoming patch" marker has no
        // say over it either way.
        upcoming: false,
      })),
    );
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

async function downloadIcon(
  row: ScrapedRow,
  role: PerkRole,
  iconSources: Record<string, string>,
  pinnedIcons: Set<string>,
  iconSourceOverrides: Record<string, string>,
): Promise<string> {
  const destRelative = `/perks/${role}/${row.slug}.webp`;
  const destAbsolute = join(PUBLIC_PERKS_DIR, role, `${row.slug}.webp`);
  const cacheKey = `perk:${role}/${row.slug}`;

  if (pinnedIcons.has(`${role}/${row.slug}`) && existsSync(destAbsolute)) {
    // A manually-sourced icon (see data/icon-overrides.json) — the wiki's
    // own URL for this one is wrong/missing, so never re-fetch it.
    return destRelative;
  }

  // Fandom's Loadout template renders a literal "?" placeholder image for a
  // perk whose data it fails to look up — the same failure that produces
  // the "Unable to retrieve the Perk description" text handled by
  // data/description-overrides.en.json. Nothing about that image is
  // distinguishable from a real icon at fetch time, so the corrected
  // source is named explicitly per slug.
  const sourceUrl = iconSourceOverrides[`${role}/${row.slug}`] ?? row.iconSourceUrl;

  if (iconSources[cacheKey] === sourceUrl && existsSync(destAbsolute)) {
    // Skip re-downloading when the source URL hasn't changed since last run.
    return destRelative;
  }

  const res = await fetch(sourceUrl, { headers: REQUEST_HEADERS });
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

  // Records the URL actually fetched, override included — storing the
  // wiki's original here would never match on the next run and would
  // re-download the overridden icon every single time.
  iconSources[cacheKey] = sourceUrl;
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
  const scrapedByRole = parsePerkTables(html, SOURCE.origin);

  const translations = loadTranslations();
  const descriptionTranslations = loadDescriptionTranslations();
  const descriptionRuRaw = loadDescriptionRuRaw();
  const descriptionOverridesEn = loadDescriptionOverridesEn();
  const nameOverridesEn = loadNameOverridesEn();
  const pinnedIcons = loadPinnedIcons();
  const iconSourceOverrides = loadIconSourceOverrides();
  const supplementalEntries = loadSupplementalPerks();
  const characterReleaseDates = loadCharacterReleaseDates();
  const previous = new Map(
    loadPreviousPerks().map((p) => [`${p.role}/${p.slug}`, p]),
  );
  const iconSources = loadIconSources();
  const scrapedAt = new Date().toISOString();

  // Both of the next two steps have to happen before the release gate,
  // because the gate decides on `character` and would otherwise be reading
  // a name the shipped data has never used — holding back a character that
  // is in fact perfectly familiar. Measured on wiki.gg's live page: without
  // this ordering the gate withheld nine perks belonging to Yun-Jin and the
  // two Davids, all of which have shipped for years.
  const characterAliases = loadCharacterAliases();
  for (const row of [scrapedByRole.survivor, scrapedByRole.killer].flat()) {
    const alias = characterAliases[row.character];
    if (alias) row.character = alias;
  }
  resolveCharacterCollisions([scrapedByRole.survivor, scrapedByRole.killer].flat());

  // The vetted set: everything already in data/perks.json, whether a
  // previous scrape found it or a person added it by hand. A character
  // stays trusted once it has shipped.
  const previousPerks = [...previous.values()];
  const knownCharacters = new Set(previousPerks.map((p) => p.character));
  const knownSlugs = new Set(previousPerks.map((p) => p.slug));

  const rowsByRole = new Map<PerkRole, ScrapedRow[]>();
  for (const role of ROLES) {
    let scraped = scrapedByRole[role];
    // Only a source that documents unreleased Chapters needs this; on one
    // that doesn't, gating would just block new characters from arriving.
    if (SOURCE.publishesPreRelease) {
      const { live, held } = gateScrapedRows(scraped, {
        getCharacter: (row) => row.character,
        getSlug: (row) => row.slug,
        isUpcoming: (row) => row.upcoming,
        knownCharacters,
        knownSlugs,
        releaseDates: characterReleaseDates,
      });
      for (const { row, reason } of held) {
        console.log(`  Holding back ${role}/${row.slug} — ${reason}`);
      }
      scraped = live;
    }
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
  // Re-run now that the supplemental rows have joined, in case one of them
  // shares a display name with a scraped character. Idempotent: the first
  // pass has already given any colliding row its distinct full name, so a
  // second pass finds no collision left to resolve.
  resolveCharacterCollisions([...rowsByRole.values()].flat());

  const perks: Perk[] = [];
  const characterPortraitUrls = new Map<string, string>();
  for (const role of ROLES) {
    const rows = rowsByRole.get(role)!;

    for (const row of rows) {
      const icon = await downloadIcon(row, role, iconSources, pinnedIcons, iconSourceOverrides);
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
