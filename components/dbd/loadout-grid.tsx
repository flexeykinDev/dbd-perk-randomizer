"use client";

import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, X } from "lucide-react";
import type { Addon, LoadoutPiece, PerkRole } from "@/lib/types";
import { withBasePath } from "@/lib/asset-path";
import { getKillerPowerIcon, isNewLoadoutPiece, ITEM_TYPE_LABEL } from "@/lib/loadout";
import { getCharacterPortrait } from "@/lib/perks";
import { getCharacterName } from "@/lib/character-name";
import { getLoadoutPieceDescription } from "@/lib/perk-description";
import { useDescription } from "@/lib/descriptions";
import { DescriptionSkeleton } from "./perk-grid";
import { useModal } from "@/lib/use-modal";
import { ROLE_COLOR } from "@/lib/role-color";
import { cn } from "@/lib/cn";
import { GENERAL_CHARACTER } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { Highlighted } from "./highlighted-text";

const KIND_LABEL: Record<LoadoutPiece["kind"], { ru: string; en: string }> = {
  item: { ru: "Предмет", en: "Item" },
  addon: { ru: "Аддон", en: "Add-on" },
  offering: { ru: "Подношение", en: "Offering" },
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
  const killerCharacter =
    role === "killer" ? (addonPieces[0]?.character ?? null) : null;
  const killerPowerIcon = killerCharacter
    ? getKillerPowerIcon(killerCharacter)
    : undefined;

  return (
    <>
      {/* Column below `sm`, row-with-wrap from `sm` up — plain flex-wrap at
          phone widths let the 3 differently-sized slot groups reflow into
          a lopsided 2-then-1 layout (Item+Add-ons on one row, Offering
          alone on the next) instead of reading as one clean stack. */}
      <div className="flex w-full max-w-4xl flex-col items-center justify-center gap-5 rounded-2xl border border-border bg-surface/40 p-4 sm:flex-row sm:flex-wrap sm:items-start sm:gap-8 sm:p-5">
        {role === "survivor" ? (
          <SlotGroup
            testId="loadout-slot-item"
            label={t({ ru: "Предмет", en: "Item" })}
          >
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
          <SlotGroup
            testId="loadout-slot-power"
            label={t({ ru: "Сила", en: "Power" })}
          >
            <PowerSlot
              icon={killerPowerIcon}
              character={killerCharacter}
              language={language}
              roleColor={roleColor}
            />
          </SlotGroup>
        )}

        <SlotGroup
          testId="loadout-slot-addons"
          label={t({ ru: "Аддоны", en: "Add-ons" })}
        >
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

        <SlotGroup
          testId="loadout-slot-offering"
          label={t({ ru: "Подношение", en: "Offering" })}
        >
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

      <LoadoutDetailModal
        piece={detailPiece}
        role={role}
        language={language}
        onCopy={onCopy}
        onClose={() => setDetailPiece(null)}
      />
    </>
  );
}

function SlotGroup({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId} className="flex flex-col items-center gap-1.5">
      <span className="text-[10px] font-semibold tracking-wide text-muted uppercase">
        {label}
      </span>
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
  // Scales up at wider breakpoints along with the grid's own w-full
  // max-2xl below — fixed-size slots left the whole HUD shrink-wrapped to
  // a few hundred px in the middle of a much wider page (same issue fixed
  // on PerkGrid's cards, see its comment).
  const dim = size === "lg" ? "size-24 sm:size-28 lg:size-32" : "size-16 sm:size-20 lg:size-24";
  const labelWidth = size === "lg" ? "w-24 sm:w-28 lg:w-32" : "w-16 sm:w-20 lg:w-24";
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
              /* What a piece actually is, published on the element itself.
                 The item/add-on pairing is the one thing here that has
                 been wrong in a way the page still renders confidently —
                 a Fog Vial shown holding Flashlight add-ons looks entirely
                 normal — so a test has no way to check it from the visible
                 text alone: it would have to map localized names back to
                 types and re-implement the bug to find it. These make the
                 pairing something the DOM states outright. */
              data-piece-kind={piece.kind}
              data-piece-slug={piece.slug}
              data-item-type={"itemType" in piece ? piece.itemType : undefined}
              data-character={piece.kind === "addon" ? piece.character : undefined}
              onClick={() => onOpenDetail(piece)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenDetail(piece);
                }
              }}
              aria-label={
                t({ ru: "Описание:", en: "Description:" }) +
                " " +
                piece.name[language]
              }
              className={cn(
                "absolute inset-0 flex cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none",
                roleColor.hoverBorder,
              )}
            >
              {isNewLoadoutPiece(piece) && (
                <span className="absolute top-0.5 left-0.5 z-10 rounded-full bg-black/60 px-1 py-px text-[7px] font-bold text-white/90 shadow">
                  {t({ ru: "НОВОЕ", en: "NEW" })}
                </span>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
              <img
                src={withBasePath(piece.icon)}
                alt={piece.name[language]}
                className="size-full icon-art object-cover"
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
          labelWidth,
        )}
      >
        {piece ? piece.name[language] : " "}
      </span>
      {piece && <PieceCopyButton size={size} onClick={() => onCopy(piece)} t={t} />}
    </div>
  );
}

