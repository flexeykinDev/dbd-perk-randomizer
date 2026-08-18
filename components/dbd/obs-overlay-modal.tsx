"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  MessageCircle,
  MonitorPlay,
  RotateCcw,
  Search,
  Wrench,
  X,
} from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { withBasePath } from "@/lib/asset-path";
import { getCharacterName } from "@/lib/character-name";
import { cn } from "@/lib/cn";
import { useT, type Lang } from "@/lib/i18n";
import { getIdForSlug } from "@/lib/perk-ids";
import { getCharacterPortrait, getPerksByRole } from "@/lib/perks";
import type {
  TwitchConnectionState,
  TwitchPermission,
} from "@/lib/twitch-chat";
import type { LoadoutPiece, Perk, PerkRole } from "@/lib/types";
import { ToggleSwitch } from "./toggle-switch";
import {
  DEFAULT_OBS_OPTIONS,
  MAX_CHARACTER_SCALE,
  MAX_OBS_NAME_SCALE,
  MAX_OBS_SCALE,
  MIN_CHARACTER_SCALE,
  MIN_OBS_NAME_SCALE,
  MIN_OBS_SCALE,
  obsOverlayUrl,
  type ObsIconPosition,
} from "@/lib/use-obs-mode";

const TWITCH_STATE_LABEL: Record<
  TwitchConnectionState,
  { ru: string; en: string }
> = {
  disconnected: { ru: "Отключено", en: "Disconnected" },
  connecting: { ru: "Подключение…", en: "Connecting…" },
  connected: { ru: "Подключено", en: "Connected" },
  error: { ru: "Ошибка подключения", en: "Connection error" },
};

const TWITCH_STATE_DOT: Record<TwitchConnectionState, string> = {
  disconnected: "bg-muted",
  connecting: "bg-amber-400 animate-pulse",
  connected: "bg-emerald-400",
  error: "bg-red-500",
};

const PERMISSION_LABEL: Record<TwitchPermission, { ru: string; en: string }> = {
  everyone: { ru: "Все в чате", en: "Everyone in chat" },
  subs_vips: { ru: "Только подписчики/VIP", en: "Subs/VIPs only" },
  mods: { ru: "Только модераторы", en: "Moderators only" },
};

// The 8-slot grid a fresh (never-dragged) icon lands on inside the preview —
// also what a partially-customized `positions` array falls back to for any
// slot that hasn't been dragged yet, so the preview and the real overlay
// always agree on where an untouched icon sits. 8, not 4: "all" mode's
// combined perks+loadout view can carry up to 4 perks + 4 loadout pieces at
// once (see randomizer-board.tsx's publish effect), and this used to only
// have positions for the first 4 — pieces past that fell back to the last
// defined slot and stacked on top of each other in a real OBS scene.
//
// Row y-positions sit at 28/76 (not 50/85) — with 8 slots each carrying an
// icon *and* a 2-line label underneath, the old 35%-of-height gap between
// rows was smaller than the label+icon's actual pixel footprint at the
// preview's old size, so row 1's labels overlapped row 2's icons. 48%
// separation plus the taller preview box below (see PREVIEW_MIN_HEIGHT_PX)
// gives both rows real breathing room instead.
const DEFAULT_SLOT_POSITIONS: readonly ObsIconPosition[] = [
  { x: 12.5, y: 33 },
  { x: 37.5, y: 33 },
  { x: 62.5, y: 33 },
  { x: 87.5, y: 33 },
  { x: 12.5, y: 78 },
  { x: 37.5, y: 78 },
  { x: 62.5, y: 78 },
  { x: 87.5, y: 78 },
];

const MIN_CANVAS_WIDTH = 320;
const MAX_CANVAS_WIDTH = 1920;
const MIN_CANVAS_HEIGHT = 120;
const MAX_CANVAS_HEIGHT = 800;

/** Which loadout piece kinds (plus perks) are shown in the OBS overlay and
 *  in Download Image — see the `pieceVisibility` prop doc above for why
 *  this is separate from the Слоты toggles that decide what gets rolled.
 *  Owned by randomizer-board.tsx; declared here since this modal is the
 *  only place that renders the toggle UI for it. */
export interface PieceVisibility {
  perks: boolean;
  item: boolean;
  addon: boolean;
  offering: boolean;
}

type StyleId = "compact" | "standard" | "roomy" | "custom";

interface StylePreset {
  id: Exclude<StyleId, "custom">;
  label: { ru: string; en: string };
  description: { ru: string; en: string };
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  nameScale: number;
}

// Canvas size, icon scale, and name width used to be 3 independent dials —
// easy to land on a combination that looks bad (e.g. a small canvas with a
// wide name box, or a big canvas with tiny icons floating in empty space).
// These 3 presets are each a tested, coherent look; "Roomy" is what testing
// showed actually looks good in a real OBS scene, so it's also this
// component's default (see DEFAULT_CANVAS_WIDTH/HEIGHT below and
// DEFAULT_OBS_OPTIONS in lib/use-obs-mode.ts).
const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: "compact",
    label: { ru: "Компакт", en: "Compact" },
    description: {
      ru: "Минимум места — для тесных сцен",
      en: "Minimal footprint — for tight scenes",
    },
    canvasWidth: 800,
    canvasHeight: 220,
    scale: 90,
    nameScale: 110,
  },
  {
    id: "standard",
    label: { ru: "Стандарт", en: "Standard" },
    description: {
      ru: "Сбалансированный размер для большинства сцен",
      en: "Balanced size for most scenes",
    },
    canvasWidth: 900,
    canvasHeight: 300,
    scale: 115,
    nameScale: 145,
  },
  {
    id: "roomy",
    label: { ru: "Просторно", en: "Roomy" },
    description: {
      ru: "Крупные карточки, имена никогда не жмутся",
      en: "Large cards, names never cramped",
    },
    canvasWidth: 1100,
    canvasHeight: 420,
    scale: 135,
    nameScale: 170,
  },
];
const DEFAULT_STYLE = STYLE_PRESETS.find((p) => p.id === "roomy")!;
const DEFAULT_CANVAS_WIDTH = DEFAULT_STYLE.canvasWidth;
const DEFAULT_CANVAS_HEIGHT = DEFAULT_STYLE.canvasHeight;

