"use client";

import { useCallback, useMemo, useState } from "react";
import { getRandomPerksWithTeachables, getSeededPerks } from "./perks";
import { flattenLoadout, getRandomLoadout, getSeededLoadout } from "./loadout";
import { usePerkSlots } from "./use-perk-slots";
import type { BuildMode, Loadout, LoadoutPiece, LoadoutSlots, Perk, PerkRole } from "./types";

/* What build is on screen, and why.
 *
 * Three things can put a build there, in priority order: a seed (deterministic
 * for everyone), a build handed to us whole (a share link, a preset, a history
 * entry, a Twitch !paste), or a fresh roll. Whichever it is, pins and
 * single-slot rerolls layer on top — see lib/use-perk-slots.ts, which was
 * already extracted.
 *
 * The reason this is a hook rather than a dozen useStates on the board is the
 * verbs at the bottom. "Drop whatever is showing and roll again" is three
 * statements — clear the shared perks, clear the shared loadout, bump the
 * nonce — and it was spelled out by hand at NINE call sites, each of which had
 * to remember all three. Several deliberately did only part of it, which is
 * real behaviour that was impossible to see: changing the perk count keeps a
 * shared loadout, and toggling a loadout slot keeps a shared build. Those are
 * now named rather than inferred from which lines a function happens to have.
 */

/** The nonce exists only to force a reshuffle; nothing reads its value. */
type Nonce = number;

export interface RollSession {
  /** The build to render, pins applied. */
  perks: Perk[];
  loadout: Loadout | null;
  loadoutPieces: LoadoutPiece[];

  pinnedPerkSlots: Record<number, string>;
  togglePin: (slot: number, slug: string) => void;
  rerollSlot: (slot: number) => void;

  /** Set when the build was handed to us rather than rolled. Suppresses pins
   *  and per-slot rerolls: there is nothing to roll around in a build
   *  somebody else chose. */
  sharedBuild: Perk[] | null;
  sharedLoadoutPieces: LoadoutPiece[] | null;
  /** Distinguishes "this roll" from the last one, for history and stats. */
  nonce: Nonce;

  /** Drop everything showing and roll both halves fresh. Deliberately does
   *  NOT touch pins: usePerkSlots keeps them across role, count and pool
   *  changes on purpose, so they come back when you switch away and return.
   *  Nothing clears a pin except unpinning it. */
  rerollAll: () => void;
  /** Roll the perks again, leaving a shared loadout alone. */
  rerollPerks: () => void;
  /** Roll the loadout again, leaving a shared build alone. */
  rerollLoadout: () => void;
  /** Stop showing a handed-over build without rolling — for a caller about to
   *  install one of its own. */
  releaseShared: () => void;

  /** Show a build handed over whole. Each clears the other half, because a
   *  share link or a history entry describes one side or the other. */
  showPerks: (perks: Perk[]) => void;
  showLoadoutPieces: (pieces: LoadoutPiece[]) => void;
  /** Replace the perks and leave a shared loadout alone. Twitch !paste and
   *  the preset picker both hand over perks only, and neither has ever
   *  disturbed a loadout that was already showing. Separate verb rather than
   *  a flag, so the difference from showPerks is visible at the call site. */
  showPerksKeepingLoadout: (perks: Perk[]) => void;

  /** Restores a build carried by a share link, at mount.
   *
   *  Sets each half independently and clears neither — an "all" mode link
   *  carries `p=` and `lp=` TOGETHER and needs both applied. Using showPerks
   *  and showLoadoutPieces here instead makes them clear each other, so the
   *  link restores one half and silently re-rolls the other; that is a real
   *  regression this had, caught by the all-mode share-link test. */
  restoreShared: (next: { perks?: Perk[]; loadoutPieces?: LoadoutPiece[] }) => void;

  /** Drops the single-slot rerolls — NOT the pins, which survive everything
   *  except being unpinned. A whole-build roll supersedes a per-slot reroll
   *  because it was an adjustment to the build being replaced; a pin is a
   *  standing instruction about a slot. Only Generate calls this. */
  clearSlotOverrides: () => void;
}

