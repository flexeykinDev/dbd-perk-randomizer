"use client";

import { useCallback, useState } from "react";
import { dailyChallengeSeed } from "./seeded-random";
import { recordDailyParticipation } from "./daily-count";
import type { PerkRole } from "./types";

/* Everything about "this build is pinned to a seed", lifted out of
 * RandomizerBoard.
 *
 * Three ways in — the Daily Challenge, a typed seed, and a seed carried by a
 * share link — and they used to be three clusters of setState scattered
 * across 900 lines of the board, each remembering for itself to also drop the
 * shared build. That "also drop the shared build" is the part that is easy to
 * forget and impossible to see: a seeded build outranks a shared one, so
 * missing it shows the wrong build with no error anywhere. It is now one
 * `onChange` call this hook makes on every path.
 *
 * The daily seed is derived from `role` on read rather than stored, so
 * switching role while the challenge is on cannot leave a stale copy behind.
 */

export type SeedMode = "none" | "daily" | "custom";

/** Which mode a seed arriving in a share link should restore.
 *
 *  A link to today's Daily Challenge is the daily mode, not a custom seed
 *  that happens to match — otherwise opening someone's challenge link shows
 *  the right build with the toggle reading "off", and the shared-participant
 *  count (which only means anything for the daily) never appears.
 *
 *  Split out of the hook so it can be tested without React; the date maths is
 *  the part worth pinning. */
export function seedModeForLink(seed: string, linkRole: PerkRole): "daily" | "custom" {
  return seed === dailyChallengeSeed(linkRole) ? "daily" : "custom";
}

export interface SeedController {
  mode: SeedMode;
  /** What is in the seed input box — not necessarily what is in force. */
  input: string;
  setInput: (value: string) => void;
  /** The seed actually deciding the build, or null when nothing is pinned. */
  active: string | null;
  /** Commit whatever is in the input box. No-ops on an empty one. */
  applyCustom: () => void;
  toggleDaily: () => void;
  clear: () => void;
  /** Drop the seed without the reroll `clear` does — for callers that are
   *  about to install a build of their own (a preset, a history entry). */
  release: () => void;
  /** Restore the seed from a share link, at mount. */
  hydrateFromUrl: (seed: string, linkRole: PerkRole) => void;
}

export function useSeed({
  role,
  onChange,
}: {
  role: PerkRole;
  /** Runs after every change that alters which build should be showing.
   *  `reroll` distinguishes "recompute from the new seed" from "there is no
   *  seed any more, so roll something fresh". */
  onChange: (opts: { reroll: boolean }) => void;
}): SeedController {
  const [mode, setMode] = useState<SeedMode>("none");
  const [input, setInput] = useState("");
  // Only the custom value is stored; see the note above about `daily`.
  const [customSeed, setCustomSeed] = useState<string | null>(null);

  const active = mode === "daily" ? dailyChallengeSeed(role) : mode === "custom" ? customSeed : null;

  const applyCustom = useCallback(() => {
    const value = input.trim();
    if (!value) return;
    setMode("custom");
    setCustomSeed(value);
    onChange({ reroll: false });
  }, [input, onChange]);

  const toggleDaily = useCallback(() => {
    if (mode === "daily") {
      setMode("none");
      setCustomSeed(null);
      setInput("");
      onChange({ reroll: true });
      return;
    }
    // Counted here rather than on page load: this is the moment someone
    // actually takes the challenge, which is what the number claims to
    // report. Deduplicated per browser per day inside the helper.
    recordDailyParticipation();
    setMode("daily");
    setInput("");
    onChange({ reroll: false });
  }, [mode, onChange]);

  const clear = useCallback(() => {
    setMode("none");
    setCustomSeed(null);
    setInput("");
    onChange({ reroll: true });
  }, [onChange]);

  const release = useCallback(() => setMode("none"), []);

  const hydrateFromUrl = useCallback((seed: string, linkRole: PerkRole) => {
    setInput(seed);
    if (seedModeForLink(seed, linkRole) === "daily") {
      setMode("daily");
      return;
    }
    setMode("custom");
    setCustomSeed(seed);
  }, []);

  return {
    mode,
    input,
    setInput,
    active,
    applyCustom,
    toggleDaily,
    clear,
    release,
    hydrateFromUrl,
  };
}
