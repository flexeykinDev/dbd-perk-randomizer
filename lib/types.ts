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
