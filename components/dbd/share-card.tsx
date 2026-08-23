import type { CSSProperties, ReactNode, Ref } from "react";
import { withBasePath } from "@/lib/asset-path";
import { getCharacterName } from "@/lib/character-name";
import { oswald, plexMono } from "@/lib/export-fonts";
import { ruPlural } from "@/lib/i18n";
import { getKillerPowerIcon } from "@/lib/loadout";
import { getCharacterPortrait } from "@/lib/perks";
import { ROLE_COLOR } from "@/lib/role-color";
import type { PerkRole } from "@/lib/types";

/** What the card grid actually needs from each item — a perk and a loadout
 *  piece (Item/Add-on/Offering) both satisfy this shape already, so the same
 *  grid renders either (or both concatenated, for "all" mode) without this
 *  component needing to know which kind of piece it's looking at. */
export interface ShareCardPiece {
  slug: string;
  icon: string;
  name: { en: string; ru: string };
  /** Present on loadout pieces; drives the small label under each frame. */
  kind?: string;
}

/* ------------------------------------------------------------------ *
 * Why there is no Tailwind in this file.
 *
 * html2canvas 1.4.x — the current release, and what the download button
 * runs — predates browser support for oklch()/oklab()/color-mix(). Tailwind
 * v4's palette is defined in oklch, so any Tailwind colour class reaches
 * html2canvas as a colour function it cannot parse: it throws, or silently
 * paints the wrong thing. Every colour here is therefore a literal hex or
 * rgba, set inline, and this component never touches a utility class or a
 * CSS custom property.
 *
 * The same constraint rules out the obvious ways to do the polish below:
 *   - no CSS filters (blur, drop-shadow) — unsupported/flaky in 1.4.x
 *   - no box-shadow — not rendered at all
 *   - no mix-blend-mode, no mask, no backdrop-filter
 *   - no CSS grid (flex is far better supported)
 *
 * So the glows, shadows and vignette below are built from gradients, which
 * html2canvas has rendered reliably for years, and the film grain is a real
 * tiled PNG rather than an SVG filter. All of it is verified by downloading
 * an actual export and looking at it, not by inspecting the DOM.
 *
 * ------------------------------------------------------------------ *
 * The one rule every overlay here obeys.
 *
 * A layer's gradient must reach full transparency INSIDE its own box, on
 * every side that is not already the card's edge. Break that and the box
 * boundary becomes a visible seam, because the shell's role wash is still
 * painted underneath and the layer stops covering it in one pixel column.
 * Three separate rectangles were showing on the exported card for exactly
 * this reason — a veil that ended in opaque GROUND, and two boxes narrower
 * than the card carrying gradients that ran the other way.
 * ------------------------------------------------------------------ */

const GROUND = "#0a0c10";
const BONE = "#e8e4dc";
const HAIRLINE = "rgba(232,228,220,0.16)";
const HAIRLINE_SOFT = "rgba(232,228,220,0.07)";
const QUIET = "rgba(232,228,220,0.40)";
const FAINT = "rgba(232,228,220,0.26)";

/** Condensed grotesque for names and perk labels; wide-tracked mono for the
 *  small uppercase labels and the footer. Literal family strings, never
 *  `var(--…)` — see the header. Loaded via lib/export-fonts.ts. */
const DISPLAY = `${oswald.style.fontFamily}, "Arial Narrow", Arial, sans-serif`;
const MONO = `${plexMono.style.fontFamily}, ui-monospace, "Courier New", monospace`;

/** Atmospheric tone per role: cool blue for Survivor, warm ember for Killer.
 *  Kept separate from ROLE_COLOR (the site's UI accent, which has to stay
 *  recognisable) so the glow can be desaturated without weakening the accent
 *  the rest of the card uses. */
const MOOD: Record<PerkRole, { rgb: string }> = {
  survivor: { rgb: "88,178,226" },
  killer: { rgb: "226,104,96" },
};

const ROLE_LABEL: Record<PerkRole, { ru: string; en: string }> = {
  survivor: { ru: "Выживший", en: "Survivor" },
  killer: { ru: "Убийца", en: "Killer" },
};

export type ShareCardLayout = "landscape" | "story";

const CANVAS_SIZE: Record<ShareCardLayout, { width: number; height: number }> =
  {
    landscape: { width: 1600, height: 900 },
    story: { width: 1080, height: 1920 },
  };

