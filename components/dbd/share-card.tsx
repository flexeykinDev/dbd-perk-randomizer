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
// never touches a Tailwind class or CSS custom property. Same rule applies
// to layout: no CSS filters (blur/drop-shadow are flaky in 1.4.x), no CSS
// grid (flex is far better supported), no external stylesheets.
//
// There is deliberately no illustration in this file. An earlier pass drew
// a generator, a campfire, a hook and the Entity as hand-authored SVG paths
// and they looked exactly like hand-authored SVG paths. The game already
// ships 1478 pieces of professional line art and 96 character portraits;
// the card's job is to frame that work and get out of its way. Everything
// below is composition, type and hairlines.
const GROUND = "#0b0d11";
const BONE = "#e8e4dc";
const HAIRLINE = "rgba(232,228,220,0.14)";
const HAIRLINE_SOFT = "rgba(232,228,220,0.08)";
const QUIET = "rgba(232,228,220,0.42)";

const ROLE_LABEL: Record<PerkRole, { ru: string; en: string }> = {
  survivor: { ru: "Выживший", en: "Survivor" },
  killer: { ru: "Убийца", en: "Killer" },
};

export type ShareCardLayout = "landscape" | "story";

// Real, fixed canvas dimensions instead of "however tall the content turns
// out to be" — landscape is a genuine 16:9 (what Discord/X crop link
// previews to), story is 9:16 for Stories/TikTok/Reels.
const CANVAS_SIZE: Record<ShareCardLayout, { width: number; height: number }> = {
  landscape: { width: 1600, height: 900 },
  story: { width: 1080, height: 1920 },
};

// Icons are scraped and stored at a native 256x256 (scripts/scrape-perks.ts).
// They used to be 128, and display sizes were pinned just under that to
// avoid upscaling a fixed-detail bitmap; 256 in the files is what allows the
// sizes below without going soft. Nothing here may exceed it.
const NATIVE_ICON = 256;

/** One perk, framed.
 *
 *  A rotated square, because that is how the game itself presents a perk —
 *  with two hairlines rather than one heavy border, so the frame reads as
 *  drawn rather than as a default 2px stroke. The icon is counter-rotated so
 *  the art stays upright, which is the single riskiest thing in this file
 *  for html2canvas and the reason e2e downloads a real PNG and measures it
 *  instead of trusting the DOM. */