export function useRollSession({
  mounted,
  mode,
  role,
  perkCount,
  loadoutSlots,
  activeSeed,
  poolExhausted,
  availableCount,
  excludedPerks,
  excludedLoadout,
  favoriteSlugs,
  guaranteeTeachables,
  selectedCharacter,
  maxPerkCount,
}: {
  mounted: boolean;
  mode: BuildMode;
  role: PerkRole;
  perkCount: number;
  loadoutSlots: LoadoutSlots;
  activeSeed: string | null;
  poolExhausted: boolean;
  availableCount: number;
  excludedPerks: ReadonlySet<string>;
  excludedLoadout: ReadonlySet<string>;
  favoriteSlugs: ReadonlySet<string>;
  guaranteeTeachables: boolean;
  selectedCharacter: string | null;
  /** How much slack to roll beyond perkCount; see basePerks below. */
  maxPerkCount: number;
}): RollSession {
  const [nonce, setNonce] = useState<Nonce>(0);
  const [sharedBuild, setSharedBuild] = useState<Perk[] | null>(null);
  const [sharedLoadoutPieces, setSharedLoadoutPieces] = useState<LoadoutPiece[] | null>(null);

  /* The raw roll, deliberately split from the `perks` everything else reads:
     pinning must not itself cause a reroll, and this memo rerolls whenever any
     of its dependencies changes. Keeping pins out of its dependency list is
     what makes "pin a perk" a no-op on the other three slots. */
  const basePerks = useMemo(() => {
    void nonce; // intentional cache-buster: forces a reshuffle on a reroll
    /* Gated on mode so every effect keyed off `perks` (stats, URL sync, the
       "perks" half of the OBS payload) naturally goes idle in loadout-only
       mode instead of needing its own mode check duplicated everywhere —
       computed for both "perks" and "all" (which shows both at once). */
    if (!mounted || mode === "loadout") return [];
    if (sharedBuild) return sharedBuild;
    if (perkCount === 0) return [];
    if (activeSeed) return getSeededPerks(role, perkCount, activeSeed);
    if (poolExhausted) return [];
    const character = guaranteeTeachables ? selectedCharacter : null;
    /* Rolls a few spares beyond perkCount. usePerkSlots drops any rolled perk
       that a pin already placed in the build, and without slack that would
       leave a slot empty whenever the roll happens to land on a pinned perk.
       Capped by what the pool can supply, so this can never ask for more than
       exists. */
    const withSlack = Math.min(perkCount + maxPerkCount, availableCount);
    return getRandomPerksWithTeachables(
      role,
      withSlack,
      character,
      excludedPerks,
      Math.random,
      favoriteSlugs,
    );
  }, [
    availableCount,
    mounted,
    mode,
    role,
    nonce,
    sharedBuild,
    excludedPerks,
    perkCount,
    poolExhausted,
    activeSeed,
    favoriteSlugs,
    guaranteeTeachables,
    selectedCharacter,
    maxPerkCount,
  ]);

  const { perks, pinnedPerkSlots, togglePin, rerollSlot, clearSlotOverrides } = usePerkSlots({
    basePerks,
    perkCount,
    role,
    fixedBuild: !!sharedBuild || !!activeSeed,
    guaranteeTeachables,
    selectedCharacter,
    combinedExcluded: excludedPerks,
    favoriteSlugs,
  });

  const loadout = useMemo((): Loadout | null => {
    void nonce;
    if (!mounted || mode === "perks" || sharedLoadoutPieces) return null;
    if (activeSeed) return getSeededLoadout(role, loadoutSlots, activeSeed);
    return getRandomLoadout(role, loadoutSlots, excludedLoadout, Math.random, selectedCharacter);
  }, [
    mounted,
    mode,
    sharedLoadoutPieces,
    role,
    nonce,
    activeSeed,
    loadoutSlots,
    excludedLoadout,
    selectedCharacter,
  ]);

  // Flattened into the same "just some pieces" shape LoadoutGrid renders,
  // same reasoning as why flattenLoadout exists (see lib/loadout.ts).
  const loadoutPieces = useMemo((): LoadoutPiece[] => {
    if (mode === "perks") return [];
    if (sharedLoadoutPieces) return sharedLoadoutPieces;
    if (!loadout) return [];
    return flattenLoadout(loadout);
  }, [mode, sharedLoadoutPieces, loadout]);

  const bump = useCallback(() => setNonce((n) => n + 1), []);

  const rerollAll = useCallback(() => {
    setSharedBuild(null);
    setSharedLoadoutPieces(null);
    bump();
  }, [bump]);

  const rerollPerks = useCallback(() => {
    setSharedBuild(null);
    bump();
  }, [bump]);

  const rerollLoadout = useCallback(() => {
    setSharedLoadoutPieces(null);
    bump();
  }, [bump]);

  const releaseShared = useCallback(() => {
    setSharedBuild(null);
    setSharedLoadoutPieces(null);
  }, []);

  const showPerks = useCallback((next: Perk[]) => {
    setSharedLoadoutPieces(null);
    setSharedBuild(next);
  }, []);

  const showPerksKeepingLoadout = useCallback((next: Perk[]) => setSharedBuild(next), []);

  const restoreShared = useCallback(
    (next: { perks?: Perk[]; loadoutPieces?: LoadoutPiece[] }) => {
      if (next.perks) setSharedBuild(next.perks);
      if (next.loadoutPieces) setSharedLoadoutPieces(next.loadoutPieces);
    },
    [],
  );

  const showLoadoutPieces = useCallback((next: LoadoutPiece[]) => {
    setSharedBuild(null);
    setSharedLoadoutPieces(next);
  }, []);

  return {
    perks,
    loadout,
    loadoutPieces,
    pinnedPerkSlots,
    togglePin,
    rerollSlot,
    sharedBuild,
    sharedLoadoutPieces,
    nonce,
    rerollAll,
    rerollPerks,
    rerollLoadout,
    releaseShared,
    showPerks,
    showLoadoutPieces,
    showPerksKeepingLoadout,
    restoreShared,
    clearSlotOverrides,
  };
}
