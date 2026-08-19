export type PerkRole = "survivor" | "killer";

/** Hand-maintained RU description, mirroring the game's own "core effect vs
 *  full text" split. `core` bullets and `full`/`quote` use `**term**` to mark
 *  spans the UI should highlight — see lib/perk-description.ts. */
export interface LocalizedDescription {
  full: string;
  core: string[];
  quote?: string;
}

export interface Perk {
  slug: string;
  role: PerkRole;
  name: {
    en: string;
    ru: string;
  };
  description: string;
  /** Present only for slugs with a hand-authored entry in
   *  data/description-translations.ru.json; falls back to an auto-derived
   *  view of `description` (see getPerkDescription) when absent. */
  descriptionRu?: LocalizedDescription;
  /** Raw RU description text scraped from the perk's own wiki page (see
   *  scripts/sync-descriptions.ts / data/description-ru-raw.json) — used as
   *  the auto-derivation source instead of the English `description` when
   *  present and no hand-authored `descriptionRu` exists. */
  descriptionRuRaw?: string;
  character: string;
  icon: string;
  /** ISO date this perk was first seen by the scraper — carried forward
   *  across runs so it doesn't reset every scrape. */
  addedAt: string;
}

export interface PerksMeta {
  scrapedAt: string;
  sourceUrl: string;
  survivorCount: number;
  killerCount: number;
}

/** The 6 survivor item families — also the vocabulary used to pair an
 *  Item with its matching Addon pool (see lib/loadout.ts). Deliberately
 *  excludes chapter-specific "Limited Item"s (Eye of Vecna, Lament
 *  Configuration, Keycard, ...) — those spawn in the trial environment for
 *  one killer/chapter's mechanic rather than being a loadout selection, so
 *  the scraper skips them entirely (see ITEM_TABLE_TYPES in
 *  scripts/scrape-loadout.ts) instead of giving them a type here. */
export type ItemType =
  "firecracker" | "flashlight" | "key" | "map" | "medkit" | "toolbox";

export type LoadoutKind = "item" | "addon" | "offering";

/** Shared shape for the 3 Full Loadout piece types — deliberately mirrors
 *  Perk's field names (slug/name/description/icon/addedAt) so UI
 *  components (grid, card, detail modal) can stay generic across perks
 *  and loadout pieces instead of duplicating rendering logic per type. */
interface LoadoutPieceBase {
  slug: string;
  name: { en: string; ru: string };
  /** English only for now — RU descriptions for perks are hand-curated
   *  (data/description-translations.ru.json) or synced from the RU wiki
   *  (data/description-ru-raw.json); loadout pieces don't have either yet,
   *  so RU-language users see the English text, same honest fallback the
   *  perk system already uses for any perk without a translation. */
  description: string;
  descriptionRu?: LocalizedDescription;
  descriptionRuRaw?: string;
  icon: string;
  addedAt: string;
}

export interface Item extends LoadoutPieceBase {
  kind: "item";
  itemType: ItemType;
}

export interface Addon extends LoadoutPieceBase {
  kind: "addon";
  role: PerkRole;
  /** Which survivor item type this add-on fits (role === "survivor") —
   *  killer power add-ons don't have one; each killer's power is unique
   *  to them, so there's no shared "type" the way survivor items have. */
  itemType?: ItemType;
  /** The killer this add-on belongs to (role === "killer"), or ".All" for
   *  survivor item add-ons (role === "survivor", not tied to one
   *  character) — mirrors Perk.character, including the same ".All"
   *  sentinel from lib/character-name.ts. */
  character: string;
}

export interface Offering extends LoadoutPieceBase {
  kind: "offering";
  /** "survivor" | "killer" | "both" — most offerings (Bloodpoint bonuses,
   *  Map/Realm selection) work for either role; a handful of wiki
   *  categories are role-specific (Luck = survivor, Memento Mori/Splinters
   *  = killer) — see OFFERING_CATEGORY_ROLE in scripts/scrape-loadout.ts. */
  role: PerkRole | "both";
  category: string;
}

export type LoadoutPiece = Item | Addon | Offering;

export interface LoadoutMeta {
  scrapedAt: string;
  sourceUrls: { items: string; addons: string; offerings: string };
  itemCount: number;
  addonCount: number;
  offeringCount: number;
}

/** Which of the 3 Full Loadout pieces to roll — independently toggleable
 *  per the feature spec. For survivor, `addons` only has an effect while
 *  `item` is also on (see lib/loadout.ts). */
export interface LoadoutSlots {
  item: boolean;
  addons: boolean;
  offering: boolean;
}

/** The result of one Full Loadout roll. `character` is set only for
 *  killer (the killer whose Power add-ons were drawn); `item` is set only
 *  for survivor (killers don't carry Items in DBD). */
export interface Loadout {
  role: PerkRole;
  character: string | null;
  item: Item | null;
  addons: Addon[];
  offering: Offering | null;
}

/** Which half of the site a roll covers: perks, the full loadout, or both
 *  at once. Lives here rather than in the board because the keyboard
 *  shortcuts branch on it too (lib/use-board-shortcuts.ts). */
export type BuildMode = "perks" | "loadout" | "all";

/** The value `character` carries for content that belongs to everybody
 *  rather than to one survivor or killer — base-game perks, and add-ons
 *  that fit any item of their type.
 *
 *  Both wikis write this as `.All`, with a leading dot that exists purely
 *  to sort those rows above the named characters. That dot used to reach
 *  the shipped data and every comparison against it, so a sorting artifact
 *  was doing the work of a sentinel in six different files. The scrapers
 *  now normalise it here on the way in, and everything downstream compares
 *  against this constant instead of repeating a magic string.
 *
 *  Deliberately not `null` or absent: `character` is a required string
 *  everywhere it is read, and making it optional would push a null check
 *  into every call site to express something no caller actually cares
 *  about. */
export const GENERAL_CHARACTER = "All";

/** What the wikis write before normalisation — see GENERAL_CHARACTER. */
export const WIKI_GENERAL_CHARACTER = ".All";
