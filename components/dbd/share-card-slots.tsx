import { MONO, NATIVE_ICON } from "./share-card-theme";
import { Diamond, fitLabelSize } from "./share-card-diamond";
import type { CardLayout } from "./share-card-layout";
import type { ShareCardPiece } from "./share-card-types";

/* The two ways frames are arranged on the card: a wrapped run of perks, and
 * the loadout laid out the way the game lays it out. */

/** A wrapped run of diamonds at an explicit width.
 *
 *  The width is always `perRow * slot` and never left to the container. Fixed
 *  sizes plus flex-wrap in an unconstrained box is how this layout broke four
 *  separate times — a row wide enough for three put a "2x2" out as 3 + 1, and
 *  eight pieces once came out as one line of eight. */
export function DiamondGrid({
  l,
  language,
  mood,
  items,
  gem,
  perRow,
  labelSize,
}: {
  l: CardLayout;
  language: "en" | "ru";
  mood: { rgb: string };
  items: ShareCardPiece[];
  gem: number;
  perRow: number;
  labelSize: number;
}) {
  const slot = l.slotFor(gem);
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
 *  the size of a large (Item / Power / Offering) diamond; add-ons come out at
 *  72% of it, roughly the ratio the site's own slot row uses. */
export function LoadoutRow({
  l,
  language,
  accent,
  mood,
  unit,
  labelSize,
}: {
  l: CardLayout;
  language: "en" | "ru";
  accent: string;
  mood: { rgb: string };
  unit: number;
  labelSize: number;
}) {
  const small = Math.round(unit * 0.72);
  // Every slot's frame area is as tall as the largest diamond's, so the
  // Add-ons sit centred against the Item and all four labels share a line.
  const bigBox = Math.round(unit * 1.4143);
  const frameHeight = bigBox + Math.round(bigBox * 0.13);
  /* Equal frame heights are not enough on their own: a gap and a type size
     derived per-diamond still start the small slots' labels a few pixels
     higher. One gap for the whole row is what actually puts them on a line. */
  const rowLabelGap = Math.max(12, Math.round(unit * 0.15));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: l.groupGap,
      }}
    >
      {l.slotGroups.map((group) => {
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
                  slotWidth={l.slotFor(g)}
                  labelGap={rowLabelGap}
                  /* Sized per group: the Add-on slots are the narrowest and
                     carry some of the longest names. The label TOP is fixed by
                     frameHeight + rowLabelGap, so a smaller size here still
                     starts on the row's shared line. */
                  labelSize={fitLabelSize(
                    group.pieces.map((p) => p.name[language]),
                    l.slotFor(g),
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
