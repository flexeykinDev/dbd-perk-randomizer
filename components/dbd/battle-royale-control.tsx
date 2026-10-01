"use client";

import { ToggleSwitch } from "./toggle-switch";
import { useT } from "@/lib/i18n";

/**
 * Battle Royale, next to the controls that decide what gets rolled.
 *
 * It used to be a bare switch at the very bottom of the page, below the
 * keyboard legend, with nothing around it — while the Theme filter, which
 * only narrows one roll, sat in prime space beside the perk count. Battle
 * Royale is a whole game mode: it keeps a session-scoped set of everything
 * spent, across both roles, and every roll draws from what is left.
 *
 * So it sits with the mode controls, it says what it does without being
 * opened, and while a run is going it shows how much pool is left.
 *
 * The count is the one thing here that can be wrong in a quiet way. The
 * eliminated set spans BOTH roles on purpose — switching side mid-run must
 * not hand back perks you already spent — so a raw count would disagree
 * with the role-filtered pool size shown beside it. `remaining` is passed
 * in already role-filtered for exactly that reason; see the note in
 * lib/use-battle-royale.ts.
 */
export function BattleRoyaleControl({
  active,
  onToggle,
  remaining,
}: {
  active: boolean;
  onToggle: () => void;
  /** Perks left for the CURRENT role. Already filtered by the caller. */
  remaining: number;
}) {
  const t = useT();

  return (
    /* A segment of the control panel, not a row of its own.
    
       It was a block first, and e2e/viewports.spec.ts caught what that cost:
       the first perk card went from y=345 to y=416 on a laptop and 589 to 664
       on a phone — 71px of the page spent on a mode most visitors never turn
       on, undoing most of what moving the setup controls behind a disclosure
       bought. Inside the panel it costs the panel's own height and nothing
       else. */
    <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 px-4 py-1.5 sm:py-2">
      <div className="flex items-center gap-2">
        <ToggleSwitch
          checked={active}
          onChange={onToggle}
          label={t({ ru: "Battle Royale", en: "Battle Royale" })}
          activeClassName="bg-accent"
          tooltip={t({
            ru: "Копирование билда навсегда убирает эти перки из пула — играйте, пока не закончатся все перки роли.",
            en: "Copying a build permanently removes those perks from the pool — play until every perk for this role is gone.",
          })}
        />
        {active && (
          <span className="text-meta font-semibold tabular-nums text-foreground">
            {t({ ru: "Осталось:", en: "Left:" })} {remaining}
          </span>
        )}
      </div>
      {/* What it does, without having to turn it on to find out. Hint size
          and muted: read once, then it stops competing with the control
          above it. */}
      <span className="text-hint text-muted">
        {t({
          ru: "Использованные перки выбывают, пока пул не кончится",
          en: "Used perks are retired until the pool runs out",
        })}
      </span>
    </div>
  );
}
