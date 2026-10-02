"use client";

import { Copy, Link2 } from "lucide-react";
import { DownloadImageButton } from "./download-image-button";
import type { ShareCardLayout } from "./share-card";
import { PresentationPicker } from "./presentation-picker";
import { SoundControl } from "./sound-control";
import { useT } from "@/lib/i18n";
import type { Presentation } from "@/lib/use-presentation";
import type { BuildMode, LoadoutPiece, Perk } from "@/lib/types";

/**
 * What you do to a build you already like.
 *
 * Below Generate rather than above it, which is the whole point of the row
 * existing as one thing. These used to sit directly under the cards, which put
 * the page's primary action last: measured at 1366x768, Generate landed at
 * y=671 of a 768px viewport and the shortcut legend below it was off the screen
 * entirely. Someone arriving had the three things you do with a finished build
 * in front of them and the one thing that makes a build out of sight.
 *
 * Quieter by weight, not by size: the borders are transparent until hover and
 * the type stays muted, but every button keeps `.tap` and its full-width phone
 * layout, because e2e/mobile.spec.ts measures every visible button against a
 * 44px target and these are five of them. Demote with colour, never with
 * geometry.
 */
export function ExportRow({
  mode,
  perks,
  loadoutPieces,
  sharePieceCount,
  squadActive,
  squadBuilds,
  onCopyAll,
  onShare,
  onDownloadImage,
  generatingImage,
  presentation,
  onPresentationChange,
  isDesktop,
  showSoundControl,
}: {
  mode: BuildMode;
  perks: Perk[];
  loadoutPieces: LoadoutPiece[];
  /** How many pieces a downloaded image would actually contain — already
   *  filtered by the overlay's visibility toggles, so hiding every kind
   *  disables the download rather than producing an empty card. */
  sharePieceCount: number;
  squadActive: boolean;
  squadBuilds: readonly Perk[][];
  onCopyAll: () => void;
  onShare: () => void;
  onDownloadImage: (layout: ShareCardLayout) => void;
  /** Which layout is rendering, not merely that one is: the button shows the
   *  spinner on the format you picked. */
  generatingImage: ShareCardLayout | null;
  presentation: Presentation;
  onPresentationChange: (next: Presentation) => void;
  isDesktop: boolean;
  /** Only where there is something to hear. Sound belongs to the slot machine,
   *  not to the site — see lib/sound.ts. */
  showSoundControl: boolean;
}) {
  const t = useT();

  const nothingToCopy = squadActive
    ? squadBuilds.every((build) => build.length === 0)
    : mode === "loadout"
      ? loadoutPieces.length === 0
      : mode === "all"
        ? perks.length === 0 && loadoutPieces.length === 0
        : perks.length === 0;

  return (
    <div className="flex w-full max-w-xs flex-col gap-2 sm:w-auto sm:max-w-none sm:flex-row sm:items-center sm:justify-center">
      <button
        type="button"
        onClick={onCopyAll}
        disabled={nothingToCopy}
        className="tap flex w-full items-center justify-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-control font-medium text-muted transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40 sm:w-auto"
      >
        <Copy className="size-3.5" />
        {mode === "loadout"
          ? t({ ru: "Скопировать всё", en: "Copy full loadout" })
          : t({ ru: "Скопировать всё", en: "Copy full build" })}
      </button>
      <button
        type="button"
        onClick={onShare}
        /* Squad links work; the four-up share card does not exist yet, so only
           the image download below stays out of squad mode. */
        disabled={squadActive && squadBuilds.length === 0}
        title={t({
          ru: "Ссылка на этот билд для обычного просмотра — не для OBS, для этого есть отдельная кнопка «Оверлей OBS».",
          en: "A link to view this exact build — not for OBS, use the separate “OBS Overlay” button for that.",
        })}
        className="tap flex w-full items-center justify-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-control font-medium text-muted transition-colors hover:border-border hover:bg-surface-hover hover:text-foreground sm:w-auto"
      >
        <Link2 className="size-3.5" />
        {t({ ru: "Поделиться", en: "Share" })}
      </button>
      <DownloadImageButton
        onSelect={onDownloadImage}
        generating={generatingImage}
        disabled={squadActive ? squadBuilds.length === 0 : sharePieceCount === 0}
        /* The squad poster exists in 16:9 only — see the note on
           useShareExport's `squad` input. Offering a story format that silently
           rendered the landscape one would be worse than not offering it. */
        layouts={squadActive ? ["landscape"] : undefined}
      />
      <PresentationPicker
        value={presentation}
        onChange={onPresentationChange}
        isDesktop={isDesktop}
      />
      {showSoundControl && <SoundControl />}
    </div>
  );
}
