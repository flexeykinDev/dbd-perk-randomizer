// Scheduled data pipeline for the Full Loadout feature: reads the official
// DBD wiki's Items, Add-ons, and Offerings pages and turns them into
// data/{items,addons,offerings}.json + public/loadout/<kind>/<slug>.webp.
// Run manually via `npm run scrape:loadout`, and on a schedule by
// .github/workflows/update-perks.yml (same PR as the perk data update).
//
// Unlike Perks (one wiki page, one table per role), these 3 pages each lay
// their data out differently — see the comments on parsePieceTable,
// findHeadingTables, and ITEM_TABLE_SIGNATURES below for what was actually
// found on each page and why the parsing approach differs per page.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import sharp from "sharp";
import { slugify } from "../lib/slugify";
import { gateScrapedRows, partitionByRelease } from "./release-gate";
import { guardAgainstShrink } from "./scrape-census";
import { guardIdStability } from "./id-stability";
import { splitDescriptions, type DescriptionEntry, type DescriptionLookup } from "./split-descriptions";
import { resolveImageUrl, WIKI_GG } from "./wiki-source";
import {
  GENERAL_CHARACTER,
  type Addon,
  type Item,
  type ItemType,
  type LoadoutMeta,
  type Offering,
  type PerkRole,
} from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const PUBLIC_LOADOUT_DIR = join(__dirname, "../public/loadout");
const ITEMS_JSON = join(DATA_DIR, "items.json");
const ADDONS_JSON = join(DATA_DIR, "addons.json");
const OFFERINGS_JSON = join(DATA_DIR, "offerings.json");
const LOADOUT_DESCRIPTIONS_JSON = join(DATA_DIR, "loadout-descriptions.json");
const LOADOUT_META_JSON = join(DATA_DIR, "loadout-meta.json");
const LOADOUT_IDS_JSON = join(DATA_DIR, "loadout-ids.json");
const LOADOUT_TRANSLATIONS_JSON = join(DATA_DIR, "loadout-translations.ru.json");
const LOADOUT_DESCRIPTION_RU_RAW_JSON = join(DATA_DIR, "loadout-description-ru-raw.json");
const KILLER_POWER_ICONS_JSON = join(DATA_DIR, "killer-power-icons.json");
const LOADOUT_ICON_SOURCES_JSON = join(DATA_DIR, "loadout-icon-sources.json");
const SUPPLEMENTAL_ADDONS_EN_JSON = join(DATA_DIR, "supplemental-addons.en.json");

// 256 because that is what the wiki's originals actually are, and what the
// character portraits already used. `withoutEnlargement` is the important
// half: the previous 128 was reached by *enlarging* a 96px thumbnail, so
// the stored files cost bytes to hold blur. Never enlarging means a file
// whose original is smaller simply stays smaller and honest.
const ICON_SIZE = 256;
const REQUEST_HEADERS = {
  "User-Agent": "vortex-info-next loadout scraper (personal site, contact via github)",
};

const ITEMS_PAGE = "Items";
const ADDONS_PAGE = "Add-ons";
const OFFERINGS_PAGE = "Offerings";

/** Which wiki the loadout data comes from. Must stay in step with the
 *  same constant in scripts/scrape-perks.ts — the two halves of the site
 *  reading different wikis would show a killer's perks from one and their
 *  add-ons from the other. See scripts/wiki-source.ts. */
const SOURCE = WIKI_GG;

/** The vetted set the release gate trusts: everything the site already
 *  ships, across *both* halves of the data.
 *
 *  Reading only the loadout files would be too narrow. A character is
 *  vetted by having shipped at all, and the two halves can disagree about
 *  which characters they cover — Fandom carried The Houndmaster, The Ghoul
 *  and The Animatronic on the Perks page but never wrote their add-on
 *  tables, so all three are long-shipped killers with perks and no add-ons.
 *  Judging add-ons against the loadout files alone treated them as unknown
 *  and withheld 60 add-ons for killers already on the site. */
function loadKnownLoadout(): { characters: Set<string>; slugs: Set<string> } {
  const read = (file: string): { slug: string; character?: string }[] =>
    existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  const loadout = [...read(ADDONS_JSON), ...read(ITEMS_JSON), ...read(OFFERINGS_JSON)];
  const perks = read(join(DATA_DIR, "perks.json"));
  // data/characters.json is the durable half of this. Every other input
  // here is a file the scrapers overwrite, so the trust set is rebuilt
  // from the previous run's output and can drift: The Cenobite's perks
  // became general, which took it out of perks.json, and from then on its
  // twenty add-ons were vouched for only by the add-on file about to be
  // replaced. The portrait map is merged rather than rebuilt (see
  // scrape-perks.ts), so it remembers every character that has ever
  // shipped and stops that feedback loop.
  const portraits = existsSync(join(DATA_DIR, "characters.json"))
    ? Object.keys(JSON.parse(readFileSync(join(DATA_DIR, "characters.json"), "utf8")))
    : [];
  return {
    characters: new Set([
      ...portraits,
      ...[...loadout, ...perks].map((p) => p.character).filter((c): c is string => !!c),
    ]),
    // Slugs stay loadout-only: a perk and an add-on sharing a slug are
    // different things, and treating a perk's slug as proof an add-on has
    // shipped would let a genuinely new add-on through on a coincidence.
    slugs: new Set(loadout.map((p) => p.slug)),
  };
}

function loadJsonMap(file: string, key: string): Record<string, string> {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8"))[key] ?? {};
}

const characterAliases = loadJsonMap(
  join(DATA_DIR, "character-aliases.json"),
  "aliases",
);
const characterReleaseDates = loadJsonMap(
  join(DATA_DIR, "character-release-dates.json"),
  "characters",
);

/**
 * Applies the release gate to loadout rows, and reports what it withheld.
 *
 * A no-op on a source that only documents released content, which is why
 * Fandom's behaviour is untouched — including picking up a brand-new
 * Killer's add-ons on its own, which gating would otherwise prevent.
 */
function gateLoadoutRows<T>(
  rows: T[],
  getCharacter: (row: T) => string | null,
  getPiece: (row: T) => ScrapedPiece,
): T[] {
  if (!SOURCE.publishesPreRelease) return rows;
  const known = loadKnownLoadout();
  const { live, held } = gateScrapedRows(rows, {
    getCharacter,
    getSlug: (row) => getPiece(row).slug,
    isUpcoming: (row) => getPiece(row).upcoming,
    knownCharacters: known.characters,
    knownSlugs: known.slugs,
    releaseDates: characterReleaseDates,
  });
  for (const { row, reason } of held) {
    console.log(`  Holding back ${getPiece(row).slug} — ${reason}`);
  }
  return live;
}

interface SupplementalAddonEntry {
  character: string;
  releasedAt?: string;
  addons: { name: string; description: string; iconSourceUrl: string }[];
}

/** Killers whose Power add-ons the scrape source doesn't carry — see
 *  data/supplemental-addons.en.json. Gated on releasedAt for the same
 *  reason everything else is: the pages these are transcribed from go up
 *  before the Chapter ships. */
function loadSupplementalAddons(): SupplementalAddonEntry[] {
  if (!existsSync(SUPPLEMENTAL_ADDONS_EN_JSON)) return [];
  const raw = JSON.parse(readFileSync(SUPPLEMENTAL_ADDONS_EN_JSON, "utf8"));
  const entries: SupplementalAddonEntry[] = raw.entries ?? [];
  const { live, pending } = partitionByRelease(
    entries,
    (e) => e.releasedAt,
    (e) => `Supplemental add-ons for "${e.character}"`,
  );
  for (const { entry, releasedAt } of pending) {
    console.log(`  Holding back ${entry.character}'s add-ons — releases ${releasedAt}`);
  }
  return live;
}

