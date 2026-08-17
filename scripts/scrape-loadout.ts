// Scheduled data pipeline for the Full Loadout feature: reads the official
// DBD wiki's Items, Add-ons, and Offerings pages and turns them into
// data/{items,addons,offerings}.json + public/loadout/<kind>/<slug>.webp.
// Run manually via `npm run scrape:loadout`, and on a schedule by
// .github/workflows/update-perks.yml (same PR as the perk data update).
//
// Unlike Perks (one wiki page, one table per role), these 3 pages each lay
// their data out differently — see the comments on parsePieceTable,
// findHeadingTables, and ITEM_TABLE_TYPES below for what was actually
// found on each page and why the parsing approach differs per page.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import sharp from "sharp";
import { slugify } from "../lib/slugify";
import type { Addon, Item, ItemType, LoadoutMeta, Offering, PerkRole } from "../lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const PUBLIC_LOADOUT_DIR = join(__dirname, "../public/loadout");
const ITEMS_JSON = join(DATA_DIR, "items.json");
const ADDONS_JSON = join(DATA_DIR, "addons.json");
const OFFERINGS_JSON = join(DATA_DIR, "offerings.json");
const LOADOUT_META_JSON = join(DATA_DIR, "loadout-meta.json");
const LOADOUT_IDS_JSON = join(DATA_DIR, "loadout-ids.json");
const LOADOUT_TRANSLATIONS_JSON = join(DATA_DIR, "loadout-translations.ru.json");
const LOADOUT_DESCRIPTION_RU_RAW_JSON = join(DATA_DIR, "loadout-description-ru-raw.json");
const KILLER_POWER_ICONS_JSON = join(DATA_DIR, "killer-power-icons.json");
const LOADOUT_ICON_SOURCES_JSON = join(DATA_DIR, "loadout-icon-sources.json");

const ICON_SIZE = 128;
const REQUEST_HEADERS = {
  "User-Agent": "vortex-info-next loadout scraper (personal site, contact via github)",
};

const ITEMS_PAGE = "Items";
const ADDONS_PAGE = "Add-ons";
const OFFERINGS_PAGE = "Offerings";