/** Icons are scraped and stored at a native 256x256 (scripts/scrape-perks.ts).
 *  Nothing here may exceed it — past that a fixed-detail bitmap just goes
 *  soft, and no html2canvas `scale` can add detail the file does not have. */
const NATIVE_ICON = 256;

/** Tiled, seeded noise (public/export-grain.png). A real image because SVG
 *  and CSS filters both fail under html2canvas; seeded so two exports of the
 *  same build come out byte-identical. */
const GRAIN = "/export-grain.png";

/** Inner padding of the anchored (portrait-composition) band. Named because
 *  the band's own width is derived from them plus its contents. */
const BAND_PAD_L = 46;
const BAND_PAD_R = 28;

/** Shrinks a row's label size until its longest unbreakable word fits the slot.
 *
 *  A slot is as wide as its diamond, but the label under it is as wide as the
 *  name — and Russian loadout names get long ("Высококлассные сапфировые
 *  линзы", "Фрагмент молитвенной скрижали"). A word wider than the slot does
 *  not wrap and does not widen its box: it simply overflows and collides with
 *  the neighbouring label, while every bounding box still says nothing is
 *  wrong. e2e/share-card.spec.ts catches that by comparing scrollWidth to
 *  clientWidth; this is what keeps it from happening.
 *
 *  The per-character factor is Oswald's uppercase advance plus the 0.10em
 *  tracking, calibrated against real exports rather than font metrics — it
 *  only has to be conservative, since the test is the actual check. */
function fitLabelSize(names: string[], slotWidth: number, desired: number) {
  const longestWord = Math.max(
    1,
    ...names.flatMap((n) => n.split(/[\s‑-]+/).map((w) => w.length)),
  );
  const room = Math.max(1, slotWidth - 12);
  return Math.max(10, Math.min(desired, Math.floor(room / (longestWord * 0.62))));
}

/** One perk or loadout piece, framed as a diamond — the shape the game uses.
 *
 *  Four stacked layers, because none of the usual shortcuts survive the
 *  export: an ellipse standing in for a drop shadow, a role-tinted halo, the
 *  rotated frame with a gradient inner glow, and the counter-rotated icon.
 *  The rotation is the riskiest thing in this file, which is why e2e
 *  downloads a real PNG and measures it rather than trusting the DOM. */
