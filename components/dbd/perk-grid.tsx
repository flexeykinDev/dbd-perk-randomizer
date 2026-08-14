"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Info, X } from "lucide-react";
import type { Perk } from "@/lib/types";
import { withBasePath } from "@/lib/asset-path";
import { isNewPerk, getCharacterPortrait } from "@/lib/perks";
import { ROLE_COLOR } from "@/lib/role-color";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

export function PerkGrid({
  perks,
  language,
  loading = false,
  emptyMessage,
  onCopy,
}: {
  perks: Perk[];
  language: "en" | "ru";
  loading?: boolean;
  emptyMessage?: string;
  onCopy: (perk: Perk) => void;
}) {
  const t = useT();
  const [detailPerk, setDetailPerk] = useState<Perk | null>(null);

  if (loading) {
    return (
      <div className="grid min-h-[220px] grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square animate-pulse rounded-2xl border border-border bg-surface"
          />
        ))}
      </div>
    );
  }

  if (perks.length === 0) {
    return (
      <div className="flex min-h-[220px] w-full max-w-md items-center justify-center rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">
        {emptyMessage ?? t({ ru: "Пусто", en: "Nothing here" })}
      </div>
    );
  }

  return (
    <>
      <div className="grid min-h-[220px] grid-cols-2 gap-4 sm:grid-cols-4">
        <AnimatePresence mode="popLayout">
          {perks.map((perk, index) => {
            const roleColor = ROLE_COLOR[perk.role];
            return (
              <motion.div
                key={perk.slug}
                initial={{ opacity: 0, scale: 0.85, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.25, delay: index * 0.05 }}
                className={cn(
                  "group relative flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-3 text-center transition-colors hover:bg-surface-hover",
                  roleColor.hoverBorder,
                )}
              >
                {isNewPerk(perk) && (
                  <span
                    className={cn(
                      "absolute -top-2 -left-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow",
                      perk.role === "survivor" ? "bg-sky-500" : "bg-rose-500",
                    )}
                  >
                    NEW
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setDetailPerk(perk)}
                  aria-label={
                    t({ ru: "Описание:", en: "Description:" }) + " " + perk.name[language]
                  }
                  className="absolute top-1.5 right-1.5 z-10 flex size-6 items-center justify-center rounded-full bg-black/40 text-white/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:bg-black/60 hover:text-white"
                >
                  <Info className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onCopy(perk)}
                  className="flex cursor-pointer flex-col items-center gap-2"
                >
                  <span className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
                    <img
                      src={withBasePath(perk.icon)}
                      alt={perk.name[language]}
                      width={96}
                      height={96}
                      className="rounded-xl transition-transform group-hover:scale-105"
                    />
                    <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
                      <Copy className="size-5 text-white" />
                    </span>
                  </span>
                  <span className="text-xs font-medium text-foreground">
                    {perk.name[language]}
                  </span>
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <PerkDetailModal
        perk={detailPerk}
        language={language}
        onClose={() => setDetailPerk(null)}
      />
    </>
  );
}

function PerkDetailModal({
  perk,
  language,
  onClose,
}: {
  perk: Perk | null;
  language: "en" | "ru";
  onClose: () => void;
}) {
  const t = useT();
  const roleColor = perk ? ROLE_COLOR[perk.role] : null;
  const portrait = perk ? getCharacterPortrait(perk.character) : undefined;

  return (
    <AnimatePresence>
      {perk && roleColor && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-surface to-background text-left shadow-2xl"
          >
            {/* Soft role-colored glow behind the header — the "lighter"
                treatment instead of a flat gray panel. */}
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute -top-16 left-1/2 h-40 w-64 -translate-x-1/2 rounded-full blur-3xl",
                roleColor.glow,
              )}
            />

            <div className="relative p-6">
              <button
                type="button"
                onClick={onClose}
                aria-label={t({ ru: "Закрыть", en: "Close" })}
                className="absolute top-0 right-0 flex size-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <X className="size-4" />
              </button>

              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "relative shrink-0 rounded-xl ring-2 ring-offset-2 ring-offset-surface",
                    roleColor.ring,
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
                  <img
                    src={withBasePath(perk.icon)}
                    alt={perk.name[language]}
                    width={56}
                    height={56}
                    className="rounded-xl"
                  />
                </span>
                <div>
                  <p className="font-semibold text-foreground">
                    {perk.name[language]}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs">
                    <span className={cn("font-medium", roleColor.text)}>
                      {perk.role === "survivor"
                        ? t({ ru: "Выживший", en: "Survivor" })
                        : t({ ru: "Убийца", en: "Killer" })}
                    </span>
                    <span className="text-muted">· {perk.character}</span>
                  </p>
                </div>
              </div>

              {portrait && (
                <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-surface/60 p-3">
                  <span
                    className={cn(
                      "relative shrink-0 overflow-hidden rounded-full ring-2 ring-offset-2 ring-offset-surface",
                      roleColor.ring,
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
                    <img
                      src={withBasePath(portrait)}
                      alt={perk.character}
                      width={48}
                      height={48}
                      className="size-12 object-cover"
                    />
                  </span>
                  <div>
                    <p className="text-[11px] text-muted">
                      {t({ ru: "Персонаж", en: "Character" })}
                    </p>
                    <p className="text-sm font-medium text-foreground">{perk.character}</p>
                  </div>
                </div>
              )}

              <p className="mt-4 text-sm leading-relaxed text-muted">
                {perk.description}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
