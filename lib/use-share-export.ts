"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { canvasToShareBlob, EXPORT_EXTENSION, saveImage } from "./save-image";
import { renderRitualBackdrop } from "./ritual-backdrop";
import { useT } from "./i18n";
import type { PerkRole, ShareCardLayout } from "./types";

/* Getting a build out of the page: as a link, or as an image.
 *
 * Both live here because they share the same failure surface — something
 * asynchronous, outside our control, that can decline (the clipboard, the
 * share sheet) — and both report through the same toast. The rasterising in
 * particular is fiddly enough that having it inline in a 2,000-line component
 * meant nobody could see all of it at once.
 */

export interface ShareExportController {
  /** Which layout is rasterising, or null. Drives the button's spinner and
   *  stops a second click starting a concurrent render. */
  generating: ShareCardLayout | null;
  /** Attach to the off-screen ShareCard for each layout. */
  cardRef: React.RefObject<HTMLDivElement | null>;
  storyCardRef: React.RefObject<HTMLDivElement | null>;
  /** One vortex per build, per layout. */
  backdrops: { landscape: string | null; story: string | null };
  copyLink: () => void;
  downloadImage: (layout: ShareCardLayout) => Promise<void>;
}

export function useShareExport({
  role,
  slugs,
  showToast,
}: {
  role: PerkRole;
  /** The slugs on the card, in order. Identifies the build for the backdrop
   *  and names the downloaded file. */
  slugs: string[];
  showToast: (message: string) => void;
}): ShareExportController {
  const t = useT();
  const [generating, setGenerating] = useState<ShareCardLayout | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const storyCardRef = useRef<HTMLDivElement>(null);

  const key = slugs.join(",");
  /* useMemo rather than state: the backdrop is a pure function of the build
     and the shape of the card, and recomputing it on an unrelated render
     would hand back a different picture for the same build. Both layouts are
     prepared up front because the off-screen cards are always mounted — the
     work is a single shader draw, not something worth deferring to the
     click. */
  const backdrops = useMemo(() => {
    const parts = key ? key.split(",") : [];
    if (parts.length === 0) return { landscape: null, story: null };
    return {
      landscape: renderRitualBackdrop({ width: 1600, height: 900, role, parts }),
      story: renderRitualBackdrop({ width: 1080, height: 1920, role, parts }),
    };
  }, [key, role]);

  const copyLink = useCallback(() => {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => showToast(t({ ru: "Ссылка на билд скопирована!", en: "Build link copied!" })))
      .catch(() =>
        showToast(t({ ru: "Не удалось скопировать ссылку", en: "Couldn't copy the link" })),
      );
  }, [showToast, t]);

  const downloadImage = useCallback(
    async (layout: ShareCardLayout) => {
      const target = layout === "story" ? storyCardRef.current : cardRef.current;
      if (!target || slugs.length === 0 || generating) return;
      setGenerating(layout);
      try {
        /* html2canvas draws text with canvas fillText using each element's
           computed font-family. If a webfont has not finished loading it does
           not fall back gracefully — it bakes the fallback face into the image
           and nothing reports a problem. The card is set in Oswald and IBM
           Plex Mono (lib/export-fonts.ts), so wait for them before
           rasterising. Cheap in practice: by the time anyone clicks, they are
           long loaded. */
        if (typeof document !== "undefined" && document.fonts?.ready) {
          await document.fonts.ready;
        }
        const { default: html2canvas } = await import("html2canvas");
        const canvas = await html2canvas(target, {
          // Background is baked into ShareCard's own gradient now (see
          // share-card.tsx), not a flat fill — this backgroundColor is just
          // the fallback if that CSS somehow fails to paint.
          backgroundColor: "#0d0e12",
          /* 2x, not 3x. Two reasons, both measured rather than assumed.
             Resolution: the card draws each icon at ~122px from a 256px
             source, so 2x renders it at 244px — just under native. 3x asked
             for 366px from the same 256px file, which is upscaling: more
             pixels, no more detail.
             Weight: the film grain is high-frequency noise, close to the worst
             case for PNG. At 3x the landscape export was 15 MB and the story
             export 22 MB — over what Discord accepts from a free account. */
          scale: 2,
          useCORS: true,
        });
        const suffix = layout === "story" ? "-story" : "";
        const filename = `dbd-${role}-build-${slugs.join("-")}${suffix}.${EXPORT_EXTENSION}`;
        // See lib/save-image.ts: this used to be an <a download> pointed at a
        // data: URL, which does nothing whatsoever on iOS and reported success
        // anyway.
        const outcome = await saveImage(await canvasToShareBlob(canvas), filename);
        if (outcome === "shared") {
          showToast(t({ ru: "Картинка билда готова!", en: "Build image ready!" }));
        } else if (outcome === "downloaded") {
          showToast(t({ ru: "Картинка билда скачана!", en: "Build image downloaded!" }));
        }
        // "cancelled" means the share sheet was dismissed on purpose. Nothing
        // went wrong and nothing was saved, so say neither.
      } catch {
        showToast(t({ ru: "Не удалось создать картинку", en: "Couldn't generate the image" }));
      } finally {
        setGenerating(null);
      }
    },
    [generating, role, showToast, slugs, t],
  );

  return { generating, cardRef, storyCardRef, backdrops, copyLink, downloadImage };
}
