"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Play, ChevronUp, ChevronDown } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useMounted } from "@/lib/use-mounted";
import { safeGet, safeSet } from "@/lib/safe-storage";

const COLLAPSED_STORAGE_KEY = "dbd-randomizer:video-collapsed";

function extractVideoId(src: string): string | null {
  const match = src.match(/embed\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function withAutoplay(src: string): string {
  const url = new URL(src);
  url.searchParams.set("autoplay", "1");
  return url.toString();
}

// YouTube's thumbnail CDN, best quality first. maxresdefault (1280x720, true
// 16:9) isn't generated for every video, so we fall back down the chain on
// load error instead of assuming it exists — hqdefault (480x360, 4:3) is
// the only size YouTube guarantees for every upload, but stretched across a
// 768px-wide 16:9 box it looks visibly soft, hence trying the sharper sizes
// first.
const THUMBNAIL_QUALITIES = ["maxresdefault", "sddefault", "hqdefault"] as const;

function thumbnailUrl(videoId: string, qualityIndex: number): string {
  return `https://img.youtube.com/vi/${videoId}/${THUMBNAIL_QUALITIES[qualityIndex]}.jpg`;
}

export function VideoEmbed({ src, title }: { src: string; title: string }) {
  const t = useT();
  const [playing, setPlaying] = useState(false);
  const [qualityIndex, setQualityIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const mounted = useMounted();
  const videoId = extractVideoId(src);

  useEffect(() => {
    function applyStoredCollapse() {
      setCollapsed(safeGet("local", COLLAPSED_STORAGE_KEY) === "1");
    }
    applyStoredCollapse();
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      safeSet("local", COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  // The server (and the client's very first render) always show the player
  // expanded — applying a localStorage-derived collapsed state before mount
  // would make that first render disagree with the server's HTML and throw
  // a hydration mismatch, same trap as the board's other persisted state.
  const isCollapsed = mounted && collapsed;

  return (
    <div className="mx-auto w-full max-w-3xl">
      {isCollapsed ? (
        <button
          type="button"
          onClick={toggleCollapsed}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <ChevronDown className="size-4" />
          {t({ ru: "Показать трейлер", en: "Show trailer" })}
        </button>
      ) : (
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/8 bg-black/60 shadow-xl shadow-black/40">
          <AnimatePresence mode="wait" initial={false}>
            {playing ? (
              <motion.iframe
                key="iframe"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="size-full"
                src={withAutoplay(src)}
                title={title}
                allow="autoplay; encrypted-media; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            ) : (
              <motion.button
                key="poster"
                type="button"
                onClick={() => setPlaying(true)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="group relative block size-full cursor-pointer"
                aria-label={t({ ru: "Воспроизвести:", en: "Play:" }) + " " + title}
              >
                {videoId && (
                  // eslint-disable-next-line @next/next/no-img-element -- external YouTube CDN thumbnail, unoptimized static export
                  <img
                    src={thumbnailUrl(videoId, qualityIndex)}
                    onError={() =>
                      setQualityIndex((i) => Math.min(i + 1, THUMBNAIL_QUALITIES.length - 1))
                    }
                    onLoad={(e) => {
                      // YouTube serves a 120x90 grey placeholder with HTTP
                      // 200 (not a 404) when a resolution wasn't generated
                      // for this video — onError never fires for that, so
                      // check dimensions ourselves and fall back the chain.
                      if (e.currentTarget.naturalWidth <= 120) {
                        setQualityIndex((i) => Math.min(i + 1, THUMBNAIL_QUALITIES.length - 1));
                      }
                    }}
                    alt={title}
                    className="size-full object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/45" />

                <span className="absolute top-3 left-3 max-w-[75%] truncate rounded-md bg-black/60 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                  {title}
                </span>

                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex size-16 items-center justify-center rounded-full bg-[#e53935] shadow-lg shadow-black/50 transition-all duration-200 group-hover:scale-110 group-hover:shadow-[0_0_28px_rgba(229,57,53,0.65)]">
                    <Play className="size-7 translate-x-0.5 text-white" fill="currentColor" />
                  </span>
                </span>
              </motion.button>
            )}
          </AnimatePresence>

          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={t({ ru: "Скрыть трейлер", en: "Hide video" })}
            title={t({ ru: "Скрыть трейлер", en: "Hide video" })}
            className="absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
          >
            <ChevronUp className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
