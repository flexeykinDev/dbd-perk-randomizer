"use client";

import { RotateCcw } from "lucide-react";
import { withBasePath } from "@/lib/asset-path";
import { getCharacterName } from "@/lib/character-name";
import { cn } from "@/lib/cn";
import { useT, type Lang } from "@/lib/i18n";
import {
  PREVIEW_MIN_HEIGHT_PX,
  type ObsOverlayOptions,
  type PreviewPiece,
} from "@/lib/use-obs-overlay-options";

/** The draggable stand-in for the real Browser Source: a checkerboard (or
 *  dark) canvas at the configured aspect ratio, with one movable thumbnail
 *  per slot. Dragging here is what writes the positions encoded into the
 *  overlay link, so this is the only place the layout can be set. */
export function ObsPreviewCanvas({
  options,
  pieces,
  slotCount,
  language,
  character,
  characterPortrait,
}: {
  options: ObsOverlayOptions;
  pieces: PreviewPiece[];
  slotCount: number;
  language: Lang;
  character?: string | null;
  characterPortrait?: string;
}) {
  const t = useT();
  const {
    attachPreview,
    iconPx,
    characterPx,
    nameMaxWidthPx,
    background,
    showNames,
    canvasWidth,
    canvasHeight,
    resetLayout,
    slotPositionAt,
    dragSlot,
    dragCharacter,
    resizeCharacter,
    characterPositionOrDefault,
  } = options;

  return (
    <div className="mt-4">
      <h3 className="mb-1.5 text-xs font-medium text-muted">
        {t({ ru: "Превью — перетащи иконки", en: "Preview — drag the icons" })}
      </h3>

      <div
        ref={attachPreview}
        className={cn(
          "relative w-full touch-none overflow-hidden rounded-xl border border-border bg-[repeating-conic-gradient(#8884_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]",
          // The checkerboard means "transparent". Any skin paints its own
          // ground, so the checker would show through a lie.
          background !== "transparent" && "bg-none",
          background === "dark" && "bg-[#0b0c0f]",
          background === "vortex" && "bg-[#0a0c10]",
          background === "slots" && "bg-[#14171d]",
        )}
        style={{
          aspectRatio: canvasWidth / canvasHeight,
          minHeight: PREVIEW_MIN_HEIGHT_PX,
        }}
      >
        {/* An overlay action rather than a row above the canvas — keeps the
            canvas itself the tall, prominent element and puts "Reset" right
            where the icons it affects are. */}
        <button
          type="button"
          onClick={resetLayout}
          className="absolute top-2 right-2 z-20 flex items-center gap-1 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[0.6875rem] font-medium text-white/80 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
        >
          <RotateCcw className="size-3" />
          {t({ ru: "Сбросить", en: "Reset" })}
        </button>

        {Array.from({ length: slotCount }, (_, index) => {
          const piece = pieces[index];
          const pos = slotPositionAt(index);
          return (
            <div
              key={piece?.slug ?? `placeholder-${index}`}
              onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
              onPointerMove={(e) => {
                if (e.buttons !== 1) return;
                dragSlot(index, e.clientX, e.clientY);
              }}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab flex-col items-center gap-1 active:cursor-grabbing"
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            >
              <span
                className="flex items-center justify-center rounded-lg border-2 border-white/25 bg-black/70 p-0.5 shadow-lg"
                style={{ width: iconPx + 4, height: iconPx + 4 }}
              >
                {piece ? (
                  // eslint-disable-next-line @next/next/no-img-element -- tiny drag-preview thumbnail, next/image is overkill here
                  <img
                    src={withBasePath(piece.icon)}
                    alt={piece.name[language]}
                    width={iconPx}
                    height={iconPx}
                    style={{ width: iconPx, height: iconPx, objectFit: "cover" }}
                    className="rounded pointer-events-none select-none"
                    draggable={false}
                  />
                ) : (
                  <span
                    className="pointer-events-none block rounded bg-white/10"
                    style={{ width: iconPx, height: iconPx }}
                  />
                )}
              </span>
              {showNames && piece && (
                <span
                  className="line-clamp-2 pointer-events-none inline-block rounded-md bg-black/70 px-1.5 py-0.5 text-center text-[0.5625rem] leading-tight font-bold break-words text-white"
                  style={{ maxWidth: nameMaxWidthPx }}
                >
                  {piece.name[language]}
                </span>
              )}
            </div>
          );
        })}

        {character && characterPortrait && (
          <div
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={(e) => {
              if (e.buttons !== 1) return;
              dragCharacter(e.clientX, e.clientY);
            }}
            // Scrolling to resize needs a live preventDefault on the wheel
            // event itself — React's onWheel is passive by default, which
            // can't stop the page behind the modal from also scrolling.
            onWheel={(e) => {
              e.preventDefault();
              resizeCharacter(e.deltaY);
            }}
            title={t({
              ru: "Перетащи, чтобы переместить; крути колесо мыши, чтобы изменить размер",
              en: "Drag to move; scroll to resize",
            })}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab flex-col items-center gap-1 active:cursor-grabbing"
            style={{
              left: `${characterPositionOrDefault.x}%`,
              top: `${characterPositionOrDefault.y}%`,
            }}
          >
            <span
              className="flex items-center justify-center overflow-hidden rounded-full border-2 border-white/25 bg-black/70 shadow-lg"
              style={{ width: characterPx + 4, height: characterPx + 4 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- tiny drag-preview thumbnail, next/image is overkill here */}
              <img
                src={withBasePath(characterPortrait)}
                alt={getCharacterName(character, language)}
                width={characterPx}
                height={characterPx}
                style={{ width: characterPx, height: characterPx, objectFit: "cover" }}
                className="pointer-events-none select-none"
                draggable={false}
              />
            </span>
          </div>
        )}
      </div>

      <p className="mt-1.5 text-[0.6875rem] text-muted">
        {t({
          ru: "Позиции сохраняются в самой ссылке — «Сбросить» вернёт стандартный ряд по центру. Портрет персонажа: перетащи, чтобы переместить, крути колесо мыши над ним, чтобы изменить размер.",
          en: "Positions are saved right in the link — “Reset” restores the default centered row. Character portrait: drag to move it, scroll over it to resize.",
        })}
      </p>
    </div>
  );
}
