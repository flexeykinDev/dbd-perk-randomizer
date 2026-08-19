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
import { gateScrapedRows } from "./release-gate";
import { WIKI_GG } from "./wiki-source";
import { GENERAL_CHARACTER } from "../lib/types";
import {
  parsePerkTables,
  resolveCharacterCollisions,
  type ScrapedRow,
} from "./wiki-perk-table";
import type { LocalizedDescription, Perk, PerkRole, PerksMeta } from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Which wiki the EN perk data comes from. Must stay in step with the
 *  same constant in scripts/scrape-loadout.ts — the two halves of the site
 *  reading different wikis would show a killer's perks from one and their
 *  add-ons from the other. See scripts/wiki-source.ts, which explains what
 *  actually differs between them and why the choice is not just a URL. */
const SOURCE = WIKI_GG;

const WIKI_PAGE_URL = `${SOURCE.wikiBase}/Perks`;
const SOURCE_URL = `${SOURCE.apiBase}?action=parse&page=Perks&format=json&prop=text`;
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
const CHARACTER_RELEASE_DATES_JSON = join(DATA_DIR, "character-release-dates.json");
const CHARACTER_ALIASES_JSON = join(DATA_DIR, "character-aliases.json");
const PERK_SLUG_ALIASES_JSON = join(DATA_DIR, "perk-slug-aliases.json");
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


/** Records retired perk slugs so old share links keep working.
 *
 *  A share URL encodes perk IDs, which map to slugs; when a perk is
 *  renamed its slug changes and every link already sent to someone would
 *  otherwise resolve to nothing. Merged rather than overwritten, so an
 *  alias survives once the retired row stops appearing on the wiki
 *  altogether — the links it exists for do not expire. */
function writeSlugAliases(discovered: Record<string, string>): void {
  const existing = existsSync(PERK_SLUG_ALIASES_JSON)
    ? JSON.parse(readFileSync(PERK_SLUG_ALIASES_JSON, "utf8"))
    : {};
  const merged = { ...(existing.aliases ?? {}), ...discovered };
  if (Object.keys(merged).length === 0) return;
  writeFileSync(
    PERK_SLUG_ALIASES_JSON,
    JSON.stringify(
      {
        _comment:
          "Retired perk slug -> its current one, written by scripts/scrape-perks.ts when the wiki reports a rename. Keeps share links and saved pools working across a rename: lib/perks.ts's getPerkBySlug falls back through this. Entries are kept forever, since the links they exist for do not expire.",
        aliases: Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))),
      },
      null,
      2,
    ) + "\n",
  );
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

  // Only a source that documents unreleased Chapters needs this; on one
  // that doesn't, gating would just block new characters from arriving.
  // Runs before the rename handling below, which asks whether a perk's
  // replacement is actually live — a replacement the gate is about to
  // withhold is not.
  if (SOURCE.publishesPreRelease) {
    for (const role of ROLES) {
      const { live, held } = gateScrapedRows(scrapedByRole[role], {
        // A general perk belongs to everybody, so there is no character
        // whose release date could gate it — same as items and offerings
        // on the loadout side. Passing its sentinel through as a name
        // instead made the gate treat "every base-game perk" as an
        // unknown character and withhold all 35 of them.
        getCharacter: (row) =>
          row.character === GENERAL_CHARACTER ? null : row.character,
        getSlug: (row) => row.slug,
        isUpcoming: (row) => row.upcoming,
        knownCharacters,
        knownSlugs,
        releaseDates: characterReleaseDates,
      });
      for (const { row, reason } of held) {
        console.log(`  Holding back ${role}/${row.slug} — ${reason}`);
      }
      scrapedByRole[role] = live;
    }
  }

  // Retired names (see RENAMED_PERK_NOTICE) carry no description, so they
  // can never ship as-is. What to do with them depends on whether the
  // rename has actually landed in the game:
  //
  //   * replacement present  -> the perk genuinely goes by the new name
  //     now, so drop the old row and let the new one stand. Old share
  //     links still resolve, via data/perk-slug-aliases.json.
  //   * replacement absent   -> the rename is announced but not live, and
  //     the release gate has just held the new name back. Dropping the old
  //     row too would remove the perk from the site entirely, so keep the
  //     description already shipped for it.
  //
  // Save the Best for Last is the second case as of writing: its
  // replacement, Keep Them Waiting, is flagged for an unreleased patch.
  const liveSlugs = new Set(
    [scrapedByRole.survivor, scrapedByRole.killer]
      .flat()
      .filter((row) => !row.renamedTo)
      .map((row) => row.slug),
  );
  const slugAliases: Record<string, string> = {};
  for (const role of ROLES) {
    scrapedByRole[role] = scrapedByRole[role].filter((row) => {
      if (!row.renamedTo) return true;
      if (liveSlugs.has(row.renamedTo)) {
        console.log(`  "${row.name}" is now "${row.renamedTo}" — dropping the retired name`);
        slugAliases[row.slug] = row.renamedTo;
        return false;
      }
      const previousPerk = previous.get(`${role}/${row.slug}`);
      if (previousPerk) {
        console.log(
          `  "${row.name}" is being renamed to "${row.renamedTo}", which isn't live yet — keeping its current text`,
        );
        row.description = previousPerk.description;
        row.renamedTo = undefined;
        return true;
      }
      // Neither a replacement nor anything already shipped: nothing to
      // show, so shipping "Identical to …" would be the only alternative.
      console.log(`  Dropping "${row.name}" — a pointer to "${row.renamedTo}", which isn't present`);
      return false;
    });
  }
  writeSlugAliases(slugAliases);

  const rowsByRole = new Map<PerkRole, ScrapedRow[]>();
  for (const role of ROLES) {
    const rows = scrapedByRole[role];
    console.log(`Found ${rows.length} ${role} perks`);
    rowsByRole.set(role, rows);
  }

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

  // Merged onto whatever was already there rather than rebuilt from
  // scratch. This map is keyed by character, but it is populated from the
  // *perk* table, and a character can stop appearing there while still
  // very much existing — when a licence lapses its perks become general,
  // so The Cenobite dropped out of the perk table while keeping 20 add-ons
  // and a Power icon, and the loadout UI badges this portrait onto that
  // icon. Rebuilding would have left it with none. An entry for a
  // character nobody references any more is harmless; a missing one is a
  // broken image.
  const characters: Record<string, string> = existsSync(CHARACTERS_JSON)
    ? JSON.parse(readFileSync(CHARACTERS_JSON, "utf8"))
    : {};
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
