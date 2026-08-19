import itemsData from "@/data/items.json";
import addonsData from "@/data/addons.json";
import offeringsData from "@/data/offerings.json";
import loadoutMetaData from "@/data/loadout-meta.json";
import killerPowerIconsData from "@/data/killer-power-icons.json";
import { GENERAL_CHARACTER } from "./types";
import type {
  Addon,
  Item,
  ItemType,
  Loadout,
  LoadoutKind,
  LoadoutMeta,
  LoadoutPiece,
  LoadoutSlots,
  Offering,
  PerkRole,
} from "./types";
import { createSeededRandom, shuffle } from "./seeded-random";

/** Display names for the survivor item types, shared by the loadout HUD and
 *  the pool manager's category filter so the two can't drift apart. */
export const ITEM_TYPE_LABEL: Record<ItemType, { ru: string; en: string }> = {
  firecracker: { ru: "Петарда", en: "Firecracker" },
  flashlight: { ru: "Фонарик", en: "Flashlight" },
  key: { ru: "Ключ", en: "Key" },
  map: { ru: "Карта", en: "Map" },
  medkit: { ru: "Аптечка", en: "Med-Kit" },
  toolbox: { ru: "Набор инструментов", en: "Toolbox" },
};

export const items: Item[] = itemsData as Item[];
export const addons: Addon[] = addonsData as Addon[];
export const offerings: Offering[] = offeringsData as Offering[];
export const loadoutMeta: LoadoutMeta = loadoutMetaData as LoadoutMeta;
const killerPowerIcons: Record<string, string> = killerPowerIconsData;

/** A killer's Power icon (e.g. Bear Trap for The Trapper), scraped from
 *  their own wiki character page — see scrapeKillerPowerIcons in
 *  scripts/scrape-loadout.ts. Shown in the loadout UI where a survivor's
 *  Item would go, since killers carry a Power instead of an Item. */
export function getKillerPowerIcon(character: string): string | undefined {
  return killerPowerIcons[character];
}

const itemsBySlug = new Map(items.map((i) => [i.slug, i]));
const addonsBySlug = new Map(addons.map((a) => [a.slug, a]));
const offeringsBySlug = new Map(offerings.map((o) => [o.slug, o]));

const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function isNewLoadoutPiece(piece: { addedAt: string }): boolean {
  return Date.now() - new Date(piece.addedAt).getTime() < NEW_WINDOW_MS;
}

export function getItems(): Item[] {
  return items;
}

export function getLoadoutPiece(kind: LoadoutKind, slug: string): LoadoutPiece | undefined {
  if (kind === "item") return itemsBySlug.get(slug);
  if (kind === "addon") return addonsBySlug.get(slug);
  return offeringsBySlug.get(slug);
}

/** Flattens a rolled Loadout into the ordered [item?, addon, addon?,
 *  offering?] list LoadoutGrid renders — the UI doesn't need to know
 *  about the item/addons/offering distinction, just "here are some
 *  pieces," same as how the board hands PerkGrid a flat Perk[]. */
export function flattenLoadout(loadout: Loadout): LoadoutPiece[] {
  const pieces: LoadoutPiece[] = [];
  if (loadout.item) pieces.push(loadout.item);
  pieces.push(...loadout.addons);
  if (loadout.offering) pieces.push(loadout.offering);
  return pieces;
}

export function getAddonsForItemType(itemType: ItemType): Addon[] {
  return addons.filter((a) => a.role === "survivor" && a.itemType === itemType);
}

export function getAddonsForKiller(character: string): Addon[] {
  return addons.filter((a) => a.role === "killer" && a.character === character);
}

/** Every killer that has at least one add-on — ".All" (the "works for any
 *  killer" bucket, currently always empty after unavailable-filtering, see
 *  scripts/scrape-loadout.ts) is deliberately excluded since it isn't a
 *  character you can actually be assigned as. */
export function getKillerCharacters(): string[] {
  return [...new Set(addons.filter((a) => a.role === "killer").map((a) => a.character))]
    .filter((c) => c !== GENERAL_CHARACTER)
    .sort();
}

export function getOfferingsByRole(role: PerkRole): Offering[] {
  return offerings.filter((o) => o.role === role || o.role === "both");
}

/** Every loadout piece a player of `role` could ever roll — items only
 *  apply to survivors (killers don't carry one, see Loadout), add-ons are
 *  filtered by role, offerings include "both". Used by LoadoutExcludePanel
 *  to manage the pool the same way ExcludePanel manages the perk pool.
 *
 *  When a specific killer `character` is given (Feature #2's picker, forcing
 *  who gets rolled — see getRandomLoadout's forcedCharacter), the add-on
 *  list is narrowed to just that killer's own Power add-ons: every other
 *  killer's add-ons are already unreachable once a character is locked in,
 *  so showing/excluding them in the pool would just be noise. */
export function getLoadoutPoolForRole(role: PerkRole, character?: string | null): LoadoutPiece[] {
  const pieces: LoadoutPiece[] = [];
  if (role === "survivor") pieces.push(...items);
  const roleAddons = addons.filter((a) => a.role === role);
  pieces.push(
    ...(role === "killer" && character ? roleAddons.filter((a) => a.character === character) : roleAddons),
  );
  pieces.push(...getOfferingsByRole(role));
  return pieces;
}

