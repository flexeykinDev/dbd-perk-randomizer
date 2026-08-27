import type { LoadoutPiece, LocalizedDescription } from "../types";

/* The shapes the description layer passes around: what a caller hands in, and
 * what it gets back. Split out so parse/overrides/summary can each name them
 * without importing one another. */

export interface PerkDescriptionView {
  /** Brief bulleted summary of the mechanical effect, "**"-highlighted. */
  core: string[];
  /** Full descriptive text, "**"-highlighted, quote stripped out. */
  full: string;
  /** Trailing lore quote, if any (already formatted for display). */
  quote: string | null;
  /** True when this came from a hand-authored translation rather than
   *  being auto-derived from the scraped English text. */
  curated: boolean;
  /** True when `core` is a hand-written Core Effect that is already exactly
   *  what should be shown. coreSummary returns it untouched — running the
   *  clause splitter over curated text can only damage it, and did: it cut
   *  "Плотность" off the front of "Плотность Тёмного тумана +25 %". */
  coreFinal?: boolean;
}

/** The description text both Perk and LoadoutPiece carry (see LoadoutPieceBase
 *  in lib/types.ts, deliberately mirroring Perk's description fields) — this
 *  module works on either without needing to know which one it's given. */
export interface DescriptionText {
  description: string;
  descriptionRu?: LocalizedDescription;
  descriptionRuRaw?: string;
}

/** Which override table a piece is looked up in. */
export type DescribableKind = "perk" | LoadoutPiece["kind"];

/** Text PLUS the identity the override lookup is keyed on.
 *
 * Identity is required, and that is the whole point of this type. It used to
 * hold description fields only, and `overriddenCore` cast its way to `kind`
 * and `slug` — which made "pass an object with no identity" a legal call that
 * silently returned every override as absent. loadout-grid.tsx did exactly
 * that, and all 118 hand-written Core Effects were dead in the UI for weeks
 * while every unit test passed, because the tests composed an identity the
 * component never did. Requiring the fields here is what turns that from a
 * silent runtime no-op into a compile error. */
export interface DescribableEntity extends DescriptionText {
  kind: DescribableKind;
  slug: string;
}
