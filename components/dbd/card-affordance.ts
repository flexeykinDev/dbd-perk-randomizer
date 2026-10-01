import { cn } from "@/lib/cn";

/* The small circular controls in a build card's corner. Shared by the perk
   cards and the loadout pieces so "All" mode does not show two different
   answers to the same question.

   The dark plate is deliberate and doesn't follow the theme: these sit on
   top of the game's artwork, which is light line-art in both themes, so a
   themed plate would vanish on one of them.

   Split into base/idle so a control with its own always-visible state —
   the padlock on a pinned slot — can reuse the shape while supplying its
   own colours. */
export const CORNER_BUTTON_BASE =
  "flex size-6 pointer-coarse:size-10 items-center justify-center rounded-full backdrop-blur-sm transition-opacity disabled:pointer-events-none disabled:opacity-30";

/* `pointer-coarse` is doing real work here, not polish. These were
   `opacity-0` until hover, and a phone never hovers — so on touch the
   reroll and the padlock were invisible *and* 22px, which means
   single-slot reroll and pinning simply did not exist on mobile. Revealed
   and enlarged where there is no hover to reveal them.

   That clause is also what makes this safe for the loadout pieces. Their
   copy button was a hover-only icon once and was replaced with a labelled
   always-visible one precisely because touch could never reveal it; the
   icon only comes back now because this treatment answers that. */
export const CORNER_BUTTON_IDLE =
  "bg-black/40 text-white/80 opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 hover:bg-black/60 hover:text-white focus-visible:opacity-100";

export const CORNER_BUTTON = cn(CORNER_BUTTON_BASE, CORNER_BUTTON_IDLE);
