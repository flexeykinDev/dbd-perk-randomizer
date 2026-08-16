import type { CSSProperties, Ref } from "react";
import { withBasePath } from "@/lib/asset-path";
import { getCharacterName } from "@/lib/character-name";
import { ruPlural } from "@/lib/i18n";
import { getCharacterPortrait } from "@/lib/perks";
import { ROLE_COLOR } from "@/lib/role-color";
import type { PerkRole } from "@/lib/types";

/** What the card grid actually needs from each item — a perk and a loadout
 *  piece (Item/Add-on/Offering) both satisfy this shape already, so the
 *  same grid renders either (or both concatenated, for "all" mode) without
 *  this component needing to know which kind of piece it's looking at. */
export interface ShareCardPiece {
  slug: string;
  icon: string;
  name: { en: string; ru: string };
}

// html2canvas (1.4.x, the current release) predates browser support for
// oklch()/oklab()/color-mix() — colors this app's Tailwind classes resolve
// to at runtime (Tailwind v4's palette is defined in oklch) — and either
// throws or silently mis-renders when it hits one. Every color here is a
// literal hex/rgba value via inline styles specifically so this component
// never touches a Tailwind class or CSS custom property. Gradients and the
// decorative SVGs below use the same literal-color rule and stick to plain
// linear-/radial-gradient and SVG path syntax html2canvas has supported for
// years (this isn't the oklch problem) — no CSS filters (blur/drop-shadow
// on filter are flaky in 1.4.x), no external image files.
const SURFACE = "#1e2228";
const SURFACE_LIGHT = "#262b33";
const BORDER = "rgba(255,255,255,0.08)";
const FOREGROUND = "#edeef0";
const MUTED = "#9096a3";

// The site's own role accent (blue for survivor, rose for killer) stays on
// every badge/border here — it's what the perk grid, pool manager, and
// everything else already use, and a shareable card should still read as
// "this site" at a glance. These are a separate, purely atmospheric mood
// per role: warm campfire embers for Survivor (DBD's own camp-fire hub),
// cold Entity dread for Killer — applied only to the background wash and
// the low-opacity decorative shapes, never to text or icon borders.
const MOOD: Record<
  PerkRole,
  { glow: string; glowSoft: string; ember: string; vignette: string }
> = {
  survivor: {
    glow: "#ff7a3d",
    glowSoft: "#ffb35c",
    ember: "#ff9a4d",
    vignette: "#2a1206",
  },
  killer: {
    glow: "#7c2d5c",
    glowSoft: "#b0203f",
    ember: "#9b2848",
    vignette: "#1a0912",
  },
};

const ROLE_LABEL: Record<PerkRole, { ru: string; en: string }> = {
  survivor: { ru: "Выживший", en: "Survivor" },
  killer: { ru: "Убийца", en: "Killer" },
};

export type ShareCardLayout = "landscape" | "story";

// Real, fixed canvas dimensions instead of "however tall the content turns
// out to be" — landscape is now a genuine 16:9 (what Discord/X crop link
// previews to), matching the story format's already-fixed 1080x1920.
const CANVAS_SIZE: Record<ShareCardLayout, { width: number; height: number }> =
  {
    landscape: { width: 1600, height: 900 },
    story: { width: 1080, height: 1920 },
  };

// Perk icons are scraped/stored at a native 128x128 (see
// scripts/scrape-perks.ts) — displaying them larger than that upscales a
// fixed-detail bitmap, which is what actually caused the "blurry export"
// complaint (no html2canvas `scale` setting can add detail that isn't in
// the source file). These stay close enough to 128 that the stretch is
// imperceptible; card size instead comes from padding/gaps/typography,
// which are vector/text and render crisply at any size.
const ICON_SIZE: Record<ShareCardLayout, number> = {
  landscape: 132,
  story: 160,
};

