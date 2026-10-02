// Turning stored keys back into a build.
//
// Four things on the board install a build they did not roll: a share link, a
// saved build from the Vault, a past roll from History, and `!paste` from
// Twitch chat. They disagree about the side effects — which is the board's
// business and stays there — but they all begin by resolving a list of strings
// or numbers into real perks and pieces, and dropping whatever no longer
// exists. That resolution was written out four times.
//
// It matters more than it looks. Every one of these lists was stored by an
// older version of the site, so each has to survive the game renaming a perk
// (data/perk-slug-aliases.json), the wiki retiring one, and a key written in a
// format that has since changed. Getting it right in one place and wrong in
// another is exactly the failure these functions exist to prevent: a build
// that opens with three perks instead of four and says nothing.
//
// Pure on purpose — no React here. The callers are a callback, a chat handler
// and two modals, and none of them needs a hook to look something up.
import { getPerkBySlug } from "./perks";
import { getLoadoutPiece } from "./loadout";
import { getSlugForId } from "./perk-ids";
import { parseLoadoutKey } from "./history";
import type { LoadoutPiece, Perk, PerkRole } from "./types";

/** Perks for a list of slugs, in the order given.
 *
 *  Unresolvable slugs are dropped rather than left as holes, and with a `role`
 *  so is any perk belonging to the other side — a build is one side's or it is
 *  nothing, and showing a mixed four is worse than showing the two that match.
 *  Callers check the result for emptiness and do nothing when it is: an empty
 *  board is the one outcome none of them wants. */
export function resolvePerkSlugs(
  slugs: readonly string[],
  role?: PerkRole,
): Perk[] {
  return slugs
    .map((slug) => getPerkBySlug(slug))
    .filter((perk): perk is Perk => !!perk && (!role || perk.role === role));
}

/** Loadout pieces for a list of `kind:slug` keys, in the order given.
 *
 *  No role filter, unlike perks above: the key already names the kind, and a
 *  piece's role is a property of the piece rather than something a caller
 *  could usefully disagree with. */
export function resolveLoadoutKeys(keys: readonly string[]): LoadoutPiece[] {
  return keys
    .map((key) => {
      const parsed = parseLoadoutKey(key);
      return parsed ? getLoadoutPiece(parsed.kind, parsed.slug) : undefined;
    })
    .filter((piece): piece is LoadoutPiece => !!piece);
}

/** Perks for a run of short ids typed into chat — `!paste 42, 105 12`.
 *
 *  Commas, spaces or both, because a viewer typing a build into chat will use
 *  whichever they please. The first id that resolves decides the role and the
 *  rest are held to it, the same rule a shared `?p=` link follows: perks
 *  determine the side, and anything that disagrees is dropped rather than
 *  shown mixed. */
export function resolvePerkIdList(argsText: string): Perk[] {
  const ids = argsText
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (ids.length === 0) return [];
  const matched = ids
    .map((id) => {
      const slug = getSlugForId(id);
      return slug ? getPerkBySlug(slug) : undefined;
    })
    .filter((p): p is Perk => !!p);
  if (matched.length === 0) return [];
  return matched.filter((p) => p.role === matched[0].role);
}
