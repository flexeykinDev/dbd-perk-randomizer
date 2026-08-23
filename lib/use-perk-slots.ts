"use client";

import { useCallback, useMemo, useState } from "react";
import { getPerkBySlug, getRandomPerks, getTeachablePerks } from "./perks";
import { playSound } from "./sound";
import type { Perk, PerkRole } from "./types";

/**
 * Layers the player's per-slot choices over a freshly rolled build.
 *
 * Two opposite gestures share one mechanism here. A pin says "never change
 * this"; a single-slot reroll says "change *only* this". Both are
 * slot-keyed rather than sets of slugs, because both are statements about
 * a position: a set would let a pinned perk drift to a different slot on
 * the next roll, which reads as the pin having failed.
 *
 * The property everything here exists to protect is that touching one slot
 * never moves another. That rules out the obvious implementation — drop
 * the fixed slots and deal the rest out in order — because removing a slot
 * from that sequence shunts every later slot along by one, so pinning slot
 * 1 would visibly reroll slots 2-4. Instead each slot takes the roll's
 * perk at its own index and fixed slots overwrite in place, which is
 * inherently position-stable.
 *
 * Lives outside the board component because it is the board's single
 * largest self-contained mechanism and none of it is presentational: it
 * takes a roll and some state, and returns the build to render.
 */
