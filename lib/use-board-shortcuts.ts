"use client";

import { useEffect, useRef } from "react";
import type { BuildMode } from "./types";

/**
 * The page-level keyboard shortcuts.
 *
 * All of them mirror a button that is already on screen, so nothing here
 * can do something the mouse can't — the point is only that a streamer
 * mid-game shouldn't have to find a button.
 *
 * The two rules that matter are shared by every shortcut rather than
 * re-derived per key: don't fire while the player is typing or a modal is
 * open, and never swallow a real browser shortcut. That second one is why
 * Ctrl/Cmd/Alt combinations pass straight through — without it Ctrl+C
 * would stop copying the selection and start copying the build.
 */
export function useBoardShortcuts({
  mode,
  perkCount,
  activeSeed,
  poolExhausted,
  modalOpen,
  hasPerks,
  hasLoadout,
  regenerate,
  handleCopyAll,
  handleShare,
  rerollSlot,
}: {
  mode: BuildMode;
  perkCount: number;
  activeSeed: string | null;
  poolExhausted: boolean;
  /** True while any modal owns the keyboard. */
  modalOpen: boolean;
  hasPerks: boolean;
  hasLoadout: boolean;
  regenerate: () => void;
  handleCopyAll: () => void;
  handleShare: () => void;
  rerollSlot: (slot: number) => void;
}) {
  // Spacebar/Enter triggers Generate from anywhere on the page — except
  // while the user is typing (the seed input) or a modal is open, where
  // those keys already mean something else (confirm a dialog, type a
  // space, activate whatever's focused).
  // The copy/share shortcuts need the *current* handlers, but those close
  // over fresh state on every render, so depending on them directly would
  // tear down and re-add the keydown listener on every single render. A
  // ref refreshed after each render gives the listener the latest versions
  // while letting its own dependency list stay stable.
  const shortcutActions = useRef({ handleCopyAll, handleShare, rerollSlot });
  useEffect(() => {
    shortcutActions.current = { handleCopyAll, handleShare, rerollSlot };
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Shared guards first, so every shortcut below is subject to the
      // same "not typing, no modal open, nothing already focused" rules
      // rather than each one re-deriving them.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typingOrInteractive =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        tag === "A" ||
        target?.isContentEditable;
      // Never swallow a real browser shortcut — Ctrl/Cmd+C in particular
      // has to keep copying whatever the user actually selected.
      const modified = e.ctrlKey || e.metaKey || e.altKey;

      // Streamer shortcuts for the actions already sitting under the
      // build. These mirror the buttons exactly rather than adding new
      // behaviour, so there's nothing here that can't also be clicked.
      if (!typingOrInteractive && !modalOpen && !modified) {
        const hasBuild =
          mode === "loadout"
            ? hasLoadout
            : mode === "all"
              ? hasPerks || hasLoadout
              : hasPerks;
        if (hasBuild) {
          if (
            e.key === "c" ||
            e.key === "C" ||
            e.key === "с" ||
            e.key === "С"
          ) {
            e.preventDefault();
            shortcutActions.current.handleCopyAll();
            return;
          }
          if (
            e.key === "s" ||
            e.key === "S" ||
            e.key === "ы" ||
            e.key === "Ы"
          ) {
            e.preventDefault();
            shortcutActions.current.handleShare();
            return;
          }
          // 1-4 reroll that one perk slot. e.code rather than e.key so the
          // digits work on a Cyrillic layout too (where the number row is
          // unchanged, but so is e.key — this is really about the numpad,
          // which reports Numpad1 while e.key is layout-dependent) and so
          // Shift+1 doesn't arrive as "!". Only in modes that show perks;
          // in loadout-only mode there is no slot 1 to reroll.
          if (mode !== "loadout") {
            const digit =
              /^(?:Digit|Numpad)([1-4])$/.exec(e.code)?.[1] ??
              (/^[1-4]$/.test(e.key) ? e.key : null);
            if (digit) {
              e.preventDefault();
              shortcutActions.current.rerollSlot(Number(digit) - 1);
              return;
            }
          }
        }
      }

      if (e.key !== " " && e.key !== "Enter") return;
      if (!!activeSeed) return;
      // Only a pure Perks roll needs a non-empty pool to mean anything —
      // matches the main Generate button's own disabled condition below,
      // so Loadout/All mode can still reroll via keyboard even if the
      // perk pool alone happens to be unrollable right now.
      if (mode === "perks" && (perkCount === 0 || poolExhausted)) return;
      // Same guards computed once at the top of this handler — a modal is
      // open, the user is typing, or focus is already on something that
      // treats Space/Enter as "activate me".
      if (modalOpen || typingOrInteractive) return;

      e.preventDefault();
      regenerate();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    mode,
    perkCount,
    activeSeed,
    poolExhausted,
    modalOpen,
    regenerate,
    hasPerks,
    hasLoadout,
  ]);
}
