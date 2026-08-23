"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link2,
  ListFilter,
  Dices,
  Skull,
  BarChart3,
  BookOpen,
  CalendarClock,
  Copy,
  History,
  MonitorPlay,
  Users,
  X,
} from "lucide-react";
import {
  getAvailablePool,
  getCharacterPortrait,
  getCharactersForRole,
  getPerkBySlug,
  getPerksByRole,
  getRandomPerksWithTeachables,
  getSeededPerks,
} from "@/lib/perks";
import { getCharacterName } from "@/lib/character-name";
import { resolvePreset, type BuildPreset } from "@/lib/build-presets";
import { usePerkSlots } from "@/lib/use-perk-slots";
import { useBoardShortcuts } from "@/lib/use-board-shortcuts";
import { getTagsForPerk, getTagsForRole } from "@/lib/perk-tags";
import type {
  Addon,
  Loadout,
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
import { usePersistedSet } from "@/lib/use-persisted-set";
import { useBuildClipboard } from "@/lib/use-build-clipboard";
import { ROLE_COLOR } from "@/lib/role-color";
import { useLanguage, useT } from "@/lib/i18n";
import { dailyChallengeSeed } from "@/lib/seeded-random";
import { recordDailyParticipation } from "@/lib/daily-count";
import { recordRoll } from "@/lib/stats";
import {
  parseLoadoutKey,
  recordHistoryEntry,
  type HistoryEntry,
} from "@/lib/history";
import { getIdForSlug, getSlugForId } from "@/lib/perk-ids";
import { withBasePath } from "@/lib/asset-path";
import {
  flattenLoadout,
  getKillerCharacters,
  getLoadoutPiece,
  getLoadoutPoolForRole,
  getRandomLoadout,
  getSeededLoadout,
} from "@/lib/loadout";
import {
  getIdForLoadoutPiece,
  getLoadoutPieceKeyForId,
} from "@/lib/loadout-ids";
import { safeGet, safeGetJSON, safeSet, safeSetJSON } from "@/lib/safe-storage";
import { publishObsState } from "@/lib/obs-sync";
import { useTwitchSettings } from "@/lib/use-twitch-settings";
import { PerkGrid } from "./perk-grid";
import { LoadoutGrid } from "./loadout-grid";
import { CopyToast } from "./copy-toast";
import { ExcludePanel } from "./exclude-panel";
import { LoadoutExcludePanel } from "./loadout-exclude-panel";
import { StatsModal } from "./stats-modal";
import { DailyCount } from "./daily-count";
import { HistoryModal } from "./history-modal";
import { PresetsModal } from "./presets-modal";
import { ToggleSwitch } from "./toggle-switch";
import {
  ShareCard,
  type ShareCardLayout,
  type ShareCardPiece,
} from "./share-card";
import { DownloadImageButton } from "./download-image-button";
import { canvasToPngBlob, saveImage } from "@/lib/save-image";
import { ObsOverlayModal, type PieceVisibility } from "./obs-overlay-modal";
import { CharacterPickerModal } from "./character-picker-modal";
import { MoreMenu } from "./more-menu";
import { PresentationPicker } from "./presentation-picker";
import { RitualStage } from "./ritual-stage";
import { SlotsStage } from "./slots-stage";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { isAvailable, usePresentation } from "@/lib/use-presentation";

const MAX_PERK_COUNT = 4;
const DEFAULT_PERK_COUNT = 4;
const EXCLUDED_STORAGE_KEY = "dbd-randomizer:excluded-perks";
const FAVORITE_STORAGE_KEY = "dbd-randomizer:favorite-perks";
const PERK_COUNT_STORAGE_KEY = "dbd-randomizer:perk-count";
const BR_STORAGE_KEY = "dbd-randomizer:battle-royale";
const MODE_STORAGE_KEY = "dbd-randomizer:mode";
const EXCLUDED_LOADOUT_STORAGE_KEY = "dbd-randomizer:excluded-loadout";
const LOADOUT_SLOT_ITEM_STORAGE_KEY = "dbd-randomizer:loadout-slot-item";
const LOADOUT_SLOT_ADDONS_STORAGE_KEY = "dbd-randomizer:loadout-slot-addons";
const LOADOUT_SLOT_OFFERING_STORAGE_KEY =
  "dbd-randomizer:loadout-slot-offering";
const DEFAULT_LOADOUT_SLOTS: LoadoutSlots = {
  item: true,
  addons: true,
  offering: true,
};
// "all" shows the perk grid and the loadout HUD together — a real player
// always has both equipped at once in an actual match, so this is what a
// visitor asking for "just show me everything" gets instead of having to
// flip between the other two.
const GUARANTEE_TEACHABLES_STORAGE_KEY = "dbd-randomizer:guarantee-teachables";
const PIECE_VISIBILITY_STORAGE_KEY = "dbd-randomizer:piece-visibility";
const DEFAULT_PIECE_VISIBILITY: PieceVisibility = {
  perks: true,
  item: true,
  addon: true,
  offering: true,
};
const ROLE_LABEL: Record<PerkRole, { ru: string; en: string }> = {
  survivor: { ru: "выжившего", en: "survivor" },
  killer: { ru: "убийцы", en: "killer" },
};
const ROLE_NAME: Record<PerkRole, { ru: string; en: string }> = {
  survivor: { ru: "Выживший", en: "Survivor" },
  killer: { ru: "Убийца", en: "Killer" },
};
const ROLE_SHORT: Record<PerkRole, string> = { survivor: "s", killer: "k" };
const ROLE_FROM_SHORT: Record<string, PerkRole> = {
  s: "survivor",
  k: "killer",
};

type SeedMode = "none" | "daily" | "custom";

function loadPerkCount(): number {
  const n = parseInt(safeGet("local", PERK_COUNT_STORAGE_KEY) ?? "", 10);
  return Number.isInteger(n) && n >= 0 && n <= MAX_PERK_COUNT
    ? n
    : DEFAULT_PERK_COUNT;
}

const VALID_MODES: readonly BuildMode[] = ["perks", "loadout", "all"];

function loadMode(): BuildMode {
  const stored = safeGet("local", MODE_STORAGE_KEY);
  return VALID_MODES.includes(stored as BuildMode)
    ? (stored as BuildMode)
    : "perks";
}

function loadLoadoutSlots(): LoadoutSlots {
  // Absent key (never saved yet) means "on" — DEFAULT_LOADOUT_SLOTS is
  // all-true, and only an explicit "0" write should turn a slot off.
  return {
    item: safeGet("local", LOADOUT_SLOT_ITEM_STORAGE_KEY) !== "0",
    addons: safeGet("local", LOADOUT_SLOT_ADDONS_STORAGE_KEY) !== "0",
    offering: safeGet("local", LOADOUT_SLOT_OFFERING_STORAGE_KEY) !== "0",
  };
}


interface BattleRoyaleState {
  active: boolean;
  used: string[];
}

function loadBattleRoyale(): BattleRoyaleState {
  const stored = safeGetJSON<Partial<BattleRoyaleState>>(
    "session",
    BR_STORAGE_KEY,
    {},
  );
  return {
    active: stored.active === true,
    used: Array.isArray(stored.used)
      ? stored.used.filter((s) => typeof s === "string")
      : [],
  };
}

function persistBattleRoyale(state: BattleRoyaleState) {
  safeSetJSON("session", BR_STORAGE_KEY, state);
}

interface InitialUrlState {
  role: PerkRole;
  mode: BuildMode;
  seed?: string;
  perks?: Perk[];
  loadoutPieces?: LoadoutPiece[];
}

/** Reads either the compact URL format (`?r=s&p=42,105,12,8`, current) or
 *  the legacy one (`?role=survivor&perks=full-slug-names`, from links
 *  shared before short IDs existed) — old links must keep working. `?seed=`
 *  takes priority over an explicit perk/loadout list either way, since a
 *  seed is enough to re-derive the build client-side. `?mode=loadout` plus
 *  `?lp=id1,id2,...` mirrors `?p=` for sharing a specific Full Loadout roll;
 *  `?mode=all` carries both `?p=` and `?lp=` together for the combined view.
 *
 *  A bare role (`?r=k`) is honoured on its own: it sets the side and nothing
 *  else. It used to be discarded unless a build or an explicit mode came
 *  with it, which meant the very parameter the site writes into its own
 *  share links opened the wrong role when a link got truncated. Applying it
 *  does not mark anything as a shared build — that still requires `p`/`lp`
 *  or a seed — so the visitor gets a normal rerollable roll. */
function readInitialUrlState(): InitialUrlState | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);

  const shortRole = params.get("r");
  const legacyRole = params.get("role");
  const role = shortRole
    ? ROLE_FROM_SHORT[shortRole]
    : legacyRole === "survivor" || legacyRole === "killer"
      ? legacyRole
      : undefined;
  if (!role) return null;

  const modeParam = params.get("mode");
  const mode: BuildMode =
    modeParam === "loadout" ? "loadout" : modeParam === "all" ? "all" : "perks";

  const seed = params.get("seed");
  if (seed) return { role, mode, seed };

  const readLoadoutPieces = (): LoadoutPiece[] => {
    const lpParam = params.get("lp");
    if (!lpParam) return [];
    return lpParam
      .split(",")
      .map((idStr) => {
        const id = Number(idStr);
        const key = Number.isFinite(id)
          ? getLoadoutPieceKeyForId(id)
          : undefined;
        return key ? getLoadoutPiece(key.kind, key.slug) : undefined;
      })
      .filter((piece): piece is LoadoutPiece => !!piece);
  };

  const readPerks = (): Perk[] => {
    const idsParam = params.get("p");
    if (idsParam) {
      const matched = idsParam
        .split(",")
        .map((idStr) => {
          const id = Number(idStr);
          const slug = Number.isFinite(id) ? getSlugForId(id) : undefined;
          return slug ? getPerkBySlug(slug) : undefined;
        })
        .filter((perk): perk is Perk => !!perk && perk.role === role);
      if (matched.length > 0) return matched;
    }
    const slugsParam = params.get("perks");
    if (slugsParam) {
      return slugsParam
        .split(",")
        .map((slug) => getPerkBySlug(slug))
        .filter((perk): perk is Perk => !!perk && perk.role === role);
    }
    return [];
  };

  if (mode === "loadout") {
    const loadoutPieces = readLoadoutPieces();
    if (loadoutPieces.length > 0) return { role, mode, loadoutPieces };
    // Explicit `?mode=loadout` is itself meaningful intent — unlike a bare
    // `?r=...` alone (which existing perk links deliberately don't treat as
    // "shared state," see the perks branch below), a link that spells out
    // the mode should open in that mode even without a specific build to
    // restore.
    return { role, mode };
  }

  if (mode === "all") {
    const perks = readPerks();
    const loadoutPieces = readLoadoutPieces();
    if (perks.length > 0 || loadoutPieces.length > 0) {
      return {
        role,
        mode,
        perks: perks.length > 0 ? perks : undefined,
        loadoutPieces: loadoutPieces.length > 0 ? loadoutPieces : undefined,
      };
    }
    return { role, mode }; // same "explicit mode is enough" rule as loadout above
  }

  const perks = readPerks();
  if (perks.length > 0) return { role, mode, perks };

  // A role with nothing attached is still intent worth honouring. `r` is the
  // short parameter the site writes into every share link it generates, so
  // `?r=k` on its own — a link truncated in a chat client, or shortened by
  // hand — used to open the Survivor side without a word. Only the role and
  // mode are applied here; nothing is marked as a shared build, so the
  // visitor gets a normal, rerollable roll for the side they asked for.
  return { role, mode };
}

