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

    const name = cleanText(nameCell.text());
    const description = cleanDescription(descriptionCell.text());
    const iconSourceUrl = iconCell.find("img").attr("data-src") ?? "";
    if (!name || !iconSourceUrl || !description) return;
    if (UNAVAILABLE_MARKERS.test(description)) return;

    rows.push({ name, slug: slugify(name), description, iconSourceUrl: iconSourceUrl.split("/revision/")[0] });
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
  // findHeadingTables here) is skipped the same way.
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
  previousIconSlugs: Set<string>,
): Promise<string> {
  const destRelative = `/loadout/${kind}/${slug}.webp`;
  const destAbsolute = join(PUBLIC_LOADOUT_DIR, kind, `${slug}.webp`);

  if (previousIconSlugs.has(`${kind}/${slug}`) && existsSync(destAbsolute)) {
    return destRelative; // already have this icon from a previous run
  }

  const res = await fetch(sourceUrl, { headers: REQUEST_HEADERS });
  if (!res.ok) throw new Error(`Failed to download icon for ${slug}: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  mkdirSync(dirname(destAbsolute), { recursive: true });
  await sharp(buffer).resize(ICON_SIZE, ICON_SIZE, { fit: "cover" }).webp({ quality: 90 }).toFile(destAbsolute);
  return destRelative;
}

// Same MediaWiki parse endpoint as fetchWikiPageHtml, but following
// redirects — killer names ("The Trapper") are themselves redirect pages
// to the character's real-name article ("Evan MacMillan"), unlike
// Items/Add-ons/Offerings which are already canonical page titles.
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
// above. Cached by killer name + the icon file already existing on disk,
// same pattern as downloadIcon's previousIconSlugs check, so a rescrape
// only re-fetches a killer whose icon is missing or new.
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
  const previousIconSlugs = new Set<string>();
  for (const p of previousItems) previousIconSlugs.add(`item/${p.slug}`);
  for (const p of previousAddons) previousIconSlugs.add(`addon/${p.slug}`);
  for (const p of previousOfferings) previousIconSlugs.add(`offering/${p.slug}`);

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
  const addons: Addon[] = [];

  const survivorAddonSections = findHeadingTables($addons, "Survivor Item Add-ons");
  for (const { heading, table } of survivorAddonSections) {
    const itemType = ITEM_TYPE_BY_ADDON_HEADING[heading];
    if (!itemType) {
      console.warn(`  Unknown survivor add-on heading "${heading}" — skipping`);
      continue;
    }
    const pieces = parsePieceTable($addons, table);
    for (const piece of pieces) {
      addons.push({ kind: "addon", role: "survivor", itemType, character: ".All", icon: "", ...toLocalized("addon", piece) });
    }
  }

  const killerAddonSections = findHeadingTables($addons, "Killer Power Add-ons");
  const powerToCharacter = await resolvePowerToCharacter(killerAddonSections.map((s) => s.heading));
  for (const { heading, table } of killerAddonSections) {
    const character = powerToCharacter[heading];
    const pieces = parsePieceTable($addons, table);
    for (const piece of pieces) {
      addons.push({ kind: "addon", role: "killer", character, icon: "", ...toLocalized("addon", piece) });
    }
  }
  console.log(
    `Found ${addons.length} add-ons (${addons.filter((a) => a.role === "survivor").length} survivor / ${addons.filter((a) => a.role === "killer").length} killer)`,
  );

  // --- Offerings ---
  console.log(`Fetching ${OFFERINGS_PAGE} via MediaWiki API ...`);
  const offeringsHtml = await fetchWikiPageHtml(OFFERINGS_PAGE);
  const $offerings = cheerio.load(offeringsHtml);
  const offerings: Offering[] = [];
  const offeringSections = findHeadingTables($offerings, "List of Offerings");
  for (const { heading, table } of offeringSections) {
    const role = OFFERING_CATEGORY_ROLE[heading];
    if (!role) continue; // "Events" and any unrecognized category — see OFFERING_CATEGORY_ROLE comment
    const pieces = parsePieceTable($offerings, table);
    for (const piece of pieces) {
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
      piece.icon = await downloadIcon(piece.kind as "item" | "addon" | "offering", piece.slug, url, previousIconSlugs);
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
    const allAddonRows: ScrapedPiece[] = [];
    for (const { table } of survivorAddonSections) allAddonRows.push(...parsePieceTable($addons, table));
    for (const { table } of killerAddonSections) allAddonRows.push(...parsePieceTable($addons, table));
    await attachIcons(addons, allAddonRows);
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

  console.log(
    `Wrote ${items.length} items, ${addons.length} add-ons, ${offerings.length} offerings -> ${DATA_DIR}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
