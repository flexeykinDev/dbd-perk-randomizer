export type PerkRole = "survivor" | "killer";

export interface Perk {
  slug: string;
  role: PerkRole;
  name: {
    en: string;
    ru: string;
  };
  description: string;
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
