"use client";

// How a rolled build is REVEALED. Not what gets rolled.
//
// Every presentation is fed the same `perks` the board already produced, so
// pinning, Battle Royale attrition, themes, seeds, guaranteed teachables and
// the pool manager keep working identically in all three. A presentation that
// rolled its own perks would be a second source of truth, and would sooner or
// later disagree with the build the rest of the page is showing.
import { useCallback, useEffect, useState } from "react";
import { safeGet, safeSet } from "./safe-storage";

const STORAGE_KEY = "dbd-randomizer:presentation";

export const PRESENTATIONS = ["classic", "ritual", "casino"] as const;
export type Presentation = (typeof PRESENTATIONS)[number];

export const PRESENTATION_LABEL: Record<Presentation, { ru: string; en: string }> = {
  classic: { ru: "Обычный", en: "Classic" },
  ritual: { ru: "Ритуал", en: "Ritual" },
  casino: { ru: "Слоты", en: "Slots" },
};

export const PRESENTATION_HINT: Record<Presentation, { ru: string; en: string }> = {
  classic: { ru: "Карточки как сейчас", en: "Cards, as now" },
  ritual: { ru: "Вихрь Сущности — только ПК", en: "The Entity's vortex — PC only" },
  casino: { ru: "Барабаны автомата — только ПК", en: "Slot reels — PC only" },
};

/* Both of these draw to a canvas sized for a wide screen, and neither
 * survives a phone.
 *
 * Casino was added after this gate was written and never added to it, so it
 * was offered on phones and rendered there: measured at 430px, the stage came
 * out 382x167 with four reels about 85px wide — roughly 28px per symbol —
 * and every copy/pin/reroll control overflowed the stage by 14px and was
 * clipped. Ritual was excluded from the start for the same reason.
 *
 * A set rather than another `p !== …` so the next presentation has to make a
 * decision here instead of inheriting "works everywhere" by omission. */
const DESKTOP_ONLY: ReadonlySet<Presentation> = new Set<Presentation>(["ritual", "casino"]);

/** Anything already saved still resolves — a desktop choice must not silently
 *  become Classic on the owner's phone and then get written back. */
export function isAvailable(p: Presentation, isDesktop: boolean): boolean {
  return !DESKTOP_ONLY.has(p) || isDesktop;
}

function parse(raw: string | null): Presentation | null {
  return raw && (PRESENTATIONS as readonly string[]).includes(raw)
    ? (raw as Presentation)
    : null;
}

export function usePresentation(): [Presentation, (p: Presentation) => void] {
  // Always starts "classic" so the server render and the first client render
  // agree; the saved value arrives on mount.
  const [presentation, setPresentationState] = useState<Presentation>("classic");

  // Named for the same reason as the other restores in lib/ — see
  // use-obs-hold.ts.
  useEffect(() => {
    function restoreSavedPresentation() {
      const saved = parse(safeGet("local", STORAGE_KEY));
      if (saved) setPresentationState(saved);
    }
    restoreSavedPresentation();
  }, []);

  const setPresentation = useCallback((p: Presentation) => {
    setPresentationState(p);
    safeSet("local", STORAGE_KEY, p);
  }, []);

  return [presentation, setPresentation];
}
