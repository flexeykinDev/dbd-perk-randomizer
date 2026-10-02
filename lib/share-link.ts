// The share link, read and written in one place.
//
// This is one format with two ends, and every bug it has had was the two ends
// disagreeing: a parameter the writer emitted and the reader discarded, or a
// level the reader applied and the writer forgot. They lived 400 lines apart
// in the board, which is how `?r=k` on its own came to open the wrong role —
// the writer put it in every link it generated and the reader threw it away.
//
// Both halves are pure. `parseShareLink` takes a query string and
// `writeShareQuery` returns one; nothing here touches `window`, so a test can
// hand one function's output to the other and assert they agree. The two
// window-reading wrappers are at the bottom and do nothing else.
import {
  getPerkBySlug,
} from "./perks";
import { getLoadoutPiece } from "./loadout";
import {
  decodeSquadParam,
  encodeSquadParam,
  getIdForSlug,
  getSlugForId,
} from "./perk-ids";
import {
  getIdForLoadoutPiece,
  getLoadoutPieceKeyForId,
} from "./loadout-ids";
import { isCoherenceLevel, type CoherenceLevel } from "./coherence";
import type { BuildMode, LoadoutPiece, Perk, PerkRole } from "./types";

export const ROLE_SHORT: Record<PerkRole, string> = {
  survivor: "s",
  killer: "k",
};
const ROLE_FROM_SHORT: Record<string, PerkRole> = {
  s: "survivor",
  k: "killer",
};

export interface InitialUrlState {
  role: PerkRole;
  mode: BuildMode;
  seed?: string;
  /** From `?c=` — see lib/coherence.ts.
   *
   *  In practice always present: `Number(null)` is 0 and 0 is a valid level,
   *  so a link with no `c` resolves to chaos rather than to "unspecified".
   *  That is the right answer and the reason links written before this
   *  parameter existed still open the build they describe — they were rolled
   *  at level 0. Optional in the type because a caller should not assume it,
   *  and because the board's `!== undefined` guard predates this note. */
  coherence?: CoherenceLevel;
  perks?: Perk[];
  loadoutPieces?: LoadoutPiece[];
  /** One build per player, from `?sq=` — see lib/perk-ids.ts. */
  squad?: Perk[][];
}

/** Reads either the compact URL format (`?r=s&p=42,105,12,8`, current) or
 *  the legacy one (`?role=survivor&perks=full-slug-names`, from links
 *  shared before short IDs existed) — old links must keep working. `?seed=`
 *  takes priority over an explicit perk/loadout list either way, since a
 *  seed is enough to re-derive the build client-side. `?mode=loadout` plus
 *  `?lp=id1,id2,...` mirrors `?p=` for sharing a specific Full Loadout roll;
 *  `?mode=all` carries both `?p=` and `?lp=` together for the combined view.
 *
 *  A bare role (`?r=k`) is honoured on its own: it sets the side and nothing
 *  else. It used to be discarded unless a build or an explicit mode came
 *  with it, which meant the very parameter the site writes into its own
 *  share links opened the wrong role when a link got truncated. Applying it
 *  does not mark anything as a shared build — that still requires `p`/`lp`
 *  or a seed — so the visitor gets a normal rerollable roll. */
export function parseShareLink(search: string): InitialUrlState | null {
  const params = new URLSearchParams(search);

  const shortRole = params.get("r");
  const legacyRole = params.get("role");
  const role = shortRole
    ? ROLE_FROM_SHORT[shortRole]
    : legacyRole === "survivor" || legacyRole === "killer"
      ? legacyRole
      : undefined;
  if (!role) return null;

  const modeParam = params.get("mode");
  const mode: BuildMode =
    modeParam === "loadout" ? "loadout" : modeParam === "all" ? "all" : "perks";

  /* The level changes what a seed means — the same seed at level 0 and
     level 3 are different builds — so it has to travel with the link or a
     shared seed reopens as something else. Read before the seed branch
     returns, for exactly that reason. */
  const coherenceParam = Number(params.get("c"));
  const coherence = isCoherenceLevel(coherenceParam) ? coherenceParam : undefined;

  const seed = params.get("seed");
  if (seed) return { role, mode, seed, coherence };

  const readLoadoutPieces = (): LoadoutPiece[] => {
    const lpParam = params.get("lp");
    if (!lpParam) return [];
    return lpParam
      .split(",")
      .map((idStr) => {
        const id = Number(idStr);
        const key = Number.isFinite(id)
          ? getLoadoutPieceKeyForId(id)
          : undefined;
        return key ? getLoadoutPiece(key.kind, key.slug) : undefined;
      })
      .filter((piece): piece is LoadoutPiece => !!piece);
  };

  const readPerks = (): Perk[] => {
    const idsParam = params.get("p");
    if (idsParam) {
      const matched = idsParam
        .split(",")
        .map((idStr) => {
          const id = Number(idStr);
          const slug = Number.isFinite(id) ? getSlugForId(id) : undefined;
          return slug ? getPerkBySlug(slug) : undefined;
        })
        .filter((perk): perk is Perk => !!perk && perk.role === role);
      if (matched.length > 0) return matched;
    }
    const slugsParam = params.get("perks");
    if (slugsParam) {
      return slugsParam
        .split(",")
        .map((slug) => getPerkBySlug(slug))
        .filter((perk): perk is Perk => !!perk && perk.role === role);
    }
    return [];
  };

  if (mode === "loadout") {
    const loadoutPieces = readLoadoutPieces();
    if (loadoutPieces.length > 0) return { role, mode, loadoutPieces, coherence };
    // Explicit `?mode=loadout` is itself meaningful intent — unlike a bare
    // `?r=...` alone (which existing perk links deliberately don't treat as
    // "shared state," see the perks branch below), a link that spells out
    // the mode should open in that mode even without a specific build to
    // restore.
    return { role, mode, coherence };
  }

  if (mode === "all") {
    const perks = readPerks();
    const loadoutPieces = readLoadoutPieces();
    if (perks.length > 0 || loadoutPieces.length > 0) {
      return {
        role,
        mode,
        coherence,
        perks: perks.length > 0 ? perks : undefined,
        loadoutPieces: loadoutPieces.length > 0 ? loadoutPieces : undefined,
      };
    }
    return { role, mode, coherence }; // same "explicit mode is enough" rule as loadout above
  }

  // A squad link is read before the single-build one. They never appear
  // together — the writer below picks exactly one — and `sq` is the more
  // specific claim of the two, so it wins if a hand-edited link carries both.
  const squadParam = params.get("sq");
  if (squadParam) {
    const squad = decodeSquadParam(squadParam)
      .map((slugs) =>
        slugs
          .map((slug) => getPerkBySlug(slug))
          .filter((perk): perk is Perk => !!perk && perk.role === role),
      )
      .filter((build) => build.length > 0);
    if (squad.length > 0) return { role, mode, squad };
  }

  const perks = readPerks();
  if (perks.length > 0) return { role, mode, perks, coherence };

  // A role with nothing attached is still intent worth honouring. `r` is the
  // short parameter the site writes into every share link it generates, so
  // `?r=k` on its own — a link truncated in a chat client, or shortened by
  // hand — used to open the Survivor side without a word. Only the role and
  // mode are applied here; nothing is marked as a shared build, so the
  // visitor gets a normal, rerollable roll for the side they asked for.
  return { role, mode, coherence };
}