function apiUrl(page: string): string {
  return `https://deadbydaylight.fandom.com/api.php?action=parse&page=${encodeURIComponent(page)}&format=json&prop=text`;
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
const KEY_MAP_ADDON_OVERRIDES: (ScrapedPiece & { itemType: "key" | "map" })[] = [
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
    const description = DESCRIPTION_OVERRIDES[slug] ?? cleanDescription(descriptionCell.text());
    const rawIconSourceUrl = iconCell.find("img").attr("data-src") ?? "";
    const iconSourceUrl = ICON_SOURCE_OVERRIDES[slug] ?? rawIconSourceUrl.split("/revision/")[0];
    if (!name || !iconSourceUrl || !description) return;
    if (UNAVAILABLE_MARKERS.test(description)) return;

    rows.push({ name, slug, description, iconSourceUrl });
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
  Keys: "key",
  Maps: "map",
  "Med-Kits": "medkit",
  Toolboxes: "toolbox",
};

// The Items page (unlike Add-ons) does *not* heading-delimit its tables by
// item type — verified by inspecting the page directly: 10 top-level
// tables in a fixed order (rarity-tier legend, then one table per item
// type, then a single unused item, then a nav box), with item type only
// recoverable from which table a row is in. If the wiki's table count or
// order ever changes, this throws (see main()) instead of silently
// mis-tagging items with the wrong type.
const ITEM_TABLE_TYPES: readonly (ItemType | null)[] = [
  null, // 0: rarity-tier legend, not data
  "firecracker",
  "flashlight",
  "key",
  "map",
  "medkit",
  "toolbox",
  // Deliberately skipped, not just untyped: every entry here (Eye of Vecna,
  // Lament Configuration, Keycard, ...) is a "Limited Item" per its own
  // wiki description — one that spawns in the trial environment for a
  // specific chapter's mechanic, not something a player brings in via
  // their own loadout. Scraping them as pickable items would let the
  // randomizer roll something nobody can actually pre-select.
  null,
  null, // single unused item ("Trapple")
  null, // "browse other unlockables" nav box
];

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
  "Any Killer": ".All",
  // Its own article opens with prose, not the standard "X is the Power of
  // <Killer>" sentence POWER_OF_PATTERN below looks for — confirmed by
  // reading the actual page text.
  "Quantum Instantiation": "The Singularity",
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
    const url = `https://deadbydaylight.fandom.com/api.php?action=query&titles=${encodeURIComponent(batch.join("|"))}&redirects=1&format=json`;
    const res = await fetch(url, { headers: REQUEST_HEADERS });
    if (!res.ok) throw new Error(`Failed to resolve power headings: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as {
      query?: { redirects?: { from: string; to: string; tofragment?: string }[] };
    };
    for (const r of json.query?.redirects ?? []) {
      if (r.tofragment) result[r.from] = r.tofragment;
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
      result[h] = ".All";
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
  if (iconSources[cacheKey] === sourceUrl && existsSync(destAbsolute)) {
    return destRelative;
  }

  const res = await fetch(sourceUrl, { headers: REQUEST_HEADERS });
  if (!res.ok) throw new Error(`Failed to download icon for ${slug}: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  mkdirSync(dirname(destAbsolute), { recursive: true });
  await sharp(buffer).resize(ICON_SIZE, ICON_SIZE, { fit: "cover" }).webp({ quality: 90 }).toFile(destAbsolute);
  iconSources[cacheKey] = sourceUrl;
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
  const url = `https://deadbydaylight.fandom.com/api.php?action=parse&page=${encodeURIComponent(page)}&redirects=1&format=json&prop=text`;
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
      if (img.length && src) found = src.split("/revision/")[0];
      node = node.next();
    }
  });
  return found;
}

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
async function scrapeKillerPowerIcons(killers: string[]): Promise<Record<string, string>> {
  const existing = loadJson<Record<string, string>>(KILLER_POWER_ICONS_JSON, {});
  const result: Record<string, string> = {};
  for (const killer of killers) {
    const slug = slugify(killer);
    const destAbsolute = join(PUBLIC_LOADOUT_DIR, "power", `${slug}.webp`);
    if (existing[killer] && existsSync(destAbsolute)) {
      result[killer] = existing[killer];
      continue;
    }
    try {
      const html = await fetchWikiPageHtmlFollowingRedirects(`The ${killer}`);
      const iconUrl = findFirstImageAfterHeading(cheerio.load(html), POWER_HEADING_PATTERN);
      if (!iconUrl) {
        console.warn(`  No Power icon found on ${killer}'s wiki page — skipping`);
        continue;
      }
      const res = await fetch(iconUrl, { headers: REQUEST_HEADERS });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(destAbsolute), { recursive: true });
      await sharp(buffer).resize(ICON_SIZE, ICON_SIZE, { fit: "cover" }).webp({ quality: 90 }).toFile(destAbsolute);
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
  if (itemTables.length !== ITEM_TABLE_TYPES.length) {
    throw new Error(
      `Items page has ${itemTables.length} tables, expected ${ITEM_TABLE_TYPES.length} — ` +
        `the wiki's layout changed and ITEM_TABLE_TYPES in this script needs updating.`,
    );
  }
  const items: Item[] = [];
  itemTables.each((i, t) => {
    const itemType = ITEM_TABLE_TYPES[i];
    if (!itemType) return;
    const pieces = parsePieceTable($items, $items(t));
    for (const piece of pieces) {
      items.push({ kind: "item", itemType, icon: "", ...toLocalized("item", piece) });
    }
  });
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
      addonRows.push({ role: "survivor", character: ".All", itemType, piece });
    }
  }
  for (const { itemType, ...piece } of KEY_MAP_ADDON_OVERRIDES) {
    addonRows.push({ role: "survivor", character: ".All", itemType, piece });
  }

  const killerAddonSections = findHeadingTables($addons, "Killer Power Add-ons");
  const powerToCharacter = await resolvePowerToCharacter(killerAddonSections.map((s) => s.heading));
  for (const { heading, table } of killerAddonSections) {
    const character = powerToCharacter[heading];
    for (const piece of parsePieceTable($addons, table)) {
      addonRows.push({ role: "killer", character, piece });
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

  const addons: Addon[] = addonRows.map((row) =>
    row.role === "survivor"
      ? {
          kind: "addon",
          role: "survivor",
          itemType: row.itemType!,
          character: ".All",
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
  const offerings: Offering[] = [];
  const offeringSections = findOfferingTables($offerings, "List of Offerings");
  console.log("Resolving each offering's role from its own page ...");
  for (const { heading, table } of offeringSections) {
    const fallbackRole = OFFERING_CATEGORY_ROLE[heading];
    if (!fallbackRole) continue; // "Events" and any unrecognized category — see OFFERING_CATEGORY_ROLE comment
    const pieces = parsePieceTable($offerings, table);
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
    const allItemRows: ScrapedPiece[] = [];
    itemTables.each((i, t) => {
      if (!ITEM_TABLE_TYPES[i]) return;
      allItemRows.push(...parsePieceTable($items, $items(t)));
    });
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
      items: `https://deadbydaylight.fandom.com/wiki/${ITEMS_PAGE}`,
      addons: `https://deadbydaylight.fandom.com/wiki/${ADDONS_PAGE}`,
      offerings: `https://deadbydaylight.fandom.com/wiki/${OFFERINGS_PAGE}`,
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
    .filter((c) => c !== ".All")
    .sort();
  const killerPowerIcons = await scrapeKillerPowerIcons(killerCharacters);
  writeFileSync(KILLER_POWER_ICONS_JSON, JSON.stringify(killerPowerIcons, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(killerPowerIcons).length} killer Power icons`);

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(ITEMS_JSON, JSON.stringify(items, null, 2) + "\n");
  writeFileSync(ADDONS_JSON, JSON.stringify(addons, null, 2) + "\n");
  writeFileSync(OFFERINGS_JSON, JSON.stringify(offerings, null, 2) + "\n");
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
