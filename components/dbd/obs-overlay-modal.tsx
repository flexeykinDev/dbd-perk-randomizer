"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, ExternalLink, MonitorPlay, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { DEFAULT_OBS_OPTIONS, obsOverlayUrl, type ObsCardSize } from "@/lib/use-obs-mode";

const SIZE_LABEL: Record<ObsCardSize, { ru: string; en: string }> = {
  sm: { ru: "Компакт", en: "Compact" },
  md: { ru: "Обычный", en: "Normal" },
  lg: { ru: "Крупный", en: "Large" },
};

export function ObsOverlayModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [size, setSize] = useState<ObsCardSize>(DEFAULT_OBS_OPTIONS.size);
  const [showNames, setShowNames] = useState(DEFAULT_OBS_OPTIONS.showNames);
  const [darkBg, setDarkBg] = useState(DEFAULT_OBS_OPTIONS.background === "dark");
  const url = obsOverlayUrl({ size, showNames, background: darkBg ? "dark" : "transparent" });

  function handleCopy() {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
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
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl"
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

            <div className="mt-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted">
                  {t({ ru: "Размер карточек", en: "Card size" })}
                </span>
                <div className="flex gap-1 rounded-full border border-border p-0.5">
                  {(["sm", "md", "lg"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSize(option)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                        size === option
                          ? "bg-accent text-accent-foreground"
                          : "text-muted hover:text-foreground",
                      )}
                    >
                      {t(SIZE_LABEL[option])}
                    </button>
                  ))}
                </div>
              </div>

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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
