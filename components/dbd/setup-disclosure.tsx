"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

/**
 * The one disclosure holding everything that is setup rather than rolling.
 *
 * Five rows of controls used to sit between the heading and the build, all
 * in the same pill treatment at the same weight, so nothing read as more
 * important than anything else. Role is the only one left outside, because it
 * is the only thing the defaults cannot guess for you: everything else — mode,
 * how many perks, loadout slots, character, theme, coherence, pools, the
 * overlay and the More menu — is in here.
 *
 * The trigger names what is inside rather than saying "Settings". A disclosure
 * whose label does not say what it hides is how the character picker would
 * have become undiscoverable.
 *
 * Mode was briefly in here and is listed no longer: it went back onto the
 * board, because Full Loadout is not a setting on the thing you came for, it
 * is a different thing to come for — see mode-select.tsx. A label that still
 * promised it would be pointing at the wrong place.
 *
 * Not `<details>`: the content has to animate, and the open state is owned
 * by useSetupDisclosure so it can persist. A button with aria-expanded and
 * aria-controls is the same thing to a screen reader.
 */
export function SetupDisclosure({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const t = useT();

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="setup-panel"
        className="tap flex items-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-control font-medium text-muted transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground"
      >
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
        {t({
          ru: "Сколько перков, персонаж, пулы, оверлей",
          en: "Perk count, character, pools, overlay",
        })}
      </button>

      {/* Unmounted when closed, not hidden: these rows carry live controls
          and a tab stop inside a collapsed panel is a focus trap nobody can
          see. */}
      {open && (
        <div
          id="setup-panel"
          className="flex w-full flex-col items-center gap-2 sm:gap-3"
        >
          {children}
        </div>
      )}
    </div>
  );
}
