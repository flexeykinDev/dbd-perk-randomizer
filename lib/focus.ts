"use client";

/**
 * Whether the currently focused element was reached by keyboard rather than
 * by a click.
 *
 * This is the whole difference between two things that look identical in the
 * DOM: a card someone TABBED to, where Space must open it, and a card someone
 * CLICKED, where focus is only a leftover and Space should still reroll the
 * build. Without the distinction, clicking anything quietly disables the
 * reroll key — copy a build, alt-tab to the game, come back, press Space, and
 * a perk description opens instead of a new roll.
 *
 * `:focus-visible` looks like the answer and is not: the browser promotes an
 * element to focus-visible as soon as a key is pressed on it, and it does so
 * BEFORE dispatching that keydown. Measured on the real page, the Copy button
 * reported `matches(":focus-visible") === false` right after the click and
 * `true` inside the very keydown that needed to know — so a check made from a
 * key handler always sees "keyboard", which is the one answer it cannot use.
 *
 * So the last focus-changing input is tracked directly. Only keys that MOVE
 * focus count as keyboard navigation; Escape and Space do not, which is what
 * keeps "click a card, close it with Escape, press Space" a reroll.
 */
let cameFromKeyboard = false;

const NAVIGATION_KEYS = new Set([
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

if (typeof window !== "undefined") {
  // Capture phase, so this settles before any component's own handler runs.
  window.addEventListener(
    "pointerdown",
    () => {
      cameFromKeyboard = false;
    },
    true,
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (NAVIGATION_KEYS.has(e.key)) cameFromKeyboard = true;
    },
    true,
  );
}

export function isKeyboardFocused(el: Element | null | undefined): boolean {
  if (!el) return false;
  if (typeof document === "undefined") return false;
  if (document.activeElement !== el) return false;
  return cameFromKeyboard;
}
