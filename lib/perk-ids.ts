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

// ---------------------------------------------------------------------------
// Squad links (`?sq=28,3,297,72.15,9,201,4`)
//
// Same ids as `?p=`, one build per player. The separator between builds is a
// dot on purpose: URLSearchParams serialises as form-urlencoded, which leaves
// `*-._` alone and percent-encodes everything else — a semicolon would come
// out as `%3B` in every squad link ever shared, and the comma already shows up
// as `%2C` inside a build. A dot keeps the part that tells you where one
// player's build ends readable in a chat client.
//
// Nothing here validates roles or resolves renames; that is getPerkBySlug's
// job, exactly as for the single-build format.

const BUILD_SEPARATOR = ".";

/** Slugs per build -> the `sq` value, or null when any perk has no short id.
 *
 *  Null rather than a partial string: the single-build writer can fall back
 *  to the legacy full-slug format, and there is no such fallback for squads,
 *  so a link that silently dropped a player's perk would be worse than no
 *  link at all. Every slug in data/perks.json gets an id at scrape time, so
 *  this is a safety net rather than an expected path. */
export function encodeSquadParam(
  builds: readonly (readonly string[])[],
): string | null {
  const encoded: string[] = [];
  for (const build of builds) {
    const ids: number[] = [];
    for (const slug of build) {
      const id = getIdForSlug(slug);
      if (id === undefined) return null;
      ids.push(id);
    }
    encoded.push(ids.join(","));
  }
  return encoded.length > 0 ? encoded.join(BUILD_SEPARATOR) : null;
}

/** The `sq` value -> slugs per build.
 *
 *  Unknown ids are dropped from their build rather than failing the whole
 *  link: a squad shared before a perk was renamed out of the id map should
 *  still open with the players and perks that do resolve. Empty segments
 *  (a trailing dot, a doubled one) are dropped too — they carry no player,
 *  and keeping them would add blank columns to someone else's squad. */
export function decodeSquadParam(param: string): string[][] {
  return param
    .split(BUILD_SEPARATOR)
    .filter((segment) => segment.length > 0)
    .map((segment) =>
      segment
        .split(",")
        .map((idText) => {
          const id = Number(idText);
          return Number.isFinite(id) ? getSlugForId(id) : undefined;
        })
        .filter((slug): slug is string => slug !== undefined),
    )
    .filter((build) => build.length > 0);
}