const PREVIEW_BASE_ICON_PX = 34;
const PREVIEW_BASE_NAME_MAX_WIDTH_PX = 56;
// A floor under the aspect-ratio-derived height below — at the modal's old
// width, a wide/short canvas preset (e.g. "Roomy" at ~2.6:1) rendered the
// preview box at ~180px tall, too short for two rows of icon+label to fit
// without overlapping (see the DEFAULT_SLOT_POSITIONS comment above).
// aspect-ratio still wins whenever it would make the box *taller* than
// this — this only kicks in as a minimum, not a fixed height.
const PREVIEW_MIN_HEIGHT_PX = 260;
const PREVIEW_BASE_CHARACTER_PX = 28;
// Bottom-left, inset from the edge — mirrors obs-overlay.tsx's own
// pre-drag fallback (a fixed `bottom-4 left-4` corner) in the same 0-100
// percentage space the rest of the preview positions use, so an
// untouched character badge starts in roughly the same spot the real
// overlay would put it before ever being dragged.
const DEFAULT_CHARACTER_POSITION: ObsIconPosition = { x: 8, y: 90 };

function PermissionSelect({
  value,
  onChange,
}: {
  value: TwitchPermission;
  onChange: (value: TwitchPermission) => void;
}) {
  const t = useT();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as TwitchPermission)}
      className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground focus:ring-2 focus:ring-accent/40 focus:outline-none"
    >
      {(["everyone", "subs_vips", "mods"] as const).map((option) => (
        <option key={option} value={option}>
          {t(PERMISSION_LABEL[option])}
        </option>
      ))}
    </select>
  );
}