/** A small, always-visible "Copy" button under a loadout piece — matches
 *  PerkGrid's card treatment (see perk-grid.tsx) instead of the tiny
 *  hover-only icon this replaced, which a touch device could never
 *  reveal at all. */
function PieceCopyButton({
  size,
  onClick,
  t,
}: {
  size: "lg" | "sm";
  onClick: () => void;
  t: TFn;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "tap flex items-center justify-center gap-1 rounded-md border border-border text-muted transition-colors hover:border-accent/50 hover:bg-accent/10 hover:text-accent",
        size === "lg" ? "w-24 py-1 text-[10px] sm:w-28 lg:w-32" : "w-16 py-0.5 text-[9px] sm:w-20 lg:w-24",
      )}
    >
      <Copy className={size === "lg" ? "size-3" : "size-2.5"} />
      {t({ ru: "Копировать", en: "Copy" })}
    </button>
  );
}

/** The killer-role counterpart of the Item slot — shows the Power the
 *  rolled add-ons belong to (killers carry a Power instead of an Item),
 *  or an empty placeholder while no killer has been determined yet (the
 *  Add-ons slot is off, or the icon wasn't found — see
 *  scripts/scrape-loadout.ts's scrapeKillerPowerIcons). The killer's own
 *  portrait rides along as a small badge in the corner — the "who this
 *  belongs to" signal the detail modal already gives, just visible at a
 *  glance on the HUD instead of only after opening a card. */
function PowerSlot({
  icon,
  character,
  language,
  roleColor,
}: {
  icon: string | undefined;
  character: string | null;
  language: "en" | "ru";
  roleColor: (typeof ROLE_COLOR)[PerkRole];
}) {
  const portrait = character ? getCharacterPortrait(character) : undefined;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative size-24 sm:size-28 lg:size-32">
        {icon && character ? (
          // eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts
          <img
            src={withBasePath(icon)}
            alt={getCharacterName(character, language)}
            className="size-24 rounded-xl border border-border icon-art object-cover sm:size-28 lg:size-32"
          />
        ) : (
          <div
            aria-hidden
            className="size-24 rounded-xl border-2 border-dashed border-border/50 bg-background/30 sm:size-28 lg:size-32"
          />
        )}
        {portrait && (
          <span
            className={cn(
              "absolute -right-2 -bottom-2 flex size-9 items-center justify-center overflow-hidden rounded-full border-2 bg-surface shadow-md",
              roleColor.border,
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts */}
            <img
              src={withBasePath(portrait)}
              alt=""
              aria-hidden
              className="size-full object-cover"
            />
          </span>
        )}
      </div>
      <span className="w-24 text-center text-[10px] leading-tight text-foreground sm:w-28 lg:w-32">
        {character ? getCharacterName(character, language) : " "}
      </span>
    </div>
  );
}

