"use client";

import type { Ref } from "react";
import { ShareCard } from "./share-card";
import { SquadShareCard } from "./squad-share-card";
import type { ShareCardPiece } from "./share-card-types";
import type { Lang } from "@/lib/i18n";
import type { PerkRole } from "@/lib/types";

/**
 * The three cards html2canvas rasterizes, parked off screen.
 *
 * They have to be real, laid-out DOM for the download to work — html2canvas
 * draws what the browser already computed, so a card rendered only at the
 * moment of the click would have no layout to read. Hence `position: fixed`
 * at `left: -9999` rather than `display: none`, which would give it none.
 *
 * Lifted out of randomizer-board.tsx because it is the clearest case of what
 * CLAUDE.md's architecture note is about: fifty lines the board renders and
 * never looks at again. It owns no state, makes no decisions, and the board
 * is already 2300 lines.
 */
export function ShareExportStage({
  squadBuilds,
  squadRef,
  shareRef,
  storyRef,
  pieces,
  mode,
  role,
  language,
  character,
  backdrops,
}: {
  /** Empty unless squad mode is on and has rolled. */
  squadBuilds: ShareCardPiece[][];
  squadRef: Ref<HTMLDivElement>;
  shareRef: Ref<HTMLDivElement>;
  storyRef: Ref<HTMLDivElement>;
  pieces: ShareCardPiece[];
  mode: "perks" | "loadout" | "all";
  role: PerkRole;
  language: Lang;
  character?: string | null;
  backdrops: { landscape: string | null; story: string | null };
}) {
  return (
    <div
      aria-hidden
      style={{ position: "fixed", top: 0, left: -9999, pointerEvents: "none" }}
    >
      {squadBuilds.length > 0 && (
        <SquadShareCard
          ref={squadRef}
          builds={squadBuilds}
          role={role}
          language={language}
          backdrop={backdrops.landscape}
        />
      )}
      <ShareCard
        ref={shareRef}
        pieces={pieces}
        mode={mode}
        role={role}
        language={language}
        character={character}
        backdrop={backdrops.landscape}
      />
      {/* The 9:16 variant. Same build, different frame — see useShareExport. */}
      <ShareCard
        ref={storyRef}
        pieces={pieces}
        mode={mode}
        role={role}
        language={language}
        character={character}
        layout="story"
        backdrop={backdrops.story}
      />
    </div>
  );
}
