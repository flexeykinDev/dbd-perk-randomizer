"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { playSound, setMuted, setVolume, useSoundSettings } from "@/lib/sound";

/** Sound: one button, and a slider behind it.
 *
 *  Deliberately not a row of controls in the toolbar. The button carries the
 *  state everyone actually wants at a glance — on or off — and the volume
 *  lives one click away, because it is set once and then never touched. */
export function SoundControl() {
  const t = useT();
  const { muted, volume } = useSoundSettings();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const percent = Math.round(volume * 100);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          muted
            ? t({ ru: "Звук выключен", en: "Sound off" })
            : t({ ru: "Звук включён", en: "Sound on" })
        }
        data-testid="sound-control"
        data-muted={muted ? "1" : "0"}
        className="tap flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        {muted ? (
          <VolumeX className="size-3.5 shrink-0" />
        ) : (
          <Volume2 className="size-3.5 shrink-0" />
        )}
        <span className="hidden sm:inline">{t({ ru: "Звук", en: "Sound" })}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t({ ru: "Настройки звука", en: "Sound settings" })}
          className="absolute top-full right-0 z-30 mt-2 w-60 max-w-[calc(100vw-2rem)] origin-top rounded-2xl border border-border bg-surface p-3 shadow-xl"
        >
          <button
            type="button"
            onClick={() => setMuted(!muted)}
            data-testid="sound-mute"
            className="flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-surface-hover"
          >
            <span>{t({ ru: "Звук интерфейса", en: "Interface sound" })}</span>
            <span
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                muted ? "bg-border" : "bg-accent",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-background transition-all",
                  muted ? "left-0.5" : "left-4.5",
                )}
              />
            </span>
          </button>

          <label className="mt-2 block px-2">
            <span className="flex items-baseline justify-between text-[0.6875rem] text-muted">
              {t({ ru: "Громкость", en: "Volume" })}
              <span className="tabular-nums">{percent}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={percent}
              disabled={muted}
              data-testid="sound-volume"
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              // A cue on release, not on every step: dragging the slider
              // would otherwise fire twenty overlapping tones.
              // Plays the reel cue because that is what this slider sets the
              // level of; a preview in some other voice would mislead.
              onPointerUp={() => playSound("deal")}
              onKeyUp={() => playSound("deal")}
              className="mt-1.5 w-full accent-accent disabled:opacity-40"
            />
          </label>
        </div>
      )}
    </div>
  );
}
