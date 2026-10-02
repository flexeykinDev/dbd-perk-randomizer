"use client";

// Product events, and deliberately nowhere to send them yet.
//
// This is a seam, not an analytics integration, and the distinction is the
// whole point. The brief that asked for this offered "analytics events or
// clear hooks"; hooks are what this repo can honestly ship today, because
// three things in it are already promises about not being watched:
//
//   - Firebase is touched only after someone opens the OBS modal, so a visitor
//     who never streams never creates a room (see CLAUDE.md).
//   - The Daily Challenge streak is local by design (lib/use-daily-streak.ts).
//   - Roll history and pool stats never leave the browser.
//
// Wiring a provider in here would quietly retire all three, add a third-party
// origin to a static site that currently talks to nobody, and — for visitors
// in the EU, which the Russian-first UI suggests is most of them — put a
// consent banner on a page whose entire redesign was about removing things
// from in front of the build. That is a product decision with legal edges, and
// it belongs to the owner rather than to a refactor.
//
// So: every interesting moment calls `track`, the call sites are reviewed and
// correct, and the sink is a no-op. Turning this on later is one function body
// and no hunting.
//
// If you do wire something up, two rules this file already keeps:
//   1. Never pass anything that identifies a person. The payloads below are
//      enumerations — a role, a mode, a skin name — chosen so there is nothing
//      to leak. Do not add a build, a seed, a room code or a channel name;
//      a build is four perks out of 321 and is closer to a fingerprint than
//      it looks.
//   2. Never let it throw into a click handler. A blocked script, an ad
//      blocker or an offline tab must not stop a button working.

/** The events worth having an opinion about, and nothing else.
 *
 *  Each one exists to answer a question this redesign had to guess at:
 *  whether Full Loadout survived being moved behind a control (`mode_chosen`),
 *  whether anyone uses the canvas skins enough to justify 1100 lines of
 *  them (`skin_chosen`), whether Battle Royale earns its place
 *  (`battle_royale_toggled`), and whether the OBS flow actually ends in a
 *  pasted URL (`obs_link_copied`, `obs_overlay_opened`). */
export type TrackEvent =
  | { name: "role_chosen"; role: "survivor" | "killer" }
  | { name: "mode_chosen"; mode: "perks" | "loadout" | "all" }
  | { name: "skin_chosen"; skin: string }
  | { name: "battle_royale_toggled"; active: boolean }
  | { name: "obs_link_copied" }
  | { name: "obs_overlay_opened" }
  /** `source` separates a button press from the keyboard shortcut, because
   *  "is the Space shortcut worth documenting" is a real question and the
   *  count alone cannot answer it. */
  | { name: "build_generated"; source: "button" | "keyboard" | "chat" };

type Sink = (event: TrackEvent) => void;

/* Swapped rather than imported directly so a provider can be installed once,
   at the top of the app, without every call site learning about it. */
let sink: Sink | null = null;

/** Installs the thing that actually sends events. Called nowhere today. */
export function setTrackSink(next: Sink | null): void {
  sink = next;
}

export function track(event: TrackEvent): void {
  if (!sink) return;
  try {
    sink(event);
  } catch {
    /* An analytics failure is never a reason for a button not to work. */
  }
}
