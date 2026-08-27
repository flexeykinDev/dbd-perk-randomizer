import { withBasePath } from "@/lib/asset-path";
import { BONE, DISPLAY, HAIRLINE, HAIRLINE_SOFT } from "./share-card-theme";

/* One slot on the export card: the rotated-square icon frame and the label
 * under it.
 *
 * Pulled out of ShareCard because it is genuinely standalone — every value it
 * needs arrives as a prop, so it closes over none of the card's geometry —
 * and because the label-fitting rule beside it is the one piece of arithmetic
 * on the card that has an actual test pointed at it
 * (e2e/share-card.spec.ts). */

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
export function fitLabelSize(names: string[], slotWidth: number, desired: number) {
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
export function Diamond({
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
