"use client";

import { useEffect } from "react";
import { useT } from "@/lib/i18n";

/* Route-level recovery. The root layout stays mounted around this, so the nav,
 * the footer and LanguageProvider are all still here — which is why this can
 * use useT and why the visitor keeps a usable page instead of a blank one.
 *
 * `reset` re-renders the segment. That genuinely fixes the transient faults
 * (a description bundle that failed to load, a canvas that could not get a
 * context) and harmlessly does nothing for the rest, so it is always offered;
 * reloading is the second string for the ones reset cannot clear. */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  useEffect(() => {
    console.error("[route] rendering failed:", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex min-h-[50vh] w-full max-w-md flex-col items-center justify-center gap-4 text-center"
    >
      <h1 className="text-xl font-semibold text-foreground">
        {t({ ru: "Что-то сломалось", en: "Something broke" })}
      </h1>
      <p className="text-sm text-muted">
        {t({
          ru: "Страница не отрисовалась. Скорее всего это разовый сбой — попробуйте ещё раз.",
          en: "This page failed to render. It is most likely a one-off — try again.",
        })}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
        >
          {t({ ru: "Попробовать снова", en: "Try again" })}
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full border border-border bg-surface px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
        >
          {t({ ru: "Перезагрузить", en: "Reload" })}
        </button>
      </div>
      {/* Next strips the message in production builds and leaves this hash,
          which is the only handle on the actual fault when someone reports
          "it broke". Shown rather than console-only for that reason. */}
      {error.digest && (
        <p className="font-mono text-xs text-muted/70">{error.digest}</p>
      )}
    </div>
  );
}
