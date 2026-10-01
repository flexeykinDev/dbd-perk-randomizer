"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ObsOverlayModal } from "./obs-overlay-modal";
import { useLanguage, useT } from "@/lib/i18n";
import { useTwitchSettings } from "@/lib/use-twitch-settings";
import { useObsHold } from "@/lib/use-obs-hold";
import { leaveStreamMode } from "@/lib/use-stream-mode";
import { loadLastObsState } from "@/lib/obs-sync";
import { getPerkBySlug } from "@/lib/perks";
import type { PerkRole, PieceVisibility } from "@/lib/types";

/**
 * The overlay's setup, given a page of its own.
 *
 * Counted on the real dialog: three tabs and thirty-one controls, inside a
 * card that also has to fit a phone. The board around it is not the problem
 * — measured at 1366px it carries no streamer-only control at rest, and the
 * one way in sits behind a collapsed disclosure. The crowding is inside the
 * dialog, and it is crowding the person who came to configure an overlay
 * with OBS open on the other monitor.
 *
 * It renders the SAME component the dialog does rather than a second copy of
 * thirty-one controls. Two surfaces built from one set of panels can drift
 * in exactly one way — not at all — and the alternative was duplicating the
 * wiring for the appearance, Twitch and constructor tabs three times over.
 *
 * The build it previews is the last one published to the overlay, read back
 * from the same localStorage mirror the overlay itself reads (see
 * lib/obs-sync.ts). That is deliberately not a fresh roll: this page is for
 * aiming the overlay, and a preview showing something the overlay is not
 * showing would be worse than no preview at all.
 */
export function StreamView() {
  const t = useT();
  const { lang } = useLanguage();
  /* Mounted gates hydration and the chat connection, exactly as it does on
     the board — nothing here may run during the server render.

     The command callbacks are no-ops on purpose. !reroll and !paste act on a
     build, and this page does not own one; connecting chat from here is for
     checking the connection works and reading the status dot, which is the
     thing a streamer actually comes here to verify. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    function markMounted() {
      setMounted(true);
    }
    markMounted();
  }, []);

  const twitch = useTwitchSettings({
    mounted,
    onReroll: () => {},
    onPaste: () => {},
  });

  // Nothing rolls here, so there is nothing to publish. The hold still has
  // to exist because the panels read its state, and holding is a real thing
  // to toggle from this page before a match starts.
  const hold = useObsHold(() => {});

  const [pieceVisibility, setPieceVisibility] = useState<PieceVisibility>({
    perks: true,
    item: true,
    addon: true,
    offering: true,
  });

  const published = useMemo(() => loadLastObsState(), []);
  const perks = useMemo(() => {
    if (!published) return [];
    // The mirror stores slugs and icons, not whole perks — resolve them back
    // through the same lookup every share link uses, so a perk the game has
    // since renamed still comes back (data/perk-slug-aliases.json).
    return published.perks.map((p) => getPerkBySlug(p.slug)).filter((p) => p !== undefined);
  }, [published]);

  const role: PerkRole = published?.role === "killer" ? "killer" : "survivor";

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Above the panels, not before them.
      
          The setup renders as a fixed, full-viewport layer — it is the same
          component the dialog uses, and that is the point. So this bar has
          to sit over it rather than above it in the flow, or the way back is
          drawn underneath the thing it is meant to escape. Caught by its own
          test: the click timed out because the button was behind the
          overlay. */}
      <header className="sticky top-0 z-[60] flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div>
          <h1 className="text-control font-semibold text-foreground">
            {t({ ru: "Настройка оверлея", en: "Overlay setup" })}
          </h1>
          <p className="text-hint text-muted">
            {t({
              ru: "Та же настройка, что в диалоге, но на целой странице — ссылка, вид, анимация, чат и конструктор.",
              en: "The same setup as the dialog, with room to see it — link, look, entrance, chat and constructor.",
            })}
          </p>
        </div>
        {/* The way back. A page with no exit is the failure mode of every
            hash route on this site, and this one is reached from a button
            that used to open a dialog you could dismiss with Escape. */}
        <button
          type="button"
          onClick={leaveStreamMode}
          className="tap flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-control font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t({ ru: "К доске", en: "Back to the board" })}
        </button>
      </header>

      <div className="relative flex-1 pt-6">
        <ObsOverlayModal
          open
          presentation="page"
          onClose={leaveStreamMode}
          perks={perks}
          mode="perks"
          loadoutPieces={[]}
          language={lang}
          role={role}
          character={published?.character ?? null}
          pieceVisibility={pieceVisibility}
          onPieceVisibilityChange={(kind, value) =>
            setPieceVisibility((prev) => ({ ...prev, [kind]: value }))
          }
          twitch={twitch}
          hold={hold}
        />
      </div>
    </div>
  );
}
