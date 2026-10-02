"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dices, Skull, BarChart3 } from "lucide-react";
import {
  getAvailablePool,
  getCharactersForRole,
  getPerksByRole,
} from "@/lib/perks";
import { resolvePreset, type BuildPreset } from "@/lib/build-presets";
import { useBoardShortcuts } from "@/lib/use-board-shortcuts";
import type {
  Addon,
  LoadoutPiece,
  LoadoutSlots,
  Perk,
  PerkRole,
  BuildMode,
} from "@/lib/types";
import { cn } from "@/lib/cn";
import { useMounted } from "@/lib/use-mounted";
import { prefetchDescriptions } from "@/lib/descriptions";
import { useObsHold } from "@/lib/use-obs-hold";
import { useBuildClipboard } from "@/lib/use-build-clipboard";
import { ROLE_COLOR } from "@/lib/role-color";
import { getBuildTheme } from "@/lib/build-theme";
import { useLanguage, useT } from "@/lib/i18n";
import { useSeed } from "@/lib/use-seed";
import { useBattleRoyale } from "@/lib/use-battle-royale";
import { useSquad } from "@/lib/use-squad";
import { useSetupDisclosure } from "@/lib/use-setup-disclosure";
import { useCoherence } from "@/lib/use-coherence";
import { useDailyStreak } from "@/lib/use-daily-streak";
import { useExclusions } from "@/lib/use-exclusions";
import { useRollSession, type RollSession } from "@/lib/use-roll-session";
import { useShareExport } from "@/lib/use-share-export";
import { MAX_PERK_COUNT, useBoardSettings } from "@/lib/use-board-settings";
import { readInitialUrlState } from "@/lib/share-link";
import { track } from "@/lib/track";
import {
  resolveLoadoutKeys,
  resolvePerkIdList,
  resolvePerkSlugs,
} from "@/lib/installed-build";
import { useShareUrl } from "@/lib/use-share-url";
import { PoolStatsPanel } from "./pool-stats-panel";
import { BoardToolbar } from "./board-toolbar";
import { ShareExportStage } from "./share-export-stage";
import { SetupDisclosure } from "./setup-disclosure";
import { SetupPanel } from "./setup-panel";
import { ModeSelect } from "./mode-select";
import { ExportRow } from "./export-row";
import { getSeenSlugs, recordRoll } from "@/lib/stats";
import { recordHistoryEntry, type HistoryEntry } from "@/lib/history";
import { rollUnseenPerks } from "@/lib/unseen-roll";
import type { VaultBuild } from "@/lib/vault";
import { tallyVotes, VOTE_SLOTS, type VoteResult } from "@/lib/chat-vote";
import type { ObsVote } from "@/lib/obs-sync";
import { getKillerCharacters, getLoadoutPoolForRole } from "@/lib/loadout";
import { publishObsState } from "@/lib/obs-sync";
import { useTwitchSettings } from "@/lib/use-twitch-settings";
import { PerkGrid } from "./perk-grid";
import { SquadGrids } from "./squad-grids";
import { LoadoutGrid } from "./loadout-grid";
import { CopyToast } from "./copy-toast";
import { ExcludePanel } from "./exclude-panel";
import { LoadoutExcludePanel } from "./loadout-exclude-panel";
import { StatsModal } from "./stats-modal";
import { HistoryModal } from "./history-modal";
import { PresetsModal } from "./presets-modal";
import { VaultModal } from "./vault-modal";
import { ToggleSwitch } from "./toggle-switch";
import {
  type ShareCardPiece,
} from "./share-card";
import { ObsOverlayModal } from "./obs-overlay-modal";
import { CharacterPickerModal } from "./character-picker-modal";
import { playSound, setSoundSurface } from "@/lib/sound";
import { RitualStage } from "./ritual-stage";
import { SlotsStage } from "./slots-stage";
import { ErrorBoundary } from "../error-boundary";
import { useIsDesktop } from "@/lib/use-is-desktop";
import {
  GRID_PRESENTATIONS,
  isAvailable,
  usePresentation,
} from "@/lib/use-presentation";

const ROLE_LABEL: Record<PerkRole, { ru: string; en: string }> = {
  survivor: { ru: "выжившего", en: "survivor" },
  killer: { ru: "убийцы", en: "killer" },
};
const ROLE_NAME: Record<PerkRole, { ru: string; en: string }> = {
  survivor: { ru: "Выживший", en: "Survivor" },
  killer: { ru: "Убийца", en: "Killer" },
};