export function ObsOverlayModal({
  open,
  onClose,
  perks,
  mode,
  loadoutPieces,
  language,
  role,
  character,
  pieceVisibility,
  onPieceVisibilityChange,
  twitchChannel,
  twitchEnabled,
  twitchState,
  onTwitchChannelChange,
  onTwitchToggle,
  twitchRerollCommand,
  twitchRerollPermission,
  twitchCooldownSec,
  twitchPasteEnabled,
  twitchPasteCommand,
  twitchPastePermission,
  onTwitchRerollCommandChange,
  onTwitchRerollPermissionChange,
  onTwitchCooldownSecChange,
  onTwitchPasteToggle,
  onTwitchPasteCommandChange,
  onTwitchPastePermissionChange,
}: {
  open: boolean;
  onClose: () => void;
  perks: Perk[];
  /** Which build the live preview below should mirror — matches whatever's
   *  actually being published to the overlay (see randomizer-board.tsx's
   *  publish effect), so the preview never shows something the real
   *  overlay wouldn't. */
  mode: "perks" | "loadout" | "all";
  loadoutPieces: LoadoutPiece[];
  language: Lang;
  role: PerkRole;
  /** The build's character, if one is known — see randomizer-board.tsx's
   *  `shareCharacter`. Drives the draggable/scroll-resizable portrait
   *  badge in the preview below and in the real overlay. */
  character?: string | null;
  /** Which piece kinds to actually show in the overlay and in Download
   *  Image — independent of `loadoutSlots` (which controls what gets
   *  *rolled* in the first place). Owned by randomizer-board.tsx, not
   *  local state here, since it also filters ShareCard's export. */
  pieceVisibility: PieceVisibility;
  onPieceVisibilityChange: (
    kind: keyof PieceVisibility,
    value: boolean,
  ) => void;
  twitchChannel: string;
  twitchEnabled: boolean;
  twitchState: TwitchConnectionState;
  onTwitchChannelChange: (channel: string) => void;
  onTwitchToggle: (enabled: boolean) => void;
  twitchRerollCommand: string;
  twitchRerollPermission: TwitchPermission;
  twitchCooldownSec: number;
  twitchPasteEnabled: boolean;
  twitchPasteCommand: string;
  twitchPastePermission: TwitchPermission;
  onTwitchRerollCommandChange: (command: string) => void;
  onTwitchRerollPermissionChange: (permission: TwitchPermission) => void;
  onTwitchCooldownSecChange: (seconds: number) => void;
  onTwitchPasteToggle: (enabled: boolean) => void;
  onTwitchPasteCommandChange: (command: string) => void;
  onTwitchPastePermissionChange: (permission: TwitchPermission) => void;
}) {
  const t = useT();
  const titleId = useId();
  const descId = useId();
  const cardSizeSliderId = useId();
  const nameWidthSliderId = useId();
  const canvasWidthId = useId();
  // A single shared live region announces whichever copy action just
  // succeeded — screen reader users get the same "it worked" feedback
  // sighted users get from the checkmark icon, without needing one
  // aria-live region per copy button.
  const [announcement, setAnnouncement] = useState("");
  const [copied, setCopied] = useState(false);
  const [pasteCommandCopied, setPasteCommandCopied] = useState(false);
  // "roomy" by default — matches DEFAULT_OBS_OPTIONS, so a link nobody has
  // customized yet still renders the good-looking combo. Switches to
  // "custom" only when the Custom tab is explicitly chosen; the 3 named
  // presets stay mutually exclusive with it.
  const [styleMode, setStyleMode] = useState<StyleId>("roomy");
  const [scale, setScale] = useState(DEFAULT_OBS_OPTIONS.scale);
  const [nameScale, setNameScale] = useState(DEFAULT_OBS_OPTIONS.nameScale);
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_CANVAS_WIDTH);
  const [canvasHeight, setCanvasHeight] = useState(DEFAULT_CANVAS_HEIGHT);
  const [showNames, setShowNames] = useState(DEFAULT_OBS_OPTIONS.showNames);
  const [showCharacter, setShowCharacter] = useState(
    DEFAULT_OBS_OPTIONS.showCharacter,
  );
  const [darkBg, setDarkBg] = useState(
    DEFAULT_OBS_OPTIONS.background === "dark",
  );
  // null = no custom layout yet, overlay falls back to its default centered
  // row. Set the first time the user drags any icon in the preview below.
  const [positions, setPositions] = useState<ObsIconPosition[] | null>(null);
  // Same "no override yet" convention as `positions`, but for the
  // character badge — it isn't one of the numbered perk/loadout slots
  // (see obs-overlay.tsx's CharacterBadge), so it needs its own position
  // and its own independent size (set by scrolling over it, not the
  // shared "Card size" slider).
  const [characterPosition, setCharacterPosition] =
    useState<ObsIconPosition | null>(null);
  const [characterScale, setCharacterScale] = useState(
    DEFAULT_OBS_OPTIONS.characterScale,
  );
  // Splits the modal into tabs instead of one long scroll — the Twitch
  // chat section (channel connect, commands) and the perk-build
  // constructor used to both render inline (the constructor nested three
  // levels deep inside Twitch → Advanced → "paste enabled"), which is most
  // of what made this modal feel overwhelming (user feedback: "too much
  // content", and separately, the constructor being "very deep hidden").
  // Each is opt-in/occasional, so a tab click replaces either a page of
  // scroll or a multi-step reveal.
  const [panelTab, setPanelTab] = useState<
    "overlay" | "twitch" | "constructor"
  >("overlay");
  const [obsSetupOpen, setObsSetupOpen] = useState(false);
  const [twitchAdvancedOpen, setTwitchAdvancedOpen] = useState(false);
  const [constructorRole, setConstructorRole] = useState<PerkRole>(role);
  const [constructorSearch, setConstructorSearch] = useState("");
  const [constructorSelected, setConstructorSelected] = useState<Perk[]>([]);
  const [constructorCopied, setConstructorCopied] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  // Only computed while actually open — obsOverlayUrl() creates a room code
  // as a side effect (see getOrCreateRoomCode), and this component stays
  // mounted (just hidden) while closed, including briefly on every normal
  // page load before useIsObsMode() corrects itself. Computing it
  // unconditionally would silently mint/overwrite a room code on every
  // visit to the site, not just when someone actually opens this modal.
  const url = open
    ? obsOverlayUrl({
        scale,
        nameScale,
        showNames,
        showCharacter,
        background: darkBg ? "dark" : "transparent",
        positions: positions ?? undefined,
        characterPosition: characterPosition ?? undefined,
        characterScale,
      })
    : "";

  function handleCopy() {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setAnnouncement(t({ ru: "Ссылка скопирована", en: "Link copied" }));
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  // The exact !paste command that hands out whatever build is currently on
  // screen — built from perk IDs (same short numeric IDs the site's own
  // Share links use), so a streamer/mod can read it out or pin it verbatim
  // instead of having to go grab a Share link and copy numbers out of it.
  const pasteCommandForBuild = useMemo(() => {
    const ids = perks
      .map((p) => getIdForSlug(p.slug))
      .filter((id): id is number => id !== undefined);
    if (ids.length === 0) return null;
    return `${twitchPasteCommand.trim() || "!paste"} ${ids.join(",")}`;
  }, [perks, twitchPasteCommand]);

  function handleCopyPasteCommand() {
    if (!pasteCommandForBuild) return;
    navigator.clipboard
      .writeText(pasteCommandForBuild)
      .then(() => {
        setPasteCommandCopied(true);
        setAnnouncement(t({ ru: "Команда скопирована", en: "Command copied" }));
        setTimeout(() => setPasteCommandCopied(false), 2000);
      })
      .catch(() => {});
  }

  // A sandbox for building a !paste command from scratch — independent of
  // whatever build happens to be showing on the main site right now, e.g.
  // to prepare an announcement build ahead of time. Perks toggle in/out of
  // a 4-slot selection; switching role clears it since a build can't mix
  // survivor and killer perks.
  const constructorPerks = useMemo(
    () => getPerksByRole(constructorRole),
    [constructorRole],
  );
  const constructorFiltered = useMemo(() => {
    const query = constructorSearch.trim().toLowerCase();
    if (!query) return constructorPerks;
    return constructorPerks.filter((perk) =>
      `${perk.name.en} ${perk.name.ru}`.toLowerCase().includes(query),
    );
  }, [constructorPerks, constructorSearch]);

  function toggleConstructorPerk(perk: Perk) {
    setConstructorSelected((prev) => {
      if (prev.some((p) => p.slug === perk.slug))
        return prev.filter((p) => p.slug !== perk.slug);
      if (prev.length >= 4) return prev;
      return [...prev, perk];
    });
  }

  function setConstructorRoleAndClear(nextRole: PerkRole) {
    setConstructorRole(nextRole);
    setConstructorSelected([]);
  }

  const constructorCommand = useMemo(() => {
    const ids = constructorSelected
      .map((p) => getIdForSlug(p.slug))
      .filter((id): id is number => id !== undefined);
    if (ids.length === 0) return null;
    return `${twitchPasteCommand.trim() || "!paste"} ${ids.join(",")}`;
  }, [constructorSelected, twitchPasteCommand]);

  function handleCopyConstructorCommand() {
    if (!constructorCommand) return;
    navigator.clipboard
      .writeText(constructorCommand)
      .then(() => {
        setConstructorCopied(true);
        setAnnouncement(t({ ru: "Команда скопирована", en: "Command copied" }));
        setTimeout(() => setConstructorCopied(false), 2000);
      })
      .catch(() => {});
  }

  // Shared by every draggable element in the preview (perk/loadout slots
  // and the character badge) — converts a pointer position into the same
  // 0-100 percentage coordinate space the overlay itself uses for
  // `positions`/`characterPosition`.
  function clientToPercent(clientX: number, clientY: number): ObsIconPosition {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return { x: 50, y: 50 };
    return {
      x: Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)),
    };
  }

  function handleDrag(index: number, clientX: number, clientY: number) {
    const pos = clientToPercent(clientX, clientY);
    setPositions((prev) => {
      const base = prev ? [...prev] : [...DEFAULT_SLOT_POSITIONS];
      base[index] = pos;
      return base;
    });
  }

  function handleCharacterDrag(clientX: number, clientY: number) {
    setCharacterPosition(clientToPercent(clientX, clientY));
  }

  // Scroll-to-resize instead of a slider — the character badge is a single
  // element with its own free-floating position, so adjusting it in place
  // (hover + wheel) reads more directly than hunting for a separate
  // control elsewhere in the modal for just this one piece.
  function handleCharacterWheel(deltaY: number) {
    setCharacterScale((prev) =>
      Math.min(
        MAX_CHARACTER_SCALE,
        Math.max(MIN_CHARACTER_SCALE, Math.round(prev - deltaY / 4)),
      ),
    );
  }

  // The overlay itself renders whatever publishObsState() last sent it,
  // which mirrors the current mode *and* the "Показывать:" visibility
  // toggles (see randomizer-board.tsx's visiblePerks/visibleLoadoutPieces) —
  // the preview needs to mirror that exact same filtered list, not the raw
  // `perks`/`loadoutPieces` props (which stay unfiltered here because the
  // Twitch !paste command and Constructor tab below intentionally hand out
  // the full rolled build regardless of what's hidden from the overlay).
  // Filtering anywhere else would desync the dragged slot *positions* from
  // reality: positions are assigned by array index, so if the modal drags
  // positions against an 8-item unfiltered list while the real overlay
  // renders a 7-item filtered one, every piece after a hidden one silently
  // renders at the position dragged for a different piece.
  const visiblePreviewPerks = pieceVisibility.perks ? perks : [];
  const visiblePreviewLoadoutPieces = loadoutPieces.filter(
    (p) => pieceVisibility[p.kind],
  );
  const previewPieces: {
    slug: string;
    icon: string;
    name: { en: string; ru: string };
  }[] =
    mode === "loadout"
      ? visiblePreviewLoadoutPieces
      : mode === "all"
        ? [...visiblePreviewPerks, ...visiblePreviewLoadoutPieces]
        : visiblePreviewPerks;
  // Capped at 8 — DEFAULT_SLOT_POSITIONS has exactly that many entries,
  // enough for "all" mode's largest possible combined list (4 perks + 4
  // loadout pieces). The real overlay itself has no cap at all (see
  // obs-overlay.tsx); this is just what the drag preview can represent.
  const previewSlotCount =
    previewPieces.length > 0 ? Math.min(previewPieces.length, 8) : 4;
  const previewIconPx = Math.round(PREVIEW_BASE_ICON_PX * (scale / 100));
  const characterPortrait = character
    ? getCharacterPortrait(character)
    : undefined;
  const previewCharacterPx = Math.round(
    PREVIEW_BASE_CHARACTER_PX * (characterScale / 100),
  );

  function updateCanvasWidth(width: number) {
    if (!Number.isFinite(width)) return;
    setCanvasWidth(
      Math.min(MAX_CANVAS_WIDTH, Math.max(MIN_CANVAS_WIDTH, Math.round(width))),
    );
  }
  function updateCanvasHeight(height: number) {
    if (!Number.isFinite(height)) return;
    setCanvasHeight(
      Math.min(
        MAX_CANVAS_HEIGHT,
        Math.max(MIN_CANVAS_HEIGHT, Math.round(height)),
      ),
    );
  }

  function applyStylePreset(preset: StylePreset) {
    setStyleMode(preset.id);
    setCanvasWidth(preset.canvasWidth);
    setCanvasHeight(preset.canvasHeight);
    setScale(preset.scale);
    setNameScale(preset.nameScale);
  }

  const activePresetDescription =
    styleMode === "custom"
      ? {
          ru: "Точная настройка холста, размера и ширины имени.",
          en: "Fine control over canvas, size, and name width.",
        }
      : STYLE_PRESETS.find((p) => p.id === styleMode)?.description;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, pointerEvents: "none" }}
          animate={{ opacity: 1, pointerEvents: "auto" }}
          exit={{ opacity: 0, pointerEvents: "none" }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ type: "spring", stiffness: 400, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl lg:max-w-xl"
          >
            <div aria-live="polite" className="sr-only">
              {announcement}
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <MonitorPlay className="size-4.5" />
                </span>
                <div>
                  <p id={titleId} className="font-semibold text-foreground">
                    {t({ ru: "Оверлей для OBS", en: "OBS Overlay" })}
                  </p>
                  <p id={descId} className="text-xs text-muted">
                    {mode === "loadout"
                      ? t({
                          ru: "Прозрачный фон, только карточки экипировки",
                          en: "Transparent background, loadout cards only",
                        })
                      : mode === "all"
                        ? t({
                            ru: "Прозрачный фон, перки и экипировка вместе",
                            en: "Transparent background, perks and loadout together",
                          })
                        : t({
                            ru: "Прозрачный фон, только карточки перков",
                            en: "Transparent background, perk cards only",
                          })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t({ ru: "Закрыть", en: "Close" })}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
              >
                <X className="size-4" />
              </button>
            </div>

            <div
              className="mt-4 flex items-center gap-1 rounded-full border border-border bg-background/60 p-1 text-sm"
              role="tablist"
            >
              {(["overlay", "twitch", "constructor"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={panelTab === tab}
                  onClick={() => setPanelTab(tab)}
                  className={cn(
                    "flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                    panelTab === tab
                      ? "bg-accent/15 text-accent"
                      : "text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  {tab === "overlay"
                    ? t({ ru: "Оверлей", en: "Overlay" })
                    : tab === "twitch"
                      ? t({ ru: "Twitch чат", en: "Twitch chat" })
                      : t({ ru: "Конструктор", en: "Constructor" })}
                </button>
              ))}
            </div>

            {panelTab === "overlay" && (
              <>
                <div className="mt-4 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
                    {url}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopy}
                    aria-label={t({
                      ru: "Скопировать ссылку",
                      en: "Copy link",
                    })}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                  >
                    {copied ? (
                      <Check className="size-4 text-accent" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t({
                      ru: "Открыть в новой вкладке",
                      en: "Open in a new tab",
                    })}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </div>

                <div className="mt-4">
                  <h3 className="mb-1.5 text-xs font-medium text-muted">
                    {t({
                      ru: "Превью — перетащи иконки",
                      en: "Preview — drag the icons",
                    })}
                  </h3>

                  <div
                    ref={previewRef}
                    className={cn(
                      "relative w-full touch-none overflow-hidden rounded-xl border border-border bg-[repeating-conic-gradient(#8884_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]",
                      darkBg && "bg-none bg-[#0b0c0f]",
                    )}
                    style={{
                      aspectRatio: canvasWidth / canvasHeight,
                      minHeight: PREVIEW_MIN_HEIGHT_PX,
                    }}
                  >
                    {/* Overlay action, not a row above the canvas — keeps
                        the canvas itself the tall, prominent element and
                        puts "Reset" right where the icons it affects are. */}
                    <button
                      type="button"
                      onClick={() => {
                        setPositions(null);
                        setCharacterPosition(null);
                        setCharacterScale(DEFAULT_OBS_OPTIONS.characterScale);
                      }}
                      className="absolute top-2 right-2 z-20 flex items-center gap-1 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white/80 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
                    >
                      <RotateCcw className="size-3" />
                      {t({ ru: "Сбросить", en: "Reset" })}
                    </button>
                    {Array.from({ length: previewSlotCount }, (_, index) => {
                      const perk = previewPieces[index];
                      const pos =
                        (positions ?? DEFAULT_SLOT_POSITIONS)[index] ??
                        DEFAULT_SLOT_POSITIONS[index];
                      return (
                        <div
                          key={perk?.slug ?? `placeholder-${index}`}
                          onPointerDown={(e) =>
                            e.currentTarget.setPointerCapture(e.pointerId)
                          }
                          onPointerMove={(e) => {
                            if (e.buttons !== 1) return;
                            handleDrag(index, e.clientX, e.clientY);
                          }}
                          className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab flex-col items-center gap-1 active:cursor-grabbing"
                          style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                        >
                          <span
                            className="flex items-center justify-center rounded-lg border-2 border-white/25 bg-black/70 p-0.5 shadow-lg"
                            style={{
                              width: previewIconPx + 4,
                              height: previewIconPx + 4,
                            }}
                          >
                            {perk ? (
                              // eslint-disable-next-line @next/next/no-img-element -- tiny drag-preview thumbnail, next/image is overkill here
                              <img
                                src={withBasePath(perk.icon)}
                                alt={perk.name[language]}
                                width={previewIconPx}
                                height={previewIconPx}
                                style={{
                                  width: previewIconPx,
                                  height: previewIconPx,
                                  objectFit: "cover",
                                }}
                                className="rounded pointer-events-none select-none"
                                draggable={false}
                              />
                            ) : (
                              <span
                                className="pointer-events-none block rounded bg-white/10"
                                style={{
                                  width: previewIconPx,
                                  height: previewIconPx,
                                }}
                              />
                            )}
                          </span>
                          {showNames && perk && (
                            <span
                              className="line-clamp-2 pointer-events-none inline-block rounded-md bg-black/70 px-1.5 py-0.5 text-center text-[9px] leading-tight font-bold break-words text-white"
                              style={{
                                maxWidth: Math.round(
                                  PREVIEW_BASE_NAME_MAX_WIDTH_PX *
                                    (nameScale / 100),
                                ),
                              }}
                            >
                              {perk.name[language]}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {character && characterPortrait && (
                      <div
                        onPointerDown={(e) =>
                          e.currentTarget.setPointerCapture(e.pointerId)
                        }
                        onPointerMove={(e) => {
                          if (e.buttons !== 1) return;
                          handleCharacterDrag(e.clientX, e.clientY);
                        }}
                        // Hovering to scroll needs a live preventDefault on the
                        // wheel event itself — React's onWheel is passive by
                        // default, which can't stop the page behind the modal
                        // from also scrolling while resizing this badge.
                        onWheel={(e) => {
                          e.preventDefault();
                          handleCharacterWheel(e.deltaY);
                        }}
                        title={t({
                          ru: "Перетащи, чтобы переместить; крути колесо мыши, чтобы изменить размер",
                          en: "Drag to move; scroll to resize",
                        })}
                        className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab flex-col items-center gap-1 active:cursor-grabbing"
                        style={{
                          left: `${(characterPosition ?? DEFAULT_CHARACTER_POSITION).x}%`,
                          top: `${(characterPosition ?? DEFAULT_CHARACTER_POSITION).y}%`,
                        }}
                      >
                        <span
                          className="flex items-center justify-center overflow-hidden rounded-full border-2 border-white/25 bg-black/70 shadow-lg"
                          style={{
                            width: previewCharacterPx + 4,
                            height: previewCharacterPx + 4,
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- tiny drag-preview thumbnail, next/image is overkill here */}
                          <img
                            src={withBasePath(characterPortrait)}
                            alt={getCharacterName(character, language)}
                            width={previewCharacterPx}
                            height={previewCharacterPx}
                            style={{
                              width: previewCharacterPx,
                              height: previewCharacterPx,
                              objectFit: "cover",
                            }}
                            className="pointer-events-none select-none"
                            draggable={false}
                          />
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted/70">
                    {t({
                      ru: "Позиции сохраняются в самой ссылке — «Сбросить» вернёт стандартный ряд по центру. Портрет персонажа: перетащи, чтобы переместить, крути колесо мыши над ним, чтобы изменить размер.",
                      en: "Positions are saved right in the link — “Reset” restores the default centered row. Character portrait: drag to move it, scroll over it to resize.",
                    })}
                  </p>
                </div>

                <div className="mt-5 flex flex-col gap-3">
                  <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
                    {t({ ru: "Оформление", en: "Appearance" })}
                  </h3>

                  <div
                    className="grid grid-cols-4 gap-1.5"
                    role="group"
                    aria-label={t({ ru: "Стиль оверлея", en: "Overlay style" })}
                  >
                    {STYLE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyStylePreset(preset)}
                        aria-pressed={styleMode === preset.id}
                        className={cn(
                          "rounded-full border px-2 py-1.5 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none",
                          styleMode === preset.id
                            ? "border-accent/50 bg-accent/15 text-accent"
                            : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                        )}
                      >
                        {t(preset.label)}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setStyleMode("custom")}
                      aria-pressed={styleMode === "custom"}
                      className={cn(
                        "rounded-full border px-2 py-1.5 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none",
                        styleMode === "custom"
                          ? "border-accent/50 bg-accent/15 text-accent"
                          : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      {t({ ru: "Свой", en: "Custom" })}
                    </button>
                  </div>
                  {activePresetDescription && (
                    <p className="-mt-1 text-[11px] text-muted/70">
                      {t(activePresetDescription)}
                    </p>
                  )}

                  {styleMode === "custom" && (
                    <div className="flex flex-col gap-4 rounded-lg border border-border bg-background/40 p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <label
                          htmlFor={canvasWidthId}
                          className="text-[11px] text-muted"
                        >
                          {t({ ru: "Холст OBS:", en: "OBS canvas:" })}
                        </label>
                        <input
                          id={canvasWidthId}
                          type="number"
                          min={MIN_CANVAS_WIDTH}
                          max={MAX_CANVAS_WIDTH}
                          value={canvasWidth}
                          onChange={(e) =>
                            updateCanvasWidth(Number(e.target.value))
                          }
                          aria-label={t({
                            ru: "Ширина холста, пикселей",
                            en: "Canvas width, pixels",
                          })}
                          className="w-16 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground focus:ring-2 focus:ring-accent/40 focus:outline-none"
                        />
                        <span className="text-muted" aria-hidden>
                          ×
                        </span>
                        <input
                          type="number"
                          min={MIN_CANVAS_HEIGHT}
                          max={MAX_CANVAS_HEIGHT}
                          value={canvasHeight}
                          onChange={(e) =>
                            updateCanvasHeight(Number(e.target.value))
                          }
                          aria-label={t({
                            ru: "Высота холста, пикселей",
                            en: "Canvas height, pixels",
                          })}
                          className="w-16 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground focus:ring-2 focus:ring-accent/40 focus:outline-none"
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <label
                            htmlFor={cardSizeSliderId}
                            className="text-xs font-medium text-muted"
                          >
                            {t({ ru: "Размер карточек", en: "Card size" })}
                          </label>
                          <span className="text-[11px] tabular-nums text-muted">
                            {scale}%
                          </span>
                        </div>
                        <input
                          id={cardSizeSliderId}
                          type="range"
                          min={MIN_OBS_SCALE}
                          max={MAX_OBS_SCALE}
                          step={5}
                          value={scale}
                          onChange={(e) => setScale(Number(e.target.value))}
                          aria-label={t({
                            ru: "Размер карточек",
                            en: "Card size",
                          })}
                          className="w-full accent-accent"
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <label
                            htmlFor={nameWidthSliderId}
                            className={cn(
                              "text-xs font-medium text-muted",
                              !showNames && "opacity-40",
                            )}
                          >
                            {t({ ru: "Ширина имени", en: "Name width" })}
                          </label>
                          <span
                            className={cn(
                              "text-[11px] tabular-nums text-muted",
                              !showNames && "opacity-40",
                            )}
                          >
                            {nameScale}%
                          </span>
                        </div>
                        <input
                          id={nameWidthSliderId}
                          type="range"
                          min={MIN_OBS_NAME_SCALE}
                          max={MAX_OBS_NAME_SCALE}
                          step={10}
                          value={nameScale}
                          onChange={(e) => setNameScale(Number(e.target.value))}
                          disabled={!showNames}
                          aria-label={t({
                            ru: "Ширина имени",
                            en: "Name width",
                          })}
                          className="w-full accent-accent"
                        />
                        <p className="text-[11px] text-muted/70">
                          {t({
                            ru: "Ниже ~130% имена почти всегда обрезаются даже с переносом на 2 строки.",
                            en: "Below ~130%, names get cut off almost every time even with 2-line wrapping.",
                          })}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="mt-1 flex flex-col gap-3">
                    <ToggleSwitch
                      checked={showNames}
                      onChange={() => setShowNames((v) => !v)}
                      label={t({
                        ru: "Показывать названия карточек",
                        en: "Show card names",
                      })}
                    />
                    <ToggleSwitch
                      checked={darkBg}
                      onChange={() => setDarkBg((v) => !v)}
                      label={t({
                        ru: "Тёмный фон вместо прозрачного",
                        en: "Dark background instead of transparent",
                      })}
                    />
                    <ToggleSwitch
                      checked={showCharacter}
                      onChange={() => setShowCharacter((v) => !v)}
                      label={t({
                        ru: "Показывать портрет персонажа",
                        en: "Show character portrait",
                      })}
                      tooltip={t({
                        ru: "Появляется только если билд привязан к персонажу — выбран вручную или для убийцы определён по аддонам.",
                        en: "Only shows up when the build has a known character — picked manually, or figured out from a killer's rolled add-ons.",
                      })}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted">
                      {t({ ru: "Показывать:", en: "Show:" })}
                    </span>
                    <div
                      className="flex flex-wrap gap-1.5"
                      role="group"
                      aria-label={t({
                        ru: "Какие элементы билда показывать в оверлее и на скачанной картинке",
                        en: "Which build pieces to show in the overlay and in the downloaded image",
                      })}
                    >
                      {(
                        [
                          [
                            "perks",
                            { ru: "Перки", en: "Perks" },
                            mode !== "loadout",
                          ],
                          [
                            "item",
                            { ru: "Предмет", en: "Item" },
                            mode !== "perks",
                          ],
                          [
                            "addon",
                            { ru: "Аддоны", en: "Add-ons" },
                            mode !== "perks",
                          ],
                          [
                            "offering",
                            { ru: "Подношение", en: "Offering" },
                            mode !== "perks",
                          ],
                        ] as const
                      )
                        .filter(([, , relevant]) => relevant)
                        .map(([kind, label]) => (
                          <button
                            key={kind}
                            type="button"
                            aria-pressed={pieceVisibility[kind]}
                            onClick={() =>
                              onPieceVisibilityChange(
                                kind,
                                !pieceVisibility[kind],
                              )
                            }
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                              pieceVisibility[kind]
                                ? "border-accent/50 bg-accent/15 text-accent"
                                : "border-border text-muted/50 hover:bg-surface-hover hover:text-foreground",
                            )}
                          >
                            {t(label)}
                          </button>
                        ))}
                    </div>
                    <p className="text-[11px] text-muted/70">
                      {t({
                        ru: "Не влияет на то, что реально выпадает — только на то, что видно в оверлее и на картинке.",
                        en: "Doesn't change what actually gets rolled — only what's visible in the overlay and the downloaded image.",
                      })}
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-border bg-background/60 p-3.5">
                  {/* Closed by default — this is reference material someone
                      checks once while setting up their Browser Source, not
                      something worth its own permanent block of vertical
                      space every time the modal opens (user feedback: the
                      instructions "take up way too much vertical space"). */}
                  <button
                    type="button"
                    onClick={() => setObsSetupOpen((v) => !v)}
                    aria-expanded={obsSetupOpen}
                    className="flex w-full items-center justify-between text-xs font-semibold tracking-wide text-muted uppercase transition-colors hover:text-foreground"
                  >
                    {t({ ru: "Настройка в OBS", en: "OBS setup" })}
                    <ChevronDown
                      className={cn(
                        "size-3.5 shrink-0 normal-case transition-transform",
                        obsSetupOpen && "rotate-180",
                      )}
                    />
                  </button>
                  {obsSetupOpen && (
                    <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-muted">
                      <li>
                        {t({
                          ru: "Источники → плюс → «Браузер»",
                          en: "Sources → plus → “Browser”",
                        })}
                      </li>
                      <li>
                        {t({
                          ru: "Вставь ссылку выше в поле URL",
                          en: "Paste the link above into URL",
                        })}
                      </li>
                      <li>
                        {t({ ru: "Ширина", en: "Width" })}:{" "}
                        <b className="text-foreground">{canvasWidth}</b> ·{" "}
                        {t({ ru: "Высота", en: "Height" })}:{" "}
                        <b className="text-foreground">{canvasHeight}</b>
                      </li>
                      <li>
                        {t({
                          ru: "Сними галочку «Закрывать источник, когда не виден» — иначе синхронизация с основной вкладкой прервётся",
                          en: "Uncheck “Shutdown source when not visible” — otherwise it stops syncing with the main tab",
                        })}
                      </li>
                    </ol>
                  )}
                </div>

                <p className="mt-3 text-xs text-muted/70">
                  {t({
                    ru: "Держи основную вкладку сайта открытой — оверлей просто зеркалит то, что на ней сгенерировано.",
                    en: "Keep the main site tab open — the overlay just mirrors whatever build is showing there.",
                  })}
                </p>
              </>
            )}

            {panelTab === "twitch" && (
              <div className="mt-4 rounded-xl border border-border bg-background/60 p-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <MessageCircle className="size-3.5 text-muted" />
                  <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
                    {t({
                      ru: "Управление из чата Twitch",
                      en: "Control from Twitch chat",
                    })}
                  </h3>
                </div>
                <p className="mb-3 text-xs text-muted/80">
                  {t({
                    ru: "Читает публичный чат канала анонимно (без входа в Twitch).",
                    en: "Reads the channel's public chat anonymously (no Twitch login).",
                  })}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-muted" aria-hidden>
                    #
                  </span>
                  <input
                    type="text"
                    value={twitchChannel}
                    onChange={(e) => onTwitchChannelChange(e.target.value)}
                    placeholder={t({ ru: "имя_канала", en: "channel_name" })}
                    aria-label={t({
                      ru: "Имя канала Twitch",
                      en: "Twitch channel name",
                    })}
                    className="min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted">
                    <input
                      type="checkbox"
                      checked={twitchEnabled}
                      disabled={!twitchChannel.trim()}
                      onChange={(e) => onTwitchToggle(e.target.checked)}
                      className="size-4 accent-accent disabled:opacity-40"
                    />
                    {t({ ru: "Вкл", en: "On" })}
                  </label>
                </div>
                {twitchEnabled && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        TWITCH_STATE_DOT[twitchState],
                      )}
                    />
                    {t(TWITCH_STATE_LABEL[twitchState])}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => setTwitchAdvancedOpen((v) => !v)}
                  className="mt-3 flex w-full items-center justify-between text-[11px] font-medium text-muted transition-colors hover:text-foreground"
                >
                  {t({
                    ru: "Команды и права доступа",
                    en: "Commands & permissions",
                  })}
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform",
                      twitchAdvancedOpen && "rotate-180",
                    )}
                  />
                </button>

                {twitchAdvancedOpen && (
                  <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium text-muted">
                        {t({ ru: "Реролл — команда", en: "Reroll — command" })}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          type="text"
                          value={twitchRerollCommand}
                          onChange={(e) =>
                            onTwitchRerollCommandChange(e.target.value)
                          }
                          placeholder="!reroll"
                          aria-label={t({
                            ru: "Команда реролла",
                            en: "Reroll command",
                          })}
                          className="w-24 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
                        />
                        <PermissionSelect
                          value={twitchRerollPermission}
                          onChange={onTwitchRerollPermissionChange}
                        />
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            max={300}
                            value={twitchCooldownSec}
                            onChange={(e) =>
                              onTwitchCooldownSecChange(Number(e.target.value))
                            }
                            aria-label={t({
                              ru: "Кулдаун реролла, секунд",
                              en: "Reroll cooldown, seconds",
                            })}
                            className="w-14 rounded-full border border-border bg-background px-2 py-1 text-[11px] text-foreground focus:ring-2 focus:ring-accent/40 focus:outline-none"
                          />
                          <span className="text-[11px] text-muted">
                            {t({ ru: "сек. кулдаун", en: "sec cooldown" })}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                        <input
                          type="checkbox"
                          checked={twitchPasteEnabled}
                          onChange={(e) =>
                            onTwitchPasteToggle(e.target.checked)
                          }
                          className="size-3.5 accent-accent"
                        />
                        {t({
                          ru: "Команда «вставить билд по коду» (для саб/VIP)",
                          en: '"Paste a build by code" command (for subs/VIPs)',
                        })}
                      </label>
                      {twitchPasteEnabled && (
                        <>
                          <div className="flex flex-wrap items-center gap-1.5 pl-5">
                            <input
                              type="text"
                              value={twitchPasteCommand}
                              onChange={(e) =>
                                onTwitchPasteCommandChange(e.target.value)
                              }
                              placeholder="!paste"
                              aria-label={t({
                                ru: "Команда вставки билда",
                                en: "Paste-build command",
                              })}
                              className="w-24 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
                            />
                            <PermissionSelect
                              value={twitchPastePermission}
                              onChange={onTwitchPastePermissionChange}
                            />
                          </div>
                          <p className="pl-5 text-[11px] text-muted/70">
                            {t({
                              ru: 'Пример: "!paste 42,105,12,8" — числа берутся из ссылки Поделиться на сайте.',
                              en: 'Example: "!paste 42,105,12,8" — the numbers come from the site\'s Share link.',
                            })}
                          </p>
                          {pasteCommandForBuild && (
                            <div className="pl-5">
                              <p className="mb-1 text-[11px] font-medium text-muted">
                                {t({
                                  ru: "Готовая команда для билда на экране сейчас:",
                                  en: "Ready command for the build on screen right now:",
                                })}
                              </p>
                              <div className="flex items-center gap-1.5">
                                <code className="min-w-0 flex-1 truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground">
                                  {pasteCommandForBuild}
                                </code>
                                <button
                                  type="button"
                                  onClick={handleCopyPasteCommand}
                                  aria-label={t({
                                    ru: "Скопировать команду",
                                    en: "Copy command",
                                  })}
                                  className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                                >
                                  {pasteCommandCopied ? (
                                    <Check className="size-3 text-accent" />
                                  ) : (
                                    <Copy className="size-3" />
                                  )}
                                </button>
                              </div>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => setPanelTab("constructor")}
                            className="flex items-center gap-1.5 pl-5 text-[11px] font-medium text-accent transition-colors hover:text-accent/80"
                          >
                            <Wrench className="size-3" />
                            {t({
                              ru: "Собрать билд вручную — вкладка «Конструктор»",
                              en: "Build one from scratch — see the “Constructor” tab",
                            })}
                          </button>
                        </>
                      )}
                    </div>

                    <p className="text-[11px] text-muted/60">
                      {t({
                        ru: "Twitch не даёт напрямую узнать «донатер» из чата — саб/VIP статус ближе всего к этому и виден в самом чате.",
                        en: 'Twitch\'s chat itself has no notion of "donator" — sub/VIP status is the closest thing visible directly in chat.',
                      })}
                    </p>
                  </div>
                )}
              </div>
            )}

            {panelTab === "constructor" && (
              <div className="mt-4 rounded-xl border border-border bg-background/60 p-3.5">
                <div className="mb-2 flex items-center gap-2">
                  <Wrench className="size-3.5 text-muted" />
                  <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
                    {t({ ru: "Конструктор билда", en: "Build constructor" })}
                  </h3>
                </div>
                <p className="mb-3 text-xs text-muted/80">
                  {t({
                    ru: "Собери билд с нуля — независимо от того, что сгенерировано на сайте сейчас, например чтобы заранее подготовить билд для анонса.",
                    en: "Build one from scratch — independent of whatever's currently rolled on the main site, e.g. to prepare an announcement build ahead of time.",
                  })}
                </p>

                <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-2.5">
                  <div className="flex items-center gap-1.5">
                    {(["survivor", "killer"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setConstructorRoleAndClear(option)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                          constructorRole === option
                            ? "border-accent/50 bg-accent/15 text-accent"
                            : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                        )}
                      >
                        {option === "survivor"
                          ? t({ ru: "Выживший", en: "Survivor" })
                          : t({ ru: "Убийца", en: "Killer" })}
                      </button>
                    ))}
                    <span className="ml-auto text-[11px] text-muted">
                      {constructorSelected.length}/4
                    </span>
                    {constructorSelected.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setConstructorSelected([])}
                        className="text-[11px] font-medium text-muted transition-colors hover:text-foreground"
                      >
                        {t({ ru: "Очистить", en: "Clear" })}
                      </button>
                    )}
                  </div>

                  <div className="flex min-h-9 flex-wrap gap-1.5">
                    {Array.from(
                      { length: 4 },
                      (_, i) => constructorSelected[i],
                    ).map((perk, i) =>
                      perk ? (
                        <button
                          key={perk.slug}
                          type="button"
                          onClick={() => toggleConstructorPerk(perk)}
                          title={perk.name[language]}
                          className="relative flex size-9 items-center justify-center rounded-lg border-2 border-accent bg-black/70"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- tiny selection-slot thumbnail, next/image is overkill here */}
                          <img
                            src={withBasePath(perk.icon)}
                            alt={perk.name[language]}
                            width={32}
                            height={32}
                            className="size-8 rounded object-cover"
                          />
                          <span className="absolute -top-1.5 -right-1.5 flex size-3.5 items-center justify-center rounded-full bg-red-500 text-white">
                            <X className="size-2.5" />
                          </span>
                        </button>
                      ) : (
                        <span
                          key={`empty-${i}`}
                          className="size-9 rounded-lg border-2 border-dashed border-border"
                        />
                      ),
                    )}
                  </div>

                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted" />
                    <input
                      type="text"
                      value={constructorSearch}
                      onChange={(e) => setConstructorSearch(e.target.value)}
                      placeholder={t({
                        ru: "Поиск перка…",
                        en: "Search perks…",
                      })}
                      aria-label={t({ ru: "Поиск перка", en: "Search perks" })}
                      className="w-full rounded-full border border-border bg-background py-1.5 pr-3 pl-7 text-[11px] text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
                    />
                  </div>

                  <div className="grid max-h-40 grid-cols-6 gap-1 overflow-y-auto">
                    {constructorFiltered.map((perk) => {
                      const selected = constructorSelected.some(
                        (p) => p.slug === perk.slug,
                      );
                      return (
                        <button
                          key={perk.slug}
                          type="button"
                          onClick={() => toggleConstructorPerk(perk)}
                          title={perk.name[language]}
                          disabled={
                            !selected && constructorSelected.length >= 4
                          }
                          className={cn(
                            "flex items-center justify-center rounded-lg border-2 p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-30",
                            selected
                              ? "border-accent"
                              : "border-transparent hover:border-border",
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- tiny picker thumbnail, next/image is overkill here */}
                          <img
                            src={withBasePath(perk.icon)}
                            alt={perk.name[language]}
                            width={30}
                            height={30}
                            className="size-[30px] rounded bg-icon-plate object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>

                  {constructorCommand ? (
                    <div className="flex items-center gap-1.5 border-t border-border pt-2">
                      <code className="min-w-0 flex-1 truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground">
                        {constructorCommand}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopyConstructorCommand}
                        aria-label={t({
                          ru: "Скопировать команду",
                          en: "Copy command",
                        })}
                        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                      >
                        {constructorCopied ? (
                          <Check className="size-3 text-accent" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                    </div>
                  ) : (
                    <p className="border-t border-border pt-2 text-[11px] text-muted/70">
                      {t({
                        ru: "Выбери до 4 перков, чтобы получить команду.",
                        en: "Pick up to 4 perks to get a command.",
                      })}
                    </p>
                  )}
                </div>

                {!twitchPasteEnabled && (
                  <p className="mt-3 text-[11px] text-muted/60">
                    {t({
                      ru: "Команда «вставить билд по коду» сейчас выключена во вкладке Twitch — включи её там, чтобы зрители могли использовать эту команду в чате.",
                      en: 'The "paste a build by code" command is currently off in the Twitch tab — turn it on there for viewers to actually use this command in chat.',
                    })}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