function Diamond({
  src,
  label,
  gemSize,
  iconSize,
  slotWidth,
  labelGap,
  labelSize,
  mood,
  frameHeight,
}: {
  src: string;
  label: string;
  gemSize: number;
  iconSize: number;
  slotWidth: number;
  labelGap: number;
  labelSize: number;
  mood: { rgb: string };
  /** Forces the frame area to a common height so a row of differently-sized
   *  diamonds (a big Item beside its small Add-ons) centres them against each
   *  other and starts every label on the same line. Without it the labels
   *  step up and down across the row. */
  frameHeight?: number;
}) {
  const box = Math.round(gemSize * 1.4143);
  const inset = Math.round(gemSize * 0.052);
  const naturalH = box + Math.round(box * 0.13);
  const frameH = Math.max(frameHeight ?? naturalH, naturalH);
  return (
    <div style={{ width: slotWidth, textAlign: "center" }}>
      {/* The centring offset is PADDING on a fixed-height outer box, not a
          margin on the frame. Margins collapse: a small diamond's 27px bottom
          margin swallowed its label's 18px top margin, so the short slots'
          labels sat 17px higher than the tall ones' — the exact misalignment
          the equal frame height was added to remove. */}
      <div
        style={{
          height: frameH,
          boxSizing: "border-box",
          paddingTop: Math.round((frameH - naturalH) / 2),
        }}
      >
        <div
          style={{
            position: "relative",
            width: box,
            height: naturalH,
            margin: "0 auto",
          }}
        >
          {/* Grounding shadow: a box-shadow is ignored by html2canvas, so this
            is an ellipse of darkness the diamond appears to sit on. */}
          <div
            style={{
              position: "absolute",
              left: "15%",
              right: "15%",
              bottom: 0,
              height: Math.round(box * 0.16),
              background:
                "radial-gradient(ellipse 50% 50% at 50% 50%, rgba(0,0,0,0.55), rgba(0,0,0,0) 72%)",
            }}
          />
          {/* Halo, wider than the frame so it reads as light rather than fill. */}
          <div
            style={{
              position: "absolute",
              left: "-16%",
              top: "-14%",
              width: "132%",
              height: "132%",
              background: `radial-gradient(circle at 50% 46%, rgba(${mood.rgb},0.20), rgba(${mood.rgb},0.06) 46%, rgba(${mood.rgb},0) 70%)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: (box - gemSize) / 2,
              top: (box - gemSize) / 2,
              width: gemSize,
              height: gemSize,
              transform: "rotate(45deg)",
              border: `1px solid ${HAIRLINE}`,
              // Gradient inner glow: lit along the top-left edge, falling away,
              // with a breath of the role tone at the far corner.
              background: `linear-gradient(152deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.03) 40%, rgba(${mood.rgb},0.06) 100%)`,
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
        </div>
      </div>

      {/* Two lines of label are always reserved, even for a short name. Slots
          in a row are top-aligned, so without this a one-line name and a
          two-line name give their columns different heights — the row's
          bottom comes out ragged and the band that holds it grows to the
          tallest column with dead space under the rest. */}
      <div
        style={{
          marginTop: labelGap,
          minHeight: Math.round(labelSize * 1.28 * 2),
          fontFamily: DISPLAY,
          fontSize: labelSize,
          // Long Russian names routinely run to two lines; give them the room
          // rather than letting them crowd the frame above.
          lineHeight: 1.28,
          letterSpacing: "0.10em",
          textTransform: "uppercase",
          fontWeight: 500,
          color: BONE,
          // The backstop under fitLabelSize. Some names have a single word no
          // readable size will fit — "Кровоостанавливающий" is twenty
          // characters — and an unbreakable word does not wrap, it overflows
          // its slot silently. Breaking mid-word is ugly once; two labels
          // printed over each other is worse every time.
          overflowWrap: "break-word",
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
  mode: "perks" | "loadout" | "all";
  role: PerkRole;
  language: "en" | "ru";
  /** The build's character, if one is known. `null`/absent is the common
   *  case for a survivor perk roll and is a first-class layout, not a gap:
   *  the composition centres itself rather than leaving the portrait's third
   *  of the frame empty. */
  character?: string | null;
  layout?: ShareCardLayout;
}) {
  const accent = ROLE_COLOR[role].solid;
  const mood = MOOD[role];
  const roleName = ROLE_LABEL[role][language];
  const portrait = character ? getCharacterPortrait(character) : undefined;
  const isStory = layout === "story";
  const { width, height } = CANVAS_SIZE[layout];

  const margin = 84;
  const count = Math.max(pieces.length, 1);

  /* Portrait geometry.
   *
   * The source portraits are square and only 256x256, so every one of these
   * numbers is a compromise with resolution. Landscape bleeds the figure off
   * the left edge at full card height, which is a 3.5x upscale (7x once the
   * export doubles it) — the design calls for it, and the art is dark and
   * low-contrast enough to carry it, but that is the ceiling: the real fix is
   * re-scraping portraits above 256, not a larger `scale` here.
   *
   * `cover` on a square source in a 3:4 box scales to fit the HEIGHT exactly,
   * so there is no vertical crop and no distortion — only the sides are
   * trimmed. That is why nothing here needs a top fade. */
  const portraitW = isStory ? 640 : 700;
  const portraitH = isStory ? 853 : height;
  const portraitLeft = isStory ? -50 : -70;
  const portraitRight = portraitLeft + portraitW;

  /** The band's heading — the card's one statement of what it is showing.
   *  The name block used to carry a subtitle saying the same thing, which
   *  printed the mode twice on the centred layouts. Perks mode counts them,
   *  since the heading alone does not. */
  const bandLabel =
    mode === "loadout"
      ? language === "ru"
        ? "Экипировка"
        : "Loadout"
      : mode === "all"
        ? language === "ru"
          ? "Перки и экипировка"
          : "Perks & loadout"
        : language === "ru"
          ? `${count} ${ruPlural(count, "перк", "перка", "перков")}`
          : `${count} ${count === 1 ? "perk" : "perks"}`;

  const title = character
    ? getCharacterName(character, language)
    : language === "ru"
      ? "Случайный билд"
      : "Random build";

  /* A loadout is not four interchangeable things. The game — and the site's
   * own loadout row — give it a shape: one Item (or the killer's Power), the
   * two Add-ons that modify it, and one Offering, each under its own slot
   * heading, with the Item drawn larger than its Add-ons because that is the
   * hierarchy. */
  const powerIcon =
    role === "killer" && character && mode !== "perks"
      ? getKillerPowerIcon(character)
      : undefined;
  const perkPieces = pieces.filter((p) => !p.kind);
  const slotGroups: Array<{
    label: { ru: string; en: string };
    pieces: ShareCardPiece[];
    big: boolean;
  }> = [
    // Killers have no Item — they have their Power, which is not one of
    // the rolled pieces but is exactly what the site shows in that slot.
    ...(powerIcon
      ? [
          {
            label: { ru: "Сила", en: "Power" },
            pieces: [
              { slug: "power", icon: powerIcon, name: { ru: "", en: "" } },
            ],
            big: true,
          },
        ]
      : []),
    {
      label: { ru: "Предмет", en: "Item" },
      pieces: pieces.filter((p) => p.kind === "item"),
      big: true,
    },
    {
      label: { ru: "Аддоны", en: "Add-ons" },
      pieces: pieces.filter((p) => p.kind === "addon"),
      big: false,
    },
    {
      label: { ru: "Подношение", en: "Offering" },
      pieces: pieces.filter((p) => p.kind === "offering"),
      big: true,
    },
  ].filter((g) => g.pieces.length > 0);
  const hasLoadout = slotGroups.length > 0;

  // A slot is only as wide as its diamond plus this gutter, while the label
  // under it is as wide as the name. The gutter buys general room; fitLabelSize
  // handles the names no gutter could absorb.
  const gutter = isStory ? 36 : mode === "all" ? 44 : 26;
  const slotFor = (gem: number) => Math.round(gem * 1.4143) + gutter;
  const GROUP_GAP = isStory ? 30 : 40;

  /** How wide a run of diamonds actually comes out — used to size the band to
   *  its contents instead of stretching it to the card and leaving a third of
   *  it empty. */
  const rowWidth = (items: ShareCardPiece[], gem: number, perRow: number) =>
    Math.min(items.length || 1, perRow) * slotFor(gem);
  const loadoutWidth = (unit: number) =>
    slotGroups.reduce(
      (w, g, i) =>
        w +
        g.pieces.length * slotFor(g.big ? unit : Math.round(unit * 0.72)) +
        (i ? GROUP_GAP : 0),
      0,
    );

  /** A wrapped run of diamonds at an explicit width.
   *
   *  The width is always `perRow * slot` and never left to the container.
   *  Fixed sizes plus flex-wrap in an unconstrained box is how this layout
   *  broke four separate times — a row wide enough for three put a "2x2" out
   *  as 3 + 1, and eight pieces once came out as one line of eight. */
  function grid(
    items: ShareCardPiece[],
    gem: number,
    perRow: number,
    labelSize: number,
  ) {
    const slot = slotFor(gem);
    const fitted = fitLabelSize(
      items.map((p) => p.name[language]),
      slot,
      labelSize,
    );
    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: `${Math.round(gem * 0.34)}px 0px`,
          width: Math.min(items.length, perRow) * slot,
        }}
      >
        {items.map((piece) => (
          <Diamond
            key={piece.slug}
            src={piece.icon}
            label={piece.name[language]}
            gemSize={gem}
            iconSize={Math.min(NATIVE_ICON, Math.round(gem * 0.79))}
            slotWidth={slot}
            labelGap={Math.max(12, Math.round(gem * 0.15))}
            labelSize={fitted}
            mood={mood}
          />
        ))}
      </div>
    );
  }

  /** The loadout, laid out the way the game and the site lay it out. `unit` is
   *  the size of a large (Item / Offering) diamond; add-ons come out at 72% of
   *  it, which is roughly the ratio the site's own slot row uses. */
  function loadoutRow(unit: number, labelSize: number) {
    const small = Math.round(unit * 0.72);
    // Every slot's frame area is as tall as the largest diamond's, so the
    // Add-ons sit centred against the Item and all four labels share a line.
    const bigBox = Math.round(unit * 1.4143);
    const frameHeight = bigBox + Math.round(bigBox * 0.13);
    // Equal frame heights are not enough on their own: a gap and a type size
    // derived per-diamond still start the small slots' labels a few pixels
    // higher. One gap and one size for the whole row is what actually puts
    // them on a line.
    const rowLabelGap = Math.max(12, Math.round(unit * 0.15));
    return (
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: GROUP_GAP,
        }}
      >
        {slotGroups.map((group) => {
          const g = group.big ? unit : small;
          return (
            <div key={group.label.en} style={{ textAlign: "center" }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: Math.max(10, Math.round(unit * 0.095)),
                  letterSpacing: "0.30em",
                  textTransform: "uppercase",
                  color: accent,
                  fontWeight: 500,
                  marginBottom: Math.round(unit * 0.13),
                }}
              >
                {group.label[language]}
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                {group.pieces.map((piece) => (
                  <Diamond
                    key={piece.slug}
                    src={piece.icon}
                    label={piece.name[language]}
                    gemSize={g}
                    iconSize={Math.min(NATIVE_ICON, Math.round(g * 0.79))}
                    slotWidth={slotFor(g)}
                    labelGap={rowLabelGap}
                    // Sized per group: the Add-on slots are the narrowest and
                    // carry some of the longest names. The label TOP is fixed
                    // by frameHeight + rowLabelGap, so a smaller size here
                    // still starts on the row's shared line.
                    labelSize={fitLabelSize(
                      group.pieces.map((p) => p.name[language]),
                      slotFor(g),
                      labelSize,
                    )}
                    mood={mood}
                    frameHeight={frameHeight}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /** The HUD band: a bounded strip carrying the slots, with hairlines top and
   *  bottom and role-coloured ticks marking its leading edge.
   *
   *  Height is deliberately NOT fixed — the band is a flow box and grows to
   *  whatever it holds, so a two-row "all" build cannot overrun a hard-coded
   *  height the way earlier fixed-size rows did. It is centred on the card by
   *  translate rather than by arithmetic for the same reason.
   *
   *  `anchored` is the portrait composition (ticks on the left, content
   *  left-aligned); the centred variant fades symmetrically and drops the
   *  ticks, because a leading edge means nothing when there is nothing to
   *  lead away from. */
  function band({
    bandWidth,
    anchored,
    children,
  }: {
    /** Explicit, because the caller derives it from the contents — a band
     *  stretched to the card leaves a third of itself visibly empty. */
    bandWidth: number | string;
    anchored: boolean;
    children: ReactNode;
  }) {
    const padL = anchored ? BAND_PAD_L : 0;
    const padR = anchored ? BAND_PAD_R : 0;
    // The fill fades out slightly BEFORE the hairlines do, so the strip of
    // band that no hairline covers carries no fill edge either.
    const fill = anchored
      ? "linear-gradient(90deg, rgba(232,228,220,0) 0%, rgba(232,228,220,0.042) 6%, rgba(232,228,220,0.018) 55%, rgba(232,228,220,0) 86%)"
      : "linear-gradient(90deg, rgba(232,228,220,0) 0%, rgba(232,228,220,0.03) 22%, rgba(232,228,220,0.03) 78%, rgba(232,228,220,0) 100%)";
    const rule = anchored
      ? `linear-gradient(90deg, ${HAIRLINE} 0%, rgba(232,228,220,0.05) 62%, rgba(232,228,220,0) 90%)`
      : `linear-gradient(90deg, rgba(232,228,220,0) 0%, ${HAIRLINE} 24%, ${HAIRLINE} 76%, rgba(232,228,220,0) 100%)`;
    return (
      <div
        style={{
          position: "relative",
          width: bandWidth,
          paddingTop: 26,
          paddingBottom: 32,
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: fill }} />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 1,
            background: rule,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 1,
            background: rule,
          }}
        />
        {anchored ? (
          <>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: 2,
                height: 22,
                background: accent,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                bottom: 0,
                width: 2,
                height: 22,
                background: accent,
              }}
            />
          </>
        ) : null}
        <div
          style={{
            paddingLeft: padL,
            paddingRight: padR,
            textAlign: anchored ? "left" : "center",
            fontFamily: MONO,
            fontSize: isStory ? 17 : 13,
            letterSpacing: "0.42em",
            textTransform: "uppercase",
            color: accent,
            fontWeight: 500,
            marginBottom: isStory ? 34 : 28,
          }}
        >
          {bandLabel}
        </div>
        <div
          style={{
            paddingLeft: padL,
            paddingRight: padR,
            display: "flex",
            justifyContent: anchored ? "flex-start" : "center",
          }}
        >
          {children}
        </div>
      </div>
    );
  }

  /** Role eyebrow, accent rule, and the name — the identity block. Uppercase
   *  throughout, which is also why the display face's line-height can stay
   *  tight: Cyrillic capitals have no descenders. */
  function nameBlock(align: "left" | "center", nameSize: number) {
    return (
      <div style={{ textAlign: align }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: isStory ? 20 : 14,
            letterSpacing: "0.46em",
            textTransform: "uppercase",
            color: accent,
            fontWeight: 500,
          }}
        >
          {roleName}
        </div>
        <div
          style={{
            width: isStory ? 72 : 56,
            height: 2,
            background: accent,
            margin: align === "center" ? "20px auto 18px" : "20px 0 18px",
          }}
        />
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: nameSize,
            lineHeight: 1.08,
            letterSpacing: "0.01em",
            textTransform: "uppercase",
            fontWeight: 600,
            color: BONE,
          }}
        >
          {title}
        </div>
        {/* No subtitle line. It carried the mode ("перки и экипировка") — and
            so does the band's own heading, so the centred layouts printed the
            same words twice, one above the other in two different colours. */}
      </div>
    );
  }

  const footer = (
    <div
      data-share-footer
      style={{
        position: "absolute",
        left: margin,
        right: margin,
        bottom: isStory ? 372 : 52,
      }}
    >
      <div
        style={{
          height: 1,
          background: `linear-gradient(90deg, rgba(232,228,220,0) 0%, ${HAIRLINE_SOFT} 16%, ${HAIRLINE_SOFT} 84%, rgba(232,228,220,0) 100%)`,
          marginBottom: isStory ? 20 : 15,
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: isStory ? "center" : "space-between",
          alignItems: "baseline",
          fontFamily: MONO,
          fontSize: isStory ? 16 : 13,
          letterSpacing: isStory ? "0.12em" : "0.26em",
          textTransform: "uppercase",
          color: QUIET,
          whiteSpace: "nowrap",
        }}
      >
        {/* A readable address rather than a QR code: a code would mean a new
            dependency, and at the size it could occupy here it would need more
            contrast than this card has to spare.
            Story is too narrow to carry the full address — it wrapped onto two
            lines, which is the opposite of readable — so the vertical format
            keeps the wordmark alone and centred. */}
        {isStory ? (
          <span style={{ color: FAINT }}>
            flexeykindev.github.io/dbd-perk-randomizer
          </span>
        ) : (
          <>
            <span style={{ color: FAINT }}>dbd-randomizer</span>
            <span>flexeykindev.github.io/dbd-perk-randomizer</span>
          </>
        )}
      </div>
    </div>
  );

  /** Grain and vignette, over everything. Gradients and a tiled image, since
   *  filters do not survive the export. */
  const atmosphere = (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 76% 72% at 50% 46%, rgba(0,0,0,0) 44%, rgba(0,0,0,0.32) 78%, rgba(0,0,0,0.6) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url(${withBasePath(GRAIN)})`,
          backgroundRepeat: "repeat",
          opacity: 0.05,
        }}
      />
    </>
  );

  const shell: CSSProperties = {
    position: "relative",
    width,
    height,
    overflow: "hidden",
    background: `radial-gradient(ellipse 86% 76% at ${portrait ? "70%" : "50%"} 40%, rgba(${mood.rgb},0.13), rgba(${mood.rgb},0) 68%), ${GROUND}`,
    color: BONE,
    fontFamily: DISPLAY,
    // The card is mounted inside a centred column; without this it inherits
    // that alignment and quietly re-centres its own text.
    textAlign: "left",
  };

  /** The horizontal veil that dissolves the figure's cut side.
   *
   *  Spans the whole card, with the stops placed relative to where the figure
   *  actually ends, so the box has no interior edge for html2canvas to band
   *  against — and it returns to transparent rather than settling on a flat
   *  colour, which would paint over the role wash and draw a seam. */
  const figureVeil = (() => {
    const edge = (portraitRight / width) * 100;
    const at = (f: number) => `${(edge * f).toFixed(1)}%`;
    return (
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          background: `linear-gradient(90deg, rgba(10,12,16,0) 0%, rgba(10,12,16,0.05) ${at(0.56)}, rgba(10,12,16,0.38) ${at(0.81)}, rgba(10,12,16,0.93) ${at(1)}, rgba(10,12,16,0.52) ${at(1.17)}, rgba(10,12,16,0) ${at(1.45)})`,
        }}
      />
    );
  })();

  /** Grounds the identity block. A radial anchored past the bottom-left
   *  corner reaches full transparency inside its own box on every side, so
   *  unlike a vertical gradient on a half-width box it leaves no seam. */
  const groundWash = (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height,
        background:
          "radial-gradient(ellipse 62% 66% at 16% 104%, rgba(10,12,16,0.96), rgba(10,12,16,0.72) 38%, rgba(10,12,16,0.28) 66%, rgba(10,12,16,0) 86%)",
      }}
    />
  );

  if (isStory) {
    // Story keeps clear of the top 8%, right 13% and bottom 20% that TikTok
    // and Reels cover with their own furniture.
    /* Story is 1080 wide and gives 172 of it back to TikTok's button column,
     * so the band has ~750px of usable room. A loadout at the landscape unit
     * size came out 832px wide: the slots overflowed their band and the
     * Add-on and Offering names printed on top of each other. These sizes are
     * solved backwards from the room, not copied from the landscape card. */
    const perkGem = mode === "all" ? 104 : 150;
    const loadUnit = mode === "all" ? 88 : 104;
    const perRow = perkPieces.length > 2 ? 2 : perkPieces.length || 1;
    const storyContentW =
      mode === "loadout"
        ? loadoutWidth(loadUnit)
        : mode === "all" && hasLoadout
          ? Math.max(rowWidth(perkPieces, perkGem, 2), loadoutWidth(loadUnit))
          : rowWidth(pieces, perkGem, perRow);
    const storyBandW = storyContentW + BAND_PAD_L + BAND_PAD_R;
    return (
      <div ref={ref} style={shell}>
        {portrait ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- captured by html2canvas */}
            <img
              src={withBasePath(portrait)}
              alt=""
              width={portraitW}
              height={portraitH}
              style={{
                position: "absolute",
                left: portraitLeft,
                top: 0,
                width: portraitW,
                height: portraitH,
                objectFit: "cover",
                objectPosition: "50% 50%",
                display: "block",
              }}
            />
            {figureVeil}
            {/* Fades the figure's bottom into the card. Full width, ending
                transparent — see the rule at the top of this file. */}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width,
                height: portraitH + 620,
                background:
                  "linear-gradient(180deg, rgba(10,12,16,0.42) 0%, rgba(10,12,16,0) 14%, rgba(10,12,16,0.6) 43%, rgba(10,12,16,0.78) 58%, rgba(10,12,16,0) 100%)",
              }}
            />
          </>
        ) : null}

        {/* Name and band are ONE bottom-anchored stack, not two blocks pinned
            at percentages. Percentages cannot survive variable content: a
            two-line character name ("Торговка черепами") grew downwards into
            the band and printed straight through it. Anchored from the bottom
            — just clear of the footer — a long name grows up into the empty
            middle instead, and the band's bottom edge never moves. */}
        <div
          style={{
            position: "absolute",
            left: margin,
            right: 172,
            bottom: 452,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 54,
          }}
        >
          {portrait ? nameBlock("left", 92) : null}
          {band({
            bandWidth: storyBandW,
            anchored: true,
            children:
              mode === "loadout" ? (
                loadoutRow(loadUnit, 18)
              ) : mode === "all" && hasLoadout ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 38 }}
                >
                  {grid(perkPieces, perkGem, 2, 19)}
                  <div
                    style={{
                      height: 1,
                      background: `linear-gradient(90deg, rgba(232,228,220,0) 0%, ${HAIRLINE} 50%, rgba(232,228,220,0) 100%)`,
                    }}
                  />
                  {loadoutRow(loadUnit, 17)}
                </div>
              ) : (
                grid(pieces.slice(0, 8), perkGem, perRow, 22)
              ),
          })}
        </div>

        {/* Without a portrait the title leads at the top instead, where a
            vertical card has room to give it. */}
        {portrait ? null : (
          <div
            style={{
              position: "absolute",
              left: margin,
              right: 172,
              top: "13%",
            }}
          >
            {nameBlock("left", 84)}
          </div>
        )}

        {footer}
        {atmosphere}
      </div>
    );
  }

  /* Landscape. With a portrait the figure bleeds off the left and the band
   * takes the space it leaves; without one the whole composition centres,
   * which is by far the most common case (a survivor perk roll). */
  if (portrait) {
    const perkGem = mode === "all" ? 84 : 118;
    const loadUnit = mode === "all" ? 76 : 118;
    /* Size the band to what it holds, then centre it in the room the figure
     * leaves. Pinning it left-to-right instead stretched it across the whole
     * right half and left a third of it visibly empty in every mode but
     * "all". */
    const contentW =
      mode === "loadout"
        ? loadoutWidth(loadUnit)
        : mode === "all" && hasLoadout
          ? Math.max(rowWidth(perkPieces, perkGem, 4), loadoutWidth(loadUnit))
          : rowWidth(pieces, perkGem, 4);
    const bandW = contentW + BAND_PAD_L + BAND_PAD_R;
    const regionL = portraitRight + 30;
    const regionR = width - margin;
    const bandLeft = Math.round(
      regionL + Math.max(0, (regionR - regionL - bandW) / 2),
    );
    return (
      <div ref={ref} style={shell}>
        {/* eslint-disable-next-line @next/next/no-img-element -- captured by html2canvas */}
        <img
          src={withBasePath(portrait)}
          alt=""
          width={portraitW}
          height={portraitH}
          style={{
            position: "absolute",
            left: portraitLeft,
            top: 0,
            width: portraitW,
            height: portraitH,
            objectFit: "cover",
            objectPosition: "50% 50%",
            display: "block",
          }}
        />
        {figureVeil}
        {groundWash}

        <div
          style={{
            position: "absolute",
            left: bandLeft,
            top: "45%",
            transform: "translateY(-50%)",
          }}
        >
          {band({
            bandWidth: bandW,
            anchored: true,
            children:
              mode === "loadout" ? (
                loadoutRow(loadUnit, 17)
              ) : mode === "all" && hasLoadout ? (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 30 }}
                >
                  {grid(perkPieces, perkGem, 4, 15)}
                  <div
                    style={{
                      height: 1,
                      background: `linear-gradient(90deg, rgba(232,228,220,0) 0%, ${HAIRLINE} 50%, rgba(232,228,220,0) 100%)`,
                    }}
                  />
                  {loadoutRow(loadUnit, 15)}
                </div>
              ) : (
                grid(pieces.slice(0, 8), perkGem, 4, 17)
              ),
          })}
        </div>

        <div style={{ position: "absolute", left: margin, bottom: 132 }}>
          {nameBlock("left", 104)}
        </div>

        {footer}
        {atmosphere}
      </div>
    );
  }

  const centeredGem = mode === "all" ? 88 : 150;
  const centeredUnit = mode === "all" ? 80 : 150;
  return (
    <div ref={ref} style={shell}>
      {/* Title and band are one centred stack. Pinned separately — title at a
          fixed top, band at a percentage — the band's top hairline cut across
          the bottom of the title as soon as the title wrapped or the band grew.
          A single column with a gap cannot overlap itself. */}
      <div
        style={{
          position: "absolute",
          left: margin,
          right: margin,
          top: "47%",
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 56,
        }}
      >
        {nameBlock("center", 76)}
        {band({
          bandWidth: "100%",
          anchored: false,
          children:
            mode === "loadout" ? (
              loadoutRow(centeredUnit, 18)
            ) : mode === "all" && hasLoadout ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 30,
                }}
              >
                {grid(perkPieces, centeredGem, 4, 16)}
                <div
                  style={{
                    width: 760,
                    height: 1,
                    background: `linear-gradient(90deg, rgba(232,228,220,0) 0%, ${HAIRLINE} 50%, rgba(232,228,220,0) 100%)`,
                  }}
                />
                {loadoutRow(centeredUnit, 16)}
              </div>
            ) : (
              grid(pieces.slice(0, 8), centeredGem, Math.min(count, 4), 18)
            ),
        })}
      </div>

      {footer}
      {atmosphere}
    </div>
  );
}
