// Descriptions are the bulk of the shipped data and are needed by nobody
// until a card is opened.
//
// Measured on the corpus this was written against: data/addons.json is
// 196 KB gzipped, of which 162 KB is description text; data/perks.json is
// 85 KB, of which 73 KB is descriptions. All of it was reaching every
// visitor in the first JS chunk — the built bundle contained the Russian
// description of a Xenomorph add-on — including visitors who never open a
// single card, and including English readers, who were downloading the
// Russian text as well.
//
// So the lists and the prose are written separately: the lists carry what
// a roll and a grid need (slug, name, icon, who it belongs to), and the
// prose goes into a lookup keyed by the same slug, loaded on demand (see
// lib/descriptions.ts).
//
// Both scrapers call this at write time so the split has one owner and
// can't drift between the two pipelines.

/** The three fields that carry prose. Kept together because they're always
 *  read together: describe() picks whichever of them applies. */
export interface DescriptionEntry {
  description: string;
  descriptionRu?: unknown;
  descriptionRuRaw?: string;
}

export type DescriptionLookup = Record<string, DescriptionEntry>;

/**
 * Splits rows into the list that ships eagerly and the prose that doesn't.
 *
 * @param rows Any rows carrying the description fields.
 * @param keyOf How a row is looked up later — the plain slug for perks,
 *   `kind:slug` for loadout pieces, since an item, an add-on and an
 *   offering can all slugify to the same string.
 */
export function splitDescriptions<T extends DescriptionEntry>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): { rows: Omit<T, keyof DescriptionEntry>[]; descriptions: DescriptionLookup } {
  const descriptions: DescriptionLookup = {};
  const stripped = rows.map((row) => {
    const { description, descriptionRu, descriptionRuRaw, ...rest } = row;
    const entry: DescriptionEntry = { description };
    // Omitted rather than written as undefined: these are absent for most
    // rows, and `"descriptionRu": null` per row would put a good chunk of
    // the saving straight back.
    if (descriptionRu !== undefined) entry.descriptionRu = descriptionRu;
    if (descriptionRuRaw !== undefined) entry.descriptionRuRaw = descriptionRuRaw;
    descriptions[keyOf(row)] = entry;
    return rest;
  });
  return { rows: stripped, descriptions };
}
