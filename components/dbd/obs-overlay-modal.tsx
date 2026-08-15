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
import { useMemo, useRef, useState } from "react";
import { withBasePath } from "@/lib/asset-path";
import { cn } from "@/lib/cn";
import { useT, type Lang } from "@/lib/i18n";
import { getIdForSlug } from "@/lib/perk-ids";
import { getPerksByRole } from "@/lib/perks";
import type { TwitchConnectionState, TwitchPermission } from "@/lib/twitch-chat";
import type { Perk, PerkRole } from "@/lib/types";
import {
  DEFAULT_OBS_OPTIONS,
  MAX_OBS_NAME_SCALE,
  MAX_OBS_SCALE,
  MIN_OBS_NAME_SCALE,
  MIN_OBS_SCALE,
  obsOverlayUrl,
  type ObsIconPosition,
} from "@/lib/use-obs-mode";

const TWITCH_STATE_LABEL: Record<TwitchConnectionState, { ru: string; en: string }> = {
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

// The 4-slot grid a fresh (never-dragged) icon lands on inside the preview —
// also what a partially-customized `positions` array falls back to for any
// slot that hasn't been dragged yet, so the preview and the real overlay
// always agree on where an untouched icon sits.
const DEFAULT_SLOT_POSITIONS: readonly ObsIconPosition[] = [
  { x: 12.5, y: 50 },
  { x: 37.5, y: 50 },
  { x: 62.5, y: 50 },
  { x: 87.5, y: 50 },
];

// Starting point for the OBS Browser Source's own width/height — matches
// what the setup steps used to hardcode. Now editable (see canvasWidth /
// canvasHeight below): the overlay itself just fills whatever pixel size
// OBS actually gives the source (`fixed inset-0`), so a taller canvas is
// all it takes to give 2-line names — see obs-overlay.tsx — real room to
// breathe instead of the cramped default 220px strip.
const DEFAULT_CANVAS_WIDTH = 800;
const DEFAULT_CANVAS_HEIGHT = 220;
const MIN_CANVAS_WIDTH = 320;
const MAX_CANVAS_WIDTH = 1920;
const MIN_CANVAS_HEIGHT = 120;
const MAX_CANVAS_HEIGHT = 800;
const CANVAS_PRESETS: readonly { width: number; height: number; label: { ru: string; en: string } }[] = [
  { width: 800, height: 220, label: { ru: "Компакт", en: "Compact" } },
  { width: 800, height: 340, label: { ru: "С именами", en: "With names" } },
  { width: 1100, height: 420, label: { ru: "Просторно", en: "Roomy" } },
];
const PREVIEW_BASE_ICON_PX = 34;
const PREVIEW_BASE_NAME_MAX_WIDTH_PX = 56;

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
  language,
  role,
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
  language: Lang;
  role: PerkRole;
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
  const [copied, setCopied] = useState(false);
  const [pasteCommandCopied, setPasteCommandCopied] = useState(false);
  const [scale, setScale] = useState(DEFAULT_OBS_OPTIONS.scale);
  const [nameScale, setNameScale] = useState(DEFAULT_OBS_OPTIONS.nameScale);
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_CANVAS_WIDTH);
  const [canvasHeight, setCanvasHeight] = useState(DEFAULT_CANVAS_HEIGHT);
  const [showNames, setShowNames] = useState(DEFAULT_OBS_OPTIONS.showNames);
  const [darkBg, setDarkBg] = useState(DEFAULT_OBS_OPTIONS.background === "dark");
  // null = no custom layout yet, overlay falls back to its default centered
  // row. Set the first time the user drags any icon in the preview below.
  const [positions, setPositions] = useState<ObsIconPosition[] | null>(null);
  const [twitchAdvancedOpen, setTwitchAdvancedOpen] = useState(false);
  const [constructorOpen, setConstructorOpen] = useState(false);
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
        background: darkBg ? "dark" : "transparent",
        positions: positions ?? undefined,
      })
    : "";

  function handleCopy() {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  // The exact !paste command that hands out whatever build is currently on
  // screen — built from perk IDs (same short numeric IDs the site's own
  // Share links use), so a streamer/mod can read it out or pin it verbatim
  // instead of having to go grab a Share link and copy numbers out of it.
  const pasteCommandForBuild = useMemo(() => {
    const ids = perks.map((p) => getIdForSlug(p.slug)).filter((id): id is number => id !== undefined);
    if (ids.length === 0) return null;
    return `${twitchPasteCommand.trim() || "!paste"} ${ids.join(",")}`;
  }, [perks, twitchPasteCommand]);

  function handleCopyPasteCommand() {
    if (!pasteCommandForBuild) return;
    navigator.clipboard
      .writeText(pasteCommandForBuild)
      .then(() => {
        setPasteCommandCopied(true);
        setTimeout(() => setPasteCommandCopied(false), 2000);
      })
      .catch(() => {});
  }

  // A sandbox for building a !paste command from scratch — independent of
  // whatever build happens to be showing on the main site right now, e.g.
  // to prepare an announcement build ahead of time. Perks toggle in/out of
  // a 4-slot selection; switching role clears it since a build can't mix
  // survivor and killer perks.
  const constructorPerks = useMemo(() => getPerksByRole(constructorRole), [constructorRole]);
  const constructorFiltered = useMemo(() => {
    const query = constructorSearch.trim().toLowerCase();
    if (!query) return constructorPerks;
    return constructorPerks.filter((perk) =>
      `${perk.name.en} ${perk.name.ru}`.toLowerCase().includes(query),
    );
  }, [constructorPerks, constructorSearch]);

  function toggleConstructorPerk(perk: Perk) {
    setConstructorSelected((prev) => {
      if (prev.some((p) => p.slug === perk.slug)) return prev.filter((p) => p.slug !== perk.slug);
      if (prev.length >= 4) return prev;
      return [...prev, perk];
    });
  }

  function setConstructorRoleAndClear(nextRole: PerkRole) {
    setConstructorRole(nextRole);
    setConstructorSelected([]);
  }

  const constructorCommand = useMemo(() => {
    const ids = constructorSelected.map((p) => getIdForSlug(p.slug)).filter((id): id is number => id !== undefined);
    if (ids.length === 0) return null;
    return `${twitchPasteCommand.trim() || "!paste"} ${ids.join(",")}`;
  }, [constructorSelected, twitchPasteCommand]);

  function handleCopyConstructorCommand() {
    if (!constructorCommand) return;
    navigator.clipboard
      .writeText(constructorCommand)
      .then(() => {
        setConstructorCopied(true);
        setTimeout(() => setConstructorCopied(false), 2000);
      })
      .catch(() => {});
  }

  function handleDrag(index: number, clientX: number, clientY: number) {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
    setPositions((prev) => {
      const base = prev ? [...prev] : [...DEFAULT_SLOT_POSITIONS];
      base[index] = { x, y };
      return base;
    });
  }

  const previewSlotCount = perks.length > 0 ? Math.min(perks.length, 4) : 4;
  const previewIconPx = Math.round(PREVIEW_BASE_ICON_PX * (scale / 100));

  function updateCanvasWidth(width: number) {
    if (!Number.isFinite(width)) return;
    setCanvasWidth(Math.min(MAX_CANVAS_WIDTH, Math.max(MIN_CANVAS_WIDTH, Math.round(width))));
  }
  function updateCanvasHeight(height: number) {
    if (!Number.isFinite(height)) return;
    setCanvasHeight(Math.min(MAX_CANVAS_HEIGHT, Math.max(MIN_CANVAS_HEIGHT, Math.round(height))));
  }

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
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <MonitorPlay className="size-4.5" />
                </span>
                <div>
                  <p className="font-semibold text-foreground">
                    {t({ ru: "Оверлей для OBS", en: "OBS Overlay" })}
                  </p>
                  <p className="text-xs text-muted">
                    {t({
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
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
                {url}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                aria-label={t({ ru: "Скопировать ссылку", en: "Copy link" })}
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
                aria-label={t({ ru: "Открыть в новой вкладке", en: "Open in a new tab" })}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <ExternalLink className="size-4" />
              </a>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-muted">
                  {t({ ru: "Превью — перетащи иконки", en: "Preview — drag the icons" })}
                </span>
                <button
                  type="button"
                  onClick={() => setPositions(null)}
                  className="flex items-center gap-1 text-[11px] font-medium text-muted transition-colors hover:text-foreground"
                >
                  <RotateCcw className="size-3" />
                  {t({ ru: "Сбросить позиции", en: "Reset positions" })}
                </button>
              </div>

              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted">
                  {t({ ru: "Холст OBS:", en: "OBS canvas:" })}
                </span>
                <input
                  type="number"
                  min={MIN_CANVAS_WIDTH}
                  max={MAX_CANVAS_WIDTH}
                  value={canvasWidth}
                  onChange={(e) => updateCanvasWidth(Number(e.target.value))}
                  className="w-16 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground focus:ring-2 focus:ring-accent/40 focus:outline-none"
                />
                <span className="text-muted">×</span>
                <input
                  type="number"
                  min={MIN_CANVAS_HEIGHT}
                  max={MAX_CANVAS_HEIGHT}
                  value={canvasHeight}
                  onChange={(e) => updateCanvasHeight(Number(e.target.value))}
                  className="w-16 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground focus:ring-2 focus:ring-accent/40 focus:outline-none"
                />
                <span className="mx-0.5 h-3.5 w-px bg-border" aria-hidden />
                {CANVAS_PRESETS.map((preset) => (
                  <button
                    key={`${preset.width}x${preset.height}`}
                    type="button"
                    onClick={() => {
                      setCanvasWidth(preset.width);
                      setCanvasHeight(preset.height);
                    }}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                      canvasWidth === preset.width && canvasHeight === preset.height
                        ? "border-accent/50 bg-accent/15 text-accent"
                        : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                    )}
                  >
                    {t(preset.label)}
                  </button>
                ))}
              </div>

              <div
                ref={previewRef}
                className={cn(
                  "relative w-full touch-none overflow-hidden rounded-xl border border-border bg-[repeating-conic-gradient(#8884_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]",
                  darkBg && "bg-none bg-[#0b0c0f]",
                )}
                style={{ aspectRatio: canvasWidth / canvasHeight }}
              >
                {Array.from({ length: previewSlotCount }, (_, index) => {
                  const perk: Perk | undefined = perks[index];
                  const pos = (positions ?? DEFAULT_SLOT_POSITIONS)[index] ?? DEFAULT_SLOT_POSITIONS[index];
                  return (
                    <div
                      key={perk?.slug ?? `placeholder-${index}`}
                      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                      onPointerMove={(e) => {
                        if (e.buttons !== 1) return;
                        handleDrag(index, e.clientX, e.clientY);
                      }}
                      className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab flex-col items-center gap-1 active:cursor-grabbing"
                      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                    >
                      <span
                        className="flex items-center justify-center rounded-lg border-2 border-accent bg-black/70 p-0.5 shadow-lg"
                        style={{ width: previewIconPx + 4, height: previewIconPx + 4 }}
                      >
                        {perk ? (
                          // eslint-disable-next-line @next/next/no-img-element -- tiny drag-preview thumbnail, next/image is overkill here
                          <img
                            src={withBasePath(perk.icon)}
                            alt={perk.name[language]}
                            width={previewIconPx}
                            height={previewIconPx}
                            style={{ width: previewIconPx, height: previewIconPx, objectFit: "cover" }}
                            className="rounded pointer-events-none select-none"
                            draggable={false}
                          />
                        ) : (
                          <span
                            className="pointer-events-none block rounded bg-white/10"
                            style={{ width: previewIconPx, height: previewIconPx }}
                          />
                        )}
                      </span>
                      {showNames && perk && (
                        <span
                          className="line-clamp-2 pointer-events-none inline-block rounded-md bg-black/70 px-1.5 py-0.5 text-center text-[9px] leading-tight font-bold break-words text-white"
                          style={{ maxWidth: Math.round(PREVIEW_BASE_NAME_MAX_WIDTH_PX * (nameScale / 100)) }}
                        >
                          {perk.name[language]}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-muted/70">
                {t({
                  ru: "Позиции сохраняются в самой ссылке — «Сбросить» вернёт стандартный ряд по центру.",
                  en: "Positions are saved right in the link — “Reset” restores the default centered row.",
                })}
              </p>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted">
                  {t({ ru: "Размер карточек", en: "Card size" })}
                </span>
                <span className="text-[11px] text-muted">{scale}%</span>
              </div>
              <input
                type="range"
                min={MIN_OBS_SCALE}
                max={MAX_OBS_SCALE}
                step={5}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                className="w-full accent-accent"
              />

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted">
                  {t({ ru: "Ширина имени", en: "Name width" })}
                </span>
                <span className="text-[11px] text-muted">{nameScale}%</span>
              </div>
              <input
                type="range"
                min={MIN_OBS_NAME_SCALE}
                max={MAX_OBS_NAME_SCALE}
                step={10}
                value={nameScale}
                onChange={(e) => setNameScale(Number(e.target.value))}
                className="w-full accent-accent"
                disabled={!showNames}
              />
              <p className="-mt-2 text-[11px] text-muted/70">
                {t({
                  ru: "Если длинное имя перка обрезается многоточием — увеличь этот ползунок.",
                  en: "If a long perk name gets cut off with an ellipsis, raise this slider.",
                })}
              </p>

              <label className="flex items-center justify-between gap-3 text-xs font-medium text-muted">
                {t({ ru: "Показывать названия перков", en: "Show perk names" })}
                <input
                  type="checkbox"
                  checked={showNames}
                  onChange={(e) => setShowNames(e.target.checked)}
                  className="size-4 accent-accent"
                />
              </label>

              <label className="flex items-center justify-between gap-3 text-xs font-medium text-muted">
                {t({
                  ru: "Тёмный фон вместо прозрачного",
                  en: "Dark background instead of transparent",
                })}
                <input
                  type="checkbox"
                  checked={darkBg}
                  onChange={(e) => setDarkBg(e.target.checked)}
                  className="size-4 accent-accent"
                />
              </label>
            </div>

            <div className="mt-4 rounded-xl border border-border bg-background/60 p-3.5">
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                {t({ ru: "Настройка в OBS", en: "OBS setup" })}
              </p>
              <ol className="list-inside list-decimal space-y-1 text-sm text-muted">
                <li>
                  {t({
                    ru: "Источники → плюс → «Браузер»",
                    en: "Sources → plus → “Browser”",
                  })}
                </li>
                <li>
                  {t({ ru: "Вставь ссылку выше в поле URL", en: "Paste the link above into URL" })}
                </li>
                <li>
                  {t({ ru: "Ширина", en: "Width" })}: <b className="text-foreground">{canvasWidth}</b> ·{" "}
                  {t({ ru: "Высота", en: "Height" })}: <b className="text-foreground">{canvasHeight}</b>
                </li>
                <li>
                  {t({
                    ru: "Сними галочку «Закрывать источник, когда не виден» — иначе синхронизация с основной вкладкой прервётся",
                    en: "Uncheck “Shutdown source when not visible” — otherwise it stops syncing with the main tab",
                  })}
                </li>
              </ol>
            </div>

            <p className="mt-3 text-xs text-muted/70">
              {t({
                ru: "Держи основную вкладку сайта открытой — оверлей просто зеркалит то, что на ней сгенерировано.",
                en: "Keep the main site tab open — the overlay just mirrors whatever build is showing there.",
              })}
            </p>

            <div className="mt-4 rounded-xl border border-border bg-background/60 p-3.5">
              <div className="mb-2 flex items-center gap-2">
                <MessageCircle className="size-3.5 text-muted" />
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                  {t({ ru: "Управление из чата Twitch", en: "Control from Twitch chat" })}
                </p>
              </div>
              <p className="mb-3 text-xs text-muted/80">
                {t({
                  ru: "Читает публичный чат канала анонимно (без входа в Twitch).",
                  en: "Reads the channel's public chat anonymously (no Twitch login).",
                })}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-muted">#</span>
                <input
                  type="text"
                  value={twitchChannel}
                  onChange={(e) => onTwitchChannelChange(e.target.value)}
                  placeholder={t({ ru: "имя_канала", en: "channel_name" })}
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
                  <span className={cn("size-1.5 rounded-full", TWITCH_STATE_DOT[twitchState])} />
                  {t(TWITCH_STATE_LABEL[twitchState])}
                </p>
              )}

              <button
                type="button"
                onClick={() => setTwitchAdvancedOpen((v) => !v)}
                className="mt-3 flex w-full items-center justify-between text-[11px] font-medium text-muted transition-colors hover:text-foreground"
              >
                {t({ ru: "Команды и права доступа", en: "Commands & permissions" })}
                <ChevronDown
                  className={cn("size-3.5 transition-transform", twitchAdvancedOpen && "rotate-180")}
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
                        onChange={(e) => onTwitchRerollCommandChange(e.target.value)}
                        placeholder="!reroll"
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
                          onChange={(e) => onTwitchCooldownSecChange(Number(e.target.value))}
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
                        onChange={(e) => onTwitchPasteToggle(e.target.checked)}
                        className="size-3.5 accent-accent"
                      />
                      {t({
                        ru: "Команда «вставить билд по коду» (для саб/VIP)",
                        en: "\"Paste a build by code\" command (for subs/VIPs)",
                      })}
                    </label>
                    {twitchPasteEnabled && (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5 pl-5">
                          <input
                            type="text"
                            value={twitchPasteCommand}
                            onChange={(e) => onTwitchPasteCommandChange(e.target.value)}
                            placeholder="!paste"
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
                                aria-label={t({ ru: "Скопировать команду", en: "Copy command" })}
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

                        <div className="pl-5">
                          <button
                            type="button"
                            onClick={() => setConstructorOpen((v) => !v)}
                            className="flex items-center gap-1.5 text-[11px] font-medium text-accent transition-colors hover:text-accent/80"
                          >
                            <Wrench className="size-3" />
                            {t({ ru: "Собрать билд вручную", en: "Build one from scratch" })}
                            <ChevronDown
                              className={cn("size-3 transition-transform", constructorOpen && "rotate-180")}
                            />
                          </button>

                          {constructorOpen && (
                            <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-2.5">
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
                                {Array.from({ length: 4 }, (_, i) => constructorSelected[i]).map((perk, i) =>
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
                                  placeholder={t({ ru: "Поиск перка…", en: "Search perks…" })}
                                  className="w-full rounded-full border border-border bg-background py-1.5 pr-3 pl-7 text-[11px] text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
                                />
                              </div>

                              <div className="grid max-h-40 grid-cols-6 gap-1 overflow-y-auto">
                                {constructorFiltered.map((perk) => {
                                  const selected = constructorSelected.some((p) => p.slug === perk.slug);
                                  return (
                                    <button
                                      key={perk.slug}
                                      type="button"
                                      onClick={() => toggleConstructorPerk(perk)}
                                      title={perk.name[language]}
                                      disabled={!selected && constructorSelected.length >= 4}
                                      className={cn(
                                        "flex items-center justify-center rounded-lg border-2 p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-30",
                                        selected ? "border-accent" : "border-transparent hover:border-border",
                                      )}
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element -- tiny picker thumbnail, next/image is overkill here */}
                                      <img
                                        src={withBasePath(perk.icon)}
                                        alt={perk.name[language]}
                                        width={30}
                                        height={30}
                                        className="size-[30px] rounded object-cover"
                                      />
                                    </button>
                                  );
                                })}
                              </div>

                              {constructorCommand && (
                                <div className="flex items-center gap-1.5 border-t border-border pt-2">
                                  <code className="min-w-0 flex-1 truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground">
                                    {constructorCommand}
                                  </code>
                                  <button
                                    type="button"
                                    onClick={handleCopyConstructorCommand}
                                    aria-label={t({ ru: "Скопировать команду", en: "Copy command" })}
                                    className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                                  >
                                    {constructorCopied ? (
                                      <Check className="size-3 text-accent" />
                                    ) : (
                                      <Copy className="size-3" />
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <p className="text-[11px] text-muted/60">
                    {t({
                      ru: "Twitch не даёт напрямую узнать «донатер» из чата — саб/VIP статус ближе всего к этому и виден в самом чате.",
                      en: "Twitch's chat itself has no notion of \"donator\" — sub/VIP status is the closest thing visible directly in chat.",
                    })}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
