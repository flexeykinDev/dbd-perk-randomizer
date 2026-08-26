"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

/* A client boundary so the server-rendered root layout can hold this.
 *
 * `reducedMotion="user"` makes every motion.* component in the tree respect
 * the OS "reduce motion" setting — transforms and scale are dropped, opacity
 * still crossfades. The two canvas stages already read the media query
 * themselves; everything else animated (modals, panels, toasts, the card
 * reveal springs) did not, which is roughly a dozen components moving
 * regardless of the setting. One line here covers all of them, and any
 * component added later inherits it. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
