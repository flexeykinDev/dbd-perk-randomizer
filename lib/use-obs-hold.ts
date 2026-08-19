"use client";

// Lets a streamer roll without the stream watching them do it.
//
// The overlay mirrors the site through an effect that fires on every
// change, which is right for "generate once and show it" and wrong for the
// thing people actually do: roll a few times until something looks fun.
// Every reject was going out live, so the reroll button and the overlay
// could not really be used together.
//
// Holding parks the overlay on whatever it last received. Rolls keep
// happening on the site, the count of unseen ones is shown, and one press
// of Reveal sends the current build.
import { useCallback, useEffect, useRef, useState } from "react";
import { safeGet, safeSet } from "./safe-storage";

const STORAGE_KEY = "dbd-randomizer:obs-hold";

export interface ObsHold {
  /** Whether the overlay is currently parked. */
  held: boolean;
  /** How many builds have been rolled since the overlay last got one.
   *  Shown so "nothing is happening on stream" is a number rather than a
   *  guess. */
  pending: number;
  setHeld: (held: boolean) => void;
  /** Publishes whatever is on screen now, and resets the counter. */
  reveal: () => void;
  /** Called by the publish effect whenever it runs. Returns true when the
   *  caller should actually publish.
   *
   *  @param buildKey Identifies the build being offered. The effect also
   *    re-runs for reasons that aren't a new roll — opening the OBS modal
   *    republishes so the overlay isn't left on "waiting for a build" —
   *    and counting those would make "rolls since then" a tally of
   *    unrelated events. */
  shouldPublish: (buildKey: string) => boolean;
}

export function useObsHold(publishCurrent: () => void): ObsHold {
  const [held, setHeldState] = useState(false);
  const [pending, setPending] = useState(0);

  // Kept in a ref as well so the publish effect can consult it without
  // listing it as a dependency — depending on `held` would make turning
  // the hold *off* republish through the effect, which is the right
  // outcome but by an accidental route; Reveal is the explicit one.
  const heldRef = useRef(false);
  /** The last build the counter has already accounted for, so a republish
   *  of the same build doesn't inflate it. */
  const countedKey = useRef<string | null>(null);

  // Named for the same reason as the other restores in lib/ — see
  // use-twitch-settings.ts.
  useEffect(() => {
    function restoreSavedHold() {
      const stored = safeGet("local", STORAGE_KEY) === "1";
      setHeldState(stored);
      heldRef.current = stored;
    }
    restoreSavedHold();
  }, []);

  const setHeld = useCallback(
    (next: boolean) => {
      setHeldState(next);
      heldRef.current = next;
      safeSet("local", STORAGE_KEY, next ? "1" : "0");
      // Letting go publishes immediately: the streamer has just said they
      // want the overlay live again, and leaving it on a stale build until
      // the next roll would look like the feature had broken.
      if (!next) {
        setPending(0);
        countedKey.current = null;
        publishCurrent();
      }
    },
    [publishCurrent],
  );

  const reveal = useCallback(() => {
    setPending(0);
    publishCurrent();
  }, [publishCurrent]);

  const shouldPublish = useCallback((buildKey: string) => {
    if (!heldRef.current) {
      countedKey.current = buildKey;
      return true;
    }
    if (countedKey.current !== buildKey) {
      countedKey.current = buildKey;
      setPending((n) => n + 1);
    }
    return false;
  }, []);

  return { held, pending, setHeld, reveal, shouldPublish };
}