function apiUrl(page: string): string {
  return `${SOURCE.apiBase}?action=parse&page=${encodeURIComponent(page)}&format=json&prop=text`;
}

interface MediaWikiParseResponse {
  parse?: { text?: { "*"?: string } };
  error?: { info?: string };
}

async function fetchWikiPageHtml(page: string): Promise<string> {
  const res = await fetch(apiUrl(page), { headers: REQUEST_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch ${page}: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as MediaWikiParseResponse;
  const html = json.parse?.text?.["*"];
  if (!html) {
    throw new Error(`Unexpected MediaWiki API response for ${page}: ${json.error?.info ?? "no parse.text.*"}`);
  }
  return html;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// The wiki prepends this notice, with no separating whitespace, to any
// piece whose numbers are previewed for an upcoming patch — e.g. "...Patch
// 7.4.0The annoying buzzing sound means...". Same notice scrape-perks.ts
// already strips for perks; loadout pieces get it too and need the same
// treatment, or it ends up glued onto the actual description text.
const UPCOMING_PATCH_NOTICE =
  /^This description is based on the changes announced for or featured in the upcoming Patch [\d.]+\s*/;

function cleanDescription(text: string): string {
  return cleanText(text).replace(UPCOMING_PATCH_NOTICE, "");
}

// Any of these markers anywhere in a row's description means the piece
// can't actually be equipped in a normal Trial today — retired, pulled
// from the Bloodweb, event-exclusive-and-over, or code-only/unused. Same
// spirit as scrape-perks.ts's UPCOMING_PATCH_NOTICE strip, just "exclude
// the row entirely" instead of "strip a prefix".
const UNAVAILABLE_MARKERS =
  /THIS (?:ITEM|ADD-ON|OFFERING) (?:IS|WAS) (?:NO LONGER AVAILABLE|RETIRED|UNUSED|DECOMMISSIONED|ONLY AVAILABLE ON DBD MOBILE)|CAN NO LONGER BE (?:OBTAINED|USED)/i;

// Fandom's own Loadout template occasionally errors out for a brand-new
// piece before the wiki's data table catches up (seen on Misty Day, Remains
// of Judgment right after Patch 9.1.0 shipped: "Unable to retrieve the
// Add-On description... contact Jouki", plus a "?" placeholder icon in
// place of real art). Rather than silently shipping broken/placeholder
// content, or dropping the piece until the wiki fixes itself, patch known
// cases from deadbydaylight.wiki.gg (a different, faster-updated fan wiki)
// by slug — remove an entry here once Fandom's own page is fixed upstream.
//
// Also doubles as a general "Fandom is stale, not just broken" override:
// Patch 9.3.0 reworked the Anti-Haemorrhagic Syringe (renamed to
// Anti-Exhaustion Syringe, no longer heals — it now cures Exhausted
// instead) and Styptic Agent (Healing Efficiency only, no more Endurance).
// Fandom's live page still had the pre-rework text as of this writing
// (confirmed against the full official patch-note history, not just the
// current wiki state — Fandom can silently lag a real rework even though
// nothing about the page "looks" broken); deadbydaylight.wiki.gg already
// had both corrected. Applied unconditionally by slug, same as the Misty
// Day case above.
const DESCRIPTION_OVERRIDES: Record<string, string> = {
  "misty-day-remains-of-judgment":
    "A painting of an imposing figure wearing a steel pyramid atop his head. Victims are caged in the background. Successful Punishment of the Damned attacks trigger the following effect: Causes the Auras of hit Survivors to be revealed to you for 8 seconds.",
  "anti-haemorrhagic-syringe":
    "A mysterious fluid that reinvigorates both body and mind. While using the Med-Kit to heal yourself or another Survivor, press the Secondary Action button to trigger the following effect: Causes the affected Survivor to instantly recover from the Exhausted Status Effect. Anti-Exhaustion Syringe consumes the Med-Kit after use.",
  "styptic-agent":
    "A white powder with coagulant properties. Apply the agent to a wound to stop it from haemorrhaging. Modifies the Med-Kit with the following effect: Increases the Efficiency of Personal Healing actions by +15%.",
};
const ICON_SOURCE_OVERRIDES: Record<string, string> = {
  "misty-day-remains-of-judgment": "https://deadbydaylight.wiki.gg/images/IconAddon_mistyDay.png",
};

// Fandom's slug-producing name (the pre-rework "Anti-Haemorrhagic Syringe")
// is kept as the map key everywhere above/below so a Fandom update doesn't
// silently orphan these overrides — only the *displayed* name changes here,
// to the current official name, same slug either way.
const NAME_OVERRIDES: Record<string, string> = {
  "anti-haemorrhagic-syringe": "Anti-Exhaustion Syringe",
};

// Patch 9.1.0 also reworked the Key and Map items' Add-ons specifically —
// cut from 9 each down to 5 each (1 per Rarity, the same standard the new
// Fog Vial item introduced) — but unlike most of the wiki, Fandom's own
// Keys and Map pages were never updated to reflect it: they still list the
// pre-rework 9-each sets verbatim (confirmed by hand against both pages'
// live HTML). deadbydaylight.wiki.gg has the current, correct 5-each
// lists, so — same reasoning as DESCRIPTION_OVERRIDES/ICON_SOURCE_OVERRIDES
// above, just at the scale of a whole item type instead of one add-on —
// these two categories are pinned here instead of scraped from Fandom.
// Remove this once Fandom's Keys/Map pages catch up.
// `upcoming` is omitted rather than written out on all ten: these are
// hand-pinned entries, so the wiki's own upcoming-patch marker has no say
// over them either way, and it is supplied at the point of use.
const KEY_MAP_ADDON_OVERRIDES: (Omit<ScrapedPiece, "upcoming"> & {
  itemType: "key" | "map";
})[] = [
  // Keys — https://deadbydaylight.wiki.gg/wiki/Keys
  {
    itemType: "key",
    slug: "friendship-charm",
    name: "Friendship Charm",
    description:
      "Someone's thumb has worn off the initials once carved into it. Modifies the Key with the following effect: Increases its Charges by +1.",
    iconSourceUrl: "https://deadbydaylight.wiki.gg/images/IconAddon_friendshipCharm.png",
  },
  {
    itemType: "key",
    slug: "shrill-whistle",
    name: "Shrill Whistle",
    description:
      "The high-pitched scream gives a sense of urgency to everything. Modifies the Key with the following effect: Reduces the time it takes to channel the Key by -35 %.",
    iconSourceUrl: "https://deadbydaylight.wiki.gg/images/IconAddon_shrillWhistle.png",
  },
  {
    itemType: "key",
    slug: "braided-bauble",
    name: "Braided Bauble",
    description:
      "Four thin but sturdy cords, all masterfully wrapped around one another. Modifies the Key with the following effect: Increases its Aura-reading duration by +2 seconds.",
    iconSourceUrl: "https://deadbydaylight.wiki.gg/images/IconAddon_braidedBauble.png",
  },
  {
    itemType: "key",
    slug: "unique-wedding-ring",
    name: "Unique Wedding Ring",
    description:
      "An engraved wedding ring that emerged from the Fog and resonates with an indescribable and incomprehensible energy. Modifies the Key with the following effects: The Aura of the Obsession is permanently revealed to you. Your Aura is permanently revealed to the Obsession. Unique Wedding Ring applies its effects passively and does not require actively using the Key. Reduces your chance of becoming the initial Obsession by reducing the default value by -100 %.",
    iconSourceUrl: "https://deadbydaylight.wiki.gg/images/IconAddon_uniqueWeddingRing.png",
  },
  {
    itemType: "key",
    slug: "blood-amber",
    name: "Blood Amber",
    description:
      "A blood-red amber striped with black veins. The amber is warm to the touch. Modifies the Key with the following effects: Reduces its Aura-reveal time by -6 seconds. Reduces its Charges by -2. While using the Key, the following effects apply: The Aura of the Killer is revealed to you. Your Aura is revealed to the Killer.",
    iconSourceUrl: "https://deadbydaylight.wiki.gg/images/IconAddon_bloodAmber.png",
  },
  // Maps — https://deadbydaylight.wiki.gg/wiki/Map
  {
    itemType: "map",
    slug: "glowing-ink",
    name: "Glowing Ink",
    description:
      "Some of the images seemed to jump right off the page. Modifies the Map with the following effect: Increases the duration it reveals Auras for by +2 seconds.",
    iconSourceUrl: "https://deadbydaylight.wiki.gg/images/IconAddon_glowingInk.png",
  },
  {
    itemType: "map",
    slug: "gnarled-compass",
    name: "Gnarled Compass",
    description:
      "It seems to set itself to the perfect distance every time. Modifies the Map with the following effect: Increases its Charges by +2.",
    iconSourceUrl: "https://deadbydaylight.wiki.gg/images/IconAddon_gnarledCompass.png",
  },
  {
    itemType: "map",
    slug: "battered-tape",
    name: "Battered Tape",
    description:
      "Additional pieces of parchment hung loosely from the map, hastily affixed with tape. Modifies the Map with the following effect: Increases its maximum range by +8 metres.",
    iconSourceUrl: "https://deadbydaylight.wiki.gg/images/IconAddon_batteredTape.png",
  },
  {
    itemType: "map",
    slug: "sharpened-flint",
    name: "Sharpened Flint",
    description:
      "When sparked near the map, new sigils appeared in unexpected locations. Modifies the Map with the following effect: Grants the ability to track the location of Totems and reveal their Auras, when using the Map.",
    iconSourceUrl: "https://deadbydaylight.wiki.gg/images/IconAddon_sharpenedFlint.png",
  },
  {
    itemType: "map",
    slug: "crimson-stamp",
    name: "Crimson Stamp",
    description:
      "Only those with absolute confidence dared to place their seal upon the map. Modifies the Map with the following effects: The Aura of the Killer is revealed to all Survivors when within 8 metres of the Beam of Light. Reduces the Life time of the Beam of Light by -10 seconds. Reduces its Charges by -2.",
    iconSourceUrl: "https://deadbydaylight.wiki.gg/images/IconAddon_crimsonStamp.png",
  },
];

interface ScrapedPiece {
  name: string;
  slug: string;
  description: string;
  iconSourceUrl: string;
  /** True when the wiki is describing a patch that hasn't shipped yet.
   *  Kept rather than just stripped, because on a source that publishes
   *  pre-release content it's the signal that a row may not be live. */
  upcoming: boolean;
}

// Reads a 3-column [icon, name, description] wikitable — the same row
// shape scrape-perks.ts reads (icon th, name th, description td), minus
// the 4th "character" column, since loadout pieces get their
// character/role/category from which heading section their table sits
// under (see findHeadingTables) rather than from a table column.
function parsePieceTable($: cheerio.CheerioAPI, table: Cheerio<AnyNode>): ScrapedPiece[] {
  const rows: ScrapedPiece[] = [];
  table.find("tr").each((i, tr) => {
    if (i === 0) return; // header row
    const cells = $(tr).find("th, td");
    if (cells.length < 3) return;

    const iconCell = cells.eq(0);
    const nameCell = cells.eq(1);
    const descriptionCell = cells.eq(2);

    const rawName = cleanText(nameCell.text());
    const slug = slugify(rawName);
    const name = NAME_OVERRIDES[slug] ?? rawName;
    const rawDescription = cleanText(descriptionCell.text());
    const description = DESCRIPTION_OVERRIDES[slug] ?? cleanDescription(descriptionCell.text());
    const icon = iconCell.find("img").first();
    const iconSourceUrl =
      ICON_SOURCE_OVERRIDES[slug] ??
      resolveImageUrl(icon.attr("data-src") ?? icon.attr("src"), SOURCE.origin);
    if (!name || !iconSourceUrl || !description) return;
    if (UNAVAILABLE_MARKERS.test(description)) return;

    rows.push({
      name,
      slug,
      description,
      iconSourceUrl,
      upcoming: UPCOMING_PATCH_NOTICE.test(rawDescription),
    });
  });
  return rows;
}

// Add-ons and Offerings both lay their data out as a sequence of
// `<h3>Category</h3><table>...</table>` pairs under one `<h2>` section
// (e.g. Add-ons has H2 "Killer Power Add-ons" containing one H3 per
// killer power, each followed by that killer's add-on table) — walks
// forward from the matching H2 collecting the first table after each H3,
// stopping at the next H2.
function findHeadingTables(
  $: cheerio.CheerioAPI,
  sectionTitle: string,
): { heading: string; table: Cheerio<AnyNode> }[] {
  const results: { heading: string; table: Cheerio<AnyNode> }[] = [];
  const h2 = $("h2")
    .filter((_, el) => $(el).text().trim().startsWith(sectionTitle))
    .first();
  if (!h2.length) return results;

  // The section's h3-heading/table pairs aren't always direct siblings of
  // the h2 — Fandom wraps some sections' whole content in an extra <div>
  // (confirmed by inspecting the actual page). nextUntil("h2") grabs every
  // sibling up to — not including — the next h2 regardless of what's
  // directly adjacent; combining its own h3/table matches with matches
  // found *inside* those siblings covers both a flat layout and a
  // wrapper-div layout. `.add()` re-sorts the combined set into document
  // order, which is what keeps headings paired with the right table.
  const container = h2.nextUntil("h2");
  const nodes = container.filter("h3, table.wikitable").add(container.find("h3, table.wikitable"));

  let currentHeading: string | null = null;
  nodes.each((_, el) => {
    const node = $(el);
    if (node.is("h3")) {
      // Headings render with a trailing edit-section artifact (shows up
      // as a stray "[]") in this wiki's parsed HTML — strip it rather
      // than try to match it.
      currentHeading = node.text().replace(/\[.*\]\s*$/, "").trim();
    } else if (node.is("table.wikitable") && currentHeading) {
      results.push({ heading: currentHeading, table: node as Cheerio<AnyNode> });
      currentHeading = null; // only the table immediately after a heading is its data table
    }
  });

  // wiki.gg renders each of these sections twice: as the h3 above, and as
  // a tab in a tabber widget wrapping the same table. Almost always both,
  // which is why the h3 pass gets nearly everything — but two powers (The
  // Redeemer and Summons of Pain) come through with only the tab, and the
  // h3 pass therefore dropped The Deathslinger's entire add-on set and his
  // Power icon with it.
  //
  // So the panels are a fallback, not the primary: h3 order is the page's
  // real reading order and is what Fandom provides, and a panel is only
  // consulted for a heading the h3 pass never produced. Fandom has no
  // tabber at all, so this contributes nothing there.
  const seen = new Set(results.map((r) => r.heading));
  container
    .find("article.tabber__panel")
    .add(container.filter("article.tabber__panel"))
    .each((_, el) => {
      const panel = $(el);
      const heading = (panel.attr("id") ?? "").replace(/-\d+$/, "").replace(/_/g, " ").trim();
      if (!heading || seen.has(heading)) return;
      const table = panel.find("table.wikitable").first();
      if (!table.length) return;
      seen.add(heading);
      results.push({ heading, table: table as Cheerio<AnyNode> });
    });

  return results;
}

/** Offerings-page counterpart of findHeadingTables above — can't reuse it
 *  directly because this page's h3 categories are often themselves split
 *  into h4 sub-headings, each with its own table (e.g. "Bonus
 *  Bloodpoints" -> "Altruism"/"Brutality"/... , "Realm Selection" -> one
 *  h4 per Realm). findHeadingTables pairs only the *first* table after a
 *  heading with it (fine for Add-ons, where every h3 has exactly one
 *  table) — on this page that silently dropped every h4-level table
 *  after the first, undercounting entire categories (confirmed by hand:
 *  Realm Selection has one h4+table per Realm, only the first was ever
 *  scraped). This walks every table regardless of h3/h4 nesting depth
 *  and pairs each with whichever h3 most recently preceded it — h4 text
 *  itself is discarded, since role is resolved per-offering instead (see
 *  resolveOfferingRole) rather than guessed from category structure. */
function findOfferingTables(
  $: cheerio.CheerioAPI,
  sectionTitle: string,
): { heading: string; table: Cheerio<AnyNode> }[] {
  const results: { heading: string; table: Cheerio<AnyNode> }[] = [];
  const h2 = $("h2")
    .filter((_, el) => $(el).text().trim().startsWith(sectionTitle))
    .first();
  if (!h2.length) return results;

  const container = h2.nextUntil("h2");
  const nodes = container.filter("h3, table.wikitable").add(container.find("h3, table.wikitable"));

  let currentH3: string | null = null;
  nodes.each((_, el) => {
    const node = $(el);
    if (node.is("h3")) {
      currentH3 = node.text().replace(/\[.*\]\s*$/, "").trim();
    } else if (node.is("table.wikitable") && currentH3) {
      // No reset here, deliberately unlike findHeadingTables — an h3
      // category on this page can be followed by any number of tables.
      results.push({ heading: currentH3, table: node as Cheerio<AnyNode> });
    }
  });
  return results;
}

const ITEM_TYPE_BY_ADDON_HEADING: Record<string, ItemType> = {
  Firecrackers: "firecracker",
  Flashlights: "flashlight",
  "Fog Vials": "fog-vial",
  Keys: "key",
  Maps: "map",
  "Med-Kits": "medkit",
  Toolboxes: "toolbox",
};

// The Items page, unlike Add-ons, doesn't heading-delimit its tables by
// item type — the headings on it are prose sections ("Obtaining",
// "Charges"), so the type is only recoverable from which table a row sits
// in.
//
// This used to be a list indexed by table position, and that broke the
// moment the source changed: wiki.gg's page has no rarity-legend table
// where Fandom's did, and adds one for Fog Vials, so tables 0-2 all
// shifted by one while 3-9 happened to still line up. The count stayed at
// 10, so the guard that was supposed to catch exactly this never fired.
// The result shipped: real Firecrackers were dropped, Flashlights were
// tagged `firecracker` (a type with no add-ons at all), and Fog Vials
// inherited the Flashlight add-ons.
//
// Identifying a table by an item that can only appear in it is immune to
// insertions, removals and reordering alike. Each signature is a name
// unique to its own table across the whole page — checked against the
// live page, and asserted below so a wiki rename fails the scrape loudly
// rather than mis-tagging silently.
const ITEM_TABLE_SIGNATURES: readonly { type: ItemType; contains: string }[] = [
  { type: "firecracker", contains: "Chinese Firecracker" },
  { type: "flashlight", contains: "Sport Flashlight" },
  { type: "fog-vial", contains: "Vigo's Fog Vial" },
  { type: "key", contains: "Skeleton Key" },
  { type: "map", contains: "Cryptic Map" },
  { type: "medkit", contains: "Camping Aid Kit" },
  { type: "toolbox", contains: "Commodious Toolbox" },
];

/** Which item type a table holds, or null for one that isn't item data.
 *
 *  Unmatched tables are deliberately ignored rather than guessed at. The
 *  page also carries a "Limited Item" table (Eye of Vecna, Lament
 *  Configuration, ...) — those spawn in a trial for a chapter's own
 *  mechanic rather than being brought in a loadout, so offering them
 *  would let the randomizer roll something nobody can pre-select. */
/** Every name in a table's Name column, before any filtering.
 *
 *  Used only to identify which table this is, which must not depend on
 *  whether its contents are currently obtainable: every Firecracker is an
 *  expired event item, so UNAVAILABLE_MARKERS empties that table
 *  completely and parsePieceTable's output has nothing left to match on. */
function tableItemNames($: cheerio.CheerioAPI, table: Cheerio<AnyNode>): string[] {
  const names: string[] = [];
  table.find("tr").each((i, tr) => {
    if (i === 0) return;
    const cells = $(tr).find("th, td");
    if (cells.length < 3) return;
    const name = cleanText(cells.eq(1).text());
    if (name) names.push(name);
  });
  return names;
}

function itemTypeForTable(names: readonly string[]): ItemType | null {
  for (const { type, contains } of ITEM_TABLE_SIGNATURES) {
    if (names.some((n) => n === contains)) return type;
  }
  return null;
}

// Deliberately just a fallback now, not the source of truth — see
// resolveOfferingRole, which fetches each offering's own page instead.
// A category-level guess can't distinguish e.g. "Bonus Bloodpoints",
// which mixes Survivor-only, Killer-only, and shared offerings under its
// own h4 sub-headings; these values only matter if that per-offering
// lookup itself fails.
const OFFERING_CATEGORY_ROLE: Record<string, PerkRole | "both"> = {
  "Bonus Bloodpoints": "both",
  Luck: "survivor",
  "Map Modifications": "both",
  "Memento Mori": "killer",
  "Realm Selection": "both",
  Shrouds: "survivor",
  Splinters: "killer",
  Wards: "both",
  // "Events" is deliberately excluded — every entry there is inherently
  // time-limited, and this scraper has no way to know whether a given
  // event is currently running, so none of them are reliably obtainable
  // right now. "Mobile Offerings" (a separate <h2>, never visited by
  // findOfferingTables here) is skipped the same way.
};

// A couple of killer-power heading titles don't wiki-redirect to
// Powers#<Killer> the normal way resolvePowerToCharacter() expects (see
// below) and need a manual fallback, confirmed by reading their actual
// wiki page content directly. If the wiki adds a new one that also
// doesn't redirect, resolvePowerToCharacter falls back further to parsing
// "X is the Power of <Killer>" from the power's own page (also confirmed
// against a real page — see below) before giving up to ".All".
const POWER_HEADING_OVERRIDES: Record<string, string> = {
  "Any Killer": GENERAL_CHARACTER,
  // Its own article opens with prose, not the standard "X is the Power of
  // <Killer>" sentence POWER_OF_PATTERN below looks for — confirmed by
  // reading the actual page text.
  "Quantum Instantiation": "The Singularity",
  // The Hillbilly's power shares its name with the generic article title,
  // and on wiki.gg there is no "The Chainsaw" page at all to redirect from
  // — only The Cannibal's "Bubba's Chainsaw" exists. Without this the
  // heading resolves to nothing and his add-ons land on ".All", where they
  // would be offered for every killer.
  "The Chainsaw": "The Hillbilly",
};

// Matches the wiki's own standard opening sentence for a power's article,
// e.g. "Carter's Spark is the Power of The Doctor." — confirmed against
// several real pages that exist as standalone articles rather than a
// Powers#<Killer> redirect.
const POWER_OF_PATTERN = /is the Power of (The [A-Za-z' -]+?)[.,]/;

async function fetchPowerOfCharacter(heading: string): Promise<string | null> {
  try {
    const html = await fetchWikiPageHtml(heading);
    const text = cleanText(cheerio.load(html).text());
    const match = text.match(POWER_OF_PATTERN);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// Resolves each killer-power section heading (e.g. "Bear Trap") to the
// killer it belongs to (e.g. "The Trapper") via the wiki's own redirects
// — "Bear Trap" is itself a page that redirects to "Powers#The Trapper",
// so `action=query&redirects=1` hands back the killer name directly. This
// is deliberately *not* a hand-typed heading->killer table: guessing 30+
// power names from memory risks silently mis-attributing an add-on to the
// wrong killer, which would make the "Item + Add-ons" feature wrong in a
// way nobody would notice without checking every single one — asking the
// wiki is both less work and actually reliable.
async function resolvePowerToCharacter(headings: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const unresolved: string[] = [];
  for (const h of headings) {
    if (h in POWER_HEADING_OVERRIDES) result[h] = POWER_HEADING_OVERRIDES[h];
    else unresolved.push(h);
  }

  const BATCH_SIZE = 40; // comfortably under MediaWiki's multi-title query limits
  for (let i = 0; i < unresolved.length; i += BATCH_SIZE) {
    const batch = unresolved.slice(i, i + BATCH_SIZE);
    const url = `${SOURCE.apiBase}?action=query&titles=${encodeURIComponent(batch.join("|"))}&redirects=1&format=json`;
    const res = await fetch(url, { headers: REQUEST_HEADERS });
    if (!res.ok) throw new Error(`Failed to resolve power headings: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as {
      query?: {
        normalized?: { from: string; to: string }[];
        redirects?: { from: string; to: string; tofragment?: string }[];
      };
    };
    // MediaWiki canonicalises a title before resolving it, and reports the
    // redirect against the *canonical* form. A heading that gets rewritten
    // on the way in therefore comes back under a name that no longer
    // matches it — "Test Subject #001" normalises to "Test Subject", so
    // the result was filed under a key nothing was looking for and The
    // First's twenty add-ons fell through to ".All".
    const originalTitle = new Map<string, string>();
    for (const n of json.query?.normalized ?? []) originalTitle.set(n.to, n.from);
    for (const r of json.query?.redirects ?? []) {
      if (!r.tofragment) continue;
      // MediaWiki numbers a fragment when the target page carries more than
      // one heading of the same text, so the redirect that resolves to
      // "The Trapper" on one wiki resolves to "The Trapper-0" on another.
      // Left in place, that reaches the release gate as a character nobody
      // has ever shipped ("Oni-0") and withholds the killer's whole add-on
      // set — 207 add-ons survived out of 847 on the first wiki.gg run.
      result[originalTitle.get(r.from) ?? r.from] = r.tofragment.replace(/-\d+$/, "");
    }
  }

  // Some power names are standalone articles rather than Powers#<Killer>
  // redirects (e.g. "Carter's Spark") — their own page still states the
  // killer in its opening sentence, just not via a redirect.
  for (const h of headings) {
    if (h in result) continue;
    const found = await fetchPowerOfCharacter(h);
    if (found) result[h] = found;
  }

  for (const h of headings) {
    if (!(h in result)) {
      console.warn(`  Could not resolve a killer for power heading "${h}" — using ".All"`);
      result[h] = GENERAL_CHARACTER;
    }
  }

  // The wiki's own redirects/prose resolve to the killer's full in-universe
  // title ("The Trapper"), but every other character reference in this app
  // — data/characters.json, data/perks.json's Perk.character,
  // data/character-translations.ru.json — is keyed by the bare name
  // ("Trapper") instead. Normalizing here (rather than adding a "The "
  // adapter at every lookup site) keeps addons.json consistent with that
  // established convention, so getCharacterPortrait/getCharacterName work
  // on a killer's add-ons the same way they already do on a killer's perks.
  for (const h of Object.keys(result)) {
    result[h] = result[h].replace(/^The /, "");
  }
  return result;
}

async function downloadIcon(
  kind: "item" | "addon" | "offering",
  slug: string,
  sourceUrl: string,
  iconSources: Record<string, string>,
): Promise<string> {
  const destRelative = `/loadout/${kind}/${slug}.webp`;
  const destAbsolute = join(PUBLIC_LOADOUT_DIR, kind, `${slug}.webp`);
  const cacheKey = `${kind}/${slug}`;

  // Compares against the *source* URL actually used last time (not just
  // "did some icon land on this slug before") — the source is already in
  // hand from the same page fetch this run makes anyway, so checking it
  // costs nothing extra and means a wiki-side icon rework (art gets
  // redrawn on an existing add-on) actually gets picked up on the next
  // scrape instead of the local copy staying stale forever.
  // Size folded in alongside the URL: comparing the URL alone left every
  // icon whose source hadn't changed sitting at the previous ICON_SIZE
  // when that constant was raised.
  const cacheValue = `${sourceUrl}@${ICON_SIZE}`;

  if (iconSources[cacheKey] === cacheValue && existsSync(destAbsolute)) {
    return destRelative;
  }

  const res = await fetch(sourceUrl, { headers: REQUEST_HEADERS });
  if (!res.ok) throw new Error(`Failed to download icon for ${slug}: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  mkdirSync(dirname(destAbsolute), { recursive: true });
  await sharp(buffer).resize(ICON_SIZE, ICON_SIZE, { fit: "cover", withoutEnlargement: true }).webp({ quality: 90 }).toFile(destAbsolute);
  iconSources[cacheKey] = cacheValue;
  return destRelative;
}

// Same MediaWiki parse endpoint as fetchWikiPageHtml, but following
// redirects — killer names ("The Trapper") are themselves redirect pages
// to the character's real-name article ("Evan MacMillan"). Items/Add-ons
// page titles are already canonical, but individual Offering titles
// aren't guaranteed to be (e.g. punctuation quirks like "Escape! Cake"),
// so resolveOfferingRole below uses this too rather than the plain
// fetchWikiPageHtml.
async function fetchWikiPageHtmlFollowingRedirects(page: string): Promise<string> {
  const url = `${SOURCE.apiBase}?action=parse&page=${encodeURIComponent(page)}&redirects=1&format=json&prop=text`;
  const res = await fetch(url, { headers: REQUEST_HEADERS });
  if (!res.ok) throw new Error(`Failed to fetch ${page}: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as MediaWikiParseResponse;
  const html = json.parse?.text?.["*"];
  if (!html) {
    throw new Error(`Unexpected MediaWiki API response for ${page}: ${json.error?.info ?? "no parse.text.*"}`);
  }
  return html;
}

// Every Offering's own article opens with a standard sentence — "<Name>
// is a(n) <Rarity> Offering belonging to <Survivors|Killers|all
// Players>." — confirmed by hand against several real pages, including
// the exact bug report that motivated this: "Survivor Pudding is an
// Uncommon Offering belonging to Killers." (its name notwithstanding —
// it's genuinely Killer-only, a real wiki/game naming quirk, not a typo).
// This is the only reliable per-offering role signal available: the List
// of Offerings page groups tables by scoring category / Realm / etc, not
// consistently by role — "Bonus Bloodpoints" alone mixes Survivor-only,
// Killer-only, and shared offerings under h4 sub-headings a category-
// level guess can't tell apart.
const OFFERING_BELONGS_TO_PATTERN = /\bOffering belonging to ([^.]+)\./i;

function offeringRoleFromPageText(text: string): PerkRole | "both" | null {
  const match = text.match(OFFERING_BELONGS_TO_PATTERN);
  if (!match) return null;
  const who = match[1].trim().toLowerCase();
  if (who.includes("all players")) return "both";
  if (who.includes("survivor")) return "survivor";
  if (who.includes("killer")) return "killer";
  return null;
}

/** Resolves one offering's real role by fetching its own wiki page —
 *  falls back to the category-level guess (OFFERING_CATEGORY_ROLE) only
 *  if the fetch fails or the page doesn't match the expected sentence
 *  shape, logging either case so a wiki-format change doesn't fail
 *  silently. */
async function resolveOfferingRole(name: string, fallback: PerkRole | "both"): Promise<PerkRole | "both"> {
  try {
    const html = await fetchWikiPageHtmlFollowingRedirects(name);
    const text = cheerio.load(html)(".mw-parser-output").first().text();
    const role = offeringRoleFromPageText(text);
    if (role) return role;
    console.warn(`  Offering "${name}": couldn't parse its role sentence, using category fallback (${fallback})`);
    return fallback;
  } catch (err) {
    console.warn(`  Offering "${name}": role lookup failed (${(err as Error).message}), using category fallback (${fallback})`);
    return fallback;
  }
}

// Every killer's character page has a "Power: <name>" heading followed
// shortly by that power's small square icon (e.g. IconPowers_trap.png,
// same asset family as the perk/item icons this scraper already
// downloads) — confirmed by inspecting several real pages directly. The
// "Weapon: <name>" heading right above it links a large weapon render
// instead, which doesn't fit a compact icon slot, so only Power is used.
const POWER_HEADING_PATTERN = /^Power:/;

function findFirstImageAfterHeading($: cheerio.CheerioAPI, pattern: RegExp): string | null {
  let found: string | null = null;
  $("h2, h3, h4").each((_, el) => {
    if (found) return;
    const text = $(el)
      .text()
      .replace(/\[.*\]\s*$/, "")
      .trim();
    if (!pattern.test(text)) return;
    let node = $(el).next();
    for (let steps = 0; steps < 8 && node.length && !found; steps++) {
      const img = node.is("img") ? node : node.find("img").first();
      const src = img.attr("data-src") ?? img.attr("src");
      if (img.length && src) found = resolveImageUrl(src, SOURCE.origin);
      node = node.next();
    }
  });
  return found;
}

// Fandom has no page at all yet for a killer only data/supplemental-perks.en.json
// and data/supplemental-addons.en.json know about (same Fandom-lag pattern
// as everywhere else in this file) — `The <Killer>` 404s outright rather
// than just missing the Power heading, so scrapeKillerPowerIcons's normal
// fetch-and-search can't run at all. Sourced by hand from each killer's own
// deadbydaylight.wiki.gg page instead. Remove an entry once Fandom's own
// page for that killer exists.
const POWER_ICON_SOURCE_OVERRIDES: Record<string, string> = {
  Krasue: "https://deadbydaylight.wiki.gg/images/IconPowers_HeadForm_K41.png",
  First: "https://deadbydaylight.wiki.gg/images/T_UI_iconPowers_EnterUpsideDown.png",
  Slasher: "https://deadbydaylight.wiki.gg/images/T_UI_iconPowers_DramaticEntrance.png",
};

// One request per killer (their own character page) — there's no single
// wiki page listing every Power icon together the way Items/Add-ons/
// Offerings do, so this can't be folded into the table-based passes
// above. Cached by killer name + the icon file already existing on disk —
// unlike downloadIcon's iconSources cache, this deliberately does NOT
// compare against the actual source URL, since doing that would require
// fetching the killer's whole character page first, defeating the point
// of skipping it. A rescrape only re-fetches a killer whose icon is
// missing or new; a wiki-side Power icon rework needs the local file
// deleted by hand to be picked up.
//
// `killers` here are the bare, app-wide names ("Trapper") — see the
// normalization note in resolvePowerToCharacter — but the wiki's actual
// page title is the full in-universe one ("The Trapper"), so that prefix
// is added back on just for the fetch.
async function scrapeKillerPowerIcons(
  killers: string[],
  iconSources: Record<string, string>,
): Promise<Record<string, string>> {
  const existing = loadJson<Record<string, string>>(KILLER_POWER_ICONS_JSON, {});
  const result: Record<string, string> = {};
  for (const killer of killers) {
    const slug = slugify(killer);
    const destAbsolute = join(PUBLIC_LOADOUT_DIR, "power", `${slug}.webp`);
    // Keyed by size only, not by source URL, because the URL isn't known
    // until the killer's whole wiki page has been fetched — and fetching 43
    // pages to discover that nothing changed is the cost this skip exists
    // to avoid. Recording the size still invalidates every icon when
    // ICON_SIZE moves, which is what was missing: the skip used to be
    // "is there a file?", so these 43 stayed at whatever size they were
    // first written at, forever.
    const sizeKey = `power:${slug}`;
    if (existing[killer] && existsSync(destAbsolute) && iconSources[sizeKey] === `@${ICON_SIZE}`) {
      result[killer] = existing[killer];
      continue;
    }
    try {
      let iconUrl: string | null;
      if (POWER_ICON_SOURCE_OVERRIDES[killer]) {
        iconUrl = POWER_ICON_SOURCE_OVERRIDES[killer];
      } else {
        const html = await fetchWikiPageHtmlFollowingRedirects(`The ${killer}`);
        iconUrl = findFirstImageAfterHeading(cheerio.load(html), POWER_HEADING_PATTERN);
      }
      if (!iconUrl) {
        console.warn(`  No Power icon found on ${killer}'s wiki page — skipping`);
        continue;
      }
      const res = await fetch(iconUrl, { headers: REQUEST_HEADERS });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(destAbsolute), { recursive: true });
      await sharp(buffer).resize(ICON_SIZE, ICON_SIZE, { fit: "cover", withoutEnlargement: true }).webp({ quality: 90 }).toFile(destAbsolute);
      // Written after a successful download, so a failed fetch doesn't mark
      // the icon as current and skip it on the next run.
      iconSources[sizeKey] = `@${ICON_SIZE}`;
      result[killer] = `/loadout/power/${slug}.webp`;
    } catch (err) {
      console.warn(`  Failed to fetch a Power icon for ${killer}: ${(err as Error).message}`);
    }
  }
  return result;
}

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function loadTranslations(): Record<string, string> {
  const raw = loadJson<Record<string, string>>(LOADOUT_TRANSLATIONS_JSON, {});
  delete raw._comment;
  return raw;
}

function loadDescriptionRuRaw(): Record<string, string> {
  const raw = loadJson<Record<string, string>>(LOADOUT_DESCRIPTION_RU_RAW_JSON, {});
  delete raw._comment;
  return raw;
}



async function main() {
  const translations = loadTranslations();
  const descriptionRuRaw = loadDescriptionRuRaw();
  const previousItems = loadJson<Item[]>(ITEMS_JSON, []);
  const previousAddons = loadJson<Addon[]>(ADDONS_JSON, []);
  const previousOfferings = loadJson<Offering[]>(OFFERINGS_JSON, []);
  const previousBySlug = new Map<string, { addedAt: string }>();
  for (const p of [...previousItems, ...previousAddons, ...previousOfferings]) {
    previousBySlug.set(`${p.kind}:${p.slug}`, p);
  }
  const iconSources = loadJson<Record<string, string>>(LOADOUT_ICON_SOURCES_JSON, {});

  const scrapedAt = new Date().toISOString();

  function toLocalized<K extends "item" | "addon" | "offering">(
    kind: K,
    piece: ScrapedPiece,
  ): {
    slug: string;
    name: { en: string; ru: string };
    description: string;
    descriptionRuRaw?: string;
    addedAt: string;
  } {
    const key = `${kind}:${piece.slug}`;
    const prev = previousBySlug.get(key);
    return {
      slug: piece.slug,
      name: { en: piece.name, ru: translations[key] ?? piece.name },
      description: piece.description,
      descriptionRuRaw: descriptionRuRaw[key],
      addedAt: prev?.addedAt ?? scrapedAt,
    };
  }

  // --- Items ---
  console.log(`Fetching ${ITEMS_PAGE} via MediaWiki API ...`);
  const itemsHtml = await fetchWikiPageHtml(ITEMS_PAGE);
  const $items = cheerio.load(itemsHtml);
  const itemTables = $items("table.wikitable");

  // Parsed once, then identified by content — see ITEM_TABLE_SIGNATURES.
  const typedItemTables: { type: ItemType; pieces: ScrapedPiece[] }[] = [];
  itemTables.each((_, t) => {
    const table = $items(t) as Cheerio<AnyNode>;
    const type = itemTypeForTable(tableItemNames($items, table));
    if (type) typedItemTables.push({ type, pieces: parsePieceTable($items, table) });
  });

  // The guard the old index-based version was supposed to be. A table
  // count is not evidence of anything — the count was still 10 while three
  // types were mislabelled. Every signature matching exactly one table is.
  const foundTypes = typedItemTables.map((t) => t.type);
  const missing = ITEM_TABLE_SIGNATURES.filter((sig) => !foundTypes.includes(sig.type));
  const duplicated = foundTypes.filter((t, i) => foundTypes.indexOf(t) !== i);
  if (missing.length > 0 || duplicated.length > 0) {
    throw new Error(
      `Items page no longer matches ITEM_TABLE_SIGNATURES — ` +
        (missing.length ? `nothing matched ${missing.map((m) => `"${m.contains}"`).join(", ")}. ` : "") +
        (duplicated.length ? `more than one table matched ${duplicated.join(", ")}. ` : "") +
        `Update the signatures in scripts/scrape-loadout.ts.`,
    );
  }

  const items: (Item & DescriptionEntry)[] = [];
  for (const { type, pieces } of typedItemTables) {
    // Items belong to nobody, so there is no character release date to
    // gate them on — only the "brand new and documented against a patch
    // that hasn't shipped" rule applies.
    const live = gateLoadoutRows(pieces, () => null, (piece) => piece);
    for (const piece of live) {
      items.push({ kind: "item", itemType: type, icon: "", ...toLocalized("item", piece) });
    }
  }
  console.log(`Found ${items.length} items`);

  // --- Add-ons ---
  console.log(`Fetching ${ADDONS_PAGE} via MediaWiki API ...`);
  const addonsHtml = await fetchWikiPageHtml(ADDONS_PAGE);
  const $addons = cheerio.load(addonsHtml);

  interface AddonRow {
    role: "survivor" | "killer";
    character: string;
    itemType?: ItemType;
    piece: ScrapedPiece;
  }
  const addonRows: AddonRow[] = [];

  const survivorAddonSections = findHeadingTables($addons, "Survivor Item Add-ons");
  for (const { heading, table } of survivorAddonSections) {
    const itemType = ITEM_TYPE_BY_ADDON_HEADING[heading];
    if (!itemType) {
      console.warn(`  Unknown survivor add-on heading "${heading}" — skipping`);
      continue;
    }
    // Key and Map are pinned via KEY_MAP_ADDON_OVERRIDES instead (see its
    // comment) — Fandom's own tables for these two are stale post-9.1.0.
    if (itemType === "key" || itemType === "map") continue;
    for (const piece of parsePieceTable($addons, table)) {
      addonRows.push({ role: "survivor", character: GENERAL_CHARACTER, itemType, piece });
    }
  }
  for (const { itemType, ...piece } of KEY_MAP_ADDON_OVERRIDES) {
    // Hand-pinned, so the wiki's own upcoming-patch marker has no say.
    addonRows.push({ role: "survivor", character: GENERAL_CHARACTER, itemType, piece: { ...piece, upcoming: false } });
  }

  const killerAddonSections = findHeadingTables($addons, "Killer Power Add-ons");
  const powerToCharacter = await resolvePowerToCharacter(killerAddonSections.map((s) => s.heading));
  const scrapedKillerRows: AddonRow[] = [];
  for (const { heading, table } of killerAddonSections) {
    const character = powerToCharacter[heading];
    for (const piece of parsePieceTable($addons, table)) {
      scrapedKillerRows.push({ role: "killer", character, piece });
    }
  }
  // Killer add-ons are the loadout's equivalent of a perk row: they belong
  // to a named character, and an announced-but-unreleased Killer is exactly
  // what a source like wiki.gg publishes early. Same gate, same files, same
  // aliases-then-collisions ordering rationale as scrape-perks.ts — except
  // there is no collision step here, because the character comes from the
  // resolved Power page rather than a first-name column.
  for (const row of scrapedKillerRows) {
    const alias = characterAliases[row.character];
    if (alias) row.character = alias;
  }
  addonRows.push(...gateLoadoutRows(scrapedKillerRows, (r) => r.character, (r) => r.piece));

  // Anything the source still doesn't cover. Skipped per killer once it
  // does — checked against what this scrape actually produced, not against
  // the shipped addons.json, which would include whatever this file put
  // there last time and so could never report itself redundant.
  const scrapedKillerCharacters = new Set(
    addonRows.filter((r) => r.role === "killer").map((r) => r.character),
  );
  for (const entry of loadSupplementalAddons()) {
    if (scrapedKillerCharacters.has(entry.character)) continue;
    for (const addon of entry.addons) {
      addonRows.push({
        role: "killer",
        character: entry.character,
        piece: {
          name: addon.name,
          slug: slugify(addon.name),
          description: cleanDescription(addon.description),
          iconSourceUrl: addon.iconSourceUrl,
          // Gated on its own releasedAt above, so it is live by definition.
          upcoming: false,
        },
      });
    }
  }

  // A handful of add-ons across different killers/items happen to share
  // an exact English name (confirmed by hand — e.g. "Jump Rope" exists
  // for both The Nightmare and The Good Guy, "Begrimed Chains" for The
  // Cannibal and The Hillbilly; genuinely different add-ons, not a
  // scraper duplicate). Left alone they'd all slugify identically and
  // silently collide into one stable ID, one icon file, and one React
  // key wherever the UI lists add-ons — so any slug seen before gets the
  // owning character appended to disambiguate it.
  const usedAddonSlugs = new Set<string>();
  for (const row of addonRows) {
    if (usedAddonSlugs.has(row.piece.slug)) {
      row.piece = { ...row.piece, slug: `${row.piece.slug}-${slugify(row.character)}` };
    }
    usedAddonSlugs.add(row.piece.slug);
  }

  const addons: (Addon & DescriptionEntry)[] = addonRows.map((row) =>
    row.role === "survivor"
      ? {
          kind: "addon",
          role: "survivor",
          itemType: row.itemType!,
          character: GENERAL_CHARACTER,
          icon: "",
          ...toLocalized("addon", row.piece),
        }
      : { kind: "addon", role: "killer", character: row.character, icon: "", ...toLocalized("addon", row.piece) },
  );
  console.log(
    `Found ${addons.length} add-ons (${addons.filter((a) => a.role === "survivor").length} survivor / ${addons.filter((a) => a.role === "killer").length} killer)`,
  );

  // --- Offerings ---
  console.log(`Fetching ${OFFERINGS_PAGE} via MediaWiki API ...`);
  const offeringsHtml = await fetchWikiPageHtml(OFFERINGS_PAGE);
  const $offerings = cheerio.load(offeringsHtml);
  const offerings: (Offering & DescriptionEntry)[] = [];
  const offeringSections = findOfferingTables($offerings, "List of Offerings");
  console.log("Resolving each offering's role from its own page ...");
  for (const { heading, table } of offeringSections) {
    const fallbackRole = OFFERING_CATEGORY_ROLE[heading];
    if (!fallbackRole) continue; // "Events" and any unrecognized category — see OFFERING_CATEGORY_ROLE comment
    // Same as items: no owning character, so only the new-and-upcoming
    // rule can apply. Gated before the per-offering role lookup so a held
    // row doesn't cost a wiki round trip.
    const pieces = gateLoadoutRows(
      parsePieceTable($offerings, table),
      () => null,
      (piece) => piece,
    );
    for (const piece of pieces) {
      const role = await resolveOfferingRole(piece.name, fallbackRole);
      offerings.push({ kind: "offering", role, category: heading, icon: "", ...toLocalized("offering", piece) });
    }
  }
  console.log(`Found ${offerings.length} offerings`);

  if (items.length === 0 || addons.length === 0 || offerings.length === 0) {
    throw new Error(
      `Scraped items=${items.length} addons=${addons.length} offerings=${offerings.length} — ` +
        `at least one wiki page's structure may have changed.`,
    );
  }

  // --- Icons ---
  // Re-fetch the raw scraped rows' icon URLs by re-walking the same
  // tables would be redundant; instead pair each output piece back up
  // with its icon URL via a slug->url map built during the parse passes
  // above would need restructuring parsePieceTable's return type, so
  // download icons in the same loop that builds each piece list instead.
  async function attachIcons<T extends { kind: string; slug: string; icon: string }>(
    pieces: T[],
    rows: ScrapedPiece[],
  ): Promise<void> {
    const urlBySlug = new Map(rows.map((r) => [r.slug, r.iconSourceUrl]));
    for (const piece of pieces) {
      const url = urlBySlug.get(piece.slug);
      if (!url) continue;
      piece.icon = await downloadIcon(piece.kind as "item" | "addon" | "offering", piece.slug, url, iconSources);
    }
  }

  console.log("Downloading icons ...");
  {
    const allItemRows: ScrapedPiece[] = typedItemTables.flatMap((t) => t.pieces);
    await attachIcons(items, allItemRows);
  }
  {
    // Reuses addonRows directly (already deduped above) rather than
    // re-parsing the tables again — re-parsing would reproduce the
    // original colliding slugs and hand the wrong icon to one of each
    // colliding pair, right back where the dedup pass started.
    await attachIcons(
      addons,
      addonRows.map((r) => r.piece),
    );
  }
  {
    const allOfferingRows: ScrapedPiece[] = [];
    for (const { table } of offeringSections) allOfferingRows.push(...parsePieceTable($offerings, table));
    await attachIcons(offerings, allOfferingRows);
  }

  // --- Stable IDs ---
  // Same append-only scheme as data/perk-ids.json — existing slugs keep
  // their number forever, so a share link stays valid across rescrapes.
  // Keyed by "kind:slug" (not just slug) since an item, add-on, and
  // offering could theoretically slugify to the same string.
  const loadoutIds = loadJson<Record<string, number>>(LOADOUT_IDS_JSON, {});
  let nextId = Object.values(loadoutIds).reduce((max, id) => Math.max(max, id), 0) + 1;
  for (const piece of [...items, ...addons, ...offerings]) {
    const key = `${piece.kind}:${piece.slug}`;
    if (!(key in loadoutIds)) loadoutIds[key] = nextId++;
  }

  const meta: LoadoutMeta = {
    scrapedAt,
    sourceUrls: {
      items: `${SOURCE.wikiBase}/${ITEMS_PAGE}`,
      addons: `${SOURCE.wikiBase}/${ADDONS_PAGE}`,
      offerings: `${SOURCE.wikiBase}/${OFFERINGS_PAGE}`,
    },
    itemCount: items.length,
    addonCount: addons.length,
    offeringCount: offerings.length,
  };

  // --- Killer Power icons ---
  // Shown next to a killer's rolled add-ons in the UI (the in-game
  // loadout screen shows the killer's Power where a survivor's Item
  // would go) — see getKillerPowerIcon in lib/loadout.ts.
  console.log("Fetching killer Power icons ...");
  const killerCharacters = [...new Set(addons.filter((a) => a.role === "killer").map((a) => a.character))]
    .filter((c) => c !== GENERAL_CHARACTER)
    .sort();
  const killerPowerIcons = await scrapeKillerPowerIcons(killerCharacters, iconSources);
  writeFileSync(KILLER_POWER_ICONS_JSON, JSON.stringify(killerPowerIcons, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(killerPowerIcons).length} killer Power icons`);

  // Counted before anything is written, so tripping the guard leaves the
  // previous data intact — the GitHub Action commits whatever it finds in
  // data/, and a half-replaced directory is worse than a skipped run.
  console.log("Checking the counts against what's committed ...");
  guardAgainstShrink("items", ITEMS_JSON, items, (i: Item) => [`type:${i.itemType}`]);
  guardAgainstShrink("add-ons", ADDONS_JSON, addons, (a: Addon) => [
    `role:${a.role}`,
    // Both halves of the Fog Vial bug are visible here and nowhere in the
    // totals: Flashlight add-ons going to zero, and a killer's add-ons
    // landing on the general sentinel instead of on them.
    a.role === "survivor" ? `item-type:${a.itemType}` : `killer:${a.character}`,
  ]);
  guardAgainstShrink("offerings", OFFERINGS_JSON, offerings, (o: Offering) => [`role:${o.role}`]);
  guardIdStability("loadout piece", LOADOUT_IDS_JSON, loadoutIds, [
    ...items.map((p) => `item:${p.slug}`),
    ...addons.map((p) => `addon:${p.slug}`),
    ...offerings.map((p) => `offering:${p.slug}`),
  ]);

  // One lookup across all three kinds — they're opened by the same detail
  // modal, so splitting them further would only mean two more requests for
  // the same click. Keyed `kind:slug` because an item, an add-on and an
  // offering can all slugify to the same string.
  const loadoutDescriptions: DescriptionLookup = {};
  const itemSplit = splitDescriptions(items, (p) => `item:${p.slug}`);
  const addonSplit = splitDescriptions(addons, (p) => `addon:${p.slug}`);
  const offeringSplit = splitDescriptions(offerings, (p) => `offering:${p.slug}`);
  Object.assign(
    loadoutDescriptions,
    itemSplit.descriptions,
    addonSplit.descriptions,
    offeringSplit.descriptions,
  );

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(LOADOUT_DESCRIPTIONS_JSON, JSON.stringify(loadoutDescriptions, null, 2) + "\n");
  writeFileSync(ITEMS_JSON, JSON.stringify(itemSplit.rows, null, 2) + "\n");
  writeFileSync(ADDONS_JSON, JSON.stringify(addonSplit.rows, null, 2) + "\n");
  writeFileSync(OFFERINGS_JSON, JSON.stringify(offeringSplit.rows, null, 2) + "\n");
  writeFileSync(LOADOUT_META_JSON, JSON.stringify(meta, null, 2) + "\n");
  writeFileSync(LOADOUT_IDS_JSON, JSON.stringify(loadoutIds, null, 2) + "\n");
  writeFileSync(LOADOUT_ICON_SOURCES_JSON, JSON.stringify(iconSources, null, 2) + "\n");

  console.log(
    `Wrote ${items.length} items, ${addons.length} add-ons, ${offerings.length} offerings -> ${DATA_DIR}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
