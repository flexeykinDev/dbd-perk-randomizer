import { getKillerPowerIcon } from "@/lib/loadout";
import { ruPlural, type Lang } from "@/lib/i18n";
import type { PerkRole, ShareCardLayout } from "@/lib/types";
import { BAND_PAD_L, BAND_PAD_R, CANVAS_SIZE } from "./share-card-metrics";
import type { ShareCardPiece } from "./share-card-types";

/* Every number on the export card, worked out before a single element is
 * rendered.
 *
 * This is the part of the card that is arithmetic rather than markup, and it
 * is the part that has actually broken: fixed sizes plus flex-wrap in an
 * unconstrained box put a "2x2" out as 3 + 1, put eight pieces on one line,
 * and once printed the Add-on and Offering names on top of each other because
 * a loadout sized for the landscape card overflowed the story band. Four
 * separate times, each found by looking at an export.
 *
 * Pulled out of the component so it can be checked without rendering
 * anything — see share-card-layout.test.ts. e2e/share-card.spec.ts still
 * measures 72 real layouts in a browser, which is the only thing that can
 * catch a label colliding with its neighbour; this is what makes the
 * arithmetic itself inspectable.
 */

export interface SlotGroup {
  label: { ru: string; en: string };
  pieces: ShareCardPiece[];
  /** Item, Power and Offering are drawn large; Add-ons at 72% of them, which
   *  is roughly the ratio the site's own loadout row uses. */
  big: boolean;
}

export interface CardLayout {
  width: number;
  height: number;
  isStory: boolean;
  /** Page margin, and the left/right inset the footer sits at. */
  margin: number;

  /* Portrait geometry. The sources are square and only 256x256, so all of
     these are a compromise with resolution: landscape bleeds the figure off
     the left at full card height, a 3.5x upscale (7x once the export
     doubles). `cover` on a square source in a 3:4 box fits the HEIGHT
     exactly, so nothing is cropped vertically and no top fade is needed. */
  portraitW: number;
  portraitH: number;
  portraitLeft: number;
  portraitRight: number;

  /** The band's heading — the card's one statement of what it is showing. */
  bandLabel: string;
  /** The character's name, or "Random build". */
  title: string;
  /** How many frames the card is showing, floored at 1 so it can divide. */
  count: number;

  slotGroups: SlotGroup[];
  hasLoadout: boolean;
  /** The rolled perks, i.e. the pieces with no `kind`. */
  perkPieces: ShareCardPiece[];

  /** Diamond and band sizes for this layout and mode. */
  perkGem: number;
  loadUnit: number;
  /** How many perk diamonds fit on a row before wrapping. */
  perRow: number;
  /** The band's outer width: its contents plus its own padding. */
  bandWidth: number;

  /** How wide a slot is, including the gutter that buys its label room. */
  slotFor: (gem: number) => number;
  /** Gap between slot groups in the loadout row. */
  groupGap: number;
}

const GUTTER = { story: 36, allMode: 44, other: 26 } as const;

function bandHeading(
  mode: "perks" | "loadout" | "all",
  language: Lang,
  perkCount: number,
): string {
  if (mode === "loadout") return language === "ru" ? "Экипировка" : "Loadout";
  if (mode === "all") return language === "ru" ? "Перки и экипировка" : "Perks & loadout";
  // Perks mode counts them, since the heading alone does not say what they are.
  return language === "ru"
    ? `${perkCount} ${ruPlural(perkCount, "перк", "перка", "перков")}`
    : `${perkCount} ${perkCount === 1 ? "perk" : "perks"}`;
}

function buildSlotGroups(
  pieces: ShareCardPiece[],
  role: PerkRole,
  character: string | null | undefined,
  mode: "perks" | "loadout" | "all",
): SlotGroup[] {
  /* Killers have no Item — they have their Power, which is not one of the
     rolled pieces but is exactly what the site shows in that slot. */
  const powerIcon =
    role === "killer" && character && mode !== "perks" ? getKillerPowerIcon(character) : undefined;
  return [
    ...(powerIcon
      ? [
          {
            label: { ru: "Сила", en: "Power" },
            pieces: [{ slug: "power", icon: powerIcon, name: { ru: "", en: "" } }],
            big: true,
          },
        ]
      : []),
    { label: { ru: "Предмет", en: "Item" }, pieces: pieces.filter((p) => p.kind === "item"), big: true },
    { label: { ru: "Аддоны", en: "Add-ons" }, pieces: pieces.filter((p) => p.kind === "addon"), big: false },
    {
      label: { ru: "Подношение", en: "Offering" },
      pieces: pieces.filter((p) => p.kind === "offering"),
      big: true,
    },
  ].filter((g) => g.pieces.length > 0);
}

