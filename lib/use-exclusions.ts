"use client";

import { useCallback, useMemo, useState } from "react";
import { getAvailablePool, getPerksByRole } from "./perks";
import { getLoadoutPoolForRole } from "./loadout";
import { getTagsForPerk } from "./perk-tags";
import { usePersistedSet } from "./use-persisted-set";
import type { LoadoutPiece, PerkRole } from "./types";

/* What has been ruled out of the pool, and everything that rules things out.
 *
 * Three separate things narrow a roll, and the roll knows about none of them:
 * the pool manager's saved exclusions, the session's theme filter, and Battle
 * Royale attrition. They all end up as one exclusion set that getRandomPerks
 * and getRandomLoadout simply subtract — which is why the theme filter is
 * expressed here as an exclusion set rather than as a filter of its own.
 *
 * Favourites ride along because they are the same shape (a persisted set of
 * slugs, toggled from the same panel), even though they weight a roll rather
 * than block one.
 *
 * Keys differ by side: perks are bare slugs, loadout pieces are `kind:slug`
 * (see excludeKey in lib/loadout.ts). Nothing merges the two.
 */

const EXCLUDED_STORAGE_KEY = "dbd-randomizer:excluded-perks";
const FAVORITE_STORAGE_KEY = "dbd-randomizer:favorite-perks";
const EXCLUDED_LOADOUT_STORAGE_KEY = "dbd-randomizer:excluded-loadout";

export type ExcludePanelKind = "perks" | "loadout";

export interface ExclusionsController {
  /** The saved sets, as the pool panels show them — manual choices only, with
   *  no theme filter or Battle Royale attrition folded in. */
  perkSlugs: ReadonlySet<string>;
  favoriteSlugs: ReadonlySet<string>;
  loadoutKeys: ReadonlySet<string>;

  /** Everything a roll must avoid: the saved sets plus the theme filter plus
   *  whatever `alsoExcluded` carries. This is what the roll actually reads. */
  combinedPerks: ReadonlySet<string>;
  combinedLoadout: ReadonlySet<string>;

  /** The perks left after all of that, and how many. */
  availablePool: ReturnType<typeof getAvailablePool>;
  availableCount: number;

  togglePerk: (slug: string) => void;
  setManyPerks: (slugs: readonly string[], present: boolean) => void;
  toggleFavorite: (slug: string) => void;
  resetPerksForRole: (role: PerkRole) => void;

  toggleLoadoutPiece: (kind: LoadoutPiece["kind"], slug: string) => void;
  setManyLoadout: (keys: readonly string[], present: boolean) => void;
  resetLoadoutForRole: (role: PerkRole) => void;

  /** The pool manager. `kind` only matters in "all" mode, which shows perks
   *  and loadout together and so needs two buttons onto two panels. */
  panelOpen: boolean;
  panelKind: ExcludePanelKind;
  openPanel: (kind: ExcludePanelKind) => void;
  closePanel: () => void;

  /** Restores all three saved sets. Called once, from the board's mount
   *  effect — see the note there about why this is not a lazy initializer. */
  hydrate: () => void;
}

