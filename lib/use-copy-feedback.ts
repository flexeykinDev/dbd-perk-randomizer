"use client";

// "Copy this, show a checkmark for 2 seconds, and tell a screen reader it
// worked" — written out three times in the OBS modal, once per copyable
// thing (the overlay link, the ready-made !paste command, the constructor's
// command), each with its own boolean.
//
// One key replaces the three booleans. Only one checkmark can be showing at
// a time anyway: they're three separate buttons and a person clicks one.
import { useRef, useState } from "react";

const FEEDBACK_MS = 2000;

export function useCopyFeedback() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // A single shared live region announces whichever copy just succeeded, so
  // screen reader users get the same "it worked" that sighted users get
  // from the checkmark — without one aria-live region per button.
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return {
    announcement,
    /** True while this specific button should show its checkmark. */
    isCopied: (key: string) => copiedKey === key,
    copy(key: string, text: string, announce: string) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopiedKey(key);
          setAnnouncement(announce);
          // Clicking a second button before the first has reset would
          // otherwise let the older timer clear the newer checkmark.
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopiedKey(null), FEEDBACK_MS);
        })
        .catch(() => {});
    },
  };
}

export type CopyFeedback = ReturnType<typeof useCopyFeedback>;