// A simple stylized flame — used low-opacity and off in a corner, so exact
// fidelity matters less than a silhouette that reads as "fire" at a glance.
function FlameShape({ style, color }: { style: CSSProperties; color: string }) {
  return (
    <svg viewBox="0 0 100 130" style={style}>
      <path
        fill={color}
        d="M50 128C24 128 6 108 6 82C6 60 20 42 27 26C30 42 39 43 36 27C33 11 45 -2 58 4C49 21 58 31 68 22C77 35 74 49 63 56C87 59 97 79 84 101C89 83 68 78 61 93C70 76 51 70 51 100C51 112 59 118 50 128Z"
      />
    </svg>
  );
}

// A trio of claw-like slash marks for the Killer theme.
function ClawMarks({ style, color }: { style: CSSProperties; color: string }) {
  return (
    <svg viewBox="0 0 120 120" style={style}>
      <path
        d="M6 20 Q 55 5 114 60"
        stroke={color}
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        opacity={0.9}
      />
      <path
        d="M2 42 Q 52 26 110 82"
        stroke={color}
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        opacity={0.65}
      />
      <path
        d="M0 66 Q 48 50 104 104"
        stroke={color}
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        opacity={0.4}
      />
    </svg>
  );
}

// A gnarled vine/tendril, standing in for the Entity's tendrils without
// needing a literal (and much harder to draw well at this scale) creature
// shape.
function VineShape({ style, color }: { style: CSSProperties; color: string }) {
  return (
    <svg viewBox="0 0 100 200" style={style}>
      <path
        d="M50 4 C 20 30, 78 55, 34 82 C -6 106, 66 118, 40 150 C 20 174, 62 182, 46 200"
        stroke={color}
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M46 60 C 60 54, 68 44, 66 32"
        stroke={color}
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M32 118 C 16 116, 6 106, 8 94"
        stroke={color}
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M42 160 C 58 158, 68 148, 66 136"
        stroke={color}
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Rising embers for Survivor — a fixed, hand-placed constellation rather
// than randomized, so the export is deterministic and nothing overlaps the
// card grid in the middle of the canvas.
const EMBER_SPOTS: readonly {
  left: string;
  top: string;
  size: number;
  opacity: number;
}[] = [
  { left: "6%", top: "88%", size: 10, opacity: 0.8 },
  { left: "10%", top: "74%", size: 6, opacity: 0.6 },
  { left: "4%", top: "60%", size: 5, opacity: 0.45 },
  { left: "13%", top: "48%", size: 4, opacity: 0.3 },
  { left: "94%", top: "90%", size: 9, opacity: 0.75 },
  { left: "90%", top: "76%", size: 6, opacity: 0.55 },
  { left: "96%", top: "62%", size: 5, opacity: 0.4 },
  { left: "88%", top: "50%", size: 4, opacity: 0.28 },
];

function ThemeDecor({ role, isStory }: { role: PerkRole; isStory: boolean }) {
  const mood = MOOD[role];
  const flameSize = isStory ? 220 : 150;
  const clawSize = isStory ? 200 : 150;
  const vineSize = isStory ? 200 : 150;

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {role === "survivor" ? (
        <>
          <FlameShape
            color={`${mood.glow}33`}
            style={{
              position: "absolute",
              left: -flameSize * 0.25,
              bottom: -flameSize * 0.15,
              width: flameSize,
              height: flameSize * 1.3,
            }}
          />
          <FlameShape
            color={`${mood.glowSoft}26`}
            style={{
              position: "absolute",
              right: -flameSize * 0.3,
              bottom: -flameSize * 0.2,
              width: flameSize * 0.8,
              height: flameSize * 1.04,
            }}
          />
          {EMBER_SPOTS.map((spot, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: spot.left,
                top: spot.top,
                width: spot.size,
                height: spot.size,
                borderRadius: "50%",
                background: `radial-gradient(circle, ${mood.ember} 0%, ${mood.ember}00 75%)`,
                opacity: spot.opacity,
              }}
            />
          ))}
        </>
      ) : (
        <>
          <ClawMarks
            color={`${mood.glowSoft}30`}
            style={{
              position: "absolute",
              top: isStory ? "4%" : "-6%",
              right: isStory ? "-8%" : "-4%",
              width: clawSize,
              height: clawSize,
            }}
          />
          <VineShape
            color={`${mood.glow}2e`}
            style={{
              position: "absolute",
              left: isStory ? "-6%" : "-3%",
              bottom: isStory ? "6%" : "-4%",
              width: vineSize,
              height: vineSize * 2,
            }}
          />
          <VineShape
            color={`${mood.glowSoft}20`}
            style={{
              position: "absolute",
              right: isStory ? "2%" : "8%",
              bottom: isStory ? "-4%" : "-8%",
              width: vineSize * 0.7,
              height: vineSize * 1.4,
              transform: "scaleX(-1)",
            }}
          />
        </>
      )}
    </div>
  );
}

