"use client";

import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, X } from "lucide-react";
import type { Addon, LoadoutPiece, PerkRole } from "@/lib/types";
import { withBasePath } from "@/lib/asset-path";
import { getKillerPowerIcon, isNewLoadoutPiece } from "@/lib/loadout";
import { getCharacterPortrait } from "@/lib/perks";
import { getCharacterName } from "@/lib/character-name";
import { ROLE_COLOR } from "@/lib/role-color";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";

const KIND_LABEL: Record<LoadoutPiece["kind"], { ru: string; en: string }> = {
  item: { ru: "Предмет", en: "Item" },
  addon: { ru: "Аддон", en: "Add-on" },
  offering: { ru: "Подношение", en: "Offering" },
};

const ITEM_TYPE_LABEL: Record<string, { ru: string; en: string }> = {
  firecracker: { ru: "Петарда", en: "Firecracker" },
  flashlight: { ru: "Фонарик", en: "Flashlight" },
  key: { ru: "Ключ", en: "Key" },
  map: { ru: "Карта", en: "Map" },
  medkit: { ru: "Аптечка", en: "Med-Kit" },
  toolbox: { ru: "Набор инструментов", en: "Toolbox" },
  special: { ru: "Особый предмет", en: "Special" },
};

/** Lays pieces out like DBD's own loadout HUD — Item (or, for killer, the
 *  Power the rolled add-ons belong to) on the left, 2 Add-on slots in the
 *  middle, one Offering slot on the right — instead of a generic card
 *  grid, so a build reads at a glance the same way it does in-game. */
export function LoadoutGrid({
  pieces,
  role,
  language,
  loading = false,
  emptyMessage,
  onCopy,
}: {
  pieces: LoadoutPiece[];
  role: PerkRole;
  language: "en" | "ru";
  loading?: boolean;
  emptyMessage?: string;
  onCopy: (piece: LoadoutPiece) => void;
}) {
  const t = useT();
  const [detailPiece, setDetailPiece] = useState<LoadoutPiece | null>(null);
  const roleColor = ROLE_COLOR[role];

  if (loading) {
    return (
      <div className="flex min-h-[180px] w-full max-w-lg items-start justify-center gap-6 rounded-2xl border border-border bg-surface/40 p-4">
        <div className="size-24 animate-pulse rounded-xl border border-border bg-surface" />
        <div className="flex gap-2">
          <div className="size-16 animate-pulse rounded-xl border border-border bg-surface" />
          <div className="size-16 animate-pulse rounded-xl border border-border bg-surface" />
        </div>
        <div className="size-24 animate-pulse rounded-xl border border-border bg-surface" />
      </div>
    );
  }

  if (pieces.length === 0) {
    return (
      <div className="flex min-h-[180px] w-full max-w-md items-center justify-center rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted">
        {emptyMessage ?? t({ ru: "Пусто", en: "Nothing here" })}
      </div>
    );
  }

  const itemPiece = pieces.find((p) => p.kind === "item") ?? null;
  const addonPieces = pieces.filter((p): p is Addon => p.kind === "addon");
  const offeringPiece = pieces.find((p) => p.kind === "offering") ?? null;
  // All of a roll's killer add-ons belong to the same killer (see
  // getRandomLoadout) — any one of them carries that killer's name.
  const killerCharacter = role === "killer" ? (addonPieces[0]?.character ?? null) : null;
  const killerPowerIcon = killerCharacter ? getKillerPowerIcon(killerCharacter) : undefined;

  return (
    <>
      <div className="flex flex-wrap items-start justify-center gap-5 rounded-2xl border border-border bg-surface/40 p-4 sm:gap-8 sm:p-5">
        {role === "survivor" ? (
          <SlotGroup testId="loadout-slot-item" label={t({ ru: "Предмет", en: "Item" })}>
            <PieceSlot
              piece={itemPiece}
              size="lg"
              roleColor={roleColor}
              language={language}
              t={t}
              onOpenDetail={setDetailPiece}
              onCopy={onCopy}
            />
          </SlotGroup>
        ) : (
          <SlotGroup testId="loadout-slot-power" label={t({ ru: "Сила", en: "Power" })}>
            <PowerSlot icon={killerPowerIcon} character={killerCharacter} language={language} />
          </SlotGroup>
        )}

        <SlotGroup testId="loadout-slot-addons" label={t({ ru: "Аддоны", en: "Add-ons" })}>
          <div className="flex gap-2">
            <PieceSlot
              piece={addonPieces[0] ?? null}
              size="sm"
              roleColor={roleColor}
              language={language}
              t={t}
              onOpenDetail={setDetailPiece}
              onCopy={onCopy}
            />
            <PieceSlot
              piece={addonPieces[1] ?? null}
              size="sm"
              roleColor={roleColor}
              language={language}
              t={t}
              onOpenDetail={setDetailPiece}
              onCopy={onCopy}
            />
          </div>
        </SlotGroup>

        <SlotGroup testId="loadout-slot-offering" label={t({ ru: "Подношение", en: "Offering" })}>
          <PieceSlot
            piece={offeringPiece}
            size="lg"
            roleColor={roleColor}
            language={language}
            t={t}
            onOpenDetail={setDetailPiece}
            onCopy={onCopy}
          />
        </SlotGroup>
      </div>

      <LoadoutDetailModal piece={detailPiece} role={role} language={language} onClose={() => setDetailPiece(null)} />
    </>
  );
}

