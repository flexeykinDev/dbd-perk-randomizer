import type { ObsEntrance } from "./use-obs-mode";

/* How a build arrives on stream.
 *
 * The overlay has exactly one moment of motion — a new build appearing — and
 * on a stream that moment is the whole notification: nobody is looking at the
 * overlay when it happens, they look because it moved. So these are pitched
 * to be noticed in peripheral vision and then get out of the way, which means
 * short, and staggered so four cards read as a sequence rather than a flash.
 *
 * `none` is a first-class option rather than an oversight. A busy scene with
 * a fixed camera is a real reason to want nothing moving at all, and a
 * streamer who wants that should not have to accept a fade.
 *
 * Kept out of the component so the overlay stays a renderer and these can be
 * read, compared and changed as data.
 */

export interface EntranceMotion {
  initial: Record<string, number>;
  animate: Record<string, number>;
  exit: Record<string, number>;
  transition: Record<string, unknown>;
}

const STAGGER = 0.06;

export function entranceMotion(entrance: ObsEntrance, index: number): EntranceMotion {
  const delay = index * STAGGER;

  switch (entrance) {
    // Nothing moves. Opacity still crossfades, because an instant swap of one
    // build for another mid-scene reads as a glitch rather than as a change.
    case "none":
      return {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.18, delay: 0 },
      };

    // Falls in from above and settles. The spring overshoot is what makes it
    // land rather than stop.
    case "drop":
      return {
        initial: { opacity: 0, y: -34, scale: 0.9 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 18, scale: 0.9 },
        transition: { type: "spring", stiffness: 420, damping: 24, mass: 0.8, delay },
      };

    // Turns over like a card. rotateY needs perspective on the element to
    // read as a turn rather than a horizontal squash — see the overlay.
    case "flip":
      return {
        initial: { opacity: 0, rotateY: -78, scale: 0.88 },
        animate: { opacity: 1, rotateY: 0, scale: 1 },
        exit: { opacity: 0, rotateY: 52, scale: 0.88 },
        transition: { duration: 0.42, delay, ease: [0.22, 1, 0.36, 1] },
      };

    // Slides in from the left with a soft ease-out. The quietest of the
    // moving options: no scale change, so nothing grows over the scene.
    case "glide":
      return {
        initial: { opacity: 0, x: -26 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: 20 },
        transition: { duration: 0.34, delay, ease: [0.16, 1, 0.3, 1] },
      };

    // The original, and still the default.
    case "rise":
    default:
      return {
        initial: { opacity: 0, scale: 0.75, y: 16 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.75, y: -16 },
        transition: { duration: 0.35, delay, ease: "easeOut" },
      };
  }
}
