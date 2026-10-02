/* How a card arrives.
 *
 * Three answers, and they are deliberately the only three, because they are
 * the only ones that differ in kind rather than in degree: nothing, one after
 * another, all at once. A fourth would be a number tweaked on one of these,
 * which is a skin list with a liar in it.
 *
 * Classic was already a stagger when this was written — a spring with a 75ms
 * step — so "cards slide in one by one" was not a skin that could be added,
 * it was the default. What was genuinely missing sat on either side of it:
 * no motion at all, and all four landing together.
 *
 * None of these needs an animation lifecycle of its own. framer-motion
 * interrupts a running transition and re-targets it from wherever the value
 * currently is, so a second Generate mid-entrance is handled by the library
 * rather than by us — which is the whole reason these are DOM cards and the
 * other two skins are 400 lines of canvas each.
 *
 * Reduced motion is handled above all of this by MotionConfig reducedMotion
 * ="user" in app/randomizer-content.tsx: framer-motion drops the transforms
 * and keeps the opacity, for every variant here, without any of them asking.
 */
export type CardEntrance = "classic" | "minimal" | "impact";

export function entranceFor(entrance: CardEntrance, index: number) {
  if (entrance === "minimal") {
    /* Not "a very fast animation" — none. A 120ms fade is still a thing you
       wait for four times a roll, and someone choosing this chose it to stop
       waiting. Opacity 1 with a zero duration keeps the same prop shape so the
       card does not need a second code path. */
    return {
      initial: { opacity: 1, scale: 1, y: 0, rotate: 0 },
      animate: { opacity: 1, scale: 1, y: 0, rotate: 0 },
      exit: { opacity: 0, transition: { duration: 0 } },
      transition: { duration: 0 },
    } as const;
  }
  if (entrance === "impact") {
    /* All four land together, hard and short. The stagger is what makes
       Classic read as dealing; removing it and keeping a stiffer spring makes
       the build read as arriving in one piece, which is the other honest way
       to show four things appearing at the same instant. ~180ms end to end. */
    return {
      initial: { opacity: 0, scale: 1.14, y: 0, rotate: 0 },
      animate: { opacity: 1, scale: 1, y: 0, rotate: 0 },
      exit: { opacity: 0, scale: 0.94, transition: { duration: 0.1 } },
      transition: { type: "spring", stiffness: 900, damping: 34, mass: 0.6 },
    } as const;
  }
  /* The same reveal the loadout row uses: a spring so each card lands rather
     than fades in, a small rotation so it reads as being set down, and a
     stagger left to right. The two halves of a build should not animate
     differently. */
  return {
    initial: { opacity: 0, scale: 0.62, y: -14, rotate: -7 },
    animate: { opacity: 1, scale: 1, y: 0, rotate: 0 },
    exit: { opacity: 0, scale: 0.86, y: 8, transition: { duration: 0.14 } },
    transition: {
      type: "spring",
      stiffness: 430,
      damping: 27,
      mass: 0.7,
      delay: index * 0.075,
    },
  } as const;
}