export function useExclusions({
  role,
  mounted,
  themeTag,
  alsoExcluded,
}: {
  role: PerkRole;
  /** Nothing is computed before hydration — the pool depends on saved state,
   *  and guessing at it during SSR would mismatch. */
  mounted: boolean;
  /** The session's theme filter, or null for the whole role pool. */
  themeTag: string | null;
  /** Battle Royale's spent set, or null when the mode is off. Holds both
   *  bare perk slugs and `kind:slug` loadout keys, so it merges into either
   *  side without being split first. */
  alsoExcluded: ReadonlySet<string> | null;
}): ExclusionsController {
  const excludedPerks = usePersistedSet(EXCLUDED_STORAGE_KEY);
  const favorites = usePersistedSet(FAVORITE_STORAGE_KEY);
  const excludedLoadout = usePersistedSet(EXCLUDED_LOADOUT_STORAGE_KEY);

  const perkSlugs = excludedPerks.values;
  const favoriteSlugs = favorites.values;
  const loadoutKeys = excludedLoadout.values;

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelKind, setPanelKind] = useState<ExcludePanelKind>("perks");

  /* The theme filter as an exclusion set, so it merges into the same pipeline
     that already handles attrition and manual exclusions — getRandomPerks and
     the pool-exhausted check do not need to know a theme exists at all. */
  const themeExcluded = useMemo(() => {
    if (!mounted || !themeTag) return null;
    const nonMatching = getPerksByRole(role)
      .filter((p) => !getTagsForPerk(p).includes(themeTag))
      .map((p) => p.slug);
    return new Set(nonMatching);
  }, [mounted, role, themeTag]);

  const combinedPerks = useMemo(() => {
    const extra: ReadonlySet<string>[] = [];
    if (alsoExcluded && alsoExcluded.size > 0) extra.push(alsoExcluded);
    if (themeExcluded && themeExcluded.size > 0) extra.push(themeExcluded);
    // Returned as-is when nothing else applies: a fresh Set on every render
    // would change identity and re-roll the build for no reason.
    if (extra.length === 0) return perkSlugs;
    const merged = new Set(perkSlugs);
    for (const set of extra) for (const slug of set) merged.add(slug);
    return merged;
  }, [perkSlugs, alsoExcluded, themeExcluded]);

  // Loadout counterpart — same merge, just `kind:slug` keys. No theme filter
  // here; themes are a perk idea.
  const combinedLoadout = useMemo(() => {
    if (!alsoExcluded || alsoExcluded.size === 0) return loadoutKeys;
    const merged = new Set(loadoutKeys);
    for (const key of alsoExcluded) merged.add(key);
    return merged;
  }, [loadoutKeys, alsoExcluded]);

  const availablePool = useMemo(
    () => (mounted ? getAvailablePool(role, combinedPerks) : []),
    [mounted, role, combinedPerks],
  );

  const resetPerksForRole = useCallback(
    (targetRole: PerkRole) => {
      const roleSlugs = new Set(getPerksByRole(targetRole).map((p) => p.slug));
      excludedPerks.removeWhere((slug) => roleSlugs.has(slug));
    },
    [excludedPerks],
  );

  const toggleLoadoutPiece = useCallback(
    (kind: LoadoutPiece["kind"], slug: string) => excludedLoadout.toggle(`${kind}:${slug}`),
    [excludedLoadout],
  );

  const resetLoadoutForRole = useCallback(
    (targetRole: PerkRole) => {
      const roleKeys = new Set(
        getLoadoutPoolForRole(targetRole).map((p) => `${p.kind}:${p.slug}`),
      );
      excludedLoadout.removeWhere((key) => roleKeys.has(key));
    },
    [excludedLoadout],
  );

  const { hydrate: hydratePerks } = excludedPerks;
  const { hydrate: hydrateFavorites } = favorites;
  const { hydrate: hydrateLoadout } = excludedLoadout;
  const hydrate = useCallback(() => {
    hydratePerks();
    hydrateFavorites();
    hydrateLoadout();
  }, [hydratePerks, hydrateFavorites, hydrateLoadout]);

  const openPanel = useCallback((kind: ExcludePanelKind) => {
    setPanelKind(kind);
    setPanelOpen(true);
  }, []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  return {
    perkSlugs,
    favoriteSlugs,
    loadoutKeys,
    combinedPerks,
    combinedLoadout,
    availablePool,
    availableCount: availablePool.length,
    // The three simple verbs come straight off the persisted sets — see
    // lib/use-persisted-set.ts, which is what stopped each of these being a
    // hand-written "copy the Set, mutate it, write it to localStorage".
    togglePerk: excludedPerks.toggle,
    setManyPerks: excludedPerks.setMany,
    toggleFavorite: favorites.toggle,
    resetPerksForRole,
    toggleLoadoutPiece,
    setManyLoadout: excludedLoadout.setMany,
    resetLoadoutForRole,
    panelOpen,
    panelKind,
    openPanel,
    closePanel,
    hydrate,
  };
}
