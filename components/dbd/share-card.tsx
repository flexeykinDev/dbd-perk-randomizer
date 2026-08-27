import type { ReactNode, Ref } from "react";
import { getCharacterName } from "@/lib/character-name";
import { getCharacterPortrait } from "@/lib/perks";
import { ROLE_COLOR } from "@/lib/role-color";
import type { PerkRole } from "@/lib/types";

/** What the card grid actually needs from each item — a perk and a loadout
 *  piece (Item/Add-on/Offering) both satisfy this shape already, so the same
 *  grid renders either (or both concatenated, for "all" mode) without this
 *  component needing to know which kind of piece it's looking at. */
// Defined in share-card-types.ts so the pure layout module can name it too;
// re-exported here because this is where callers import it from.
export type { ShareCardPiece } from "./share-card-types";
import type { ShareCardPiece } from "./share-card-types";

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

// Defined in lib/types.ts; re-exported here because this is where
// callers have always imported it from.
export type { ShareCardLayout } from "@/lib/types";
import type { ShareCardLayout } from "@/lib/types";
import {
  FAINT,
  HAIRLINE,
  MOOD,
  QUIET,
  ROLE_LABEL,
} from "./share-card-theme";
import { landscapePortraitLayout, shareCardLayout } from "./share-card-layout";
import {
  Atmosphere,
  BackdropLayer,
  Band,
  FigureVeil,
  Footer,
  GroundWash,
  NameBlock,
  PortraitImage,
  shellStyle,
} from "./share-card-chrome";
import { DiamondGrid, LoadoutRow } from "./share-card-slots";


export function ShareCard({
  ref,
  pieces,
  mode,
  role,
  language,
  character,
  layout = "landscape",
  backdrop,
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
  /** A pre-rendered vortex for this build, as a data URI — see
   *  lib/ritual-backdrop.ts. Absent is a first-class case: WebGL can be
   *  unavailable, and the card is composed to look finished without it. */
  backdrop?: string | null;
}) {
  const accent = ROLE_COLOR[role].solid;
  const mood = MOOD[role];
  const roleName = ROLE_LABEL[role][language];
  const portrait = character ? getCharacterPortrait(character) : undefined;

  /* Every number on this card, worked out up front — see
     share-card-layout.ts. It is pure arithmetic and lives outside the
     component so it can be checked without rendering anything; a parity run
     over 504 layout/mode/piece-count combinations confirmed it matches the
     inline version it replaced field for field. */
  const L = shareCardLayout({
    layout,
    mode,
    role,
    language,
    pieces,
    character,
    title: character
      ? getCharacterName(character, language)
      : language === "ru"
        ? "Случайный билд"
        : "Random build",
  });
  const {
    width,
    isStory,
    margin,
    hasLoadout,
    perkPieces,
    portraitH,
    perkGem,
    loadUnit,
    perRow,
    bandWidth,
    count,
  } = L;

  /* Everything below used to be ten closures here, each reading a dozen of
     this component's locals off its scope. They live in share-card-chrome.tsx
     and share-card-slots.tsx now and take the layout object instead, which is
     what made pulling them out an improvement rather than a relocation. */
  const shell = shellStyle(L, mood, !!portrait);
  const atmosphere = <Atmosphere />;
  const backdropLayer = <BackdropLayer backdrop={backdrop} />;
  const figureVeil = <FigureVeil l={L} />;
  const groundWash = <GroundWash l={L} />;

  const grid = (items: ShareCardPiece[], gem: number, per: number, labelSize: number) => (
    <DiamondGrid l={L} language={language} mood={mood} items={items} gem={gem} perRow={per} labelSize={labelSize} />
  );
  const loadoutRow = (unit: number, labelSize: number) => (
    <LoadoutRow l={L} language={language} accent={accent} mood={mood} unit={unit} labelSize={labelSize} />
  );
  const nameBlock = (align: "left" | "center", nameSize: number) => (
    <NameBlock l={L} accent={accent} roleName={roleName} align={align} nameSize={nameSize} />
  );
  const band = ({ bandWidth: w, anchored, children }: { bandWidth: number | string; anchored: boolean; children: ReactNode }) => (
    <Band l={L} accent={accent} width={w} anchored={anchored}>{children}</Band>
  );

  const footer = (
    <Footer l={L}>
      {/* A readable address rather than a QR code: a code would mean a new
          dependency, and at the size it could occupy here it would need more
          contrast than this card has to spare. Story is too narrow to carry
          the full address — it wrapped onto two lines, which is the opposite
          of readable — so the vertical format keeps the wordmark alone and
          centred. */}
      {isStory ? (
        <span style={{ color: FAINT }}>flexeykindev.github.io/dbd-perk-randomizer</span>
      ) : (
        <>
          <span style={{ color: FAINT }}>dbd-randomizer</span>
          <span style={{ color: QUIET }}>flexeykindev.github.io/dbd-perk-randomizer</span>
        </>
      )}
    </Footer>
  );

  if (isStory) {
    // Story keeps clear of the top 8%, right 13% and bottom 20% that TikTok
    // and Reels cover with their own furniture.
    /* Story is 1080 wide and gives 172 of it back to TikTok's button column,
     * so the band has ~750px of usable room. A loadout at the landscape unit
     * size came out 832px wide: the slots overflowed their band and the
     * Add-on and Offering names printed on top of each other. These sizes are
     * solved backwards from the room, not copied from the landscape card. */
    return (
      <div ref={ref} style={shell}>
        {backdropLayer}
        {portrait ? (
          <>
            <PortraitImage l={L} src={portrait} />
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
            bandWidth,
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
    const { bandLeft, nameMax, nameSize } = landscapePortraitLayout(L);
    return (
      <div ref={ref} style={shell}>
        {backdropLayer}
        <PortraitImage l={L} src={portrait} />
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
            bandWidth,
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

        {/* Bounded by where the band starts. Unbounded, the block was as wide
            as its widest line, which for a long killer name ("Торговка
            черепами" sets ~880px at 104px) reached under the band — and the
            title sat only 9px below the band's bottom edge in "all" mode, so
            it was one slightly taller band away from printing through it.
            Capped, a long name wraps instead, and since the block is anchored
            from the bottom it grows up into empty frame — except a name that
            is one long WORD ("Демогоргон") has nowhere to wrap, so the size
            comes down to meet the space as well. */}
        <div
          style={{
            position: "absolute",
            left: margin,
            bottom: 132,
            maxWidth: nameMax,
          }}
        >
          {nameBlock("left", nameSize)}
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
      {backdropLayer}
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
