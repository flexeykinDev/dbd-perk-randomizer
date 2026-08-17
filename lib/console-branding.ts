"use client";

// Purely cosmetic — a signature for anyone poking around devtools.
const ASCII_LOGO = String.raw`
 ██████╗ ██████╗ ██████╗
 ██╔══██╗██╔══██╗██╔══██╗
 ██║  ██║██████╔╝██║  ██║
 ██║  ██║██╔══██╗██║  ██║
 ██████╔╝██████╔╝██████╔╝
 ╚═════╝ ╚═════╝ ╚═════╝
`;

export function printConsoleBranding(): void {
  if (typeof window === "undefined" || typeof console === "undefined") return;

  console.log(`%c${ASCII_LOGO}`, "color:#f5a524;font-weight:bold;line-height:1.1;");
  console.log(
    "%cDead by Daylight — Perk Randomizer",
    "color:#f5a524;font-size:14px;font-weight:bold;",
  );
  console.log(
    "%cBuilt by flexeykinDev · %chttps://github.com/flexeykinDev/dbd-perk-randomizer",
    "color:#9096a3;font-size:12px;",
    "color:#5b9bd5;font-size:12px;",
  );
}
