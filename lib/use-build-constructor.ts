"use client";

// A sandbox for assembling a !paste command from scratch — independent of
// whatever build happens to be showing on the main site, e.g. to prepare an
// announcement build ahead of time.
//
// Lives outside the modal because it shares nothing with the overlay's
// appearance settings beyond happening to be in the same dialog: its own
// role, its own search, its own 4-slot selection.
import { useMemo, useState } from "react";
import { getIdForSlug } from "./perk-ids";
import { getPerksByRole } from "./perks";
import type { Perk, PerkRole } from "./types";

const MAX_SLOTS = 4;

/** The command a chat bot would accept for these perks, or null when
 *  nothing is selected. Shared with the "build on screen right now"
 *  shortcut in the Twitch tab, which is the same transformation applied to
 *  a different list of perks. */
export function pasteCommandFor(perks: Perk[], pasteCommand: string): string | null {
  const ids = perks
    .map((p) => getIdForSlug(p.slug))
    .filter((id): id is number => id !== undefined);
  if (ids.length === 0) return null;
  return `${pasteCommand.trim() || "!paste"} ${ids.join(",")}`;
}

export function useBuildConstructor(initialRole: PerkRole, pasteCommand: string) {
  const [role, setRole] = useState<PerkRole>(initialRole);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Perk[]>([]);

  const available = useMemo(() => getPerksByRole(role), [role]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return available;
    return available.filter((perk) =>
      `${perk.name.en} ${perk.name.ru}`.toLowerCase().includes(query),
    );
  }, [available, search]);

  return {
    role,
    search,
    selected,
    filtered,
    maxSlots: MAX_SLOTS,
    isFull: selected.length >= MAX_SLOTS,
    isSelected: (perk: Perk) => selected.some((p) => p.slug === perk.slug),
    command: pasteCommandFor(selected, pasteCommand),

    setSearch,
    clear: () => setSelected([]),
    /** Switching role clears the selection — a build can't mix survivor and
     *  killer perks, so keeping them would produce a command nobody can
     *  actually paste. */
    setRole(next: PerkRole) {
      setRole(next);
      setSelected([]);
    },
    toggle(perk: Perk) {
      setSelected((prev) => {
        if (prev.some((p) => p.slug === perk.slug)) {
          return prev.filter((p) => p.slug !== perk.slug);
        }
        return prev.length >= MAX_SLOTS ? prev : [...prev, perk];
      });
    },
  };
}

export type BuildConstructor = ReturnType<typeof useBuildConstructor>;