// Exclusion sets are namespaced "kind:slug" (e.g. "item:flashlight",
// "addon:bear-oil", "offering:escape-cake") — same reason the scraper
// namespaces IDs and translations the same way: an item, add-on, and
// offering could otherwise slugify to the same string.
function excludeKey(kind: "item" | "addon" | "offering", slug: string): string {
  return `${kind}:${slug}`;
}

export function getAvailableItems(excludedSlugs?: ReadonlySet<string>): Item[] {
  if (!excludedSlugs || excludedSlugs.size === 0) return items;
  return items.filter((i) => !excludedSlugs.has(excludeKey("item", i.slug)));
}

export function getAvailableAddons(pool: Addon[], excludedSlugs?: ReadonlySet<string>): Addon[] {
  if (!excludedSlugs || excludedSlugs.size === 0) return pool;
  return pool.filter((a) => !excludedSlugs.has(excludeKey("addon", a.slug)));
}

export function getAvailableOfferings(role: PerkRole, excludedSlugs?: ReadonlySet<string>): Offering[] {
  const pool = getOfferingsByRole(role);
  if (!excludedSlugs || excludedSlugs.size === 0) return pool;
  return pool.filter((o) => !excludedSlugs.has(excludeKey("offering", o.slug)));
}

/** Survivor: an Item (from the pool) plus up to 2 Add-ons matching that
 *  item's type, plus an Offering. Killer: DBD killers don't carry an
 *  Item — their loadout is 2 Add-ons for their own unique Power plus an
 *  Offering — so a killer character has to be picked first before its
 *  add-on pool even exists: `forcedCharacter` (Feature #2's "Random
 *  Character" button) picks it explicitly when given and valid, otherwise
 *  it's chosen uniformly at random same as before. Each of `slots.item` /
 *  `.addons` / `.offering` independently skips that piece (left `null` /
 *  empty) when off; for survivor, addons also come back empty if
 *  `slots.item` is off, since an add-on without its item doesn't
 *  correspond to anything equippable. */
export function getRandomLoadout(
  role: PerkRole,
  slots: LoadoutSlots,
  excludedSlugs?: ReadonlySet<string>,
  random: () => number = Math.random,
  forcedCharacter?: string | null,
): Loadout {
  if (role === "survivor") {
    const item = slots.item ? (shuffle(getAvailableItems(excludedSlugs), random)[0] ?? null) : null;
    const addonPool = item && slots.addons ? getAddonsForItemType(item.itemType) : [];
    const rolledAddons = shuffle(getAvailableAddons(addonPool, excludedSlugs), random).slice(0, 2);
    const offering = slots.offering
      ? (shuffle(getAvailableOfferings("survivor", excludedSlugs), random)[0] ?? null)
      : null;
    return { role, character: null, item, addons: rolledAddons, offering };
  }

  const killers = getKillerCharacters();
  const character = !slots.addons
    ? null
    : forcedCharacter && killers.includes(forcedCharacter)
      ? forcedCharacter
      : (shuffle(killers, random)[0] ?? null);
  const addonPool = character ? getAddonsForKiller(character) : [];
  const rolledAddons = shuffle(getAvailableAddons(addonPool, excludedSlugs), random).slice(0, 2);
  const offering = slots.offering
    ? (shuffle(getAvailableOfferings("killer", excludedSlugs), random)[0] ?? null)
    : null;
  return { role, character, item: null, addons: rolledAddons, offering };
}

/** Deterministic Daily Challenge / shared-seed counterpart to
 *  getRandomLoadout — mirrors getSeededPerks: always draws from the *full*
 *  pool (ignoring personal exclusions) so the same seed gives every player
 *  the same loadout. Each slot gets its own seed namespace so toggling one
 *  slot on/off doesn't shift what the others roll. */
export function getSeededLoadout(role: PerkRole, slots: LoadoutSlots, seedString: string): Loadout {
  if (role === "survivor") {
    const item = slots.item ? (shuffle(items, createSeededRandom(`${seedString}:item`))[0] ?? null) : null;
    const addonPool = item && slots.addons ? getAddonsForItemType(item.itemType) : [];
    const rolledAddons = shuffle(addonPool, createSeededRandom(`${seedString}:addons`)).slice(0, 2);
    const offering = slots.offering
      ? (shuffle(getOfferingsByRole("survivor"), createSeededRandom(`${seedString}:offering`))[0] ?? null)
      : null;
    return { role, character: null, item, addons: rolledAddons, offering };
  }

  const killers = getKillerCharacters();
  const character =
    slots.addons && killers.length > 0 ? shuffle(killers, createSeededRandom(`${seedString}:character`))[0] : null;
  const addonPool = character ? getAddonsForKiller(character) : [];
  const rolledAddons = shuffle(addonPool, createSeededRandom(`${seedString}:addons`)).slice(0, 2);
  const offering = slots.offering
    ? (shuffle(getOfferingsByRole("killer"), createSeededRandom(`${seedString}:offering`))[0] ?? null)
    : null;
  return { role, character, item: null, addons: rolledAddons, offering };
}
