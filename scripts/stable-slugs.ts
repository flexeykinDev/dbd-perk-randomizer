// Who keeps the bare slug when two pieces share a name.
//
// A handful of add-ons across different killers and items have the same English
// name — "Jump Rope" belongs to both The Nightmare and The Good Guy, "Mirror
// Shards" to both The Good Guy and the Slasher. They are genuinely different
// add-ons, so they need different slugs, and the scraper has always resolved
// that by giving the first one it meets the bare slug and suffixing the rest
// with their owner.
//
// "The first one it meets" is the bug. It is the wiki's page order, which is
// not a promise anybody made: on 6 October 2026 it changed, and
//
//     addon:mirror-shards   Good Guy (id 501)  ->  Slasher (id 501)
//
// Share links and saved pools carry that slug. Nothing was renamed, no id was
// reassigned, every count matched — the swap passed the census and the id guard
// and was stopped only by the identity guard written for exactly this. So the
// fix belongs here, not in the data: the bare slug has an owner already, and
// that ownership is what has to survive a reordering.
//
// New collisions — a name this repo has never shipped — still fall to first
// come, because there is no promise to keep yet. The moment that run is
// committed, the rule below pins it forever.

export interface SlugCandidate {
  /** The slug before any disambiguation. */
  slug: string;
  /** Who owns this piece. The tiebreaker, and the suffix when it loses. */
  character: string;
}

/**
 * Final slugs for `candidates`, in the same order.
 *
 * @param committed Slug -> owning character, read from the shipped data. The
 *                  only source of truth about who already holds a bare slug.
 * @param suffix    How a loser's slug is built. Injected so the caller keeps
 *                  using its own slugify rather than this module guessing.
 */
export function stableSlugs(
  candidates: readonly SlugCandidate[],
  committed: ReadonlyMap<string, string>,
  suffix: (slug: string, character: string) => string,
): string[] {
  /* Grouped first, because the decision is per NAME and not per row: with the
     sequential version the answer depended on where in the list you were, which
     is the whole defect. */
  const groups = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    const group = groups.get(candidate.slug);
    if (group) group.push(index);
    else groups.set(candidate.slug, [index]);
  });

  const out: string[] = new Array(candidates.length);
  const used = new Set<string>();

  for (const [slug, indices] of groups) {
    /* Whoever the shipped data says owns this slug keeps it, wherever they
       happen to appear in this run. Everyone else is suffixed. */
    const owner = committed.get(slug);
    const keeperIndex = owner
      ? indices.find((i) => candidates[i].character === owner)
      : undefined;
    /* No committed owner, or the owner is gone from the game: first come. A
       disappeared owner is not something to preserve a slug for — the identity
       guard will still report the change, and a person decides. */
    const keeper = keeperIndex ?? indices[0];

    for (const index of indices) {
      const candidate = candidates[index];
      let value = index === keeper ? slug : suffix(slug, candidate.character);
      /* Two pieces with the same name AND the same owner would still collide.
         It has not happened, but a silent merge into one id and one icon is
         exactly the failure this file exists to prevent, so it counts rather
         than trusting that it never will. */
      let n = 2;
      while (used.has(value)) value = `${suffix(slug, candidate.character)}-${n++}`;
      used.add(value);
      out[index] = value;
    }
  }
  return out;
}
