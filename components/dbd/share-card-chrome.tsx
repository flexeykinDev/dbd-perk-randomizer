import type { CSSProperties, ReactNode } from "react";
import { withBasePath } from "@/lib/asset-path";
import {
  BAND_PAD_L,
  BAND_PAD_R,
  BONE,
  DISPLAY,
  GRAIN,
  GROUND,
  HAIRLINE,
  HAIRLINE_SOFT,
  MONO,
} from "./share-card-theme";
import type { CardLayout } from "./share-card-layout";

/* The card's furniture: the ground it sits on, the layers over the figure, the
 * band that holds the slots, the identity block and the footer.
 *
 * Every one of these was a closure inside ShareCard reading fifteen locals off
 * its scope. They take the layout object plus the two or three values that are
 * genuinely per-card (the role accent, the mood tint), which is what made
 * pulling them out worth doing rather than just moving the problem.
 *
 * The rule the whole file obeys, and the reason several of these look
 * overwrought: a gradient box whose stops end on an opaque colour draws a
 * visible seam under html2canvas. Every overlay here spans the full card and
 * returns to fully transparent, rather than being a narrower box that stops.
 */

/** The card's own ground: size, base wash, and the type defaults. */
export function shellStyle(l: CardLayout, mood: { rgb: string }, hasPortrait: boolean): CSSProperties {
  return {
    position: "relative",
    width: l.width,
    height: l.height,
    overflow: "hidden",
    background: `radial-gradient(ellipse 86% 76% at ${hasPortrait ? "70%" : "50%"} 40%, rgba(${mood.rgb},0.13), rgba(${mood.rgb},0) 68%), ${GROUND}`,
    color: BONE,
    fontFamily: DISPLAY,
    // The card is mounted inside a centred column; without this it inherits
    // that alignment and quietly re-centres its own text.
    textAlign: "left",
  };
}

/** Grain and vignette, over everything. Gradients and a tiled image, since
 *  filters do not survive the export. */
export function Atmosphere() {
  return (
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
}

/* The vortex, if one was rendered, sitting under every other layer.
 *
 * An <img> rather than a CSS background, because html2canvas resolves an img's
 * data URI reliably and is fussier about background-image sizing. It carries
 * its own scrim: the fog has a bright eye, and card text is bone-on-near-black
 * that stops being readable the moment anything luminous sits behind it.
 *
 * The scrim is darkest in the MIDDLE and thins towards the corners, which is
 * the opposite of the obvious vignette and the right way round here: every
 * word sits in the central band, and the empty corners are the only place the
 * fog can be seen without fighting anything. A flat wash strong enough to
 * protect the text hid the vortex so thoroughly that two different builds were
 * indistinguishable side by side — which defeats generating one per build. */
export function BackdropLayer({ backdrop }: { backdrop?: string | null }) {
  if (!backdrop) return null;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- captured by html2canvas */}
      <img
        src={backdrop}
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: 0.92,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 72% 64% at 50% 45%, rgba(10,12,16,0.90) 0%, rgba(10,12,16,0.84) 46%, rgba(10,12,16,0.55) 78%, rgba(10,12,16,0.34) 100%)",
        }}
      />
    </>
  );
}

/** The character, bled off the left edge. */
export function PortraitImage({ l, src }: { l: CardLayout; src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- captured by html2canvas
    <img
      src={withBasePath(src)}
      alt=""
      width={l.portraitW}
      height={l.portraitH}
      style={{
        position: "absolute",
        left: l.portraitLeft,
        top: 0,
        width: l.portraitW,
        height: l.portraitH,
        objectFit: "cover",
        objectPosition: "50% 50%",
        display: "block",
      }}
    />
  );
}

/** The horizontal veil that dissolves the figure's cut side.
 *
 *  Spans the whole card, with the stops placed relative to where the figure
 *  actually ends, so the box has no interior edge for html2canvas to band
 *  against — and it returns to transparent rather than settling on a flat
 *  colour, which would paint over the role wash and draw a seam. */
export function FigureVeil({ l }: { l: CardLayout }) {
  const edge = (l.portraitRight / l.width) * 100;
  const at = (f: number) => `${(edge * f).toFixed(1)}%`;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: l.width,
        height: l.height,
        background: `linear-gradient(90deg, rgba(10,12,16,0) 0%, rgba(10,12,16,0.05) ${at(0.56)}, rgba(10,12,16,0.38) ${at(0.81)}, rgba(10,12,16,0.93) ${at(1)}, rgba(10,12,16,0.52) ${at(1.17)}, rgba(10,12,16,0) ${at(1.45)})`,
      }}
    />
  );
}

/** Grounds the identity block. A radial anchored past the bottom-left corner
 *  reaches full transparency inside its own box on every side, so unlike a
 *  vertical gradient on a half-width box it leaves no seam. */
