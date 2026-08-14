import type { PerkRole } from "./types";

// Mirrors Dead by Daylight's own convention (blue-ish for survivor HUD/aura
// reads, red for killer) so perk cards read at a glance instead of every
// role sharing the site's single green accent.
export const ROLE_COLOR: Record<
  PerkRole,
  {
    text: string;
    bg: string;
    border: string;
    hoverBorder: string;
    ring: string;
    glow: string;
    solid: string;
  }
> = {
  survivor: {
    text: "text-sky-400",
    bg: "bg-sky-500/10",
    border: "border-sky-500/40",
    hoverBorder: "hover:border-sky-500/40",
    ring: "ring-sky-400/40",
    glow: "bg-sky-500/25",
    solid: "#38bdf8",
  },
  killer: {
    text: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/40",
    hoverBorder: "hover:border-rose-500/40",
    ring: "ring-rose-400/40",
    glow: "bg-rose-500/25",
    solid: "#fb7185",
  },
};
