"use client";

import { useEffect, useState } from "react";

/* Stream mode: the overlay's own setup, on a page instead of in a dialog.
 *
 * Same trick as #/obs and #/embed — a hash the static export never has to
 * route, checked on the client. There is no server here to add a route to.
 *
 * It exists because the OBS configuration is not a dialog-shaped job.
 * Counted on the real modal: three tabs and thirty-one controls, in a card
 * that has to fit a phone. Nobody sets that up in passing; they set it up
 * once, on a desktop, with OBS open beside them. The board is unchanged and
 * the dialog still works — this is a roomier way in, not a replacement.
 */

const STREAM_HASH = "#/stream";

export function useIsStreamMode(): boolean {
  const [isStream, setIsStream] = useState(false);

  useEffect(() => {
    function check() {
      // `?stream=1` alongside the hash, for the same reason the overlay and
      // the embed carry one: a hash is the first thing a chat client or a
      // link shortener drops.
      const isQuery = new URLSearchParams(window.location.search).get("stream") === "1";
      setIsStream(window.location.hash === STREAM_HASH || isQuery);
    }
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  return isStream;
}

/** Leaves stream mode without a reload, so the board keeps its session. */
export function leaveStreamMode(): void {
  const url = new URL(window.location.href);
  url.hash = "";
  url.searchParams.delete("stream");
  window.history.replaceState(null, "", url.toString());
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
