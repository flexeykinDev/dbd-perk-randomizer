import idsData from "@/data/perk-ids.json";

// Stable slug <-> short numeric ID mapping for compact share URLs
// (?p=42,105,12,8 instead of full slug names). IDs are assigned once in
// data/perk-ids.json and never reassigned — see scripts/scrape-perks.ts,
// which only appends IDs for newly discovered slugs — so an old shared
// link keeps resolving to the same perk even after future scrapes reorder
// or add to the underlying wiki table.
const SLUG_TO_ID: Record<string, number> = idsData;
const ID_TO_SLUG = new Map<number, string>(
  Object.entries(SLUG_TO_ID).map(([slug, id]) => [id, slug]),
);

export function getIdForSlug(slug: string): number | undefined {
  return SLUG_TO_ID[slug];
}

export function getSlugForId(id: number): string | undefined {
  return ID_TO_SLUG.get(id);
}