export function RandomizerBoard() {
  const t = useT();
  const { lang: language } = useLanguage();
  const [role, setRole] = useState<PerkRole>("survivor");
  // Pool exclusions, favourites and the pool manager — see lib/use-exclusions.ts.
  // Both start at SSR-safe defaults and are corrected from localStorage in
  // the mount effect below — a lazy useState(loadX) initializer would read
  // localStorage during the client's first render, which happens *before*
  // hydration reconciles against the server's (window-less) HTML and would
  // throw a hydration mismatch for any returning visitor with saved state.
  //
  // The five settings that rule applies to — perk count, mode, loadout slots,
  // guaranteed teachables, overlay visibility — live in lib/use-board-settings.ts
  // with their storage keys. What a change to one of them costs the build on
  // screen is decided below, where the roll session is in scope.
  const settings = useBoardSettings();
  const {
    perkCount,
    mode,
    loadoutSlots,
    guaranteeTeachables,
    pieceVisibility,
  } = settings;
  /* Named, like every other hook's callbacks here: the mount effect below
     needs them in its dependency list, and `settings` is a fresh object on
     every render. Depending on the object would restart an effect that sets
     state — an endless loop, not merely wasted work. All three are stable. */
  const hydrateSettings = settings.hydrate;
  const showMode = settings.showMode;
  const showPerkCount = settings.showPerkCount;
  // Random Character (Feature #2) — deliberately session-only, not synced
  // to the URL or localStorage: it's a flourish on top of a build, not
  // part of what a share link or a returning visit needs to restore.
  // guaranteeTeachables (the perks-mode "always include this character's
  // own perks" toggle) IS persisted, same as the other pool/settings
  // toggles — it only has an effect once a character is actually selected.
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(
    null,
  );
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [presetsModalOpen, setPresetsModalOpen] = useState(false);
  const [vaultModalOpen, setVaultModalOpen] = useState(false);
  const [obsModalOpen, setObsModalOpen] = useState(false);
  const [statsVersion, setStatsVersion] = useState(0);
  /* The Daily Challenge streak. Local only, by design — see the privacy
     note in lib/use-daily-streak.ts. */
  const dailyStreak = useDailyStreak();
  const hydrateDailyStreak = dailyStreak.hydrate;
  const recordDailyStreak = dailyStreak.record;

  /* How much the roll leans toward a build that hangs together — see
     lib/coherence.ts. Level 0 is the roll this site has always done. */
  const coherence = useCoherence();
  const hydrateCoherence = coherence.hydrate;
  /* Pulled out for the mount effect's dependency list: useCoherence returns a
     fresh object each render, so depending on the controller would re-run
     that once-only hydration on every roll. Both callbacks are stable. */
  const setCoherenceLevel = coherence.setLevel;

  /* Battle Royale — play until the pool runs dry. See lib/use-battle-royale.ts. */
  const br = useBattleRoyale();

  /* Squad mode — one build per member of a SWF team. See lib/use-squad.ts;
     the roll itself is lib/squad-roll.ts. Only meaningful in "perks" mode:
     a squad of loadouts is a different question and nobody has asked it. */
  const squad = useSquad();
  const setup = useSetupDisclosure();
  const squadActive = squad.active && mode === "perks";
  /* Pulled out because the mount effect below needs it in its dependency
     list. useSquad returns a fresh object each render, so depending on the
     controller itself would re-run that once-only hydration on every roll;
     `show` is a stable useCallback and does not. */
  const showSquad = squad.show;
  const hydrateSquad = squad.hydrate;
  const hydrateSetup = setup.hydrate;
  const battleRoyale = br.active;
  const battleRoyaleUsed = br.used;
  // Named for the mount effect and the eliminate callback below, so neither
  // depends on `br` — a fresh object every render.
  const { hydrate: hydrateBattleRoyale, eliminate: eliminateFromPool } = br;
  // Perks are randomized, so they can only be computed after hydration —
  // otherwise the server-rendered HTML and the client's first render would
  // pick different perks and React would flag a hydration mismatch.
  const mounted = useMounted();
  const isDesktop = useIsDesktop();
  const [presentation, setPresentation] = usePresentation();
  // A saved choice is kept, but never *rendered* where it does not fit:
  // Ritual on a phone would run a WebGL loop with nowhere to deal to.
  const effectivePresentation = isAvailable(presentation, isDesktop)
    ? presentation
    : "classic";
  // The one switch that decides whether the site may make a sound at all.
  // Driven by what is actually on screen rather than by the saved choice, so
  // a phone falling back from Ritual to Classic is silent too.
  useEffect(() => {
    setSoundSurface(effectivePresentation === "casino");
  }, [effectivePresentation]);
  // Card text is no longer part of the page's own payload (see
  // lib/descriptions.ts). Warming it once the browser is idle means the
  // first card someone opens already has its text, without any of it
  // sitting on the critical path.
  useEffect(() => {
    prefetchDescriptions();
  }, []);
  // A quick, session-only filter (not persisted, resets on role change) —
  // distinct from the pool manager's exclusions, which are a deliberate,
  // saved choice. "themeTag: null" means no filter, i.e. the full role pool.
  const [themeTag, setThemeTag] = useState<string | null>(null);

  /* Everything that narrows the pool: saved exclusions, the theme filter, and
     Battle Royale attrition, merged into the one set a roll subtracts. */
  const exclusions = useExclusions({
    role,
    mounted,
    themeTag,
    alsoExcluded: battleRoyale ? battleRoyaleUsed : null,
  });
  const excludedSlugs = exclusions.perkSlugs;
  const favoriteSlugs = exclusions.favoriteSlugs;
  const excludedLoadoutSlugs = exclusions.loadoutKeys;
  const combinedExcluded = exclusions.combinedPerks;
  const combinedExcludedLoadout = exclusions.combinedLoadout;
  const availablePool = exclusions.availablePool;
  const availableCount = exclusions.availableCount;
  const excludePanelOpen = exclusions.panelOpen;
  const excludePanelKind = exclusions.panelKind;
  const openExcludePanel = exclusions.openPanel;
  const { hydrate: hydrateExclusions } = exclusions;
  /* Seeds — Daily Challenge, a typed seed, or one carried by a share link.
     See lib/use-seed.ts. Every path through it drops the shared build on the
     way, and must: a shared build wins over a seed in the roll session
     (use-roll-session.ts resolves sharedBuild before activeSeed), so a seed
     applied on top of one that was left in place would be the seed the board
     claims and the shared build it actually draws. Forgetting that on one path
     was how a seed could silently show the wrong build. */
  // Populated by the effect just below useRollSession.
  const rollRef = useRef<RollSession | null>(null);
  const seed = useSeed({
    role,
    onDailyTaken: recordDailyStreak,
    /* Reaches the roll session through a ref because that hook is declared
       below this one — it needs `activeSeed` from here, so the dependency
       genuinely runs both ways. Same trick as regenerateRef further down. */
    onChange: useCallback(({ reroll }: { reroll: boolean }) => {
      if (reroll) rollRef.current?.rerollAll();
      else rollRef.current?.releaseShared();
    }, []),
  });
  const activeSeed = seed.active;
  // Pulled out by name for the mount effect below, same reason as the
  // hydrate callbacks above: `seed` is a fresh object every render, and an
  // effect that sets state depending on it would never stop running.
  const { hydrateFromUrl: hydrateSeedFromUrl } = seed;



  // Applies to both causes of a too-small pool: Battle Royale attrition and
  // the player just manually excluding too many perks in Manage Pool. Either
  // way, getRandomPerks() refuses to top up from excluded perks (see
  // lib/perks.ts), so this must be checked up front rather than discovered
  // after the fact from a short/empty result.
  const poolExhausted =
    !activeSeed && mounted && perkCount > 0 && availableCount < perkCount;

  /* The build on screen and every way it can change — see
     lib/use-roll-session.ts. */
  const roll = useRollSession({
    mounted,
    mode,
    role,
    perkCount,
    loadoutSlots,
    activeSeed,
    poolExhausted,
    availableCount,
    excludedPerks: combinedExcluded,
    excludedLoadout: combinedExcludedLoadout,
    favoriteSlugs,
    coherence: coherence.level,
    guaranteeTeachables,
    selectedCharacter,
    maxPerkCount: MAX_PERK_COUNT,
  });
  const {
    perks,
    loadoutPieces,
    pinnedPerkSlots,
    togglePin,
    rerollSlot,
    sharedBuild,
    sharedLoadoutPieces,
    nonce,
    clearSlotOverrides,
    rerollAll,
    rerollPerks,
    rerollLoadout,
    releaseShared,
    showPerks,
    showLoadoutPieces,
    showPerksKeepingLoadout,
    restoreShared,
  } = roll;
  useEffect(() => {
    rollRef.current = roll;
  }, [roll]);
  // Named for the mount effect, which must not depend on `roll` itself — a
  // fresh object every render would restart an effect that sets state.
  const hydrateShared = restoreShared;

  /* Restores everything a returning visitor or a share link brings with them.
     Placed below the roll session on purpose: it installs a shared build, and
     effects run in declaration order, so it has to come after the effect that
     populates rollRef. */
  useEffect(() => {
    function applyInitialClientState() {
      // The three saved Sets restore themselves — see lib/use-persisted-set.ts.
      hydrateExclusions();
      hydrateDailyStreak();
      hydrateSquad();
      hydrateCoherence();
      hydrateSetup();
      hydrateSettings();

      const urlState = readInitialUrlState();
      if (urlState) {
        setRole(urlState.role);
        /* `showMode`/`showPerkCount`, not the persisting setters: a link is
           somebody else's build, and opening it once should not become your
           saved preference. See lib/use-board-settings.ts. */
        showMode(urlState.mode);
        /* After hydrateCoherence, so a link wins over the saved setting: the
           build someone shared was rolled at their level, and opening it at
           yours would show a different build under their link. Applied before
           the branch below rather than inside one arm of it — the level is
           orthogonal to which of squad/seed/shared put the build on screen. */
        if (urlState.coherence !== undefined) setCoherenceLevel(urlState.coherence);
        if (urlState.squad) {
          // A squad link turns the mode on and sizes the lobby to whatever
          // arrived. It never marks a shared single build: the squad is the
          // build here, and the normal session underneath stays rerollable.
          showSquad(urlState.squad);
          showPerkCount(urlState.squad[0].length);
        } else if (urlState.seed) {
          hydrateSeedFromUrl(urlState.seed, urlState.role);
        } else {
          // Not an else-if chain — "all" mode's share link carries both
          // `p=` and `lp=` together and needs both applied, or the
          // loadout half would silently re-roll instead of restoring
          // (only the last branch taken would ever run).
          // One call, both halves: an "all" link carries p= and lp= together.
          hydrateShared(urlState);
          if (urlState.perks) showPerkCount(urlState.perks.length);
        }
      }
      hydrateBattleRoyale();
    }
    applyInitialClientState();
    // The individual hydrate callbacks, not the hook objects that carry
    // them: usePersistedSet returns a fresh object every render, so
    // depending on those would re-run this on every render — and since
    // hydrating sets state, that is an endless loop rather than merely
    // wasteful. The callbacks themselves are stable.
  }, [
    hydrateExclusions,
    hydrateSeedFromUrl,
    hydrateBattleRoyale,
    hydrateDailyStreak,
    showSquad,
    hydrateSquad,
    hydrateSetup,
    hydrateCoherence,
    setCoherenceLevel,
    hydrateShared,
    hydrateSettings,
    showMode,
    showPerkCount,
  ]);

  // What Download Image actually exports — perks and/or loadout pieces
  // concatenated the same way the OBS overlay's "all" mode already does
  // (see the publish effect below), so a downloaded image always matches
  // whatever's actually on screen instead of being perks-only regardless
  // of mode. Also where `pieceVisibility` (the OBS modal's "Показывать:"
  // toggles) applies — a display-only filter, so a piece hidden here can
  // still show up via "Copy full build" or the loadout HUD itself; only
  // the export and the OBS overlay respect it.
  const visiblePerks = useMemo(
    () => (pieceVisibility.perks ? perks : []),
    [pieceVisibility.perks, perks],
  );
  const visibleLoadoutPieces = useMemo(
    () => loadoutPieces.filter((p) => pieceVisibility[p.kind]),
    [pieceVisibility, loadoutPieces],
  );

  /* What a screen reader is told when a build lands.
   *
   * Rolling replaces every card at once. Visually that is the whole point;
   * without a live region it is also completely silent — the button says
   * "Generate a new build", and then nothing, because swapping card contents
   * moves no focus and fires no announcement of its own. This is the site's
   * primary action producing no perceivable result (WCAG 2.2 §4.1.3).
   *
   * `perks` is already empty in loadout-only mode and `loadoutPieces` in
   * perks-only mode, so concatenating both covers all three modes without a
   * mode check here. */
  const buildAnnouncement = useMemo(
    () =>
      [...perks.map((p) => p.name[language]), ...loadoutPieces.map((p) => p.name[language])].join(
        ", ",
      ),
    [perks, loadoutPieces, language],
  );
  const [announced, setAnnounced] = useState("");
  const skipFirstAnnouncement = useRef(true);
  useEffect(() => {
    // Nothing rolled yet. The first render is always empty — `mounted` is
    // false until hydration — so this is also what keeps the count below
    // from spending its one skip on the empty string.
    if (!buildAnnouncement) return;
    /* The build that is simply *there* on arrival is not an event, and a live
     * region with content at mount gets read out over the top of the page
     * load, ahead of its own heading. Skipping "the first render" is not
     * enough to catch that: hydration fills an empty board, so the initial
     * build arrives as a CHANGE and was being announced. What has to be
     * skipped is the first build, not the first render. */
    if (skipFirstAnnouncement.current) {
      skipFirstAnnouncement.current = false;
      return;
    }
    setAnnounced(buildAnnouncement);
  }, [buildAnnouncement]);
  const sharePieces: ShareCardPiece[] = useMemo(() => {
    return mode === "loadout"
      ? visibleLoadoutPieces
      : mode === "all"
        ? [...visiblePerks, ...visibleLoadoutPieces]
        : visiblePerks;
  }, [mode, visiblePerks, visibleLoadoutPieces]);

  // Same "who does this build belong to" logic loadout-grid.tsx's PowerSlot
  // already uses for the killer's Power-slot badge: an explicitly chosen
  // character wins, otherwise a killer build's rolled Power add-ons already
  // say who it belongs to even with nothing manually forced.
  const shareCharacter = useMemo(() => {
    if (selectedCharacter) return selectedCharacter;
    if (role !== "killer") return null;
    const addon = loadoutPieces.find((p): p is Addon => p.kind === "addon");
    return addon?.character ?? null;
  }, [selectedCharacter, role, loadoutPieces]);

  /* The address bar, kept describing the build on screen — see
     lib/share-link.ts for the format and lib/use-share-url.ts for when it
     fires. A squad is passed only while squad mode is on, because it replaces
     the single build in the link rather than sitting beside it. */
  useShareUrl({
    mounted,
    role,
    mode,
    coherence: coherence.level,
    seed: activeSeed,
    perks,
    loadoutPieces,
    squad: squadActive ? squad.squad : null,
  });

  // Records exactly one roll event per genuine generation (initial pick,
  // regenerate, role/count switch) — deduped by content key so React 19
  // Strict Mode's dev-only double-invoke of this effect can't double-count.
  const lastRecordedKey = useRef<string>("");
  useEffect(() => {
    if (!mounted || perks.length === 0) return;
    const key = `${role}:${nonce}:${activeSeed ?? ""}:${sharedBuild ? "shared" : "rolled"}`;
    if (sharedBuild) return; // viewing someone else's shared build isn't "your" roll
    if (lastRecordedKey.current === key) return;
    lastRecordedKey.current = key;
    recordRoll(role, perks);
    recordHistoryEntry({ mode: "perks", role, keys: perks.map((p) => p.slug) });
    setStatsVersion((v) => v + 1);
  }, [perks, role, nonce, mounted, activeSeed, sharedBuild]);

  // Loadout counterpart of the perks-recording effect above — same
  // dedup-by-key and "don't record someone else's shared/history build"
  // rules, just keyed off loadoutPieces/sharedLoadoutPieces instead.
  // Loadout mode has no roll-frequency stats today (getRoleStatsSummary is
  // perk-only), so this only feeds history, not recordRoll.
  const lastRecordedLoadoutKey = useRef<string>("");
  useEffect(() => {
    if (!mounted || loadoutPieces.length === 0) return;
    const key = `${role}:${nonce}:${activeSeed ?? ""}:${sharedLoadoutPieces ? "shared" : "rolled"}`;
    if (sharedLoadoutPieces) return;
    if (lastRecordedLoadoutKey.current === key) return;
    lastRecordedLoadoutKey.current = key;
    recordHistoryEntry({
      mode: "loadout",
      role,
      keys: loadoutPieces.map((p) => `${p.kind}:${p.slug}`),
    });
    setStatsVersion((v) => v + 1);
  }, [loadoutPieces, role, nonce, mounted, activeSeed, sharedLoadoutPieces]);

  // Mirrors whatever's currently on screen to the OBS overlay tab, if one's
  // open — see lib/obs-sync.ts. Fires on every display change (regenerate,
  // role switch, seed, shared-build view), same trigger set as stats above.
  // Also fires when obsModalOpen flips true: opening the modal is what
  // lazily creates this session's Firebase room code (see
  // getOrCreateRoomCode), so without this, a build generated *before* the
  // modal's first-ever open would never get published to that room at
  // all — the overlay would sit on "waiting for a build" until the next
  // regenerate, even though a build is already showing on the main page.
  // The overlay only ever renders slug/icon/name (see obs-overlay.tsx) —
  // a loadout piece fits that same ObsPerk shape as-is, so no separate
  // payload field is needed. Piece slugs are prefixed "kind:" here purely
  // so a killer add-on and an offering that happen to share a slug can't
  // collide as the same React key on the overlay's own list. In "all"
  // mode both lists are simply concatenated — perk slugs never contain a
  // colon, so they can't collide with a "kind:slug" loadout key either.
  // Filtered by `pieceVisibility` first (see sharePieces above) — the
  // overlay renders exactly what gets published, so hiding a kind here
  // is what actually keeps it off stream, not a flag the overlay itself
  // has to know about.
  /* What the overlay should draw for a running vote.
     A ref, not state, and declared here because publishCurrentBuild below is
     defined long before useTwitchSettings further down — and because a vote
     changing must not give publishCurrentBuild a new identity, which would
     re-fire the publish effect that depends on it. The effect further down
     writes this and republishes. */
  const overlayVoteRef = useRef<ObsVote | undefined>(undefined);

  const publishCurrentBuild = useCallback(() => {
    const perkPieces = visiblePerks.map((p) => ({
      slug: p.slug,
      icon: p.icon,
      name: p.name,
    }));
    const loadoutDisplayPieces = visibleLoadoutPieces.map((p) => ({
      slug: `${p.kind}:${p.slug}`,
      icon: p.icon,
      name: p.name,
    }));
    const displayPieces =
      mode === "loadout"
        ? loadoutDisplayPieces
        : mode === "all"
          ? [...perkPieces, ...loadoutDisplayPieces]
          : perkPieces;
    publishObsState({
      role,
      language,
      perks: displayPieces,
      character: shareCharacter ?? undefined,
      vote: overlayVoteRef.current,
    });
  }, [mode, role, language, visiblePerks, visibleLoadoutPieces, shareCharacter]);

  const obsHold = useObsHold(publishCurrentBuild);
  // Depends on the stable callback rather than the hook's return object,
  // which is a fresh object every render and would re-fire this on each
  // one.
  const { shouldPublish } = obsHold;

  // What makes one build different from another, for the withheld-roll
  // counter. Slugs only: re-opening the OBS modal re-runs the publish
  // effect with the same build, and that isn't a roll.
  const buildKey = useMemo(
    () =>
      [
        ...visiblePerks.map((p) => p.slug),
        ...visibleLoadoutPieces.map((p) => `${p.kind}:${p.slug}`),
      ].join("|"),
    [visiblePerks, visibleLoadoutPieces],
  );

  useEffect(() => {
    if (!mounted) return;
    // While held, this counts the roll instead of sending it — see
    // lib/use-obs-hold.ts.
    if (!shouldPublish(buildKey)) return;
    publishCurrentBuild();
  }, [mounted, publishCurrentBuild, shouldPublish, buildKey, obsModalOpen]);

  const eliminateCurrentBuild = useCallback(() => {
    eliminateFromPool({ mode, perks, loadoutPieces });
  }, [eliminateFromPool, mode, perks, loadoutPieces]);

  // Declared after eliminateCurrentBuild because it takes it: copying a
  // build is one of the two ways Battle Royale retires one (the other is
  // regenerating, below).
  const { toast, showToast, copy } = useBuildClipboard({
    onUsed: () => {
      if (battleRoyale) eliminateCurrentBuild();
    },
  });

  /* Link and image export — see lib/use-share-export.ts. Both report
     through the same toast, and both can be declined by something outside
     our control (the clipboard, the share sheet). */
  const {
    generating: generatingImage,
    cardRef: shareCardRef,
    storyCardRef: storyShareCardRef,
    squadCardRef: squadShareCardRef,
    backdrops: shareBackdrops,
    copyLink: handleShare,
    downloadImage: handleDownloadImage,
    // Destructured rather than kept as one object: the React Compiler lint
    // treats any property read on a value that carries refs as a ref access
    // during render, which `ref={shareCardRef}` trips.
  } = useShareExport({
    role,
    // In squad mode the export is of the squad, so the backdrop seed and the
    // filename come from every perk on the poster rather than from the single
    // build sitting behind it.
    slugs: useMemo(
      () =>
        squadActive && squad.squad.length > 0
          ? squad.squad.flat().map((p) => p.slug)
          : sharePieces.map((p) => p.slug),
      [squadActive, squad.squad, sharePieces],
    ),
    squad: squadActive && squad.squad.length > 0,
    showToast,
  });


  /* `source` exists for one question: whether the Space shortcut is used
     enough to be worth documenting on the board. The button passes it
     explicitly rather than being wired straight to onClick, because onClick
     would hand the MouseEvent in as the first argument. */
  const regenerate = useCallback((source: "button" | "keyboard" | "chat" = "button") => {
    track({ name: "build_generated", source });
    playSound("roll");
    // Squad mode replaces the single build on screen, so Generate rolls the
    // squad and leaves the single-build session alone — including Battle
    // Royale elimination, which retires the perks of a build the player
    // actually used and has no meaning for four builds nobody has played yet.
    if (squadActive) {
      squad.roll({ role, pool: availablePool, buildSize: perkCount, seed: activeSeed });
      return;
    }
    // Battle Royale's whole premise is elimination — the pool should shrink
    // every round regardless of *how* you moved on, not only when you
    // happened to copy a perk first. Without this, spamming Generate (or
    // its Space/Enter shortcut) never drains the pool, so "play until every
    // perk is gone" never actually triggers.
    if (battleRoyale) eliminateCurrentBuild();
    clearSlotOverrides();
    rerollAll();
  }, [
    squadActive,
    squad,
    role,
    availablePool,
    perkCount,
    activeSeed,
    battleRoyale,
    eliminateCurrentBuild,
    clearSlotOverrides,
    rerollAll,
  ]);

  // `regenerate`'s identity changes on every roll (it depends on
  // eliminateCurrentBuild, which depends on `perks`) — if the Twitch effect
  // below depended on it directly, the chat connection would disconnect and
  // reconnect on every single generate. A ref sidesteps that: the effect
  // only depends on twitchEnabled/twitchChannel, and always calls whatever
  // regenerate currently is via the ref.
  const regenerateRef = useRef(regenerate);
  useEffect(() => {
    regenerateRef.current = regenerate;
  }, [regenerate]);

  // `!paste <ids>` sets a specific build directly (same mechanism as
  // opening a shared-build URL) rather than rolling a new one — doesn't
  // need a ref like regenerate above since it only calls stable setState
  // functions and pure lookups, nothing that changes identity per render.
  const handleTwitchPaste = useCallback((argsText: string) => {
    // Parsing and the "perks decide the side" rule live in
    // lib/installed-build.ts, which is where a shared link resolves too.
    const matched = resolvePerkIdList(argsText);
    if (matched.length === 0) return;
    setRole(matched[0].role);
    showPerksKeepingLoadout(matched);
  }, [showPerksKeepingLoadout]);

  /** Shows a hand-picked build (see data/build-presets.json).
   *
   *  Reuses the shared-build path rather than adding a mode of its own, so
   *  a preset behaves exactly like a build someone sent you: displayed as
   *  given, and replaced the moment you roll. That also means it inherits
   *  every existing consequence for free — the URL updates, the OBS
   *  overlay follows, and the padlocks hide themselves because there is
   *  nothing to reroll around in a fixed build. */
  // Chat settings, their persistence, and the connection they configure —
  // see lib/use-twitch-settings.ts. `onReroll` goes through the ref for
  // the reason described above: regenerate's identity changes every roll,
  // and depending on it directly would reconnect the socket each time.
  /* A finished chat vote: the winning slot stays, the other three reroll.
     Done with the same per-slot reroll the dice buttons and the 1-4 keys
     use, rather than by pinning the winner and rolling the rest — a pin is
     the player's own standing instruction about a slot, and borrowing it for
     a vote would leave a padlock on the board that nobody set. */
  const handleVoteEnd = useCallback(
    (result: VoteResult) => {
      if (result.winner === null) {
        showToast(
          t({
            ru: "Никто не проголосовал — билд остаётся как есть.",
            en: "Nobody voted — the build stays as it is.",
          }),
        );
        return;
      }
      const winner = result.winner;
      for (const slot of VOTE_SLOTS) {
        // rerollSlot is 0-based; chat counts from 1.
        if (slot !== winner) rerollSlot(slot - 1);
      }
      showToast(
        result.tied
          ? t({
              ru: `Ничья — оставляем перк ${winner} (левый из равных).`,
              en: `A tie — keeping perk ${winner}, the leftmost of them.`,
            })
          : t({
              ru: `Чат выбрал перк ${winner} (${result.tally[winner]} из ${result.voters}).`,
              en: `Chat kept perk ${winner} (${result.tally[winner]} of ${result.voters}).`,
            }),
      );
    },
    [rerollSlot, showToast, t],
  );

  const twitch = useTwitchSettings({
    mounted,
    onReroll: useCallback(() => regenerateRef.current("chat"), []),
    onPaste: handleTwitchPaste,
    onVoteEnd: handleVoteEnd,
  });

  /* The live tally, out to the overlay.
   *
   * Gated by the same hold the build publish uses: a streamer who has parked
   * the overlay does not want chat's votes appearing on it either.
   *
   * Only fires on a real change. recordVote hands back the identical state
   * object for a line that altered nothing (see lib/chat-vote.ts), so
   * ordinary chat never reaches this and never costs a Firebase write. The
   * `hadVote` ref is what makes the *end* of a vote publish too — the bars
   * have to come off the overlay, and "no vote" is a change worth sending
   * exactly once. */
  const hadVoteRef = useRef(false);
  useEffect(() => {
    const live = twitch.vote;
    const active = live.ballots.size > 0;
    if (!active && !hadVoteRef.current) return;
    overlayVoteRef.current = active
      ? { tally: tallyVotes(live), endsAt: live.endsAt }
      : undefined;
    hadVoteRef.current = active;
    if (!shouldPublish(`vote:${buildKey}:${live.ballots.size}`)) return;
    publishCurrentBuild();
  }, [twitch.vote, publishCurrentBuild, shouldPublish, buildKey]);

  /* "Roll something new", from the coverage bar in the Stats modal.
     Installs a specific build the same way a preset does — including
     releasing an active seed, which would otherwise outrank it and quietly
     ignore the press. Pins and per-slot rerolls are suppressed for it, as
     they are for any build handed over whole; rolling around a build chosen
     for what is *not* in it does not have an obvious meaning, and Generate
     is one press away. */
  const rollUnseen = useCallback(
    (targetRole: PerkRole) => {
      const pool = getAvailablePool(targetRole, excludedSlugs);
      const result = rollUnseenPerks(pool, getSeenSlugs(targetRole), perkCount);
      if (result.perks.length === 0) return;

      setRole(targetRole);
      seed.release();
      showPerksKeepingLoadout(result.perks);
      setStatsModalOpen(false);
      playSound("roll");

      /* Recorded here rather than by the effect below, which skips anything
         installed as a handed-over build — that rule is about not counting
         somebody else's shared link as your roll, and this is your roll: you
         asked for it and these perks are now ones you have been given. Left
         uncounted, the button could never move the coverage number it sits
         under, which is the only reason to press it twice. */
      recordRoll(targetRole, result.perks);
      recordHistoryEntry({
        mode: "perks",
        role: targetRole,
        keys: result.perks.map((p) => p.slug),
      });
      setStatsVersion((v) => v + 1);

      showToast(
        result.outcome === "fresh"
          ? t({
              ru: "Билд целиком из перков, которые вам ещё не выпадали.",
              en: "A build made only of perks you have never been given.",
            })
          : result.outcome === "topped-up"
            ? t({
                ru: `Новых осталось всего ${result.unseenCount} — они все здесь, остальное обычное.`,
                en: `Only ${result.unseenCount} new ones left — all of them are here, the rest is ordinary.`,
              })
            : t({
                ru: "Вам уже выпадали все перки этой роли. Это обычный билд.",
                en: "Every perk for this role has come up already. This is an ordinary build.",
              }),
      );
    },
    [excludedSlugs, perkCount, seed, showPerksKeepingLoadout, showToast, t],
  );

  /* Reopening a saved build. Same path a preset takes — including releasing
     an active seed — because from the board's point of view they are the same
     thing: a specific build, chosen rather than rolled.
  
     Releasing the seed is not what makes the build appear; a handed-over build
     already outranks a seed in use-roll-session.ts. It is what keeps the board
     honest about it: while a seed is active Generate is disabled and the share
     link writes `?seed=`, so leaving one in place shows this build under a
     link to a different one and no way to roll off it. */
  const openVaultBuild = useCallback(
    (build: VaultBuild) => {
      setRole(build.role);
      seed.release();
      if (build.mode === "perks") {
        const perks = resolvePerkSlugs(build.keys, build.role);
        if (perks.length === 0) return;
        showMode("perks");
        showPerkCount(perks.length);
        showPerksKeepingLoadout(perks);
      } else {
        const pieces = resolveLoadoutKeys(build.keys);
        if (pieces.length === 0) return;
        showMode("loadout");
        showLoadoutPieces(pieces);
      }
      setVaultModalOpen(false);
    },
    [seed, showPerksKeepingLoadout, showLoadoutPieces, showMode, showPerkCount],
  );

  const applyPreset = useCallback((preset: BuildPreset) => {
    const perks = resolvePreset(preset);
    if (perks.length === 0) return;
    setRole(preset.role);
    // Same reason as openVaultBuild above: the preset shows either way, but a
    // seed left active disables Generate and makes the share link describe the
    // seed's build instead of this one.
    // `release`, not `clear`: this is installing a build, so the reroll
    // `clear` triggers would immediately throw it away.
    seed.release();
    showPerksKeepingLoadout(perks);
  }, [seed, showPerksKeepingLoadout]);


  // Page-level keyboard shortcuts — see lib/use-board-shortcuts.ts. Every
  // one of them mirrors a button that is already on screen.
  useBoardShortcuts({
    mode,
    perkCount,
    activeSeed,
    poolExhausted,
    modalOpen: excludePanelOpen || statsModalOpen || obsModalOpen,
    hasPerks: perks.length > 0,
    hasLoadout: loadoutPieces.length > 0,
    regenerate: useCallback(() => regenerate("keyboard"), [regenerate]),
    handleCopyAll,
    handleShare,
    rerollSlot,
  });

  function selectRole(next: PerkRole) {
    track({ name: "role_chosen", role: next });
    releaseShared();
    setSelectedCharacter(null); // survivor/killer character lists don't overlap
    setRole(next);
    setThemeTag(null); // survivor/killer tags don't overlap — stale otherwise
  }

  // Single entry point for both picking a specific character (the picker
  // modal's grid) and clearing the selection ("Убрать выбор" / clicking the
  // chip's ×) — both need the exact same side effects, so there's one
  // function instead of two that could drift out of sync.
  function selectCharacter(character: string | null) {
    setSelectedCharacter(character);
    rerollAll();
  }

  function toggleGuaranteeTeachables() {
    settings.toggleGuaranteeTeachables();
    // Perks only: a shared loadout is unaffected by a perks-mode toggle.
    rerollPerks();
  }

  // Jumps back to a past roll from the History modal — same "shared build"
  // display path a Share link or Twitch !paste already uses (readInitialUrlState
  // / handleTwitchPaste above), so re-viewing history is exactly as inert
  // as viewing someone else's shared build: it doesn't touch the pool,
  // Battle Royale progress, or roll further. Silently no-ops if every
  // slug/key in the entry has since become unresolvable (e.g. a perk
  // retired from the wiki) rather than opening onto an empty build.
  function restoreHistoryEntry(entry: HistoryEntry) {
    if (entry.mode === "perks") {
      /* No role filter, unlike the Vault above: a history entry records the
         role it was rolled for and is restored under it, so a slug that
         somehow disagrees is the entry's own, not a stranger's. */
      const matched = resolvePerkSlugs(entry.keys);
      if (matched.length === 0) return;
      setRole(entry.role);
      /* The persisting setter here and the display-only one in openVaultBuild
         above: restoring from History remembers the mode across a reload,
         reopening from the Vault does not. An old inconsistency, carried over
         unchanged rather than quietly settled while moving the code. */
      settings.setMode("perks");
      showPerks(matched);
      showPerkCount(matched.length);
    } else {
      const matched = resolveLoadoutKeys(entry.keys);
      if (matched.length === 0) return;
      setRole(entry.role);
      settings.setMode("loadout");
      showLoadoutPieces(matched);
    }
    setHistoryModalOpen(false);
  }


  function selectMode(next: BuildMode) {
    track({ name: "mode_chosen", mode: next });
    settings.setMode(next);
    rerollAll();
  }

  function toggleLoadoutSlot(slot: keyof LoadoutSlots) {
    settings.toggleLoadoutSlot(slot);
    // Loadout only: which slots are rolled says nothing about the perks.
    rerollLoadout();
  }

  function selectTheme(tag: string | null) {
    setThemeTag(tag);
    // Themes are a perk idea; a shared loadout is left alone.
    rerollPerks();
  }

  function selectPerkCount(next: number) {
    settings.setPerkCount(next);
    // Perks only: how many perks to roll says nothing about a shared loadout.
    rerollPerks();
  }

  const toggleExcluded = exclusions.togglePerk;
  const bulkSetExcluded = exclusions.setManyPerks;
  const toggleFavorite = exclusions.toggleFavorite;
  const resetExcludedForRole = exclusions.resetPerksForRole;

  const toggleExcludedLoadoutPiece = exclusions.toggleLoadoutPiece;

  const bulkSetExcludedLoadout = exclusions.setManyLoadout;

  const resetExcludedLoadoutForRole = exclusions.resetLoadoutForRole;


  // All five of these were the same eleven lines with a different string —
  // see lib/use-build-clipboard.ts, which also owns the toast.
  function handleCopy(perk: Perk) {
    copy(perk.name[language], {
      ru: `«${perk.name[language]}» скопировано в буфер обмена!`,
      en: `"${perk.name[language]}" copied to clipboard!`,
    });
  }

  function handleCopyAll() {
    // One line per player, labelled, because a squad pasted into Discord as
    // sixteen comma-separated names is not something anyone can read back.
    if (squadActive) {
      const text = squad.squad
        .map(
          (build, i) =>
            `${t({ ru: "Игрок", en: "Player" })} ${i + 1}: ${build
              .map((p) => p.name[language])
              .join(", ")}`,
        )
        .join("\n");
      copy(text, {
        ru: "Билды всей группы скопированы в буфер обмена!",
        en: "Every build in the squad copied to clipboard!",
      });
      return;
    }
    copy(perks.map((p) => p.name[language]).join(", "), {
      ru: "Весь билд скопирован в буфер обмена!",
      en: "Full build copied to clipboard!",
    });
  }

  function handleCopyLoadoutPiece(piece: LoadoutPiece) {
    copy(piece.name[language], {
      ru: `«${piece.name[language]}» скопировано в буфер обмена!`,
      en: `"${piece.name[language]}" copied to clipboard!`,
    });
  }

  function handleCopyAllLoadout() {
    copy(loadoutPieces.map((p) => p.name[language]).join(", "), {
      ru: "Вся экипировка скопирована в буфер обмена!",
      en: "Full loadout copied to clipboard!",
    });
  }

  function handleCopyAllCombined() {
    copy(
      [
        ...perks.map((p) => p.name[language]),
        ...loadoutPieces.map((p) => p.name[language]),
      ].join(", "),
      { ru: "Всё скопировано в буфер обмена!", en: "Everything copied to clipboard!" },
    );
  }

  function toggleBattleRoyale() {
    track({ name: "battle_royale_toggled", active: !battleRoyale });
    // The mode itself is the hook's; dropping whatever build is on screen
    // and rolling into the new pool is the board's.
    br.toggle();
    rerollAll();
  }

  function restartBattleRoyale() {
    br.restart();
    rerollAll();
  }

  /* Everything that narrows or reshapes a roll, back to a first visit.
  
     Not the role, which is the question the page opens with rather than a
     filter, and deliberately NOT the perk pool or favourites. Those are a
     curation someone built by hand over many visits, and wiping them from a
     one-click button in a settings panel would be the most destructive thing
     on the site — Manage Pool has its own per-role Reset, next to the list it
     empties, where you can see what you are about to lose. `nothingToReset`
     below is what keeps this honest: a visitor who has changed nothing never
     sees the button, so it also says what "default" means. */
  const filtersAtDefault =
    settings.isDefault &&
    themeTag === null &&
    coherence.level === 0 &&
    selectedCharacter === null &&
    !battleRoyale &&
    !squad.active &&
    !activeSeed;

  function resetFilters() {
    settings.reset();
    setThemeTag(null);
    coherence.setLevel(0);
    setSelectedCharacter(null);
    // Both are toggles rather than setters, so only touch them when they are
    // actually on — calling toggle() unconditionally would turn them on.
    if (battleRoyale) br.toggle();
    if (squad.active) squad.toggle();
    // `clear`, not `release`: there is no build being installed here, so the
    // reroll it triggers is exactly what should happen.
    if (activeSeed) seed.clear();
    rerollAll();
  }

  const roleColor = ROLE_COLOR[role];
  /* While Battle Royale is running, the subtitle carries the remaining count.
     The toggle that used to display it moved into the setup disclosure (see
     setup-panel.tsx), and a mode whose entire point is a pool draining toward
     zero cannot keep that number behind a collapsed panel. Written as two
     strings rather than one t({...}) because they are interpolated inside the
     subtitle's own ru/en pair. */
  const brRu = `Battle Royale — осталось ${availableCount}`;
  const brEn = `Battle Royale — ${availableCount} left`;
  // Loadout mode for killer needs a character with rolled add-ons to
  // actually mean something (see getRandomLoadout's forcedCharacter) — a
  // small handful of killers have perks scraped but no add-ons yet (very
  // new releases), so the picker only offers that narrower list there,
  // keeping the portrait and the roll from disagreeing with each other.
  const characterChoices = mounted
    ? mode !== "perks" && role === "killer"
      ? getKillerCharacters()
      : getCharactersForRole(role)
    : [];
  // Tags come from the shipped data, so this is a cheap derivation — but it
  // runs on every render of a 1700-line component, so it is memoised like
  // every other one here.
  const buildTheme = useMemo(
    () => (squadActive ? null : getBuildTheme(perks, role)),
    [perks, role, squadActive],
  );
  const totalInRole = mounted ? getAvailablePool(role).length : 0;
  // battleRoyaleUsed accumulates eliminated slugs across BOTH roles (nothing
  // resets it on a role switch — see selectRole), so it must be filtered to
  // the current role here rather than shown raw, or it'd read inconsistently
  // against `availableCount` below (which already is role-filtered).
  const battleRoyaleUsedInRole = mounted
    ? getPerksByRole(role).filter((p) => battleRoyaleUsed.has(p.slug)).length
    : 0;
  const loadoutPoolForRole = mounted
    ? getLoadoutPoolForRole(role, role === "killer" ? selectedCharacter : null)
    : [];
  const totalLoadoutInRole = loadoutPoolForRole.length;
  const availableLoadoutCount = mounted
    ? loadoutPoolForRole.filter(
        (p) => !combinedExcludedLoadout.has(`${p.kind}:${p.slug}`),
      ).length
    : 0;
  const battleRoyaleUsedLoadoutInRole = mounted
    ? loadoutPoolForRole.filter((p) =>
        battleRoyaleUsed.has(`${p.kind}:${p.slug}`),
      ).length
    : 0;

  // Keeps the browser tab useful when juggling several — shows which role
  // and build size this tab is on instead of a static app name everywhere.
  // Rendered declaratively (not via a document.title effect) because React
  // 19 owns and hoists <title> itself; an imperative mutation gets silently
  // overwritten on the next unrelated re-render.
  const pageTitle =
    mode === "loadout"
      ? `${t(ROLE_NAME[role])} · ${t({ ru: "Экипировка", en: "Loadout" })} — ${t({ ru: "Рандомайзер перков DBD", en: "DBD Perk Randomizer" })}`
      : `${t(ROLE_NAME[role])} · ${t({ ru: "Перков", en: "Perks" })}: ${perkCount} — ${t({ ru: "Рандомайзер перков DBD", en: "DBD Perk Randomizer" })}`;

  /* The plain grid, named once because it is used twice: as the classic
     presentation, and as what a failed WebGL stage degrades to. */
  const perkGridView = (
    <PerkGrid
      perks={perks}
      language={language}
      /* Classic, Minimal and Impact are this same grid with a different
         entrance — see components/dbd/card-entrance.ts. Anything not a grid
         skin falls through to a canvas stage below, and lands back here if
         that stage fails. */
      entrance={
        effectivePresentation === "minimal"
          ? "minimal"
          : effectivePresentation === "impact"
            ? "impact"
            : "classic"
      }
      loading={!mounted}
      emptyMessage={
        perkCount === 0
          ? t({
              ru: "Ноль перков — режим испытания",
              en: "Zero perks — challenge mode",
            })
          : undefined
      }
      onCopy={handleCopy}
      {...(sharedBuild || activeSeed
        ? {}
        : {
            pinnedSlots: pinnedPerkSlots,
            onTogglePin: togglePin,
            onRerollSlot: rerollSlot,
          })}
    />
  );

  return (
    /* gap-4 on phones, gap-6 from sm up.
    
       The history of this number is the history of the board. It was gap-2/
       gap-3 when eight groups stacked above the build and 96px of pure gap was
       more than the page could spare. Mode, count and the slots panel have
       since moved into the disclosure, so four groups sit above the result
       instead of eight — and gap scales with how many things it separates.
       Four groups at 24px is 96px of rhythm doing what 96px of damage control
       used to.
    
       This is the whole trade: the controls did not get smaller, there are
       just fewer of them out here, and the space that bought went back into
       the gaps rather than into pulling everything further up. A short, dense
       page is not a calm one. */
    /* `w-full` is load-bearing, not decoration.
    
       This board is a flex item of a column flex container that sets
       `items-center`, which gives it `align-self: center` and therefore a
       shrink-to-fit width. So it sized itself to its own content and every
       `max-w-*` below it was dead: the perk grid's `max-w-4xl` never once
       applied. Measured on the static export, the board was 664px wide inside
       a 1568px parent at 1920, and 746 inside 1764 at 2560 — the interface was
       not small on a large monitor because it lacked a scale step, it was
       small because it had never claimed the width it already had. */
    <div className="flex w-full flex-col items-center gap-4 sm:gap-6">
      <title>{pageTitle}</title>
      {/* Polite, so it waits for the reader to finish rather than cutting in;
          the build is not urgent enough for assertive. Empty until the first
          roll — see buildAnnouncement above. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announced && `${t({ ru: "Новый билд", en: "New build" })}: ${announced}`}
      </div>
      {/* The only strongly emphasised choice on the board.
      
          Everything else that shapes a roll — mode, how many, slots, theme,
          coherence, character, pools, the overlay — is one click away in the
          disclosure below. Which side you are playing is the one thing the
          defaults genuinely cannot guess, so it is the one thing asked out
          loud. */}
      <div className="flex flex-wrap items-center justify-center gap-2">
          {(Object.keys(ROLE_LABEL) as PerkRole[]).map((r) => {
            const c = ROLE_COLOR[r];
            return (
              <button
                key={r}
                type="button"
                onClick={() => selectRole(r)}
                className={cn(
                  "tap rounded-full border px-5 py-1.5 text-control font-medium capitalize",
                  /* The one control whose whole job is saying which side you
                     are playing, so it carries the colour at full strength
                     rather than the /10 wash it used to. See the note in
                     lib/role-color.ts for what that wash actually painted.

                     No `transition-colors`, unlike every other pill here.
                     The URL's role is applied after mount, so this button
                     changes state on load — and animating between a muted
                     label on bare background and a dark label on a saturated
                     fill passes through pairs that are briefly unreadable.
                     e2e/contrast.spec.ts caught one at 3.65:1 under load.
                     The old /10 wash hid this by never moving far enough to
                     matter. An instant swap has no midpoint to fail. */
                  role === r
                    ? c.fill
                    : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {t(ROLE_NAME[r])}
              </button>
            );
          })}

        {/* Quiet, and beside the role rather than under it. Role is the
            question; this is what the answer produces. See mode-select.tsx for
            why this one control came back out of the disclosure when
            everything else stayed in. */}
        <ModeSelect value={mode} onChange={selectMode} />
      </div>

      <SetupDisclosure open={setup.open} onToggle={setup.toggle}>
        <SetupPanel
          mode={mode}
          perkCount={perkCount}
          onSelectPerkCount={selectPerkCount}
          loadoutSlots={loadoutSlots}
          onToggleLoadoutSlot={toggleLoadoutSlot}
          role={role}
          mounted={mounted}
          language={language}
          themeTag={themeTag}
          onSelectTheme={selectTheme}
          coherenceLevel={coherence.level}
          onSelectCoherence={coherence.setLevel}
          selectedCharacter={selectedCharacter}
          onOpenCharacterPicker={() => setCharacterPickerOpen(true)}
          onClearCharacter={() => selectCharacter(null)}
          guaranteeTeachables={guaranteeTeachables}
          onToggleGuaranteeTeachables={toggleGuaranteeTeachables}
          battleRoyale={battleRoyale}
          availableCount={availableCount}
          onToggleBattleRoyale={toggleBattleRoyale}
          filtersAtDefault={filtersAtDefault}
          onResetFilters={resetFilters}
        />


        <BoardToolbar
          mode={mode}
          excludedPerkCount={excludedSlugs.size}
          excludedLoadoutCount={excludedLoadoutSlugs.size}
          seed={seed}
          dailyStreak={dailyStreak.streak}
          onOpenPool={openExcludePanel}
          onOpenObs={() => setObsModalOpen(true)}
          onOpenStats={() => setStatsModalOpen(true)}
          onOpenHistory={() => setHistoryModalOpen(true)}
          onOpenPresets={() => setPresetsModalOpen(true)}
          onOpenVault={() => setVaultModalOpen(true)}
        />
      </SetupDisclosure>

      {mode === "loadout" ? (
        <p className="text-hint text-muted">
          {t({
            ru: `${battleRoyale ? brRu : "Случайная экипировка"} для ${ROLE_LABEL[role].ru} — нажмите на карточку, чтобы скопировать название`,
            en: `${battleRoyale ? brEn : "Random loadout"} for ${ROLE_LABEL[role].en} — click a card to copy its name`,
          })}
        </p>
      ) : mode === "all" ? (
        <p className="text-hint text-muted">
          {t({
            ru: `${battleRoyale ? brRu : "Случайный билд и экипировка"} для ${ROLE_LABEL[role].ru} — нажмите на карточку, чтобы скопировать название`,
            en: `${battleRoyale ? brEn : "Random build and loadout"} for ${ROLE_LABEL[role].en} — click a card to copy its name`,
          })}
        </p>
      ) : perkCount === 0 ? (
        <p className="text-hint text-muted">
          {t({
            ru: `Испытание без перков для ${ROLE_LABEL[role].ru} — удачи!`,
            en: `A no-perk challenge for ${ROLE_LABEL[role].en} — good luck!`,
          })}
        </p>
      ) : (
        <p className="text-hint text-muted">
          {t({
            ru: `${battleRoyale ? brRu : "Случайный билд"} для ${ROLE_LABEL[role].ru} — нажмите на перк, чтобы скопировать название`,
            en: `${battleRoyale ? brEn : "Random build"} for ${ROLE_LABEL[role].en} — click a perk to copy its name`,
          })}
        </p>
      )}

      {/* "all" mode stacks both grids instead of picking one — each block
          below independently no-ops (renders nothing) for the mode it
          doesn't apply to, so "perks"/"loadout" alone still show exactly
          one grid, same as before this mode existed. */}
      {mode !== "perks" && (
        <LoadoutGrid
          pieces={loadoutPieces}
          role={role}
          language={language}
          loading={!mounted}
          emptyMessage={t({
            ru: "Все слоты отключены — включите хотя бы один выше",
            en: "Every slot is off — turn at least one on above",
          })}
          onCopy={handleCopyLoadoutPiece}
        />
      )}
      {mode !== "loadout" && squadActive && (
        <SquadGrids
          squad={squad.squad}
          players={squad.players}
          language={language}
          onCopy={handleCopy}
        />
      )}
      {mode !== "loadout" &&
        !squadActive &&
        (poolExhausted ? (
          <div
            className={cn(
              "flex min-h-[220px] w-full max-w-md flex-col items-center justify-center gap-3 rounded-2xl border p-6 text-center",
              roleColor.border,
              roleColor.bg,
            )}
          >
            <Skull className={cn("size-8", roleColor.text)} />
            <p className="font-semibold text-foreground">
              {battleRoyale
                ? t({ ru: "Пул перков исчерпан!", en: "Perk pool exhausted!" })
                : t({
                    ru: "В пуле недостаточно перков",
                    en: "Not enough perks in the pool",
                  })}
            </p>
            <p className="text-hint text-muted">
              {battleRoyale
                ? t({
                    ru: `Вы скопировали билды из всех доступных перков ${ROLE_LABEL[role].ru}.`,
                    en: `You've copied builds from every available ${ROLE_LABEL[role].en} perk.`,
                  })
                : t({
                    ru: `Включено только ${availableCount} из ${perkCount} нужных — включите больше перков в пуле или уменьшите их количество.`,
                    en: `Only ${availableCount} of the ${perkCount} needed are enabled — enable more perks in the pool or lower the count.`,
                  })}
            </p>
            <button
              type="button"
              onClick={
                battleRoyale
                  ? restartBattleRoyale
                  : () => openExcludePanel("perks")
              }
              className="mt-1 rounded-full bg-accent px-5 py-2 text-control font-semibold text-accent-foreground transition-transform hover:scale-105 active:scale-95"
            >
              {battleRoyale
                ? t({ ru: "Начать заново", en: "Start over" })
                : t({ ru: "Открыть пул перков", en: "Open perk pool" })}
            </button>
          </div>
        ) : !GRID_PRESENTATIONS.has(effectivePresentation) && perks.length > 0 ? (
          /* Same build, shown differently. The stages are fed `perks` and
             never roll anything themselves — see lib/use-presentation.ts.
             Pinning and per-slot reroll are grid affordances, so they stay
             with the grid rather than being reinvented on a canvas. */
          /* Both stages draw to a canvas, and Ritual's fog is WebGL on top of
             that. Canvases fail for reasons that have nothing to do with this
             code: a blocklisted driver, a GPU reset, a context the browser
             declines to hand out. The build itself is fine in all of those
             cases, so a failed stage falls back to the plain grid — the same
             cards, no presentation — rather than taking the page down with
             it. (Ritual additionally recovers from a *lost* GL context on its
             own; this catches the harder failures, where there is nothing to
             recover.) */
          <ErrorBoundary label={effectivePresentation} fallback={perkGridView}>
            {effectivePresentation === "ritual" ? (
              <RitualStage
                pool={availablePool}
                perks={perks}
                role={role}
                language={language}
                onCopy={handleCopy}
                {...(sharedBuild || activeSeed
                  ? {}
                  : {
                      pinnedSlots: pinnedPerkSlots,
                      onTogglePin: togglePin,
                      onRerollSlot: rerollSlot,
                    })}
              />
            ) : (
              <SlotsStage
                pool={availablePool}
                perks={perks}
                role={role}
                language={language}
                onCopy={handleCopy}
                {...(sharedBuild || activeSeed
                  ? {}
                  : {
                      pinnedSlots: pinnedPerkSlots,
                      onTogglePin: togglePin,
                      onRerollSlot: rerollSlot,
                    })}
              />
            )}
          </ErrorBoundary>
        ) : (
          perkGridView
        ))}

      <ShareExportStage
        squadBuilds={
          squadActive
            ? squad.squad.map((build) =>
                build.map((perk) => ({ slug: perk.slug, icon: perk.icon, name: perk.name })),
              )
            : []
        }
        squadRef={squadShareCardRef}
        shareRef={shareCardRef}
        storyRef={storyShareCardRef}
        pieces={sharePieces}
        mode={mode}
        role={role}
        language={language}
        character={shareCharacter}
        backdrops={shareBackdrops}
      />

      {/* What the four have in common, when they have anything.
      
          Below the cards, so it cannot move the build down the page — the
          thing three passes of layout work were spent raising. Above
          Generate, because it is about the build you are looking at rather
          than the next one.
      
          Silent most of the time at coherence 0, which is correct: measured
          over 400 seeded rolls per level, a theme turns up in 29.5% of
          chaos builds and 77.8% at full synergy. A line under a genuinely
          unrelated four would be the site inventing a story. */}
      {mode !== "loadout" && buildTheme && (
        /* Says what it means now. It used to read "3 из 4 — aura", which is
           three facts and no sentence: nothing told you the number counted
           perks, and nothing said what "aura" was doing there at all. The
           title carries where it comes from, for anyone who wonders why the
           line appears on some rolls and not others. */
        <p
          className="text-hint text-muted"
          title={t({
            ru: "Считается по тегам перков. Появляется, только если большинство билда тянет в одну сторону.",
            en: "Counted from the perks' own tags. Shown only when most of the build pulls the same way.",
          })}
        >
          {t({
            ru: `${buildTheme.count} из ${buildTheme.total} перков — про ${buildTheme.tag.ru.toLowerCase()}`,
            en: `${buildTheme.count} of ${buildTheme.total} perks are about ${buildTheme.tag.en.toLowerCase()}`,
          })}
        </p>
      )}

      {/* Primary CTA — the one action on this page that should visually
          win: standalone, largest, most saturated element on the board. */}
      <button
        type="button"
        onClick={() => regenerate("button")}
        disabled={
          !!activeSeed ||
          (mode === "perks" && (perkCount === 0 || poolExhausted))
        }
        title={
          activeSeed
            ? t({
                ru: "Билд зафиксирован этим сидом — сбросьте сид, чтобы рандомизировать",
                en: "This build is locked to the active seed — clear the seed to randomize",
              })
            : undefined
        }
        /* Sticky on a phone, static everywhere else.
        
           Measured at 390x844: the controls above the build come to 574px and
           the build itself to 315, so Generate lands at 915 on an 844px
           screen. It cannot be raised above the fold without removing a
           control, and four passes have already established that hiding
           things is not the answer here.
        
           So it stops trying to be above the fold and stays on screen
           instead: the one action the site exists for is always under a
           thumb, which is better than being 71px further up and still
           needing a scroll. Static from `sm`, where it was never a problem —
           at 1366x768 it sits at 598 of 768. */
        /* `sm:mt-2` is the one piece of asymmetric spacing on the board, and
           it is deliberate: the primary action reads as primary partly by
           having nothing crowding it. Only from `sm`, because the sticky phone
           layout already floats it clear of everything. */
        className="sticky bottom-3 z-30 flex items-center gap-2.5 rounded-full bg-accent px-8 py-3.5 text-base font-bold text-accent-foreground shadow-lg shadow-accent/30 transition-transform hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40 sm:static sm:bottom-auto sm:mt-2"
      >
        <Dices className="size-5" />
        {t({ ru: "Сгенерировать новый билд", en: "Generate a new build" })}
      </button>

      {/* Shortcuts are only useful if they're discoverable — a streamer
          mid-broadcast isn't going to find them by experiment.
          Hidden under `pointer: coarse`: measured on a 412px Pixel 7, this
          row still rendered 275x23 advertising keys a phone has no way to
          press. Hiding it is the rare fix that gives the tightest viewport
          space back instead of asking for more.
          The digit shortcuts are deliberately not listed here. They live on
          the reroll buttons themselves (perk-grid.tsx), because a legend
          grows with every shortcut added while a label on the control does
          not — and this row reading as the complete set while omitting
          them was the actual problem. */}
      <p className="-mt-1 flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-hint text-muted pointer-coarse:hidden">
        <kbd className="rounded border border-border bg-surface px-1 py-0.5 font-sans">
          Space
        </kbd>
        {t({ ru: "новый билд", en: "new build" })}
        <span className="opacity-50">·</span>
        <kbd className="rounded border border-border bg-surface px-1 py-0.5 font-sans">
          C
        </kbd>
        {t({ ru: "скопировать", en: "copy" })}
        <span className="opacity-50">·</span>
        <kbd className="rounded border border-border bg-surface px-1 py-0.5 font-sans">
          S
        </kbd>
        {t({ ru: "ссылка", en: "share link" })}
      </p>

      <ExportRow
        mode={mode}
        perks={perks}
        loadoutPieces={loadoutPieces}
        sharePieceCount={sharePieces.length}
        squadActive={squadActive}
        squadBuilds={squad.squad}
        onCopyAll={
          mode === "loadout"
            ? handleCopyAllLoadout
            : mode === "all"
              ? handleCopyAllCombined
              : handleCopyAll
        }
        onShare={handleShare}
        onDownloadImage={handleDownloadImage}
        generatingImage={generatingImage}
        presentation={presentation}
        onPresentationChange={setPresentation}
        isDesktop={isDesktop}
        showSoundControl={effectivePresentation === "casino"}
      />


      {mode === "perks" && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          <ToggleSwitch
            checked={squad.active}
            onChange={squad.toggle}
            label={t({ ru: "Билды на группу", en: "Squad builds" })}
            activeClassName="bg-accent"
            tooltip={t({
              ru: "Один билд на каждого в группе, без повторов перков между игроками.",
              en: "One build per player in your group, with no perk repeated across the team.",
            })}
          />
          {squad.active && (
            <div
              className="flex items-center gap-1"
              role="radiogroup"
              aria-label={t({ ru: "Сколько игроков", en: "How many players" })}
            >
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={squad.players === n}
                  onClick={() => squad.setPlayers(n)}
                  className={cn(
                    "tap size-7 rounded-full border text-control font-semibold transition-colors",
                    squad.players === n
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowStats((v) => !v)}
        className="tap flex items-center gap-1.5 text-control text-muted transition-colors hover:text-muted"
      >
        <BarChart3 className="size-3.5" />
        {t({ ru: "Статистика пула", en: "Pool stats" })}
      </button>
      {showStats && mounted && mode !== "loadout" && (
        <PoolStatsPanel
          totalLabel={t({
            ru: `Всего перков ${ROLE_LABEL[role].ru}:`,
            en: `Total ${ROLE_LABEL[role].en} perks:`,
          })}
          total={totalInRole}
          excluded={excludedSlugs.size}
          battleRoyale={
            battleRoyale
              ? { usedInRole: battleRoyaleUsedInRole, remaining: availableCount }
              : undefined
          }
        />
      )}
      {showStats && mounted && mode !== "perks" && (
        <PoolStatsPanel
          totalLabel={t({
            ru: `Всего предметов экипировки для ${ROLE_LABEL[role].ru}:`,
            en: `Total ${ROLE_LABEL[role].en} loadout pieces:`,
          })}
          total={totalLoadoutInRole}
          excluded={excludedLoadoutSlugs.size}
          battleRoyale={
            battleRoyale
              ? {
                  usedInRole: battleRoyaleUsedLoadoutInRole,
                  remaining: availableLoadoutCount,
                }
              : undefined
          }
        />
      )}

      {excludePanelKind === "perks" ? (
        <ExcludePanel
          key={`perk-pool-${role}`}
          open={excludePanelOpen}
          role={role}
          language={language}
          excludedSlugs={excludedSlugs}
          alsoGrayedOut={battleRoyale ? battleRoyaleUsed : undefined}
          favoriteSlugs={favoriteSlugs}
          onToggle={toggleExcluded}
          onBulkSet={bulkSetExcluded}
          onToggleFavorite={toggleFavorite}
          onResetRole={resetExcludedForRole}
          onClose={exclusions.closePanel}
        />
      ) : (
        <LoadoutExcludePanel
          key={`loadout-pool-${role}`}
          open={excludePanelOpen}
          role={role}
          language={language}
          character={role === "killer" ? selectedCharacter : null}
          excludedKeys={excludedLoadoutSlugs}
          alsoGrayedOut={battleRoyale ? battleRoyaleUsed : undefined}
          onToggle={toggleExcludedLoadoutPiece}
          onBulkSet={bulkSetExcludedLoadout}
          onResetRole={resetExcludedLoadoutForRole}
          onClose={exclusions.closePanel}
        />
      )}

      <StatsModal
        open={statsModalOpen}
        language={language}
        onClose={() => setStatsModalOpen(false)}
        version={statsVersion}
        onRollUnseen={rollUnseen}
      />

      <VaultModal
        open={vaultModalOpen}
        onClose={() => setVaultModalOpen(false)}
        onOpenBuild={openVaultBuild}
        currentBuild={
          mode === "loadout"
            ? loadoutPieces.length > 0
              ? {
                  role,
                  mode: "loadout" as const,
                  keys: loadoutPieces.map((p) => `${p.kind}:${p.slug}`),
                }
              : null
            : perks.length > 0
              ? { role, mode: "perks" as const, keys: perks.map((p) => p.slug) }
              : null
        }
      />

      <PresetsModal
        open={presetsModalOpen}
        role={role}
        language={language}
        onClose={() => setPresetsModalOpen(false)}
        onApply={applyPreset}
      />

      <HistoryModal
        open={historyModalOpen}
        language={language}
        onClose={() => setHistoryModalOpen(false)}
        onRestore={restoreHistoryEntry}
        version={statsVersion}
      />

      <ObsOverlayModal
        open={obsModalOpen}
        onClose={() => setObsModalOpen(false)}
        perks={perks}
        mode={mode}
        loadoutPieces={loadoutPieces}
        language={language}
        role={role}
        character={shareCharacter}
        pieceVisibility={pieceVisibility}
        onPieceVisibilityChange={settings.setPieceVisibility}
        twitch={twitch}
        hold={obsHold}
      />

      <CharacterPickerModal
        key={`char-picker-${mode !== "perks" && role === "killer" ? "killer-loadout" : role}`}
        open={characterPickerOpen}
        role={role}
        language={language}
        characters={characterChoices}
        selected={selectedCharacter}
        onSelect={selectCharacter}
        onClose={() => setCharacterPickerOpen(false)}
      />

      <CopyToast message={toast} />
    </div>
  );
}