export function usePerkSlots({
  basePerks,
  perkCount,
  role,
  fixedBuild,
  guaranteeTeachables,
  selectedCharacter,
  combinedExcluded,
  favoriteSlugs,
}: {
  /** The raw roll. Deliberately does NOT depend on pins, which is what
   *  makes pinning a no-op on the other slots rather than a reroll. */
  basePerks: Perk[];
  perkCount: number;
  role: PerkRole;
  /** True for a shared or seeded build — fixed by definition, so neither
   *  pins nor rerolls apply and the roll is passed straight through. */
  fixedBuild: boolean;
  guaranteeTeachables: boolean;
  selectedCharacter: string | null;
  combinedExcluded: ReadonlySet<string>;
  favoriteSlugs: ReadonlySet<string>;
}) {
  // Which slot holds which pinned perk, as slot index -> slug. Slot-keyed
  // rather than a flat set of slugs because a pin means "this perk stays
  // *here*" — a set would let a pinned perk drift to a different position
  // on the next roll, which reads as the pin having failed.
  //
  // Deliberately not part of the share URL. A shared link describes a
  // finished build, and the recipient sees exactly those four perks either
  // way; pins only change what *their* next reroll does, which isn't
  // something the sender was expressing. Keeping them out also means every
  // link already in circulation keeps working untouched.
  const [pinnedPerkSlots, setPinnedPerkSlots] = useState<
    Record<number, string>
  >({});

  // Slots the player has rerolled individually, as slot index -> slug.
  // Separate from pins because they mean opposite things: a pin says "never
  // change this", a single-slot reroll says "change *only* this". Cleared by
  // a full regenerate, which supersedes them.
  const [slotOverrides, setSlotOverrides] = useState<Record<number, string>>(
    {},
  );

  /** A slot-keyed map is only usable here if the perk it names is still
   *  eligible. Pins and single-slot rerolls both survive in state across
   *  role, perk-count and pool changes so they come back when you switch
   *  away and return — they simply don't apply while they point outside the
   *  current build. `combinedExcluded` is the important one: Battle Royale
   *  retires perks as they're rolled and Manage Pool can remove one
   *  directly, and neither a pin nor a reroll may outrank that, or the
   *  build shows a perk the player just took out of it. */
  const resolveSlotMap = useCallback(
    (map: Record<number, string>) => {
      const out = new Map<number, Perk>();
      for (const [slot, slug] of Object.entries(map)) {
        const i = Number(slot);
        if (i >= perkCount) continue;
        const perk = getPerkBySlug(slug);
        if (!perk || perk.role !== role || combinedExcluded.has(perk.slug))
          continue;
        out.set(i, perk);
      }
      return out;
    },
    [perkCount, role, combinedExcluded],
  );

  /** The build actually shown: the roll from above, with pinned and
   *  individually-rerolled slots layered over it. Shared and seeded builds
   *  skip the whole thing — those are fixed by definition.
   *
   *  The one property everything here exists to protect is that touching
   *  one slot never moves another. That rules out the obvious
   *  implementation (drop the fixed slots, deal the rest out in order):
   *  removing a slot from that sequence shunts every later slot along by
   *  one, so pinning slot 1 would visibly reroll slots 2-4. Instead each
   *  slot takes the roll's perk *at its own index* and fixed slots
   *  overwrite in place, which is inherently position-stable. */
  const perks = useMemo(() => {
    if (fixedBuild || basePerks.length === 0) return basePerks;

    // basePerks is rolled with spares (see above), so the character's
    // teachables aren't necessarily inside the first perkCount of it —
    // getRandomPerksWithTeachables guarantees they're somewhere in what it
    // returns and then shuffles. Float them forward, keeping roll order
    // among the winners so the build still *displays* shuffled rather than
    // sorted, and leave the losers behind as the spare pool. Depends only
    // on the roll, never on pins or rerolls, so it can't shift anything.
    const character = guaranteeTeachables ? selectedCharacter : null;
    let ordered = basePerks;
    if (character) {
      const winners = new Set(
        [
          ...basePerks.filter((p) => p.character === character),
          ...basePerks.filter((p) => p.character !== character),
        ]
          .slice(0, perkCount)
          .map((p) => p.slug),
      );
      ordered = [
        ...basePerks.filter((p) => winners.has(p.slug)),
        ...basePerks.filter((p) => !winners.has(p.slug)),
      ];
    }

    const pins = resolveSlotMap(pinnedPerkSlots);
    const rerolled = resolveSlotMap(slotOverrides);

    const out: (Perk | undefined)[] = new Array(perkCount);
    const claimed = new Set<string>();
    for (let i = 0; i < perkCount; i++) {
      // A pin wins over a single-slot reroll on the same slot: they can only
      // coexist when you pin a slot you'd rerolled, and then they name the
      // same perk anyway.
      const fixed = pins.get(i) ?? rerolled.get(i);
      if (fixed) {
        out[i] = fixed;
        claimed.add(fixed.slug);
      }
    }

    let spare = perkCount;
    for (let i = 0; i < perkCount; i++) {
      if (out[i]) continue;
      // Normally just `ordered[i]`. The loop only advances into the spares
      // when a fixed slot has already claimed that perk, which can't happen
      // from pinning or rerolling alone (a pin names the perk already in
      // its slot, and rerollSlot draws from outside the roll entirely) —
      // only from the roll itself changing underneath a pin, e.g. when
      // Battle Royale shrinks the pool.
      let pick = ordered[i];
      while (pick && claimed.has(pick.slug)) pick = ordered[spare++];
      if (!pick) break;
      claimed.add(pick.slug);
      out[i] = pick;
    }
    return out.filter((p): p is Perk => !!p);
  }, [
    slotOverrides,
    basePerks,
    pinnedPerkSlots,
    perkCount,
    resolveSlotMap,
    fixedBuild,
    guaranteeTeachables,
    selectedCharacter,
  ]);

  /** Rerolls a single slot, leaving the other three exactly as they are.
   *
   *  The replacement is drawn from outside `basePerks` entirely, not merely
   *  outside the visible build. basePerks holds spares that the overlay
   *  above uses to fill the unpinned slots, so a replacement taken from
   *  that set would be removed from the fill pool and shunt every later
   *  slot along by one — a "reroll one slot" that visibly changes three. */
  const rerollSlot = useCallback(
    (slot: number) => {
      if (fixedBuild || slot >= perkCount) return;
      // A pinned slot is the one thing that outranks this. Rerolling it
      // would make the padlock a lie.
      if (pinnedPerkSlots[slot]) return;
      // After the guards, not before: pressing "3" on a pinned slot, or on a
      // slot that does not exist, must not click as though something rolled.
      playSound("deal");

      const blocked = new Set(combinedExcluded);
      for (const p of basePerks) blocked.add(p.slug);
      for (const p of perks) blocked.add(p.slug);
      for (const slug of Object.values(slotOverrides)) blocked.add(slug);

      // With "guarantee teachables" on, rerolling a slot that holds one of
      // the character's perks should hand back another of *their* perks —
      // otherwise the shortcut quietly erodes the guarantee one press at a
      // time. Falls through to the general pool once they're all in the
      // build already, which is the best the guarantee can do.
      const character = guaranteeTeachables ? selectedCharacter : null;
      let replacement: Perk | undefined;
      if (character && perks[slot]?.character === character) {
        const spare = getTeachablePerks(role, character).filter(
          (p) => !blocked.has(p.slug),
        );
        replacement = spare[Math.floor(Math.random() * spare.length)];
      }
      replacement ??= getRandomPerks(
        role,
        1,
        blocked,
        Math.random,
        favoriteSlugs,
      )[0];
      if (!replacement) return; // pool has nothing left to offer

      const slug = replacement.slug;
      setSlotOverrides((prev) => ({ ...prev, [slot]: slug }));
    },
    [
      fixedBuild,
      perkCount,
      pinnedPerkSlots,
      combinedExcluded,
      basePerks,
      perks,
      slotOverrides,
      guaranteeTeachables,
      selectedCharacter,
      role,
      favoriteSlugs,
    ],
  );

  const togglePin = useCallback((slot: number, slug: string) => {
    setPinnedPerkSlots((prev) => {
      const next = { ...prev };
      if (next[slot] === slug) {
        delete next[slot];
        // Unpinning must not change what's on screen. A pin masks whatever
        // the roll put in that slot, so simply dropping it would uncover a
        // different perk — turning "this may change from now on" into "this
        // changes right now". Handing the slot to the single-slot-reroll
        // map keeps the same perk visible until something actually rerolls
        // it, which is the promise the padlock made.
        setSlotOverrides((o) => ({ ...o, [slot]: slug }));
      } else {
        next[slot] = slug;
      }
      return next;
    });
  }, []);

  /** Drops the single-slot rerolls. A whole-build roll supersedes them —
   *  they were adjustments to the build being replaced. Pins are the
   *  opposite and deliberately survive. */
  const clearSlotOverrides = useCallback(() => setSlotOverrides({}), []);

  return { perks, pinnedPerkSlots, togglePin, rerollSlot, clearSlotOverrides };
}
