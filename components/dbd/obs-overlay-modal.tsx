"use client";

// The dialog itself: chrome, three tabs, and the wiring between them.
//
// It used to be all of that *plus* every appearance dial, the drag maths,
// the Twitch form, and the build constructor — around 1,500 lines with two
// dozen useState calls before the first line of markup. The tabs were
// already the seam; this just follows it. State that belongs to one tab now
// lives in a hook next to it (lib/use-obs-overlay-options.ts,
// lib/use-build-constructor.ts), and what's left here is the part that is
// genuinely about the modal: which tab is showing, and which props reach
// which panel.
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Copy, ExternalLink, MonitorPlay, X } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { useT, type Lang } from "@/lib/i18n";
import { getCharacterPortrait } from "@/lib/perks";
import type { LoadoutPiece, Perk, PerkRole, PieceVisibility } from "@/lib/types";
import { pasteCommandFor, useBuildConstructor } from "@/lib/use-build-constructor";
import { useCopyFeedback } from "@/lib/use-copy-feedback";
import { useObsPublishStatus, type ObsPublishState } from "@/lib/use-obs-mode";
import { useModal } from "@/lib/use-modal";
import { previewPiecesFor, useObsOverlayOptions } from "@/lib/use-obs-overlay-options";
import type { TwitchSettings } from "@/lib/use-twitch-settings";
import type { ObsHold } from "@/lib/use-obs-hold";
import { ObsAppearancePanel } from "./obs-appearance-panel";
import { ObsConstructorPanel } from "./obs-constructor-panel";
import { ObsHoldControl } from "./obs-hold-control";
import { ObsLayoutBookmarks } from "./obs-layout-bookmarks";
import { ObsPreviewCanvas } from "./obs-preview-canvas";
import { ObsTwitchPanel } from "./obs-twitch-panel";

export type { PieceVisibility };

/** Same dot vocabulary as the Twitch panel, for the Firebase link that
 *  feeds OBS's own browser profile. */
const PUBLISH_STATE_DOT: Record<ObsPublishState, string> = {
  off: "bg-muted",
  syncing: "bg-amber-400 animate-pulse",
  synced: "bg-emerald-400",
  error: "bg-red-500",
};

const PUBLISH_STATE_LABEL: Record<ObsPublishState, { ru: string; en: string }> = {
  off: { ru: "Ожидание первого билда", en: "Waiting for the first build" },
  syncing: { ru: "Отправка…", en: "Sending…" },
  synced: { ru: "Оверлей получает билды", en: "Overlay is receiving builds" },
  error: {
    ru: "Не доходит до оверлея в OBS",
    en: "Not reaching the overlay in OBS",
  },
};

/** "5 s ago" / "2 min ago" — deliberately coarse. The exact second doesn't
 *  matter; what matters mid-stream is whether this says seconds or minutes. */
