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
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { withBasePath } from "@/lib/asset-path";
import { cn } from "@/lib/cn";
import { useT, type Lang } from "@/lib/i18n";
import type { TwitchConnectionState, TwitchPermission } from "@/lib/twitch-chat";
import type { Perk } from "@/lib/types";
import {
  DEFAULT_OBS_OPTIONS,
  MAX_OBS_SCALE,
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

// OBS's recommended Browser Source dimensions (see the setup steps below) —
// the live preview keeps the same aspect ratio so a dragged position lines
// up with where it'll actually land in OBS.
const PREVIEW_ASPECT = 800 / 220;
const PREVIEW_BASE_ICON_PX = 34;

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
  const [scale, setScale] = useState(DEFAULT_OBS_OPTIONS.scale);
  const [showNames, setShowNames] = useState(DEFAULT_OBS_OPTIONS.showNames);
  const [darkBg, setDarkBg] = useState(DEFAULT_OBS_OPTIONS.background === "dark");
  // null = no custom layout yet, overlay falls back to its default centered
  // row. Set the first time the user drags any icon in the preview below.
  const [positions, setPositions] = useState<ObsIconPosition[] | null>(null);
  const [twitchAdvancedOpen, setTwitchAdvancedOpen] = useState(false);
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
              <div
                ref={previewRef}
                className={cn(
                  "relative w-full touch-none overflow-hidden rounded-xl border border-border bg-[repeating-conic-gradient(#8884_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]",
                  darkBg && "bg-none bg-[#0b0c0f]",
                )}
                style={{ aspectRatio: PREVIEW_ASPECT }}
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
                        <span className="pointer-events-none inline-block max-w-16 truncate rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-white">
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
                  {t({ ru: "Ширина", en: "Width" })}: <b className="text-foreground">800</b> ·{" "}
                  {t({ ru: "Высота", en: "Height" })}: <b className="text-foreground">220</b>
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
