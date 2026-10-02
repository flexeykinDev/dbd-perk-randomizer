"use client";

import { useCallback, useRef, useState } from "react";
import { canvasToShareBlob, EXPORT_EXTENSION, saveImage } from "./save-image";
import { renderRitualBackdrop } from "./ritual-backdrop";
import { useT } from "./i18n";
import type { PerkRole, ShareCardLayout } from "./types";

/** Shared so a build with nothing drawn yet hands the off-screen cards the
 *  same object every render rather than a fresh one. */
const EMPTY_BACKDROPS = { landscape: null, story: null } as const;

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
  /** The four-up squad poster. A third card rather than a third layout of the
   *  first two: it is a different composition, not the same one at another
   *  aspect ratio — see components/dbd/squad-share-card.tsx. */
  squadCardRef: React.RefObject<HTMLDivElement | null>;
  /** One vortex per build, per layout. */
  backdrops: { landscape: string | null; story: string | null };
  copyLink: () => void;
  downloadImage: (layout: ShareCardLayout) => Promise<void>;
}

export function useShareExport({
  role,
  slugs,
  squad = false,
  showToast,
}: {
  role: PerkRole;
  /** The slugs on the card, in order. Identifies the build for the backdrop
   *  and names the downloaded file. */
  slugs: string[];
  /** True while the board is showing a squad, so the download targets the
   *  four-up poster. The squad card is landscape only — a 9:16 story of four
   *  builds would have to be solved backwards from a much narrower band, the
   *  way the story layout already was, and nobody has asked for it. */
  squad?: boolean;
  showToast: (message: string) => void;
}): ShareExportController {
  const t = useT();
  const [generating, setGenerating] = useState<ShareCardLayout | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const storyCardRef = useRef<HTMLDivElement>(null);
  const squadCardRef = useRef<HTMLDivElement>(null);

  const key = slugs.join(",");

  /* The backdrop is drawn when somebody asks for an image, not when the build
     changes.

     It used to be a useMemo keyed on the build, with a comment arguing that
     "the work is a single shader draw, not something worth deferring to the
     click". That was wrong, and the number is large: each roll compiled a
     shader, drew two canvases — 1600x900 and 1080x1920 — and JPEG-encoded both
     through toDataURL. Sampled while spamming the 1-4 slot-reroll keys,
     toDataURL alone was 52.7% of all CPU time, 1408ms out of 2669ms, and the
     page dropped 21 of 79 frames. Holding Space or leaning on 1-4 was
     measurably janky for everyone, to prepare a picture that is only ever
     looked at by someone who clicks Download Image.

     Cached by build and role so a second export of the same build is free, and
     so switching between the landscape and story formats draws each once. */
  /** What has been drawn, and for which build. Held together on purpose: the
   *  off-screen card must never show the previous build's backdrop, because
   *  html2canvas would bake it into the export. Pairing the picture with the
   *  build it belongs to makes that a derivation rather than an effect that
   *  races the render. */
  const [drawn, setDrawn] = useState<{
    for: string;
    landscape: string | null;
    story: string | null;
  }>({ for: "", landscape: null, story: null });

  const current = `${role}:${key}`;
  const backdrops =
    drawn.for === current
      ? { landscape: drawn.landscape, story: drawn.story }
      : EMPTY_BACKDROPS;

  const ensureBackdrop = useCallback(
    (layout: ShareCardLayout) => {
      const parts = key ? key.split(",") : [];
      if (parts.length === 0) return;
      const size =
        layout === "story"
          ? { width: 1080, height: 1920 }
          : { width: 1600, height: 900 };
      const picture = renderRitualBackdrop({ ...size, role, parts });
      const slot = layout === "story" ? "story" : "landscape";
      setDrawn((prev) => {
        const base = prev.for === `${role}:${key}` ? prev : { for: `${role}:${key}`, landscape: null, story: null };
        if (base[slot] === picture) return base;
        return { ...base, [slot]: picture };
      });
    },
    [key, role],
  );

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
      const target = squad
        ? squadCardRef.current
        : layout === "story"
          ? storyCardRef.current
          : cardRef.current;
      if (!target || slugs.length === 0 || generating) return;
      setGenerating(layout);
      try {
        /* Draw the backdrop now, and let React commit it before html2canvas
           reads the node — a capture taken in the same tick would rasterise
           the card without it. Two frames: one for the commit, one for the
           paint. */
        ensureBackdrop(layout);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
        const suffix = squad ? "-squad" : layout === "story" ? "-story" : "";
        /* A squad's filename would otherwise be sixteen slugs long, which
           Windows rejects outright past 255 characters and every chat client
           truncates. The link carries the build; the file only has to say
           what it is. */
        const stem = squad ? `${slugs.length}-perks` : slugs.join("-");
        const filename = `dbd-${role}-build-${stem}${suffix}.${EXPORT_EXTENSION}`;
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
    [ensureBackdrop, generating, role, showToast, slugs, squad, t],
  );

  return { generating, cardRef, storyCardRef, squadCardRef, backdrops, copyLink, downloadImage };
}