/** What the link has to carry: the build on screen and the settings that
 *  change what it means. */
export interface ShareLinkState {
  role: PerkRole;
  mode: BuildMode;
  coherence: CoherenceLevel;
  seed: string | null;
  perks: Perk[];
  loadoutPieces: LoadoutPiece[];
  /** The squad on screen, or null when squad mode is off or has not rolled
   *  yet. A squad replaces the single build's `p=` rather than sitting beside
   *  it — see below. */
  squad: Perk[][] | null;
}

/** The query string for a given board state, without the leading `?`.
 *
 *  The order of the branches is the precedence: a seed outranks everything
 *  (it re-derives the build on its own), a squad outranks the single build
 *  (it is what is on screen), and a loadout rides along with either because
 *  `?mode=all` needs both halves. */
export function writeShareQuery(state: ShareLinkState): string {
  const params = new URLSearchParams();
  params.set("r", ROLE_SHORT[state.role]);
  if (state.mode !== "perks") params.set("mode", state.mode); // "loadout" or "all"
  /* Only when it is doing something. At level 0 the link is byte-for-byte
     what this site has always written, so nothing about existing links,
     bookmarks or the OBS overlay's URL changes for anyone who leaves the
     setting alone. */
  if (state.coherence !== 0) params.set("c", String(state.coherence));
  if (state.seed) {
    params.set("seed", state.seed);
    return params.toString();
  }
  if (state.mode !== "perks" && state.loadoutPieces.length > 0) {
    const ids = state.loadoutPieces.map((p) =>
      getIdForLoadoutPiece(p.kind, p.slug),
    );
    if (ids.every((id): id is number => id !== undefined)) {
      params.set("lp", ids.join(","));
    }
    // No legacy fallback needed here (unlike perks below) — every
    // loadout piece gets a short ID at scrape time, same guarantee
    // data/perk-ids.json has always made for perks.
  }
  // A squad on screen is what the link should reopen, so it replaces the
  // single build's `p=` rather than sitting beside it. Falls through to the
  // normal writer before the first roll, when there is no squad yet.
  if (state.squad && state.squad.length > 0) {
    const sq = encodeSquadParam(
      state.squad.map((build) => build.map((perk) => perk.slug)),
    );
    if (sq) params.set("sq", sq);
    return params.toString();
  }
  if (state.mode !== "loadout" && state.perks.length > 0) {
    const ids = state.perks.map((p) => getIdForSlug(p.slug));
    if (ids.every((id): id is number => id !== undefined)) {
      params.set("p", ids.join(","));
    } else {
      // Safety net for a perk with no assigned short ID (shouldn't
      // happen — every slug in data/perks.json gets one at scrape
      // time) — fall back to the legacy full-slug format rather than
      // producing a share link that silently drops perks.
      params.set("perks", state.perks.map((p) => p.slug).join(","));
    }
  }
  return params.toString();
}

/** `parseShareLink` against the current address. Returns null during the
 *  server render, where there is no address to read. */
export function readInitialUrlState(): InitialUrlState | null {
  if (typeof window === "undefined") return null;
  return parseShareLink(window.location.search);
}

/** Rewrites the address bar in place. `replaceState`, not `pushState`: every
 *  roll would otherwise add a history entry, and Back would walk through a
 *  session's builds one at a time instead of leaving the site. */
export function replaceShareQuery(state: ShareLinkState): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}?${writeShareQuery(state)}`,
  );
}