function Gem({
  index,
  src,
  label,
  gemSize,
  iconSize,
  slotWidth,
  labelGap,
  labelSize,
  indexSize,
  accent,
}: {
  index: number;
  src: string;
  label: string;
  gemSize: number;
  iconSize: number;
  slotWidth: number;
  labelGap: number;
  labelSize: number;
  indexSize: number;
  accent: string;
}) {
  const inset = Math.round(gemSize * 0.055);
  return (
    <div style={{ width: slotWidth, textAlign: "center" }}>
      <div
        style={{
          position: "relative",
          width: gemSize,
          height: gemSize,
          margin: `0 auto ${labelGap}px`,
          transform: "rotate(45deg)",
          border: `1px solid ${HAIRLINE}`,
          background: "linear-gradient(160deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: inset,
            top: inset,
            right: inset,
            bottom: inset,
            border: `1px solid ${HAIRLINE_SOFT}`,
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- captured by html2canvas, not rendered as a normal page image */}
        <img
          src={withBasePath(src)}
          alt=""
          width={iconSize}
          height={iconSize}
          style={{
            width: iconSize,
            height: iconSize,
            transform: "rotate(-45deg)",
            display: "block",
          }}
        />
      </div>
      {/* The slot number is real information, not ornament: it is the same
          number that rerolls this slot from the keyboard. */}
      <div
        style={{
          fontSize: indexSize,
          letterSpacing: "0.2em",
          color: accent,
          marginBottom: Math.round(labelGap * 0.34),
          fontWeight: 700,
        }}
      >
        {String(index + 1).padStart(2, "0")}
      </div>
      <div
        style={{
          fontSize: labelSize,
          lineHeight: 1.28,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          fontWeight: 600,
          color: BONE,
        }}
      >
        {label}
      </div>
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
  /** Drives the line under the role — "all" mode's pieces are perks and
   *  loadout pieces concatenated into one list, so this is the only way to
   *  tell that apart from a plain perks-only build for wording purposes. */
  mode: "perks" | "loadout" | "all";
  role: PerkRole;
  language: "en" | "ru";
  /** The build's character, if one is known — either explicitly chosen via
   *  the character picker, or (killer only) inferred from the rolled Power
   *  add-ons. `null`/absent is the common case for a survivor perk roll, and
   *  the layout treats it as a first-class state: the title block simply
   *  takes the space the portrait would have had. */
  character?: string | null;
  /** "landscape" (default): fixed 1600x900 (16:9). "story": 1080x1920 (9:16),
   *  laid out to keep everything clear of the caption and button furniture
   *  TikTok/Reels draw over the edges. */
  layout?: ShareCardLayout;
}) {
  const accent = ROLE_COLOR[role].solid;
  const roleName = ROLE_LABEL[role][language];
  const portrait = character ? getCharacterPortrait(character) : undefined;
  const isStory = layout === "story";
  const { width, height } = CANVAS_SIZE[layout];

  const count = Math.max(pieces.length, 1);
  const perRow = isStory ? 2 : Math.min(count, 4);
  const rows = Math.ceil(count / perRow);
  // Shrink only when there are MORE rows than the layout intends — story is
  // meant to be two-by-two, landscape a single row. Shrinking merely because
  // a second row exists is self-defeating: the smaller slots then fit on one
  // row, and story rendered four tiny diamonds in a line instead of a grid.
  const intendedRows = isStory ? 2 : 1;
  const shrink = rows > intendedRows ? 0.66 : 1;

  const gemSize = Math.round((isStory ? 200 : 158) * shrink);
  const iconSize = Math.min(NATIVE_ICON, Math.round((isStory ? 150 : 126) * shrink));
  // A square rotated 45 degrees needs 1.414x its own width; laying slots out
  // at the square's width is what made neighbouring diamonds collide.
  const slotWidth = Math.round(gemSize * 1.4143) + Math.round((isStory ? 34 : 22) * shrink);
  const labelGap = Math.round((isStory ? 38 : 30) * shrink);
  const labelSize = Math.round((isStory ? 25 : 17) * shrink);
  const indexSize = Math.round((isStory ? 19 : 12) * shrink);
  const rowGap = isStory ? 54 : 48;

  const margin = isStory ? 84 : 88;

  const subtitle =
    mode === "loadout"
      ? language === "ru"
        ? "экипировка"
        : "loadout"
      : mode === "all"
        ? language === "ru"
          ? "перки и экипировка"
          : "perks & loadout"
        : `${count} ${language === "ru" ? ruPlural(count, "перк", "перка", "перков") : count === 1 ? "perk" : "perks"}`;

  const title = character
    ? getCharacterName(character, language)
    : language === "ru"
      ? "Случайный билд"
      : "Random build";

  // One quiet role-tinted wash on the side opposite the portrait. It is the
  // only colour on the card besides the accent rule, and it exists so the
  // ground does not read as flat black.
  const tint = role === "survivor" ? "76,194,241" : "242,100,122";
  const wash = `radial-gradient(ellipse 82% 74% at ${isStory ? "50% 30%" : "76% 42%"}, rgba(${tint},0.11), rgba(${tint},0) 70%)`;

  const gems = pieces.slice(0, 8).map((piece, i) => (
    <Gem
      key={piece.slug}
      index={i}
      src={piece.icon}
      label={piece.name[language]}
      gemSize={gemSize}
      iconSize={iconSize}
      slotWidth={slotWidth}
      labelGap={labelGap}
      labelSize={labelSize}
      indexSize={indexSize}
      accent={accent}
    />
  ));

  const titleBlock = (
    <div style={{ maxWidth: isStory ? 820 : 520 }}>
      <div
        style={{
          fontSize: isStory ? 27 : 16,
          letterSpacing: "0.34em",
          textTransform: "uppercase",
          color: accent,
          fontWeight: 700,
          marginBottom: isStory ? 22 : 20,
        }}
      >
        {roleName}
      </div>
      <div style={{ width: isStory ? 104 : 88, height: 2, background: accent, marginBottom: isStory ? 30 : 26 }} />
      <div
        style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: isStory ? 92 : 62,
          lineHeight: 1.0,
          letterSpacing: "-0.015em",
          color: BONE,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: isStory ? 26 : 18,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: QUIET,
          marginTop: isStory ? 22 : 18,
        }}
      >
        {subtitle}
      </div>
    </div>
  );

  /** A hairline with the wordmark sitting on it — the only footer furniture. */
  const footer = (
    <div style={{ position: "absolute", left: margin, right: margin, bottom: isStory ? 380 : 62 }}>
      <div style={{ height: 1, background: HAIRLINE_SOFT, marginBottom: isStory ? 22 : 18 }} />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: isStory ? 22 : 14,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: QUIET,
        }}
      >
        <span>dbd-randomizer</span>
        <span>{roleName}</span>
      </div>
    </div>
  );

  const shell: CSSProperties = {
    position: "relative",
    width,
    height,
    overflow: "hidden",
    // Flat ground, not a vertical gradient: the portrait veil is a
    // horizontal gradient that must end in the background colour, and
    // against a vertical gradient it can only match at one height —
    // everywhere else it shows as a hard vertical seam down the card.
    background: `${wash}, ${GROUND}`,
    color: BONE,
    fontFamily: "Arial, Helvetica, sans-serif",
    textAlign: "left",
  };

  if (isStory) {
    const artHeight = Math.round(height * 0.46);
    return (
      <div ref={ref} style={shell}>
        {portrait ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- captured by html2canvas */}
            <img
              src={withBasePath(portrait)}
              alt=""
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width,
                height: artHeight,
                objectFit: "cover",
                objectPosition: "50% 18%",
                display: "block",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width,
                height: artHeight + 200,
                background: `linear-gradient(180deg, rgba(11,13,17,0.45) 0%, rgba(11,13,17,0) 22%, rgba(11,13,17,0.78) 76%, ${GROUND} 100%)`,
              }}
            />
          </>
        ) : null}

        {/* Clear of the top 8% and bottom 20% that TikTok and Reels cover
            with their own furniture, and the right 13% where the buttons are. */}
        <div style={{ position: "absolute", left: margin, right: 200, top: portrait ? "40%" : "13%" }}>
          {titleBlock}
        </div>

        <div
          style={{
            position: "absolute",
            left: margin,
            right: 150,
            top: portrait ? "60%" : "40%",
            display: "flex",
            flexWrap: "wrap",
            gap: `${rowGap}px 0px`,
            justifyContent: "center",
          }}
        >
          {gems}
        </div>

        {footer}
      </div>
    );
  }

  const artWidth = Math.round(width * 0.3);
  const veilWidth = Math.round(width * 0.44);
  const rowWidth = perRow * slotWidth;

  return (
    <div ref={ref} style={shell}>
      {portrait ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- captured by html2canvas */}
          <img
            src={withBasePath(portrait)}
            alt=""
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: artWidth,
              height,
              objectFit: "cover",
              objectPosition: "50% 16%",
              display: "block",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: veilWidth,
              height,
              background: `linear-gradient(90deg, rgba(11,13,17,0) 0%, rgba(11,13,17,0.1) 30%, rgba(11,13,17,0.88) 72%, ${GROUND} 94%, ${GROUND} 100%)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              bottom: 0,
              width: veilWidth,
              height: Math.round(height * 0.66),
              background: `linear-gradient(180deg, rgba(11,13,17,0) 0%, rgba(11,13,17,0.72) 46%, rgba(11,13,17,0.96) 100%)`,
            }}
          />
        </>
      ) : null}

      <div
        style={{
          position: "absolute",
          left: margin,
          // With a portrait the type sits low, under the face; without one it
          // takes the middle of the column and carries the left half itself.
          ...(portrait ? { bottom: 148 } : { top: "50%", transform: "translateY(-50%)" }),
        }}
      >
        {titleBlock}
      </div>

      <div
        style={{
          position: "absolute",
          right: margin,
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          flexWrap: "wrap",
          gap: `${rowGap}px 0px`,
          justifyContent: "flex-end",
          width: rowWidth,
        }}
      >
        {gems}
      </div>

      {footer}
    </div>
  );
}
