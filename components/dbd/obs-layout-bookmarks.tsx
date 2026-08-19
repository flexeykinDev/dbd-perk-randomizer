"use client";

import { Bookmark, Plus, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { MAX_LAYOUT_NAME, useObsLayouts } from "@/lib/obs-layouts";
import type { ObsOverlayOptions } from "@/lib/use-obs-overlay-options";

/** Saves the current arrangement under a name so a second scene doesn't
 *  mean dragging eight icons again. Sits under the preview, next to the
 *  work it bookmarks. */
export function ObsLayoutBookmarks({ options }: { options: ObsOverlayOptions }) {
  const t = useT();
  const { layouts, save, remove, isFull } = useObsLayouts();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  function commit() {
    save(name, options.snapshot());
    setName("");
    setNaming(false);
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-background/60 p-3">
      <div className="flex items-center gap-2">
        <Bookmark className="size-3.5 shrink-0 text-muted" />
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
          {t({ ru: "Мои раскладки", en: "Saved layouts" })}
        </h3>
      </div>

      {layouts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {layouts.map((layout) => (
            <span
              key={layout.name}
              className="flex items-center gap-1 rounded-full border border-border bg-surface pl-2.5 text-[11px]"
            >
              <button
                type="button"
                onClick={() => options.applySnapshot(layout.snapshot)}
                className="py-1 font-medium text-foreground transition-colors hover:text-accent"
              >
                {layout.name}
              </button>
              <button
                type="button"
                onClick={() => remove(layout.name)}
                aria-label={t({
                  ru: `Удалить раскладку ${layout.name}`,
                  en: `Delete layout ${layout.name}`,
                })}
                className="flex size-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {naming ? (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="text"
            autoFocus
            value={name}
            maxLength={MAX_LAYOUT_NAME}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setNaming(false);
            }}
            placeholder={t({ ru: "Например, «Игровая сцена»", en: "e.g. “Gameplay scene”" })}
            aria-label={t({ ru: "Название раскладки", en: "Layout name" })}
            className="min-w-0 flex-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
          />
          <button
            type="button"
            onClick={commit}
            disabled={!name.trim()}
            className="rounded-full bg-accent px-3 py-1 text-[11px] font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {t({ ru: "Сохранить", en: "Save" })}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          disabled={isFull}
          className={cn(
            "mt-2 flex items-center gap-1 text-[11px] font-medium transition-colors",
            isFull ? "cursor-not-allowed text-muted/50" : "text-accent hover:text-accent/80",
          )}
        >
          <Plus className="size-3" />
          {t({ ru: "Сохранить текущую", en: "Save the current one" })}
        </button>
      )}

      <p className="mt-1.5 text-[11px] text-muted/70">
        {t({
          ru: "Сохраняются настройки, а не ссылка — раскладку можно применить, и ссылка соберётся заново. Хранится только в этом браузере.",
          en: "Stores the settings rather than the link — applying one rebuilds the link. Kept in this browser only.",
        })}
      </p>
    </div>
  );
}