export function GroundWash({ l }: { l: CardLayout }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: l.width,
        height: l.height,
        background:
          "radial-gradient(ellipse 62% 66% at 16% 104%, rgba(10,12,16,0.96), rgba(10,12,16,0.72) 38%, rgba(10,12,16,0.28) 66%, rgba(10,12,16,0) 86%)",
      }}
    />
  );
}

/** The HUD band: a bounded strip carrying the slots, with hairlines top and
 *  bottom and role-coloured ticks marking its leading edge.
 *
 *  Height is deliberately NOT fixed — the band is a flow box and grows to
 *  whatever it holds, so a two-row "all" build cannot overrun a hard-coded
 *  height the way earlier fixed-size rows did.
 *
 *  `anchored` is the portrait composition (ticks on the left, content
 *  left-aligned); the centred variant fades symmetrically and drops the ticks,
 *  because a leading edge means nothing when there is nothing to lead away
 *  from. */
export function Band({
  l,
  accent,
  width,
  anchored,
  children,
}: {
  l: CardLayout;
  accent: string;
  /** Explicit, because it is derived from the contents — a band stretched to
   *  the card leaves a third of itself visibly empty. */
  width: number | string;
  anchored: boolean;
  children: ReactNode;
}) {
  const padL = anchored ? BAND_PAD_L : 0;
  const padR = anchored ? BAND_PAD_R : 0;
  // The fill fades out slightly BEFORE the hairlines do, so the strip of band
  // that no hairline covers carries no fill edge either.
  const fill = anchored
    ? "linear-gradient(90deg, rgba(232,228,220,0) 0%, rgba(232,228,220,0.042) 6%, rgba(232,228,220,0.018) 55%, rgba(232,228,220,0) 86%)"
    : "linear-gradient(90deg, rgba(232,228,220,0) 0%, rgba(232,228,220,0.03) 22%, rgba(232,228,220,0.03) 78%, rgba(232,228,220,0) 100%)";
  const rule = anchored
    ? `linear-gradient(90deg, ${HAIRLINE} 0%, rgba(232,228,220,0.05) 62%, rgba(232,228,220,0) 90%)`
    : `linear-gradient(90deg, rgba(232,228,220,0) 0%, ${HAIRLINE} 24%, ${HAIRLINE} 76%, rgba(232,228,220,0) 100%)`;
  const tick: CSSProperties = { position: "absolute", left: 0, width: 2, height: 22, background: accent };
  return (
    <div style={{ position: "relative", width, paddingTop: 26, paddingBottom: 32 }}>
      <div style={{ position: "absolute", inset: 0, background: fill }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 1, background: rule }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, background: rule }} />
      {anchored ? (
        <>
          <div style={{ ...tick, top: 0 }} />
          <div style={{ ...tick, bottom: 0 }} />
        </>
      ) : null}
      <div
        style={{
          paddingLeft: padL,
          paddingRight: padR,
          textAlign: anchored ? "left" : "center",
          fontFamily: MONO,
          fontSize: l.isStory ? 17 : 13,
          letterSpacing: "0.42em",
          textTransform: "uppercase",
          color: accent,
          fontWeight: 500,
          marginBottom: l.isStory ? 34 : 28,
        }}
      >
        {l.bandLabel}
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
export function NameBlock({
  l,
  accent,
  roleName,
  align,
  nameSize,
}: {
  l: CardLayout;
  accent: string;
  roleName: string;
  align: "left" | "center";
  nameSize: number;
}) {
  return (
    <div style={{ textAlign: align }}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: l.isStory ? 20 : 14,
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
          width: l.isStory ? 72 : 56,
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
        {l.title}
      </div>
      {/* No subtitle line. It carried the mode ("перки и экипировка") — and so
          does the band's own heading, so the centred layouts printed the same
          words twice, one above the other in two different colours. */}
    </div>
  );
}

/** The hairline and the two small labels along the bottom. */
export function Footer({ l, children }: { l: CardLayout; children: ReactNode }) {
  return (
    <div
      data-share-footer
      style={{ position: "absolute", left: l.margin, right: l.margin, bottom: l.isStory ? 372 : 52 }}
    >
      <div
        style={{
          height: 1,
          background: `linear-gradient(90deg, rgba(232,228,220,0) 0%, ${HAIRLINE_SOFT} 16%, ${HAIRLINE_SOFT} 84%, rgba(232,228,220,0) 100%)`,
          marginBottom: l.isStory ? 20 : 15,
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: l.isStory ? "center" : "space-between",
          alignItems: "baseline",
          fontFamily: MONO,
          fontSize: l.isStory ? 16 : 13,
          letterSpacing: l.isStory ? "0.12em" : "0.26em",
          textTransform: "uppercase",
        }}
      >
        {children}
      </div>
    </div>
  );
}
