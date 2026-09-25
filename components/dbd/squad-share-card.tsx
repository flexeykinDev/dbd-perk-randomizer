import type { Ref } from "react";
import { ROLE_COLOR } from "@/lib/role-color";
import type { PerkRole } from "@/lib/types";
import { Atmosphere, BackdropLayer } from "./share-card-chrome";
import { Diamond, fitLabelSize } from "./share-card-diamond";
import { squadShareCardLayout } from "./share-card-layout";
import {
  BONE,
  DISPLAY,
  FAINT,
  GROUND,
  HAIRLINE_SOFT,
  MONO,
  MOOD,
  QUIET,
  ROLE_LABEL,
} from "./share-card-theme";
import type { ShareCardPiece } from "./share-card-types";

/* The squad export card: one labelled row per player, four builds on one
 * poster.
 *
 * Every constraint share-card.tsx documents applies here unchanged, and for
 * the same reason — this is rasterised by the same html2canvas 1.4.x. No
 * Tailwind, no CSS variables, no filters, no box-shadow, no grid. Literal hex
 * and rgba set inline, gradients for anything that wants to glow. If that
 * file's header is news, read it before touching this one.
 *
 * What is deliberately absent is the portrait composition. The single-build
 * card is built around one character standing beside one build; four builds
 * have no single character to stand beside, so the figure, the anchored band
 * and the name block are gone and the card is just its contents. The
 * arithmetic that replaces them is squadShareCardLayout in
 * share-card-layout.ts, where it can be tested without a renderer.
 */
export function SquadShareCard({
  ref,
  builds,
  role,
  language,
  backdrop,
}: {
  ref?: Ref<HTMLDivElement>;
  /** One build per player, in player order. */
  builds: ShareCardPiece[][];
  role: PerkRole;
  language: "en" | "ru";
  /** A pre-rendered vortex, as a data URI — see lib/ritual-backdrop.ts.
   *  Absent is a first-class case, exactly as on the single-build card. */
  backdrop?: string | null;
}) {
  const accent = ROLE_COLOR[role].solid;
  const mood = MOOD[role];
  const L = squadShareCardLayout({
    language,
    builds,
    title: language === "ru" ? "Билды на группу" : "Squad builds",
  });

  /* One label size for the whole card rather than per row. The rows sit
     directly above one another, so sizing each to its own longest word makes
     the type step up and down the card — the same thing that was fixed inside
     a single loadout row by passing a shared frameHeight. */
  const labelSize = fitLabelSize(
    builds.flat().map((piece) => piece.name[language]),
    L.slotWidth,
    L.labelSize,
  );

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        width: L.width,
        height: L.height,
        overflow: "hidden",
        // Centred glow, not the portrait card's off-centre one: there is no
        // figure on the right for it to sit behind.
        background: `radial-gradient(ellipse 86% 76% at 50% 40%, rgba(${mood.rgb},0.13), rgba(${mood.rgb},0) 68%), ${GROUND}`,
        color: BONE,
        fontFamily: DISPLAY,
        textAlign: "left",
      }}
    >
      <BackdropLayer backdrop={backdrop} />

      {/* Heading. Left-aligned against the same margin the rows start at, so
          the card has one vertical line rather than a centred title over
          left-aligned content. */}
      <div style={{ position: "absolute", left: L.margin, right: L.margin, top: L.margin }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 15,
            letterSpacing: "0.26em",
            textTransform: "uppercase",
            color: QUIET,
          }}
        >
          {ROLE_LABEL[role][language]} · {L.bandLabel}
        </div>
        <div
          style={{
            fontSize: 62,
            lineHeight: 1.05,
            fontWeight: 600,
            marginTop: 6,
            color: BONE,
          }}
        >
          {L.title}
        </div>
        <div
          style={{
            height: 3,
            width: 96,
            marginTop: 16,
            background: `linear-gradient(90deg, ${accent}, rgba(${mood.rgb},0))`,
          }}
        />
      </div>

      {/* The rows themselves. Absolutely positioned as a block rather than
          flowed, so the heading above can never push them off the card. */}
      <div
        style={{
          position: "absolute",
          left: L.margin,
          right: L.margin,
          top: L.margin + 168,
        }}
      >
        {L.rows.map((row, i) => (
          <div
            key={i}
            data-squad-row
            style={{
              height: L.rowHeight,
              marginTop: i === 0 ? 0 : L.rowGap,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontFamily: MONO,
                fontSize: 14,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: FAINT,
                marginBottom: 4,
              }}
            >
              <span>{row.label}</span>
              <span
                style={{
                  flex: 1,
                  height: 1,
                  background: `linear-gradient(90deg, ${HAIRLINE_SOFT}, rgba(232,228,220,0))`,
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-start" }}>
              {row.pieces.map((piece) => (
                <Diamond
                  key={piece.slug}
                  src={piece.icon}
                  label={piece.name[language]}
                  gemSize={L.gem}
                  iconSize={L.iconSize}
                  slotWidth={L.slotWidth}
                  labelGap={L.labelGap}
                  labelSize={labelSize}
                  mood={mood}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div
        data-share-footer
        style={{ position: "absolute", left: L.margin, right: L.margin, bottom: 52 }}
      >
        <div
          style={{
            height: 1,
            background: `linear-gradient(90deg, rgba(232,228,220,0) 0%, ${HAIRLINE_SOFT} 16%, ${HAIRLINE_SOFT} 84%, rgba(232,228,220,0) 100%)`,
            marginBottom: 15,
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            fontFamily: MONO,
            fontSize: 13,
            letterSpacing: "0.26em",
            textTransform: "uppercase",
          }}
        >
          <span style={{ color: QUIET }}>
            {language === "ru" ? "Без повторов перков" : "No perk twice"}
          </span>
          <span style={{ color: FAINT }}>flexeykindev.github.io/dbd-perk-randomizer</span>
        </div>
      </div>

      <Atmosphere />
    </div>
  );
}
