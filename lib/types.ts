export type PerkRole = "survivor" | "killer";

/** Hand-maintained RU description, mirroring the game's own "core effect vs
 *  full text" split. `core` bullets and `full`/`quote` use `**term**` to mark
 *  spans the UI should highlight — see lib/perk-description.ts. */
export interface LocalizedDescription {
  full: string;
  core: string[];
  quote?: string;
}

/** What a perk needs to be rolled, listed and drawn.
 *
 *  Deliberately without its description: prose lives in
 *  data/perk-descriptions.json and loads on demand (see
 *  lib/descriptions.ts and scripts/split-descriptions.ts), because it was
 *  the majority of the shipped payload and is read only when someone opens
 *  a card. */
export interface Perk {
  slug: string;
  role: PerkRole;
  name: {
    en: string;
    ru: string;
  };
  character: string;
  icon: string;
  /** Tag ids from the keyword classifier, worked out by the scraper (see
   *  classifyPerk in lib/perk-tags.ts). Stored rather than derived because
   *  deriving it needs the description, and the pool filter and themed
   *  builds need tags for every perk at once — which would have pulled the
   *  whole description corpus back into the first page load. */
  tags?: string[];
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
  | "firecracker"
  | "flashlight"
  | "fog-vial"
  | "key"
  | "map"
  | "medkit"
  | "toolbox";

export type LoadoutKind = "item" | "addon" | "offering";

/** Shared shape for the 3 Full Loadout piece types — deliberately mirrors
 *  Perk's field names (slug/name/icon/addedAt) so UI components (grid,
 *  card, detail modal) can stay generic across perks and loadout pieces
 *  instead of duplicating rendering logic per type.
 *
 *  Descriptions live in data/loadout-descriptions.json, keyed `kind:slug`,
 *  and load on demand — see lib/descriptions.ts. */
interface LoadoutPieceBase {
  slug: string;
  name: { en: string; ru: string };
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

/** Which piece kinds (plus perks) are shown in the OBS overlay and in
 *  Download Image.
 *
 *  Deliberately separate from LoadoutSlots, which decides what gets
 *  *rolled*: hiding the Offering here still rolls one, it just doesn't
 *  reach the stream. Owned by randomizer-board.tsx, since it filters both
 *  the overlay publish and ShareCard's export; the OBS modal only renders
 *  the toggles for it. */
export interface PieceVisibility {
  perks: boolean;
  item: boolean;
  addon: boolean;
  offering: boolean;
}

/** Which shape the shareable build card is rendered at — a 16:9 image for a
 *  post, or a 9:16 one for a story. Lives here rather than in share-card.tsx
 *  so lib/use-share-export.ts can name it without lib/ reaching up into
 *  components/; share-card re-exports it, so existing imports still work. */
export type ShareCardLayout = "landscape" | "story";