export function RandomizerBoard() {
  const t = useT();
  const { lang: language } = useLanguage();
  const [role, setRole] = useState<PerkRole>("survivor");
  const [generatingImage, setGeneratingImage] =
    useState<ShareCardLayout | null>(null);
  const shareCardRef = useRef<HTMLDivElement>(null);
  const storyShareCardRef = useRef<HTMLDivElement>(null);
  const [excludePanelOpen, setExcludePanelOpen] = useState(false);
  // Which pool the "Пул" button(s) open — irrelevant outside "all" mode
  // (there's only one pool to manage there), but "all" mode shows perks
  // and loadout together, so it needs two separate pool buttons and this
  // decides which panel opens when one of them is clicked.
  const [excludePanelKind, setExcludePanelKind] = useState<"perks" | "loadout">(
    "perks",
  );
  // Both start at SSR-safe defaults and are corrected from localStorage in
  // the mount effect below — a lazy useState(loadX) initializer would read
  // localStorage during the client's first render, which happens *before*
  // hydration reconciles against the server's (window-less) HTML and would
  // throw a hydration mismatch for any returning visitor with saved state.
  const excludedPerks = usePersistedSet(EXCLUDED_STORAGE_KEY);
  const favorites = usePersistedSet(FAVORITE_STORAGE_KEY);
  const excludedSlugs = excludedPerks.values;
  const favoriteSlugs = favorites.values;
  const [perkCount, setPerkCount] = useState<number>(DEFAULT_PERK_COUNT);
  // Full Loadout mode — same hydration-safety rule as everything else here:
  // SSR-safe defaults, corrected from localStorage/URL in the mount effect.
  const [mode, setMode] = useState<BuildMode>("perks");
  const [loadoutSlots, setLoadoutSlots] = useState<LoadoutSlots>(
    DEFAULT_LOADOUT_SLOTS,
  );
  const excludedLoadout = usePersistedSet(EXCLUDED_LOADOUT_STORAGE_KEY);
  const excludedLoadoutSlugs = excludedLoadout.values;
  // Pulled out by name so the mount effect can depend on stable callbacks
  // rather than on the hooks' return objects, which are new every render.
  const { hydrate: hydrateExcludedPerks } = excludedPerks;
  const { hydrate: hydrateFavorites } = favorites;
  const { hydrate: hydrateExcludedLoadout } = excludedLoadout;
  const [sharedLoadoutPieces, setSharedLoadoutPieces] = useState<
    LoadoutPiece[] | null
  >(null);
  // Random Character (Feature #2) — deliberately session-only, not synced
  // to the URL or localStorage: it's a flourish on top of a build, not
  // part of what a share link or a returning visit needs to restore.
  // guaranteeTeachables (the perks-mode "always include this character's
  // own perks" toggle) IS persisted, same as the other pool/settings
  // toggles — it only has an effect once a character is actually selected.
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(
    null,
  );
  const [guaranteeTeachables, setGuaranteeTeachables] = useState(false);
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [presetsModalOpen, setPresetsModalOpen] = useState(false);
  const [obsModalOpen, setObsModalOpen] = useState(false);
  const [statsVersion, setStatsVersion] = useState(0);
  const [battleRoyale, setBattleRoyale] = useState(false);
  const [battleRoyaleUsed, setBattleRoyaleUsed] = useState<Set<string>>(
    new Set(),
  );
  const [seedMode, setSeedMode] = useState<SeedMode>("none");
  const [customSeedInput, setCustomSeedInput] = useState("");
  // Only holds the custom-seed value — Daily Challenge's seed is derived
  // below from `role`, so switching role while it's on can't drift out of
  // sync with a stale copy stored in state.
  const [activeCustomSeed, setActiveCustomSeed] = useState<string | null>(null);
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
  // Card text is no longer part of the page's own payload (see
  // lib/descriptions.ts). Warming it once the browser is idle means the
  // first card someone opens already has its text, without any of it
  // sitting on the critical path.
  useEffect(() => {
    prefetchDescriptions();
  }, []);
  const [nonce, setNonce] = useState(0);
  const [sharedBuild, setSharedBuild] = useState<Perk[] | null>(null);
  // A quick, session-only filter (not persisted, resets on role change) —
  // distinct from the pool manager's exclusions, which are a deliberate,
  // saved choice. "themeTag: null" means no filter, i.e. the full role pool.
  const [themeTag, setThemeTag] = useState<string | null>(null);
  // Display-only filter for the OBS overlay and Download Image — separate
  // from `loadoutSlots` (which decides what actually gets *rolled*): a
  // streamer might still want the full loadout rolled (to copy/reference
  // themselves) while only showing perks + Item on stream, for instance.
  const [pieceVisibility, setPieceVisibility] = useState<PieceVisibility>(
    DEFAULT_PIECE_VISIBILITY,
  );

  const activeSeed =
    seedMode === "daily"
      ? dailyChallengeSeed(role)
      : seedMode === "custom"
        ? activeCustomSeed
        : null;

  useEffect(() => {
    function applyInitialClientState() {
      // The three saved Sets restore themselves — see lib/use-persisted-set.ts.
      hydrateExcludedPerks();
      hydrateFavorites();
      hydrateExcludedLoadout();
      setPerkCount(loadPerkCount());
      setMode(loadMode());
      setLoadoutSlots(loadLoadoutSlots());
      setGuaranteeTeachables(
        safeGet("local", GUARANTEE_TEACHABLES_STORAGE_KEY) === "1",
      );

      const urlState = readInitialUrlState();
      if (urlState) {
        setRole(urlState.role);
        setMode(urlState.mode);
        if (urlState.seed) {
          setCustomSeedInput(urlState.seed);
          if (urlState.seed === dailyChallengeSeed(urlState.role)) {
            setSeedMode("daily");
          } else {
            setSeedMode("custom");
            setActiveCustomSeed(urlState.seed);
          }
        } else {
          // Not an else-if chain — "all" mode's share link carries both
          // `p=` and `lp=` together and needs both applied, or the
          // loadout half would silently re-roll instead of restoring
          // (only the last branch taken would ever run).
          if (urlState.perks) {
            setSharedBuild(urlState.perks);
            setPerkCount(urlState.perks.length);
          }
          if (urlState.loadoutPieces) {
            setSharedLoadoutPieces(urlState.loadoutPieces);
          }
        }
      }
      const br = loadBattleRoyale();
      if (br.active) {
        setBattleRoyale(true);
        setBattleRoyaleUsed(new Set(br.used));
      }

      setPieceVisibility(
        safeGetJSON(
          "local",
          PIECE_VISIBILITY_STORAGE_KEY,
          DEFAULT_PIECE_VISIBILITY,
        ),
      );
    }
    applyInitialClientState();
    // The individual hydrate callbacks, not the hook objects that carry
    // them: usePersistedSet returns a fresh object every render, so
    // depending on those would re-run this on every render — and since
    // hydrating sets state, that is an endless loop rather than merely
    // wasteful. The callbacks themselves are stable.
  }, [hydrateExcludedPerks, hydrateFavorites, hydrateExcludedLoadout]);

  // Perks the current theme filter rules out, expressed as an exclusion set
  // so it can merge into the same combinedExcluded pipeline that already
  // handles Battle Royale attrition and manual exclusions — getRandomPerks
  // and the pool-exhausted check don't need to know a theme exists at all.
  const themeExcluded = useMemo(() => {
    if (!mounted || !themeTag) return null;
    const nonMatching = getPerksByRole(role)
      .filter((p) => !getTagsForPerk(p).includes(themeTag))
      .map((p) => p.slug);
    return new Set(nonMatching);
  }, [mounted, role, themeTag]);

  const combinedExcluded = useMemo(() => {
    const extra: ReadonlySet<string>[] = [];
    if (battleRoyale && battleRoyaleUsed.size > 0) extra.push(battleRoyaleUsed);
    if (themeExcluded && themeExcluded.size > 0) extra.push(themeExcluded);
    if (extra.length === 0) return excludedSlugs;
    const merged = new Set(excludedSlugs);
    for (const set of extra) for (const slug of set) merged.add(slug);
    return merged;
  }, [excludedSlugs, battleRoyale, battleRoyaleUsed, themeExcluded]);

  const availablePool = useMemo(
    () => (mounted ? getAvailablePool(role, combinedExcluded) : []),
    [mounted, role, combinedExcluded],
  );
  const availableCount = availablePool.length;
  // Applies to both causes of a too-small pool: Battle Royale attrition and
  // the player just manually excluding too many perks in Manage Pool. Either
  // way, getRandomPerks() refuses to top up from excluded perks (see
  // lib/perks.ts), so this must be checked up front rather than discovered
  // after the fact from a short/empty result.
  const poolExhausted =
    !activeSeed && mounted && perkCount > 0 && availableCount < perkCount;

  // The raw roll. Deliberately split from the `perks` the rest of the
  // component uses (see the overlay memo below): pinning must not itself
  // cause a reroll, and this memo rerolls whenever any of its dependencies
  // changes. Keeping pins out of its dependency list is what makes
  // "pin a perk" a no-op on the other three slots.
  const basePerks = useMemo(() => {
    void nonce; // intentional cache-buster: forces a reshuffle on "regenerate"
    // Gated on mode so every effect keyed off `perks` (stats, URL sync, the
    // "perks" half of the OBS payload) naturally goes idle in loadout-only
    // mode instead of needing its own mode check duplicated everywhere —
    // computed for both "perks" and "all" (which shows both at once).
    if (!mounted || mode === "loadout") return [];
    if (sharedBuild) return sharedBuild;
    if (perkCount === 0) return [];
    if (activeSeed) return getSeededPerks(role, perkCount, activeSeed);
    if (poolExhausted) return [];
    const character = guaranteeTeachables ? selectedCharacter : null;
    // Rolls a few spares beyond perkCount. The overlay below drops any
    // rolled perk that a pin already placed in the build, and without
    // slack that would leave a slot empty whenever the roll happens to
    // land on a perk the user has pinned. Capped by what the pool can
    // actually supply so this can never ask for more than exists.
    const withSlack = Math.min(perkCount + MAX_PERK_COUNT, availableCount);
    return getRandomPerksWithTeachables(
      role,
      withSlack,
      character,
      combinedExcluded,
      Math.random,
      favoriteSlugs,
    );
  }, [
    availableCount,
    mounted,
    mode,
    role,
    nonce,
    sharedBuild,
    combinedExcluded,
    perkCount,
    poolExhausted,
    activeSeed,
    favoriteSlugs,
    guaranteeTeachables,
    selectedCharacter,
  ]);

  // Pins and single-slot rerolls, layered over the roll above. Extracted
  // whole (see lib/use-perk-slots.ts): it was the largest self-contained
  // mechanism in this file and none of it is presentational — it takes a
  // roll and returns the build to render.
  const { perks, pinnedPerkSlots, togglePin, rerollSlot, clearSlotOverrides } =
    usePerkSlots({
      basePerks,
      perkCount,
      role,
      fixedBuild: !!sharedBuild || !!activeSeed,
      guaranteeTeachables,
      selectedCharacter,
      combinedExcluded,
      favoriteSlugs,
    });

  // Loadout counterpart of combinedExcluded above — same Battle Royale +
  // manual-exclusion merge, just namespaced "kind:slug" keys instead of
  // plain perk slugs (see lib/loadout.ts's excludeKey).
  const combinedExcludedLoadout = useMemo(() => {
    if (!battleRoyale || battleRoyaleUsed.size === 0)
      return excludedLoadoutSlugs;
    const merged = new Set(excludedLoadoutSlugs);
    for (const key of battleRoyaleUsed) merged.add(key);
    return merged;
  }, [excludedLoadoutSlugs, battleRoyale, battleRoyaleUsed]);

  const loadout = useMemo((): Loadout | null => {
    void nonce;
    if (!mounted || mode === "perks" || sharedLoadoutPieces) return null;
    if (activeSeed) return getSeededLoadout(role, loadoutSlots, activeSeed);
    return getRandomLoadout(
      role,
      loadoutSlots,
      combinedExcludedLoadout,
      Math.random,
      selectedCharacter,
    );
  }, [
    mounted,
    mode,
    sharedLoadoutPieces,
    role,
    nonce,
    activeSeed,
    loadoutSlots,
    combinedExcludedLoadout,
    selectedCharacter,
  ]);

  // Flattened into the same "just some pieces" shape LoadoutGrid renders,
  // same reasoning as why flattenLoadout exists (see lib/loadout.ts).
  const loadoutPieces = useMemo((): LoadoutPiece[] => {
    if (mode === "perks") return [];
    if (sharedLoadoutPieces) return sharedLoadoutPieces;
    if (!loadout) return [];
    return flattenLoadout(loadout);
  }, [mode, sharedLoadoutPieces, loadout]);

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

  useEffect(() => {
    function syncUrl() {
      const params = new URLSearchParams();
      params.set("r", ROLE_SHORT[role]);
      if (mode !== "perks") params.set("mode", mode); // "loadout" or "all"
      if (activeSeed) {
        params.set("seed", activeSeed);
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}?${params}`,
        );
        return;
      }
      if (mode !== "perks" && loadoutPieces.length > 0) {
        const ids = loadoutPieces.map((p) =>
          getIdForLoadoutPiece(p.kind, p.slug),
        );
        if (ids.every((id): id is number => id !== undefined)) {
          params.set("lp", ids.join(","));
        }
        // No legacy fallback needed here (unlike perks below) — every
        // loadout piece gets a short ID at scrape time, same guarantee
        // data/perk-ids.json has always made for perks.
      }
      if (mode !== "loadout" && perks.length > 0) {
        const ids = perks.map((p) => getIdForSlug(p.slug));
        if (ids.every((id): id is number => id !== undefined)) {
          params.set("p", ids.join(","));
        } else {
          // Safety net for a perk with no assigned short ID (shouldn't
          // happen — every slug in data/perks.json gets one at scrape
          // time) — fall back to the legacy full-slug format rather than
          // producing a share link that silently drops perks.
          params.set("perks", perks.map((p) => p.slug).join(","));
        }
      }
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?${params}`,
      );
    }
    if (mounted) syncUrl();
  }, [role, mode, perks, loadoutPieces, mounted, activeSeed]);

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
    // "all" mode eliminates both halves together in one update, rather
    // than two separate setState calls — avoids persisting the evolving
    // set to storage twice for what's really one user action.
    const hasPerks = mode !== "loadout" && perks.length > 0;
    const hasLoadout = mode !== "perks" && loadoutPieces.length > 0;
    if (!hasPerks && !hasLoadout) return;
    setBattleRoyaleUsed((prev) => {
      const next = new Set(prev);
      if (hasPerks) perks.forEach((p) => next.add(p.slug));
      if (hasLoadout)
        loadoutPieces.forEach((p) => next.add(`${p.kind}:${p.slug}`));
      persistBattleRoyale({ active: true, used: [...next] });
      return next;
    });
  }, [mode, perks, loadoutPieces]);

  // Declared after eliminateCurrentBuild because it takes it: copying a
  // build is one of the two ways Battle Royale retires one (the other is
  // regenerating, below).
  const { toast, showToast, copy } = useBuildClipboard({
    onUsed: () => {
      if (battleRoyale) eliminateCurrentBuild();
    },
  });

  const regenerate = useCallback(() => {
    // Battle Royale's whole premise is elimination — the pool should shrink
    // every round regardless of *how* you moved on, not only when you
    // happened to copy a perk first. Without this, spamming Generate (or
    // its Space/Enter shortcut) never drains the pool, so "play until every
    // perk is gone" never actually triggers.
    if (battleRoyale) eliminateCurrentBuild();
    setSharedBuild(null);
    setSharedLoadoutPieces(null);
    clearSlotOverrides();
    setNonce((n) => n + 1);
  }, [battleRoyale, eliminateCurrentBuild, clearSlotOverrides]);

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
    const ids = argsText
      .split(/[,\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    if (ids.length === 0) return;
    const matched = ids
      .map((id) => {
        const slug = getSlugForId(id);
        return slug ? getPerkBySlug(slug) : undefined;
      })
      .filter((p): p is Perk => !!p);
    if (matched.length === 0) return;
    // Mirrors readInitialUrlState's own rule for a shared-build link: perks
    // determine the role, and any ID that doesn't match the first one's
    // role is dropped rather than shown mixed.
    const targetRole = matched[0].role;
    setRole(targetRole);
    setSharedBuild(matched.filter((p) => p.role === targetRole));
  }, []);

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
  const twitch = useTwitchSettings({
    mounted,
    onReroll: useCallback(() => regenerateRef.current(), []),
    onPaste: handleTwitchPaste,
  });

  const applyPreset = useCallback((preset: BuildPreset) => {
    const perks = resolvePreset(preset);
    if (perks.length === 0) return;
    setRole(preset.role);
    // A seeded build outranks a shared one further up, so leaving a seed
    // active would show the seed's build and quietly ignore the pick.
    setSeedMode("none");
    setSharedBuild(perks);
  }, []);


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
    regenerate,
    handleCopyAll,
    handleShare,
    rerollSlot,
  });

  function selectRole(next: PerkRole) {
    setSharedBuild(null);
    setSharedLoadoutPieces(null);
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
    setSharedBuild(null);
    setSharedLoadoutPieces(null);
    setNonce((n) => n + 1);
  }

  function toggleGuaranteeTeachables() {
    const next = !guaranteeTeachables;
    setGuaranteeTeachables(next);
    safeSet("local", GUARANTEE_TEACHABLES_STORAGE_KEY, next ? "1" : "0");
    setSharedBuild(null);
    setNonce((n) => n + 1);
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
      const matched = entry.keys
        .map((slug) => getPerkBySlug(slug))
        .filter((p): p is Perk => !!p);
      if (matched.length === 0) return;
      setRole(entry.role);
      setMode("perks");
      safeSet("local", MODE_STORAGE_KEY, "perks");
      setSharedLoadoutPieces(null);
      setSharedBuild(matched);
      setPerkCount(matched.length);
    } else {
      const matched = entry.keys
        .map((key) => {
          const parsed = parseLoadoutKey(key);
          return parsed ? getLoadoutPiece(parsed.kind, parsed.slug) : undefined;
        })
        .filter((p): p is LoadoutPiece => !!p);
      if (matched.length === 0) return;
      setRole(entry.role);
      setMode("loadout");
      safeSet("local", MODE_STORAGE_KEY, "loadout");
      setSharedBuild(null);
      setSharedLoadoutPieces(matched);
    }
    setHistoryModalOpen(false);
  }

  function openExcludePanel(kind: "perks" | "loadout") {
    setExcludePanelKind(kind);
    setExcludePanelOpen(true);
  }

  function selectMode(next: BuildMode) {
    setMode(next);
    safeSet("local", MODE_STORAGE_KEY, next);
    setSharedBuild(null);
    setSharedLoadoutPieces(null);
    setNonce((n) => n + 1);
  }

  function toggleLoadoutSlot(slot: keyof LoadoutSlots) {
    setLoadoutSlots((prev) => {
      const next = { ...prev, [slot]: !prev[slot] };
      const key =
        slot === "item"
          ? LOADOUT_SLOT_ITEM_STORAGE_KEY
          : slot === "addons"
            ? LOADOUT_SLOT_ADDONS_STORAGE_KEY
            : LOADOUT_SLOT_OFFERING_STORAGE_KEY;
      safeSet("local", key, next[slot] ? "1" : "0");
      return next;
    });
    setSharedLoadoutPieces(null);
    setNonce((n) => n + 1);
  }

  function selectTheme(tag: string | null) {
    setSharedBuild(null);
    setThemeTag(tag);
    setNonce((n) => n + 1);
  }

  function selectPerkCount(next: number) {
    setSharedBuild(null);
    setPerkCount(next);
    safeSet("local", PERK_COUNT_STORAGE_KEY, String(next));
    setNonce((n) => n + 1);
  }

  // All six of these used to spell out the same "copy the Set, mutate it,
  // write it to localStorage" by hand, once per set — see
  // lib/use-persisted-set.ts.
  const toggleExcluded = excludedPerks.toggle;
  const bulkSetExcluded = excludedPerks.setMany;
  const toggleFavorite = favorites.toggle;

  function resetExcludedForRole(targetRole: PerkRole) {
    const roleSlugs = new Set(getPerksByRole(targetRole).map((p) => p.slug));
    excludedPerks.removeWhere((slug) => roleSlugs.has(slug));
  }

  function toggleExcludedLoadoutPiece(kind: LoadoutPiece["kind"], slug: string) {
    excludedLoadout.toggle(`${kind}:${slug}`);
  }

  const bulkSetExcludedLoadout = excludedLoadout.setMany;

  function resetExcludedLoadoutForRole(targetRole: PerkRole) {
    const roleKeys = new Set(
      getLoadoutPoolForRole(targetRole).map((p) => `${p.kind}:${p.slug}`),
    );
    excludedLoadout.removeWhere((key) => roleKeys.has(key));
  }


  function updatePieceVisibility(kind: keyof PieceVisibility, value: boolean) {
    setPieceVisibility((prev) => {
      const next = { ...prev, [kind]: value };
      safeSetJSON("local", PIECE_VISIBILITY_STORAGE_KEY, next);
      return next;
    });
  }

  // All five of these were the same eleven lines with a different string —
  // see lib/use-build-clipboard.ts, which also owns the toast.
  function handleCopy(perk: Perk) {
    copy(perk.name[language], {
      ru: `«${perk.name[language]}» скопировано в буфер обмена!`,
      en: `"${perk.name[language]}" copied to clipboard!`,
    });
  }

  function handleCopyAll() {
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

  function handleShare() {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() =>
        showToast(
          t({ ru: "Ссылка на билд скопирована!", en: "Build link copied!" }),
        ),
      )
      .catch(() =>
        showToast(
          t({
            ru: "Не удалось скопировать ссылку",
            en: "Couldn't copy the link",
          }),
        ),
      );
  }

  async function handleDownloadImage(layout: ShareCardLayout) {
    const target =
      layout === "story" ? storyShareCardRef.current : shareCardRef.current;
    if (!target || sharePieces.length === 0 || generatingImage) return;
    setGeneratingImage(layout);
    try {
      // html2canvas draws text with canvas fillText using each element's
      // computed font-family. If a webfont has not finished loading it does
      // not fall back gracefully — it bakes the fallback face into the PNG
      // and nothing reports a problem. The card is set in Oswald and IBM Plex
      // Mono (lib/export-fonts.ts), so wait for them before rasterising.
      // Cheap in practice: by the time anyone clicks, they are long loaded.
      if (typeof document !== "undefined" && document.fonts?.ready) {
        await document.fonts.ready;
      }
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(target, {
        // Background is baked into ShareCard's own gradient now (see
        // share-card.tsx), not a flat fill — this backgroundColor is just
        // the fallback if that CSS somehow fails to paint.
        backgroundColor: "#0d0e12",
        // 2x, not 3x. Two reasons, both measured rather than assumed.
        //
        // Resolution: the card draws each icon at ~122px from a 256px source,
        // so 2x renders it at 244px — just under native. 3x asked for 366px
        // from the same 256px file, which is upscaling: more pixels, no more
        // detail.
        //
        // Weight: the film grain is high-frequency noise, which is close to
        // the worst case for PNG. At 3x the landscape export was 15 MB and
        // the story export 22 MB — over what Discord accepts from a free
        // account. 2x brings both back under control while still being far
        // larger than anything a feed displays.
        //
        // (The note that used to sit here said the icons were capped at
        // 128x128. That has been wrong since the 256px re-scrape.)
        scale: 2,
        useCORS: true,
      });
      const suffix = layout === "story" ? "-story" : "";
      const filename = `dbd-${role}-build-${sharePieces.map((p) => p.slug).join("-")}${suffix}.png`;
      // See lib/save-image.ts: this used to be an <a download> pointed at a
      // data: URL, which does nothing whatsoever on iOS and reported success
      // anyway.
      const outcome = await saveImage(await canvasToPngBlob(canvas), filename);
      if (outcome === "shared") {
        showToast(t({ ru: "Картинка билда готова!", en: "Build image ready!" }));
      } else if (outcome === "downloaded") {
        showToast(
          t({ ru: "Картинка билда скачана!", en: "Build image downloaded!" }),
        );
      }
      // "cancelled" means the share sheet was dismissed on purpose. Nothing
      // went wrong and nothing was saved, so say neither.
    } catch {
      showToast(
        t({
          ru: "Не удалось создать картинку",
          en: "Couldn't generate the image",
        }),
      );
    } finally {
      setGeneratingImage(null);
    }
  }

  function toggleBattleRoyale() {
    // Strict Mode (dev, React 19) invokes a setState updater function twice
    // to catch impurity — the side effects (localStorage write, other
    // setters) used to live inside setBattleRoyale's updater and so fired
    // twice per toggle. Computing `next` from the already-in-scope
    // `battleRoyale` and calling the other setters as plain top-level
    // statements keeps setBattleRoyale itself a pure value-set.
    const next = !battleRoyale;
    const used = next ? new Set<string>() : battleRoyaleUsed;
    setBattleRoyale(next);
    setBattleRoyaleUsed(used);
    persistBattleRoyale({ active: next, used: [...used] });
    setSharedBuild(null);
    setSharedLoadoutPieces(null);
    setNonce((n) => n + 1);
  }

  function restartBattleRoyale() {
    setBattleRoyaleUsed(new Set());
    persistBattleRoyale({ active: true, used: [] });
    setSharedBuild(null);
    setSharedLoadoutPieces(null);
    setNonce((n) => n + 1);
  }

  function toggleDailyChallenge() {
    if (seedMode === "daily") {
      clearSeed();
      return;
    }
    // Counted here rather than on page load: this is the moment someone
    // actually takes the challenge, which is what the number claims to
    // report. Deduplicated per browser per day inside the helper.
    recordDailyParticipation();
    setSeedMode("daily");
    setCustomSeedInput("");
    setSharedBuild(null);
    setSharedLoadoutPieces(null);
  }

  function applyCustomSeed() {
    const value = customSeedInput.trim();
    if (!value) return;
    setSeedMode("custom");
    setActiveCustomSeed(value);
    setSharedBuild(null);
    setSharedLoadoutPieces(null);
  }

  function clearSeed() {
    setSeedMode("none");
    setActiveCustomSeed(null);
    setCustomSeedInput("");
    setSharedBuild(null);
    setSharedLoadoutPieces(null);
    setNonce((n) => n + 1);
  }

  const roleColor = ROLE_COLOR[role];
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

  return (
    <div className="flex flex-col items-center gap-3">
      <title>{pageTitle}</title>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <div className="flex flex-wrap items-center justify-center gap-2">
          {(Object.keys(ROLE_LABEL) as PerkRole[]).map((r) => {
            const c = ROLE_COLOR[r];
            return (
              <button
                key={r}
                type="button"
                onClick={() => selectRole(r)}
                className={cn(
                  "tap rounded-full border px-5 py-1.5 text-sm font-medium capitalize transition-colors",
                  role === r
                    ? cn(c.border, c.bg, c.text)
                    : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {t(ROLE_NAME[r])}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 rounded-full border border-border bg-surface/60 p-1 text-sm">
          {(["perks", "loadout", "all"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => selectMode(m)}
              className={cn(
                "tap rounded-full px-3 py-1 text-xs font-medium transition-colors",
                mode === m
                  ? cn(roleColor.border, roleColor.bg, roleColor.text, "border")
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {m === "perks"
                ? t({ ru: "Перки", en: "Perks" })
                : m === "loadout"
                  ? t({ ru: "Экипировка", en: "Full Loadout" })
                  : t({ ru: "Всё", en: "Both" })}
            </button>
          ))}
        </div>
      </div>

      {/* Contextual filters — kept in a bordered, divided panel (rather than
          loose in the row above) so they read as one "roll settings" group
          distinct from the role/mode identity controls.

          Deliberately NOT `flex-wrap` + `divide-x` together: a divider is
          just a border on one side of each non-first child, so it has no
          idea which *visual line* that child landed on once the browser
          starts wrapping — at whatever width leaves an odd 2-then-1 (or
          1-then-2) split, the wrapped-away child's divider renders as an
          orphan line with nothing beside it on that row. This is a known
          divide-x/flex-wrap incompatibility, not something fixable by
          tweaking spacing.

          Fixed by making the layout binary instead of letting the browser
          decide a wrap point: `flex-col` (one child per row, `divide-y` for
          horizontal rules between them — always exactly as many dividers as
          row boundaries, no ambiguity) below `sm`, `flex-row` with NO wrap
          at all (`divide-x` for vertical rules — likewise unambiguous,
          every divider sits between two real same-row neighbors) from `sm`
          up. `overflow-x-auto` is the safety net for the rare width where
          all 3 groups' combined content doesn't quite fit unwrapped — the
          *panel* scrolls internally rather than either wrapping (bringing
          the bug back) or blowing out the page's own width. */}
      <div className="flex w-full max-w-full flex-col items-start divide-y divide-border overflow-x-auto rounded-2xl border border-border bg-surface/40 sm:w-auto sm:flex-row sm:items-center sm:divide-x sm:divide-y-0">
        {mode !== "loadout" && (
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1.5 px-4 py-2 text-sm">
            <span className="text-muted">
              {t({ ru: "Перков:", en: "Perks:" })}
            </span>
            {Array.from({ length: MAX_PERK_COUNT + 1 }, (_, n) => n).map(
              (n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => selectPerkCount(n)}
                  className={cn(
                    "tap-square flex size-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                    perkCount === n
                      ? cn(roleColor.border, roleColor.bg, roleColor.text)
                      : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  {n}
                </button>
              ),
            )}
          </div>
        )}

        {mode !== "loadout" && mounted && getTagsForRole(role).length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1.5 px-4 py-2 text-sm">
            <span className="text-muted">
              {t({ ru: "Тема:", en: "Theme:" })}
            </span>
            <select
              value={themeTag ?? ""}
              onChange={(e) => selectTheme(e.target.value || null)}
              aria-label={t({ ru: "Тема билда", en: "Build theme" })}
              className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground focus:ring-2 focus:ring-accent/40 focus:outline-none"
            >
              <option value="">{t({ ru: "Любая", en: "Any" })}</option>
              {getTagsForRole(role).map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {t({ ru: tag.ru, en: tag.en })}
                </option>
              ))}
            </select>
          </div>
        )}

        {mode !== "perks" && (
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1.5 px-4 py-2 text-sm">
            <span className="text-muted">
              {t({ ru: "Слоты:", en: "Slots:" })}
            </span>
            {(
              [
                ["item", { ru: "Предмет", en: "Item" }],
                ["addons", { ru: "Аддоны", en: "Add-ons" }],
                ["offering", { ru: "Подношение", en: "Offering" }],
              ] as const
            )
              .filter(([slot]) => role === "survivor" || slot !== "item")
              .map(([slot, label]) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => toggleLoadoutSlot(slot)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    loadoutSlots[slot]
                      ? cn(roleColor.border, roleColor.bg, roleColor.text)
                      : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  {t(label)}
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Character picker (Feature #2) — picks a specific character for the
          portrait chip below and, in Perks mode with the toggle on,
          guarantees their own teachable perks in the roll; in Loadout mode
          for killer, it's what actually decides whose Power/add-ons get
          rolled (see getRandomLoadout's forcedCharacter). A modal with a
          search + portrait grid, not a single "reroll" button — Space/
          Generate already rerolls the build at random, so this is
          specifically for choosing *which* character, with random still
          available as one option inside rather than the only one. */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {selectedCharacter ? (
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface/60 py-1 pr-1 pl-1.5">
            <button
              type="button"
              onClick={() => setCharacterPickerOpen(true)}
              className="flex items-center gap-2 rounded-full"
            >
              <span
                className={cn(
                  "relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-offset-1 ring-offset-surface",
                  roleColor.ring,
                )}
              >
                {getCharacterPortrait(selectedCharacter) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- next/image ignores basePath for unoptimized runtime src, see lib/asset-path.ts
                  <img
                    src={withBasePath(
                      getCharacterPortrait(selectedCharacter) as string,
                    )}
                    alt={getCharacterName(selectedCharacter, language)}
                    className="size-7 object-cover"
                  />
                ) : (
                  <span className="text-[0.625rem] text-muted">?</span>
                )}
              </span>
              <span className="text-xs font-medium text-foreground">
                {getCharacterName(selectedCharacter, language)}
              </span>
            </button>
            <button
              type="button"
              onClick={() => selectCharacter(null)}
              aria-label={t({ ru: "Убрать персонажа", en: "Clear character" })}
              className="flex size-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCharacterPickerOpen(true)}
            className="tap flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <Users className="size-3.5" />
            {t({ ru: "Выбрать персонажа", en: "Choose Character" })}
          </button>
        )}

        {mode !== "loadout" && selectedCharacter && (
          <ToggleSwitch
            checked={guaranteeTeachables}
            onChange={toggleGuaranteeTeachables}
            // "Тичеблы" was the English term in Cyrillic letters and read as
            // nonsense to anyone who had not seen "teachables" written down.
            // The tooltip right beside it already said "собственные перки
            // этого персонажа"; the label now uses the same words.
            label={t({
              ru: "Гарантировать личные перки",
              en: "Guarantee teachables",
            })}
            tooltip={t({
              ru: "В билд гарантированно попадут собственные перки этого персонажа (если они не исключены из пула).",
              en: "The build is guaranteed to include this character's own perks (unless they're excluded from the pool).",
            })}
          />
        )}
      </div>

      {/* Utility bar — only the controls used on nearly every roll (pool,
          OBS) stay always-visible; Daily Challenge, custom seed, Stats, and
          History move into the "More" popover below since they're reached
          far less often and were crowding this row (user feedback: "too
          much buttons"). */}
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-full border border-border bg-surface/60 px-2 py-1.5">
          {mode === "all" ? (
            <>
              <button
                type="button"
                onClick={() => openExcludePanel("perks")}
                className="tap flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <ListFilter className="size-3.5" />
                {t({ ru: "Пул перков", en: "Perk pool" })}
                {excludedSlugs.size > 0 && (
                  <span className="rounded-full bg-accent/15 px-1.5 text-accent">
                    {excludedSlugs.size}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => openExcludePanel("loadout")}
                className="tap flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <ListFilter className="size-3.5" />
                {t({ ru: "Пул экип.", en: "Loadout pool" })}
                {excludedLoadoutSlugs.size > 0 && (
                  <span className="rounded-full bg-accent/15 px-1.5 text-accent">
                    {excludedLoadoutSlugs.size}
                  </span>
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() =>
                openExcludePanel(mode === "perks" ? "perks" : "loadout")
              }
              className="tap flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <ListFilter className="size-3.5" />
              {t({ ru: "Пул", en: "Pool" })}
              {(mode === "perks"
                ? excludedSlugs.size
                : excludedLoadoutSlugs.size) > 0 && (
                <span className="rounded-full bg-accent/15 px-1.5 text-accent">
                  {mode === "perks"
                    ? excludedSlugs.size
                    : excludedLoadoutSlugs.size}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setObsModalOpen(true)}
            title={t({
              ru: "Отдельная ссылка специально для источника «Браузер» в OBS — не та же ссылка, что у кнопки «Поделиться».",
              en: "A separate link made specifically for an OBS Browser source — not the same link as the “Share” button.",
            })}
            className="tap flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <MonitorPlay className="size-3.5" />
            {t({ ru: "Оверлей OBS", en: "OBS Overlay" })}
          </button>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <MoreMenu>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={toggleDailyChallenge}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium transition-colors",
                  seedMode === "daily"
                    ? "bg-accent/15 text-accent"
                    : "text-foreground hover:bg-surface-hover",
                )}
              >
                <CalendarClock className="size-4 shrink-0" />
                {t({ ru: "Задание дня", en: "Daily Challenge" })}
              </button>

              <div className="flex items-center gap-1.5 px-2 py-1">
                <input
                  type="text"
                  value={customSeedInput}
                  onChange={(e) => setCustomSeedInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyCustomSeed()}
                  aria-label={t({ ru: "Свой сид", en: "Custom seed" })}
                  placeholder={t({ ru: "Свой сид…", en: "Custom seed…" })}
                  className="min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={applyCustomSeed}
                  disabled={!customSeedInput.trim()}
                  className="rounded-full px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  {t({ ru: "Задать", en: "Set" })}
                </button>
                {seedMode !== "none" && (
                  <button
                    type="button"
                    onClick={clearSeed}
                    aria-label={t({ ru: "Сбросить сид", en: "Clear seed" })}
                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              <div className="my-1 h-px bg-border" aria-hidden />

              <button
                type="button"
                onClick={() => setStatsModalOpen(true)}
                className="tap flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-surface-hover"
              >
                <BarChart3 className="size-4 shrink-0" />
                {t({ ru: "Статистика", en: "Stats" })}
              </button>
              <button
                type="button"
                onClick={() => setHistoryModalOpen(true)}
                className="tap flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-surface-hover"
              >
                <History className="size-4 shrink-0" />
                {t({ ru: "История", en: "History" })}
              </button>
              {/* Hidden in loadout-only mode: presets are perk builds, and
                  an entry that opens a picker with nothing to apply is
                  worse than no entry. */}
              {mode !== "loadout" && (
                <button
                  type="button"
                  onClick={() => setPresetsModalOpen(true)}
                  className="tap flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-surface-hover"
                >
                  <BookOpen className="size-4 shrink-0" />
                  {t({ ru: "Готовые билды", en: "Preset Builds" })}
                </button>
              )}
            </div>
          </MoreMenu>
        </div>
        {activeSeed && (
          <p className="text-xs text-muted">
            {t({ ru: "Активный сид:", en: "Active seed:" })}{" "}
            <code className="rounded bg-surface px-1.5 py-0.5 text-accent">
              {activeSeed}
            </code>
            {/* Daily Challenge only: a custom seed is yours alone, so a
                shared count would mean nothing there. Mounting this is
                also what opens the listener — see the component. */}
            {seedMode === "daily" && <DailyCount />}
          </p>
        )}
      </div>

      {mode === "loadout" ? (
        <p className="text-sm text-muted">
          {t({
            ru: `${battleRoyale ? "Battle Royale" : "Случайная экипировка"} для ${ROLE_LABEL[role].ru} — нажмите на карточку, чтобы скопировать название`,
            en: `${battleRoyale ? "Battle Royale" : "Random loadout"} for ${ROLE_LABEL[role].en} — click a card to copy its name`,
          })}
        </p>
      ) : mode === "all" ? (
        <p className="text-sm text-muted">
          {t({
            ru: `${battleRoyale ? "Battle Royale" : "Случайный билд и экипировка"} для ${ROLE_LABEL[role].ru} — нажмите на карточку, чтобы скопировать название`,
            en: `${battleRoyale ? "Battle Royale" : "Random build and loadout"} for ${ROLE_LABEL[role].en} — click a card to copy its name`,
          })}
        </p>
      ) : perkCount === 0 ? (
        <p className="text-sm text-muted">
          {t({
            ru: `Испытание без перков для ${ROLE_LABEL[role].ru} — удачи!`,
            en: `A no-perk challenge for ${ROLE_LABEL[role].en} — good luck!`,
          })}
        </p>
      ) : (
        <p className="text-sm text-muted">
          {t({
            ru: `${battleRoyale ? "Battle Royale" : "Случайный билд"} для ${ROLE_LABEL[role].ru} — нажмите на перк, чтобы скопировать название`,
            en: `${battleRoyale ? "Battle Royale" : "Random build"} for ${ROLE_LABEL[role].en} — click a perk to copy its name`,
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
      {mode !== "loadout" &&
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
            <p className="text-sm text-muted">
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
              className="mt-1 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground transition-transform hover:scale-105 active:scale-95"
            >
              {battleRoyale
                ? t({ ru: "Начать заново", en: "Start over" })
                : t({ ru: "Открыть пул перков", en: "Open perk pool" })}
            </button>
          </div>
        ) : effectivePresentation !== "classic" && perks.length > 0 ? (
          /* Same build, shown differently. The stages are fed `perks` and
             never roll anything themselves — see lib/use-presentation.ts.
             Pinning and per-slot reroll are grid affordances, so they stay
             with the grid rather than being reinvented on a canvas. */
          effectivePresentation === "ritual" ? (
            <RitualStage
              pool={availablePool}
              perks={perks}
              role={role}
              language={language}
            />
          ) : (
            <SlotsStage
              pool={availablePool}
              perks={perks}
              role={role}
              language={language}
            />
          )
        ) : (
          <PerkGrid
            perks={perks}
            language={language}
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
        ))}

      {/* Secondary toolbar — sleek, compact, sits right under the cards it
          acts on rather than competing with Generate for weight. Stacked
          full-width below `sm` instead of a bare unwrapped row: three
          worded pill buttons never fit a 320-375px phone on one line, and
          naive flex-wrap here would've just produced the same lopsided
          2-then-1 wrap the loadout HUD had (see LoadoutGrid) — a
          deliberate vertical stack reads cleanly instead. */}
      <div className="flex w-full max-w-xs flex-col gap-2 sm:w-auto sm:max-w-none sm:flex-row sm:items-center sm:justify-center">
        <button
          type="button"
          onClick={
            mode === "loadout"
              ? handleCopyAllLoadout
              : mode === "all"
                ? handleCopyAllCombined
                : handleCopyAll
          }
          disabled={
            mode === "loadout"
              ? loadoutPieces.length === 0
              : mode === "all"
                ? perks.length === 0 && loadoutPieces.length === 0
                : perks.length === 0
          }
          className="tap flex w-full items-center justify-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40 sm:w-auto"
        >
          <Copy className="size-3.5" />
          {mode === "loadout"
            ? t({ ru: "Скопировать всё", en: "Copy full loadout" })
            : t({ ru: "Скопировать всё", en: "Copy full build" })}
        </button>
        <button
          type="button"
          onClick={handleShare}
          title={t({
            ru: "Ссылка на этот билд для обычного просмотра — не для OBS, для этого есть отдельная кнопка «Оверлей OBS».",
            en: "A link to view this exact build — not for OBS, use the separate “OBS Overlay” button for that.",
          })}
          className="tap flex w-full items-center justify-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground sm:w-auto"
        >
          <Link2 className="size-3.5" />
          {t({ ru: "Поделиться", en: "Share" })}
        </button>
        <DownloadImageButton
          onSelect={handleDownloadImage}
          generating={generatingImage}
          disabled={sharePieces.length === 0}
        />
        <PresentationPicker
          value={presentation}
          onChange={setPresentation}
          isDesktop={isDesktop}
        />
      </div>

      {/* Off-screen — exists only so html2canvas has real, laid-out DOM to
          rasterize when a download button is clicked; never visible itself. */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: -9999,
          pointerEvents: "none",
        }}
      >
        <ShareCard
          ref={shareCardRef}
          pieces={sharePieces}
          mode={mode}
          role={role}
          language={language}
          character={shareCharacter}
        />
        <ShareCard
          ref={storyShareCardRef}
          pieces={sharePieces}
          mode={mode}
          role={role}
          language={language}
          character={shareCharacter}
          layout="story"
        />
      </div>

      {/* Primary CTA — the one action on this page that should visually
          win: standalone, largest, most saturated element on the board. */}
      <button
        type="button"
        onClick={regenerate}
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
        className="flex items-center gap-2.5 rounded-full bg-accent px-8 py-3.5 text-base font-bold text-accent-foreground shadow-lg shadow-accent/30 transition-transform hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
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
      <p className="-mt-1 flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-[0.6875rem] text-muted pointer-coarse:hidden">
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

      <ToggleSwitch
        checked={battleRoyale}
        onChange={toggleBattleRoyale}
        label={t({ ru: "Battle Royale", en: "Battle Royale" })}
        activeClassName="bg-accent"
        tooltip={t({
          ru: "Копирование билда навсегда убирает эти перки из пула — играйте, пока не закончатся все перки роли.",
          en: "Copying a build permanently removes those perks from the pool — play until every perk for this role is gone.",
        })}
      />

      <button
        type="button"
        onClick={() => setShowStats((v) => !v)}
        className="tap flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-muted"
      >
        <BarChart3 className="size-3.5" />
        {t({ ru: "Статистика пула", en: "Pool stats" })}
      </button>
      {showStats && mounted && mode !== "loadout" && (
        <div className="rounded-xl border border-border bg-surface px-4 py-3 text-center text-xs text-muted">
          <p>
            {t({
              ru: `Всего перков ${ROLE_LABEL[role].ru}:`,
              en: `Total ${ROLE_LABEL[role].en} perks:`,
            })}{" "}
            <b className="text-foreground">{totalInRole}</b>
          </p>
          <p>
            {t({ ru: "Исключено вручную:", en: "Manually excluded:" })}{" "}
            <b className="text-foreground">{excludedSlugs.size}</b>
          </p>
          {battleRoyale && (
            <p>
              {t({
                ru: "Использовано в Battle Royale:",
                en: "Used in Battle Royale:",
              })}{" "}
              <b className="text-foreground">{battleRoyaleUsedInRole}</b> ·{" "}
              {t({ ru: "Осталось:", en: "Remaining:" })}{" "}
              <b className="text-foreground">{availableCount}</b>
            </p>
          )}
        </div>
      )}
      {showStats && mounted && mode !== "perks" && (
        <div className="rounded-xl border border-border bg-surface px-4 py-3 text-center text-xs text-muted">
          <p>
            {t({
              ru: `Всего предметов экипировки для ${ROLE_LABEL[role].ru}:`,
              en: `Total ${ROLE_LABEL[role].en} loadout pieces:`,
            })}{" "}
            <b className="text-foreground">{totalLoadoutInRole}</b>
          </p>
          <p>
            {t({ ru: "Исключено вручную:", en: "Manually excluded:" })}{" "}
            <b className="text-foreground">{excludedLoadoutSlugs.size}</b>
          </p>
          {battleRoyale && (
            <p>
              {t({
                ru: "Использовано в Battle Royale:",
                en: "Used in Battle Royale:",
              })}{" "}
              <b className="text-foreground">{battleRoyaleUsedLoadoutInRole}</b>{" "}
              · {t({ ru: "Осталось:", en: "Remaining:" })}{" "}
              <b className="text-foreground">{availableLoadoutCount}</b>
            </p>
          )}
        </div>
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
          onClose={() => setExcludePanelOpen(false)}
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
          onClose={() => setExcludePanelOpen(false)}
        />
      )}

      <StatsModal
        open={statsModalOpen}
        language={language}
        onClose={() => setStatsModalOpen(false)}
        version={statsVersion}
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
        onPieceVisibilityChange={updatePieceVisibility}
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
