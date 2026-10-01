import type { PerkRole } from "./types";

// Mirrors Dead by Daylight's own convention (blue-ish for survivor HUD/aura
// reads, red for killer) so perk cards read at a glance instead of every
// role sharing the site's single green accent.
//
// Every class below now resolves through --role-survivor / --role-killer in
// app/globals.css, which are theme-aware. They used to be Tailwind palette
// steps with one value for both themes, and that is why the roles barely
// registered: sky-400 and rose-400 measure 7.46 and 5.94 against the dark
// card but 2.14 and 2.69 against the light one, against an AA floor of 4.5.
// A colour that cannot be used at full strength in half the product gets
// diluted everywhere until it is safe, and at /10 the two roles painted
// #1c2f3b and #33252d — 28.7 apart out of 441, less than the distance
// between a card and its own border.
//
// Structure only. The perk art is deliberately uniform line work and is
// handled by `icon-art`; tinting it would make a Survivor's Adrenaline a
// different picture from a Killer's, which it is not.
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
    /** The selected state of the role switch: a real fill, not a 10% wash.
     *  Measured on its own label — 8.74 and 6.96 on dark, 5.58 and 5.91 on
     *  light — because a full fill puts the text ON the role colour and
     *  changes which pair has to clear AA. */
    fill: string;
    /** A card's own edge. Low alpha on purpose: this one is a whole-grid
     *  wash and the cards are already bordered, so it tints rather than
     *  outlines. Non-text, so 3:1 is the relevant floor, not 4.5. */
    edge: string;
  }
> = {
  survivor: {
    text: "text-role-survivor",
    bg: "bg-role-survivor/15",
    border: "border-role-survivor/60",
    hoverBorder: "hover:border-role-survivor/50",
    ring: "ring-role-survivor/50",
    glow: "bg-role-survivor/25",
    solid: "#38bdf8",
    fill: "border-role-survivor bg-role-survivor text-background",
    edge: "border-role-survivor/30",
  },
  killer: {
    text: "text-role-killer",
    bg: "bg-role-killer/15",
    border: "border-role-killer/60",
    hoverBorder: "hover:border-role-killer/50",
    ring: "ring-role-killer/50",
    glow: "bg-role-killer/25",
    solid: "#fb7185",
    fill: "border-role-killer bg-role-killer text-background",
    edge: "border-role-killer/30",
  },
};
