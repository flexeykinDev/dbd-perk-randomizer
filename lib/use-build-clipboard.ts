"use client";

// Copying something and saying so.
//
// The board had five of these — one perk, all perks, one loadout piece,
// all loadout pieces, everything at once — and they were the same eleven
// lines each time: write to the clipboard, toast on success, toast the
// same failure message on error, and eliminate the build if Battle Royale
// is on. Only the text and the success wording actually differed.
import { useCallback, useRef, useState } from "react";
import { useT } from "./i18n";

const TOAST_MS = 2500;

export function useBuildClipboard({
  /** Battle Royale treats copying as "I'm using this build", which retires
   *  it from the pool. Passed in rather than known here, because what
   *  counts as using a build is the board's rule, not the clipboard's. */
  onUsed,
}: {
  onUsed?: () => void;
} = {}) {
  const t = useT();
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    // Without clearing, two copies in quick succession leave the first
    // timer to dismiss the second message early.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const copy = useCallback(
    (text: string, success: { ru: string; en: string }) => {
      navigator.clipboard
        .writeText(text)
        .then(() => showToast(t(success)))
        .catch(() => showToast(t({ ru: "Не удалось скопировать", en: "Couldn't copy" })))
        // Deliberately outside the promise: the build has been used the
        // moment someone asks for it, and a clipboard permission refusal
        // shouldn't leave Battle Royale in a state where the same build
        // can be copied forever.
        .finally(() => onUsed?.());
    },
    [onUsed, showToast, t],
  );

  return { toast, showToast, copy };
}