function formatAgo(timestamp: number, lang: Lang): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return lang === "ru" ? `${seconds} с назад` : `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return lang === "ru" ? `${minutes} мин назад` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return lang === "ru" ? `${hours} ч назад` : `${hours}h ago`;
}

type PanelTab = "overlay" | "twitch" | "constructor";

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
  twitch,
  hold,
}: {
  open: boolean;
  onClose: () => void;
  perks: Perk[];
  /** Which build the live preview should mirror — matches whatever's being
   *  published to the overlay (see randomizer-board.tsx's publish effect),
   *  so the preview never shows something the real overlay wouldn't. */
  mode: "perks" | "loadout" | "all";
  loadoutPieces: LoadoutPiece[];
  language: Lang;
  role: PerkRole;
  /** The build's character, if one is known — see randomizer-board.tsx's
   *  `shareCharacter`. Drives the draggable portrait badge. */
  character?: string | null;
  pieceVisibility: PieceVisibility;
  onPieceVisibilityChange: (kind: keyof PieceVisibility, value: boolean) => void;
  /** The whole settings object from useTwitchSettings, rather than its
   *  eighteen fields as eighteen props. */
  twitch: TwitchSettings;
  /** Owned by the board, because the publish effect it gates lives there. */
  hold: ObsHold;
}) {
  const t = useT();
  const titleId = useId();
  const descId = useId();
  const publishStatus = useObsPublishStatus();
  // This one already had the role and the labelling; the hook adds the
  // Escape key and focus handling it was missing, and keeps all eight
  // dialogs behaving the same way.
  const { attachCard, dialogProps } = useModal({ open, onClose, labelledBy: titleId });
  const [panelTab, setPanelTab] = useState<PanelTab>("overlay");
  const [obsSetupOpen, setObsSetupOpen] = useState(false);

  const options = useObsOverlayOptions(open);
  const copy = useCopyFeedback();
  const constructor = useBuildConstructor(role, twitch.pasteCommand);

  const { pieces, slotCount } = previewPiecesFor({
    mode,
    perks,
    loadoutPieces,
    visibility: pieceVisibility,
  });

  // The !paste command that hands out whatever build is on screen right
  // now — built from the same short numeric IDs the Share links use, so a
  // streamer can read it out or pin it verbatim instead of going and
  // copying numbers out of a Share link.
  const pasteCommandForBuild = pasteCommandFor(perks, twitch.pasteCommand);

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
            ref={attachCard}
            {...dialogProps}
            aria-describedby={descId}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl lg:max-w-xl"
          >
            <div aria-live="polite" className="sr-only">
              {copy.announcement}
            </div>

            <header className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <MonitorPlay className="size-4.5" />
                </span>
                <div>
                  {/* A heading, not a styled <p>. This dialog is the only
                      place in the app with <h3> section headings (the panels
                      below), and with a <p> here they hung off the page's
                      <h1> with no <h2> in between — a skipped level, which is
                      what a screen reader navigating by heading actually
                      trips over. Tailwind's preflight drops the default
                      heading size and weight, so this looks identical. */}
                  <h2 id={titleId} className="font-semibold text-foreground">
                    {t({ ru: "Оверлей для OBS", en: "OBS Overlay" })}
                  </h2>
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
            </header>

            {/* Tabs rather than one long scroll: the Twitch form and the
                constructor are each occasional and opt-in, and inline they
                were most of what made this modal feel overwhelming (user
                feedback: "too much content", and the constructor being
                "very deep hidden"). */}
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
                {/* Sits directly under the link a streamer just pasted into
                    OBS, because that's the moment they need to know whether
                    it's actually working. Until this existed, a failed write
                    was invisible: the preview keeps updating over
                    BroadcastChannel regardless, so everything looked fine
                    while the Browser Source on stream sat frozen. */}
                <p className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.6875rem] text-muted">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      PUBLISH_STATE_DOT[publishStatus.state],
                    )}
                  />
                  {t(PUBLISH_STATE_LABEL[publishStatus.state])}
                  {publishStatus.lastSyncedAt !== null && (
                    <span className="opacity-70">
                      · {formatAgo(publishStatus.lastSyncedAt, language)}
                    </span>
                  )}
                </p>
                {publishStatus.state === "error" && (
                  <p className="mt-1 text-[0.6875rem] text-red-400">
                    {t({
                      ru: "Проверьте интернет и блокировщики. Оверлей в той же вкладке браузера продолжит работать.",
                      en: "Check your connection and any blockers. An overlay in this same browser keeps working.",
                    })}
                  </p>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <code
                    data-testid="obs-overlay-url"
                    className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
                  >
                    {options.url}
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      copy.copy(
                        "overlay-url",
                        options.url,
                        t({ ru: "Ссылка скопирована", en: "Link copied" }),
                      )
                    }
                    aria-label={t({ ru: "Скопировать ссылку", en: "Copy link" })}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                  >
                    {copy.isCopied("overlay-url") ? (
                      <Check className="size-4 text-accent" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                  <a
                    href={options.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t({ ru: "Открыть в новой вкладке", en: "Open in a new tab" })}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </div>

                <ObsHoldControl hold={hold} />

                <ObsPreviewCanvas
                  options={options}
                  pieces={pieces}
                  slotCount={slotCount}
                  language={language}
                  character={character}
                  characterPortrait={character ? getCharacterPortrait(character) : undefined}
                />

                <ObsLayoutBookmarks options={options} />

                <ObsAppearancePanel
                  options={options}
                  mode={mode}
                  pieceVisibility={pieceVisibility}
                  onPieceVisibilityChange={onPieceVisibilityChange}
                />

                <div className="mt-4 rounded-xl border border-border bg-background/60 p-3.5">
                  {/* Closed by default — reference material someone checks
                      once while setting up their Browser Source, not
                      something worth a permanent block of vertical space
                      every time the modal opens. */}
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
                        {t({ ru: "Вставь ссылку выше в поле URL", en: "Paste the link above into URL" })}
                      </li>
                      <li>
                        {t({ ru: "Ширина", en: "Width" })}:{" "}
                        <b className="text-foreground">{options.canvasWidth}</b> ·{" "}
                        {t({ ru: "Высота", en: "Height" })}:{" "}
                        <b className="text-foreground">{options.canvasHeight}</b>
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

                <p className="mt-3 text-xs text-muted">
                  {t({
                    ru: "Держи основную вкладку сайта открытой — оверлей просто зеркалит то, что на ней сгенерировано.",
                    en: "Keep the main site tab open — the overlay just mirrors whatever build is showing there.",
                  })}
                </p>
              </>
            )}

            {panelTab === "twitch" && (
              <ObsTwitchPanel
                twitch={twitch}
                copy={copy}
                pasteCommandForBuild={pasteCommandForBuild}
                onOpenConstructor={() => setPanelTab("constructor")}
              />
            )}

            {panelTab === "constructor" && (
              <ObsConstructorPanel
                constructor={constructor}
                copy={copy}
                language={language}
                pasteEnabled={twitch.pasteEnabled}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