function LoadoutDetailModal({
  piece,
  role,
  language,
  onCopy,
  onClose,
}: {
  piece: LoadoutPiece | null;
  role: PerkRole;
  language: "en" | "ru";
  onCopy: (piece: LoadoutPiece) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { attachCard, dialogProps } = useModal({
    open: piece !== null,
    onClose,
    label: piece ? piece.name[language] : undefined,
  });
  const roleColor = ROLE_COLOR[role];
  const character =
    piece?.kind === "addon" && piece.character !== GENERAL_CHARACTER
      ? piece.character
      : null;
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
            ref={attachCard}
            {...dialogProps}
            /* Same fixed-header / scrolling-body / fixed-action shape as
               PerkDetailModal — see its comment. */
            className="modal-card relative flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-surface to-background text-left shadow-2xl"
          >
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute -top-16 left-1/2 h-40 w-64 -translate-x-1/2 rounded-full blur-3xl",
                roleColor.glow,
              )}
            />

            <div className="relative shrink-0 px-6 pt-6 pb-4">
              <button
                type="button"
                onClick={onClose}
                aria-label={t({ ru: "Закрыть", en: "Close" })}
                className="absolute top-4 right-4 flex size-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <X className="size-4" />
              </button>

              <div className="flex items-center gap-3 pr-8">
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
                    className="size-14 rounded-xl icon-art object-cover"
                  />
                </span>
                <div>
                  <p className="font-semibold text-foreground">
                    {piece.name[language]}
                  </p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className={cn("font-medium", roleColor.text)}>
                      {t(KIND_LABEL[piece.kind])}
                    </span>
                    {itemType && (
                      <span className="text-muted">
                        ·{" "}
                        {t(
                          ITEM_TYPE_LABEL[itemType] ?? {
                            ru: itemType,
                            en: itemType,
                          },
                        )}
                      </span>
                    )}
                    {piece.kind === "offering" && (
                      <span className="text-muted">· {piece.category}</span>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* min-h-0 is what lets this actually scroll instead of
                stretching the card — see PerkDetailModal. */}
            <div className="modal-scroll relative min-h-0 flex-1 px-6">
              {character && (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/60 p-3">
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
                      <span className="flex size-12 items-center justify-center bg-surface text-muted">
                        ?
                      </span>
                    )}
                  </span>
                  <div>
                    <p className="text-[11px] text-muted">
                      {t({ ru: "Убийца", en: "Killer" })}
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      {getCharacterName(character, language)}
                    </p>
                  </div>
                </div>
              )}

              <LoadoutDescriptionPanel
                key={`${piece.kind}:${piece.slug}`}
                piece={piece}
                role={role}
                language={language}
              />

              <div className="h-6" aria-hidden />
            </div>

            <div className="relative shrink-0 border-t border-border/60 bg-background/80 px-6 py-4 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => onCopy(piece)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-sm font-medium text-muted transition-colors hover:border-accent/50 hover:bg-accent/10 hover:text-accent"
              >
                <Copy className="size-3.5" />
                {t({ ru: "Копировать", en: "Copy" })}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type DescriptionTab = "core" | "full";

/** Same "core effect vs full text" toggle as PerkDescriptionPanel
 *  (components/dbd/perk-grid.tsx) — kept as its own component (not a
 *  shared import) since the two pull from different data shapes (Perk vs
 *  LoadoutPiece) even though getLoadoutPieceDescription/getPerkDescription
 *  share their derivation logic. Keyed by the caller so switching pieces
 *  resets the tab. */
function LoadoutDescriptionPanel({
  piece,
  role,
  language,
}: {
  piece: LoadoutPiece;
  /** Tints the highlighted values — see the Highlighted component. */
  role: PerkRole;
  language: "en" | "ru";
}) {
  const t = useT();
  const [tab, setTab] = useState<DescriptionTab>("core");
  // Keyed `kind:slug`: an item, an add-on and an offering can all slugify
  // to the same string. See lib/descriptions.ts for why this loads here
  // rather than shipping with the piece.
  const entry = useDescription("loadout", `${piece.kind}:${piece.slug}`);

  if (!entry) return <DescriptionSkeleton />;
  const description = getLoadoutPieceDescription(entry, language);
  // Moved in here from the modal body: it's a statement about the
  // description, and the description is what this component has.
  const untranslated =
    language === "ru" &&
    (piece.name.ru === piece.name.en || (!entry.descriptionRu && !entry.descriptionRuRaw));

  return (
    <div className="mt-4">
      <div className="inline-flex rounded-full border border-border bg-surface/60 p-0.5 text-xs font-medium">
        {(["core", "full"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTab(option)}
            className={cn(
              "rounded-full px-3 py-1 transition-colors",
              tab === option
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:text-foreground",
            )}
          >
            {option === "core"
              ? t({ ru: "Кратко", en: "Core Effect" })
              : t({ ru: "Подробно", en: "Full Text" })}
          </button>
        ))}
      </div>

      {tab === "core" ? (
        <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted">
          {description.core.map((bullet, i) => (
            <li key={i} className="flex gap-2">
              <span
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent"
                aria-hidden
              />
              <span>
                <Highlighted text={bullet} role={role} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-relaxed text-muted">
            <Highlighted text={description.full} role={role} />
          </p>
          {description.quote && (
            <p className="border-l-2 border-accent/40 pl-3 text-xs italic leading-relaxed text-muted/80">
              {description.quote}
            </p>
          )}
        </div>
      )}

      {untranslated && (
        <p className="mt-2 text-[11px] text-muted/60">
          {t({
            ru: "Перевод для этого предмета пока не добавлен — название и/или описание показаны на английском.",
            en: "No RU translation yet for this piece — the name and/or description are shown in English.",
          })}
        </p>
      )}
    </div>
  );
}
