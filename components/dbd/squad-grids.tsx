"use client";

import { useT } from "@/lib/i18n";
import type { Squad } from "@/lib/squad-roll";
import type { Perk } from "@/lib/types";
import { PerkGrid } from "./perk-grid";

/* One PerkGrid per player, stacked.
 *
 * Deliberately the same grid the single build uses rather than a squad-shaped
 * variant of it: a perk card is a perk card, and the only thing that differs
 * here is that there are four of them and each has a name over it.
 *
 * No pins and no per-slot reroll, which is the same treatment a shared or
 * seeded build gets — those affordances roll one slot *around* the rest of a
 * build, and in a squad the rest of the build is three other people's. What a
 * single-player reroll should do to the no-duplicates promise is a real
 * question, and it is not this chunk's.
 */
export function SquadGrids({
  squad,
  players,
  language,
  onCopy,
}: {
  squad: Squad;
  /** How many columns to draw before the first roll has filled them. */
  players: number;
  language: "en" | "ru";
  onCopy: (perk: Perk) => void;
}) {
  const t = useT();
  // Before the first roll `squad` is empty, but the control already says how
  // many players there are — drawing that many empty slots is what makes the
  // mode legible without having to press anything.
  const builds: Perk[][] = squad.length > 0 ? squad : Array.from({ length: players }, () => []);

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4">
      {builds.map((build, i) => (
        <section key={i} className="flex w-full flex-col items-center gap-1.5">
          <h2 className="self-start text-meta font-semibold tracking-wide text-muted uppercase">
            {t({ ru: `Игрок ${i + 1}`, en: `Player ${i + 1}` })}
          </h2>
          <PerkGrid
            perks={build}
            language={language}
            emptyMessage={t({
              ru: "Нажмите «Сгенерировать новый билд»",
              en: "Press Generate for a new build",
            })}
            onCopy={onCopy}
          />
        </section>
      ))}
    </div>
  );
}