function SlotGroup({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="flex flex-col items-center gap-1.5">
      <span className="text-[10px] font-semibold tracking-wide text-muted uppercase">{label}</span>
      <div className="flex items-start gap-2">{children}</div>
    </div>
  );
}

type TFn = (text: { ru: string; en: string }) => string;

function PieceSlot({
  piece,
  size,
  roleColor,
  language,
  t,
  onOpenDetail,
  onCopy,
}: {
  piece: LoadoutPiece | null;
  size: "lg" | "sm";
  roleColor: (typeof ROLE_COLOR)[PerkRole];
  language: "en" | "ru";
  t: TFn;
  onOpenDetail: (piece: LoadoutPiece) => void;
  onCopy: (piece: LoadoutPiece) => void;
}) {
  const dim = size === "lg" ? "size-24" : "size-16";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={cn(dim, "relative shrink-0")}>
        <AnimatePresence mode="wait">
          {piece ? (
            <motion.div
              key={`${piece.kind}:${piece.slug}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2 }}
              role="button"
              tabIndex={0}
              onClick={() => onOpenDetail(piece)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenDetail(piece);
                }
              }}
              aria-label={t({ ru: "Описание:", en: "Description:" }) + " " + piece.name[language]}
              className={cn(
                "group absolute inset-0 flex cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none",
                roleColor.hoverBorder,
              )}
            >
              {isNewLoadoutPiece(piece) && (
                <span className="absolute top-0.5 left-0.5 z-10 rounded-full bg-black/60 px-1 py-px text-[7px] font-bold text-white/90 shadow">
                  {t({ ru: "НОВОЕ", en: "NEW" })}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCopy(piece);
                }}
                aria-label={t({ ru: "Копировать", en: "Copy" }) + " " + piece.name[language]}
                className="absolute top-0.5 right-0.5 z-10 flex size-4 items-center justify-center rounded-full bg-black/50 text-white/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:bg-black/70 hover:text-white"
              >
                <Copy className="size-2.5" />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
              <img
                src={withBasePath(piece.icon)}
                alt={piece.name[language]}
                className="size-full object-cover"
              />
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              aria-hidden
              className="absolute inset-0 rounded-xl border-2 border-dashed border-border/50 bg-background/30"
            />
          )}
        </AnimatePresence>
      </div>
      <span
        className={cn(
          "text-center text-[10px] leading-tight text-foreground",
          size === "lg" ? "w-24" : "w-16",
        )}
      >
        {piece ? piece.name[language] : " "}
      </span>
    </div>
  );
}

/** The killer-role counterpart of the Item slot — shows the Power the
 *  rolled add-ons belong to (killers carry a Power instead of an Item),
 *  or an empty placeholder while no killer has been determined yet (the
 *  Add-ons slot is off, or the icon wasn't found — see
 *  scripts/scrape-loadout.ts's scrapeKillerPowerIcons). */
function PowerSlot({
  icon,
  character,
  language,
}: {
  icon: string | undefined;
  character: string | null;
  language: "en" | "ru";
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      {icon && character ? (
        // eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts
        <img
          src={withBasePath(icon)}
          alt={getCharacterName(character, language)}
          className="size-24 rounded-xl border border-border bg-surface object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="size-24 rounded-xl border-2 border-dashed border-border/50 bg-background/30"
        />
      )}
      <span className="w-24 text-center text-[10px] leading-tight text-foreground">
        {character ? getCharacterName(character, language) : " "}
      </span>
    </div>
  );
}

function LoadoutDetailModal({
  piece,
  role,
  language,
  onClose,
}: {
  piece: LoadoutPiece | null;
  role: PerkRole;
  language: "en" | "ru";
  onClose: () => void;
}) {
  const t = useT();
  const roleColor = ROLE_COLOR[role];
  const character = piece?.kind === "addon" && piece.character !== ".All" ? piece.character : null;
  const portrait = character ? getCharacterPortrait(character) : undefined;
  const itemType = piece && "itemType" in piece ? piece.itemType : undefined;

  return (
    <AnimatePresence>
      {piece && (
        <motion.div
          initial={{ opacity: 0, pointerEvents: "none" }}
          animate={{ opacity: 1, pointerEvents: "auto" }}
          exit={{ opacity: 0, pointerEvents: "none" }}
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
                    src={withBasePath(piece.icon)}
                    alt={piece.name[language]}
                    width={56}
                    height={56}
                    className="size-14 rounded-xl object-cover"
                  />
                </span>
                <div>
                  <p className="font-semibold text-foreground">{piece.name[language]}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className={cn("font-medium", roleColor.text)}>{t(KIND_LABEL[piece.kind])}</span>
                    {itemType && (
                      <span className="text-muted">· {t(ITEM_TYPE_LABEL[itemType] ?? { ru: itemType, en: itemType })}</span>
                    )}
                    {piece.kind === "offering" && <span className="text-muted">· {piece.category}</span>}
                  </p>
                </div>
              </div>

              {character && (
                <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-surface/60 p-3">
                  <span
                    className={cn(
                      "relative shrink-0 overflow-hidden rounded-full ring-2 ring-offset-2 ring-offset-surface",
                      roleColor.ring,
                    )}
                  >
                    {portrait ? (
                      // eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts
                      <img
                        src={withBasePath(portrait)}
                        alt={getCharacterName(character, language)}
                        width={48}
                        height={48}
                        className="size-12 object-cover"
                      />
                    ) : (
                      <span className="flex size-12 items-center justify-center bg-surface text-muted">?</span>
                    )}
                  </span>
                  <div>
                    <p className="text-[11px] text-muted">{t({ ru: "Убийца", en: "Killer" })}</p>
                    <p className="text-sm font-medium text-foreground">{getCharacterName(character, language)}</p>
                  </div>
                </div>
              )}

              <p className="mt-4 text-sm leading-relaxed text-muted">{piece.description}</p>
              {language === "ru" && piece.name.ru === piece.name.en && (
                <p className="mt-2 text-[11px] text-muted/60">
                  {t({
                    ru: "Перевод для этого предмета пока не добавлен — название и описание показаны на английском.",
                    en: "No RU translation yet for this piece — name and description are shown in English.",
                  })}
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
