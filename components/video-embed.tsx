"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { useT } from "@/lib/i18n";

function extractVideoId(src: string): string | null {
  const match = src.match(/embed\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function withAutoplay(src: string): string {
  const url = new URL(src);
  url.searchParams.set("autoplay", "1");
  return url.toString();
}

export function VideoEmbed({ src, title }: { src: string; title: string }) {
  const t = useT();
  const [playing, setPlaying] = useState(false);
  const videoId = extractVideoId(src);

  return (
    <div className="relative mx-auto aspect-video w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-black shadow-lg">
      {playing ? (
        <iframe
          className="size-full"
          src={withAutoplay(src)}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="group relative size-full cursor-pointer"
          aria-label={t({ ru: "Воспроизвести:", en: "Play:" }) + " " + title}
        >
          {videoId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
              alt={title}
              className="size-full object-cover"
            />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover:bg-black/40">
            <span className="flex size-16 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg transition-transform group-hover:scale-110">
              <Play className="size-7 translate-x-0.5" fill="currentColor" />
            </span>
          </div>
        </button>
      )}
    </div>
  );
}