export function shareCardLayout({
  layout,
  mode,
  role,
  language,
  pieces,
  character,
  title,
}: {
  layout: ShareCardLayout;
  mode: "perks" | "loadout" | "all";
  role: PerkRole;
  language: Lang;
  pieces: ShareCardPiece[];
  character?: string | null;
  /** Already localized by the caller, which owns the name lookup. */
  title: string;
}): CardLayout {
  const isStory = layout === "story";
  const { width, height } = CANVAS_SIZE[layout];
  const count = Math.max(pieces.length, 1);

  const gutter = isStory ? GUTTER.story : mode === "all" ? GUTTER.allMode : GUTTER.other;
  const slotFor = (gem: number) => Math.round(gem * 1.4143) + gutter;
  const groupGap = isStory ? 30 : 40;

  const slotGroups = buildSlotGroups(pieces, role, character, mode);
  const hasLoadout = slotGroups.length > 0;
  const perkPieces = pieces.filter((p) => !p.kind);

  /* Story is 1080 wide and gives 172 of it back to TikTok's button column, so
     the band has ~750px of usable room. A loadout at the landscape unit size
     came out 832px wide and overflowed. These sizes are solved backwards from
     the room available, not copied from the landscape card. */
  const perkGem = isStory ? (mode === "all" ? 104 : 150) : mode === "all" ? 84 : 118;
  const loadUnit = isStory ? (mode === "all" ? 88 : 104) : mode === "all" ? 76 : 118;
  const maxPerRow = isStory ? 2 : 4;
  const perRow = isStory
    ? perkPieces.length > 2
      ? 2
      : perkPieces.length || 1
    : maxPerRow;

  /** How wide a run of diamonds actually comes out — used to size the band to
   *  its contents rather than stretching it across the card and leaving a
   *  third of it visibly empty. */
  const rowWidth = (items: ShareCardPiece[], gem: number, per: number) =>
    Math.min(items.length || 1, per) * slotFor(gem);
  const loadoutWidth = (unit: number) =>
    slotGroups.reduce(
      (w, g, i) =>
        w + g.pieces.length * slotFor(g.big ? unit : Math.round(unit * 0.72)) + (i ? groupGap : 0),
      0,
    );

  const contentWidth =
    mode === "loadout"
      ? loadoutWidth(loadUnit)
      : mode === "all" && hasLoadout
        ? Math.max(rowWidth(perkPieces, perkGem, maxPerRow), loadoutWidth(loadUnit))
        : rowWidth(pieces, perkGem, perRow);

  const portraitW = isStory ? 640 : 700;
  const portraitLeft = isStory ? -50 : -70;

  return {
    width,
    height,
    isStory,
    margin: 84,
    portraitW,
    portraitH: isStory ? 853 : height,
    portraitLeft,
    portraitRight: portraitLeft + portraitW,
    bandLabel: bandHeading(mode, language, count),
    title,
    count,
    slotGroups,
    hasLoadout,
    perkPieces,
    perkGem,
    loadUnit,
    perRow,
    bandWidth: contentWidth + BAND_PAD_L + BAND_PAD_R,
    slotFor,
    groupGap,
  };
}

/** Where the landscape band sits, and how big the name beside it can be.
 *
 *  Split from the layout above because it only applies to the portrait
 *  composition: the band is sized to its contents and then centred in the room
 *  the figure leaves. Pinning it left-to-right instead stretched it across the
 *  whole right half and left a third of it empty in every mode but "all". */
export function landscapePortraitLayout(l: CardLayout): {
  bandLeft: number;
  /** The widest the name block may be before it runs into the band. */
  nameMax: number;
  nameSize: number;
} {
  const regionL = l.portraitRight + 30;
  const regionR = l.width - l.margin;
  const bandLeft = Math.round(regionL + Math.max(0, (regionR - regionL - l.bandWidth) / 2));

  /* The name gets whatever the band leaves, and shrinks if its longest WORD
     will not fit that. A two-word name wraps; "Демогоргон" has nowhere to
     break and simply ran past the cap. Same per-character factor as
     fitLabelSize, calibrated against real exports. */
  const nameMax = bandLeft - l.margin - 40;
  const longestWord = Math.max(1, ...l.title.split(/\s+/).map((w) => w.length));
  const nameSize = Math.max(52, Math.min(104, Math.floor(nameMax / (longestWord * 0.62))));
  return { bandLeft, nameMax, nameSize };
}