export function ShareCard({
  ref,
  pieces,
  mode,
  role,
  language,
  character,
  layout = "landscape",
}: {
  ref?: Ref<HTMLDivElement>;
  pieces: ShareCardPiece[];
  /** Drives the subtitle under "Dead by Daylight" — "all" mode's pieces
   *  are perks and loadout pieces concatenated into one list (same as the
   *  OBS overlay does), so this is the only way to tell that apart from a
   *  plain perks-only build for wording purposes ("N perks" reads oddly
   *  once the count also includes an Offering). */
  mode: "perks" | "loadout" | "all";
  role: PerkRole;
  language: "en" | "ru";
  /** The build's character, if one is known — either explicitly chosen via
   *  the character picker, or (killer only) inferred from the rolled
   *  Power add-ons, same as the main site's own loadout HUD badge (see
   *  loadout-grid.tsx's PowerSlot). `null`/absent renders no badge at all,
   *  same as a survivor build with no character forced. */
  character?: string | null;
  /** "landscape" (default): fixed 1600x900 (16:9) — used for the regular
   *  "Download Image" option. "story": fixed 1080x1920 (9:16), for
   *  Instagram/TikTok Stories. */
  layout?: ShareCardLayout;
}) {
  const accent = ROLE_COLOR[role].solid;
  const mood = MOOD[role];
  const roleName = ROLE_LABEL[role][language];
  const characterPortrait = character
    ? getCharacterPortrait(character)
    : undefined;
  const isStory = layout === "story";
  const columns = isStory
    ? Math.min(Math.max(pieces.length, 1), 2)
    : Math.max(pieces.length, 1);
  const iconSize = ICON_SIZE[layout];
  // "N perks" only reads sensibly when every card actually is a perk — once
  // Loadout pieces are mixed in (or it's the only thing shown), a bare
  // count is either misleading ("4 perks" when 2 are add-ons) or pointless
  // (a loadout is always up to 4 fixed slots, not a count worth stating).
  const subtitle =
    mode === "loadout"
      ? language === "ru"
        ? "Экипировка"
        : "Loadout"
      : mode === "all"
        ? language === "ru"
          ? "Перки и экипировка"
          : "Perks & Loadout"
        : `${pieces.length} ${language === "ru" ? ruPlural(pieces.length, "перк", "перка", "перков") : "perks"}`;
  const { width, height } = CANVAS_SIZE[layout];
  const padding = isStory ? 64 : 56;
  const blockGap = isStory ? 72 : 40;

  // Survivor: a warm glow rising from below, like camp firelight. Killer:
  // a cold glow pressing down from above, like the Entity's fog descending
  // — plus a second, off-center smear of the deep-purple/blood tone so it
  // doesn't read as a plain single-color vignette.
  const moodGradient =
    role === "survivor"
      ? `radial-gradient(ellipse 90% 60% at 50% 115%, ${mood.glow}3d, transparent 60%), radial-gradient(ellipse 120% 55% at 50% 0%, ${accent}22, transparent 65%)`
      : `radial-gradient(ellipse 100% 65% at 50% -10%, ${mood.glow}40, transparent 62%), radial-gradient(ellipse 70% 50% at 85% 90%, ${mood.glowSoft}2b, transparent 60%)`;

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: blockGap,
        padding,
        // Layered: role-tinted mood glow(s) on top of a plain dark vertical
        // gradient base — flat color alone read as sterile at this size.
        background: `${moodGradient}, linear-gradient(180deg, #181b22 0%, #0d0e12 100%)`,
        color: FOREGROUND,
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <ThemeDecor role={role} isStory={isStory} />

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: isStory ? "column" : "row",
          alignItems: "center",
          gap: isStory ? 22 : 18,
        }}
      >
        <div
          style={{
            display: "flex",
            width: isStory ? 100 : 64,
            height: isStory ? 100 : 64,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: isStory ? 24 : 16,
            background: `linear-gradient(180deg, ${SURFACE_LIGHT} 0%, ${SURFACE} 100%)`,
            border: `1px solid ${BORDER}`,
          }}
        >
          <div
            style={{
              width: isStory ? 44 : 30,
              height: isStory ? 44 : 30,
              borderRadius: isStory ? 13 : 9,
              border: `${isStory ? 4 : 3}px solid ${accent}`,
            }}
          />
        </div>
        <div style={{ textAlign: isStory ? "center" : "left" }}>
          <div
            style={{
              fontSize: isStory ? 46 : 30,
              fontWeight: 700,
              lineHeight: 1.2,
            }}
          >
            Dead by Daylight
          </div>
          <div
            style={{
              fontSize: isStory ? 30 : 19,
              fontWeight: 600,
              color: accent,
            }}
          >
            {roleName} · {subtitle}
          </div>
        </div>

        {character && characterPortrait && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: isStory ? 16 : 12,
              // Landscape: pushed to the row's far end, away from the title
              // block. Story: no "auto" side to push toward in a centered
              // column, so it just stacks below instead.
              marginLeft: isStory ? undefined : "auto",
            }}
          >
            <span
              style={{
                display: "block",
                width: isStory ? 90 : 58,
                height: isStory ? 90 : 58,
                borderRadius: "50%",
                overflow: "hidden",
                border: `${isStory ? 3 : 2}px solid ${accent}`,
                flexShrink: 0,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- captured by html2canvas, not rendered as a normal page image */}
              <img
                src={withBasePath(characterPortrait)}
                alt={getCharacterName(character, language)}
                width={isStory ? 90 : 58}
                height={isStory ? 90 : 58}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            </span>
            <div
              style={{
                fontSize: isStory ? 24 : 16,
                fontWeight: 600,
                color: MUTED,
              }}
            >
              {getCharacterName(character, language)}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: isStory
            ? `repeat(${columns}, 1fr)`
            : `repeat(${columns}, minmax(0, 300px))`,
          justifyContent: isStory ? "stretch" : "center",
          gap: isStory ? 44 : 28,
        }}
      >
        {pieces.map((piece) => (
          <div
            key={piece.slug}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: isStory ? 22 : 16,
              padding: isStory ? 48 : 36,
              background: `linear-gradient(180deg, ${SURFACE_LIGHT} 0%, ${SURFACE} 100%)`,
              border: `1px solid ${BORDER}`,
              borderRadius: isStory ? 28 : 20,
              boxShadow: "0 10px 26px rgba(0,0,0,0.35)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- captured by html2canvas, not rendered as a normal page image */}
            <img
              src={withBasePath(piece.icon)}
              alt={piece.name[language]}
              width={iconSize}
              height={iconSize}
              style={{
                width: iconSize,
                height: iconSize,
                borderRadius: isStory ? 20 : 14,
                display: "block",
                objectFit: "cover",
              }}
            />
            <div
              style={{
                fontSize: isStory ? 26 : 19,
                fontWeight: 600,
                textAlign: "center",
                lineHeight: 1.3,
              }}
            >
              {piece.name[language]}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          position: "relative",
          paddingTop: isStory ? 36 : 24,
          borderTop: `1px solid ${BORDER}`,
          textAlign: "center",
          fontSize: isStory ? 20 : 14,
          color: MUTED,
        }}
      >
        DBD Perk Randomizer by flexeykinDev
      </div>
    </div>
  );
}
