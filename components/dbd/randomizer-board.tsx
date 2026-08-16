"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link2,
  ListFilter,
  Dices,
  Skull,
  BarChart3,
  CalendarClock,
  Copy,
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
import { getTagsForPerk, getTagsForRole } from "@/lib/perk-tags";
import type { Loadout, LoadoutPiece, LoadoutSlots, Perk, PerkRole } from "@/lib/types";
import { cn } from "@/lib/cn";
import { useMounted } from "@/lib/use-mounted";
import { ROLE_COLOR } from "@/lib/role-color";
import { useLanguage, useT } from "@/lib/i18n";
import { dailyChallengeSeed } from "@/lib/seeded-random";
import { recordRoll } from "@/lib/stats";
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
import { getIdForLoadoutPiece, getLoadoutPieceKeyForId } from "@/lib/loadout-ids";
import { safeGet, safeGetJSON, safeSet, safeSetJSON } from "@/lib/safe-storage";
import { publishObsState } from "@/lib/obs-sync";
import {
  connectTwitchChat,
  type TwitchCommand,
  type TwitchConnectionState,
  type TwitchPermission,
} from "@/lib/twitch-chat";
import { PerkGrid } from "./perk-grid";
import { LoadoutGrid } from "./loadout-grid";
import { CopyToast } from "./copy-toast";
import { ExcludePanel } from "./exclude-panel";
import { LoadoutExcludePanel } from "./loadout-exclude-panel";
import { StatsModal } from "./stats-modal";
import { ToggleSwitch } from "./toggle-switch";
import { ShareCard, type ShareCardLayout } from "./share-card";
import { DownloadImageButton } from "./download-image-button";
import { ObsOverlayModal } from "./obs-overlay-modal";
import { CharacterPickerModal } from "./character-picker-modal";

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
const LOADOUT_SLOT_OFFERING_STORAGE_KEY = "dbd-randomizer:loadout-slot-offering";
const DEFAULT_LOADOUT_SLOTS: LoadoutSlots = { item: true, addons: true, offering: true };
type BuildMode = "perks" | "loadout";
const GUARANTEE_TEACHABLES_STORAGE_KEY = "dbd-randomizer:guarantee-teachables";
const TWITCH_CHANNEL_STORAGE_KEY = "dbd-randomizer:twitch-channel";
const TWITCH_ENABLED_STORAGE_KEY = "dbd-randomizer:twitch-enabled";
const TWITCH_REROLL_COMMAND_STORAGE_KEY = "dbd-randomizer:twitch-reroll-command";
const TWITCH_REROLL_PERMISSION_STORAGE_KEY = "dbd-randomizer:twitch-reroll-permission";
const TWITCH_COOLDOWN_STORAGE_KEY = "dbd-randomizer:twitch-cooldown-sec";
const TWITCH_PASTE_ENABLED_STORAGE_KEY = "dbd-randomizer:twitch-paste-enabled";
const TWITCH_PASTE_COMMAND_STORAGE_KEY = "dbd-randomizer:twitch-paste-command";
const TWITCH_PASTE_PERMISSION_STORAGE_KEY = "dbd-randomizer:twitch-paste-permission";
const DEFAULT_TWITCH_REROLL_COMMAND = "!reroll";
const DEFAULT_TWITCH_PASTE_COMMAND = "!paste";
const DEFAULT_TWITCH_COOLDOWN_SEC = 4;
const MIN_TWITCH_COOLDOWN_SEC = 1;
const MAX_TWITCH_COOLDOWN_SEC = 300;
const ROLE_LABEL: Record<PerkRole, { ru: string; en: string }> = {
  survivor: { ru: "выжившего", en: "survivor" },
  killer: { ru: "убийцы", en: "killer" },
};
const ROLE_NAME: Record<PerkRole, { ru: string; en: string }> = {
  survivor: { ru: "Выживший", en: "Survivor" },
  killer: { ru: "Убийца", en: "Killer" },
};
const ROLE_SHORT: Record<PerkRole, string> = { survivor: "s", killer: "k" };
const ROLE_FROM_SHORT: Record<string, PerkRole> = { s: "survivor", k: "killer" };

type SeedMode = "none" | "daily" | "custom";

function loadSlugSet(key: string): Set<string> {
  // Validate the parsed shape, not just that it parsed — a value written by
  // some future/incompatible version of the app could be valid JSON that's
  // still the wrong shape (e.g. an object instead of an array), and
  // `new Set()` on a non-iterable throws rather than returning [].
  const stored = safeGetJSON<unknown>("local", key, []);
  const slugs = Array.isArray(stored) ? stored.filter((s) => typeof s === "string") : [];
  return new Set(slugs);
}

function loadPerkCount(): number {
  const n = parseInt(safeGet("local", PERK_COUNT_STORAGE_KEY) ?? "", 10);
  return Number.isInteger(n) && n >= 0 && n <= MAX_PERK_COUNT ? n : DEFAULT_PERK_COUNT;
}

const VALID_MODES: readonly BuildMode[] = ["perks", "loadout"];

function loadMode(): BuildMode {
  const stored = safeGet("local", MODE_STORAGE_KEY);
  return VALID_MODES.includes(stored as BuildMode) ? (stored as BuildMode) : "perks";
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

const VALID_TWITCH_PERMISSIONS: readonly TwitchPermission[] = ["everyone", "subs_vips", "mods"];

function loadTwitchPermission(key: string, fallback: TwitchPermission): TwitchPermission {
  const stored = safeGet("local", key);
  return VALID_TWITCH_PERMISSIONS.includes(stored as TwitchPermission)
    ? (stored as TwitchPermission)
    : fallback;
}

function loadTwitchCooldownSec(): number {
  const n = parseInt(safeGet("local", TWITCH_COOLDOWN_STORAGE_KEY) ?? "", 10);
  return Number.isInteger(n) && n >= MIN_TWITCH_COOLDOWN_SEC && n <= MAX_TWITCH_COOLDOWN_SEC
    ? n
    : DEFAULT_TWITCH_COOLDOWN_SEC;
}

interface BattleRoyaleState {
  active: boolean;
  used: string[];
}

function loadBattleRoyale(): BattleRoyaleState {
  const stored = safeGetJSON<Partial<BattleRoyaleState>>("session", BR_STORAGE_KEY, {});
  return {
    active: stored.active === true,
    used: Array.isArray(stored.used) ? stored.used.filter((s) => typeof s === "string") : [],
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
 *  `?lp=id1,id2,...` mirrors `?p=` for sharing a specific Full Loadout roll.
 *  Mirrors the existing rule that a bare role with no seed/build attached
 *  isn't treated as "shared state" at all — mode only takes effect when it
 *  comes with content, same as role always has. */
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

  const mode: BuildMode = params.get("mode") === "loadout" ? "loadout" : "perks";

  const seed = params.get("seed");
  if (seed) return { role, mode, seed };

  if (mode === "loadout") {
    const lpParam = params.get("lp");
    if (lpParam) {
      const matched = lpParam
        .split(",")
        .map((idStr) => {
          const id = Number(idStr);
          const key = Number.isFinite(id) ? getLoadoutPieceKeyForId(id) : undefined;
          return key ? getLoadoutPiece(key.kind, key.slug) : undefined;
        })
        .filter((piece): piece is LoadoutPiece => !!piece);
      if (matched.length > 0) return { role, mode, loadoutPieces: matched };
    }
    // Explicit `?mode=loadout` is itself meaningful intent — unlike a bare
    // `?r=...` alone (which existing perk links deliberately don't treat as
    // "shared state," see the perks branch below), a link that spells out
    // the mode should open in that mode even without a specific build to
    // restore.
    return { role, mode };
  }

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
    if (matched.length > 0) return { role, mode, perks: matched };
  }

  const slugsParam = params.get("perks");
  if (slugsParam) {
    const matched = slugsParam
      .split(",")
      .map((slug) => getPerkBySlug(slug))
      .filter((perk): perk is Perk => !!perk && perk.role === role);
    if (matched.length > 0) return { role, mode, perks: matched };
  }

  return null;
}

export function RandomizerBoard() {
  const t = useT();
  const { lang: language } = useLanguage();
  const [role, setRole] = useState<PerkRole>("survivor");
  const [toast, setToast] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState<ShareCardLayout | null>(null);
  const shareCardRef = useRef<HTMLDivElement>(null);
  const storyShareCardRef = useRef<HTMLDivElement>(null);
  const [excludePanelOpen, setExcludePanelOpen] = useState(false);
  // Both start at SSR-safe defaults and are corrected from localStorage in
  // the mount effect below — a lazy useState(loadX) initializer would read
  // localStorage during the client's first render, which happens *before*
  // hydration reconciles against the server's (window-less) HTML and would
  // throw a hydration mismatch for any returning visitor with saved state.
  const [excludedSlugs, setExcludedSlugs] = useState<Set<string>>(new Set());
  const [favoriteSlugs, setFavoriteSlugs] = useState<Set<string>>(new Set());
  const [perkCount, setPerkCount] = useState<number>(DEFAULT_PERK_COUNT);
  // Full Loadout mode — same hydration-safety rule as everything else here:
  // SSR-safe defaults, corrected from localStorage/URL in the mount effect.
  const [mode, setMode] = useState<BuildMode>("perks");
  const [loadoutSlots, setLoadoutSlots] = useState<LoadoutSlots>(DEFAULT_LOADOUT_SLOTS);
  const [excludedLoadoutSlugs, setExcludedLoadoutSlugs] = useState<Set<string>>(new Set());
  const [sharedLoadoutPieces, setSharedLoadoutPieces] = useState<LoadoutPiece[] | null>(null);
  // Random Character (Feature #2) — deliberately session-only, not synced
  // to the URL or localStorage: it's a flourish on top of a build, not
  // part of what a share link or a returning visit needs to restore.
  // guaranteeTeachables (the perks-mode "always include this character's
  // own perks" toggle) IS persisted, same as the other pool/settings
  // toggles — it only has an effect once a character is actually selected.
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  const [guaranteeTeachables, setGuaranteeTeachables] = useState(false);
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [obsModalOpen, setObsModalOpen] = useState(false);
  const [statsVersion, setStatsVersion] = useState(0);
  const [battleRoyale, setBattleRoyale] = useState(false);
  const [battleRoyaleUsed, setBattleRoyaleUsed] = useState<Set<string>>(new Set());
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
  const [nonce, setNonce] = useState(0);
  const [sharedBuild, setSharedBuild] = useState<Perk[] | null>(null);
  // A quick, session-only filter (not persisted, resets on role change) —
  // distinct from the pool manager's exclusions, which are a deliberate,
  // saved choice. "themeTag: null" means no filter, i.e. the full role pool.
  const [themeTag, setThemeTag] = useState<string | null>(null);
  const [twitchChannel, setTwitchChannel] = useState("");
  const [twitchEnabled, setTwitchEnabled] = useState(false);
  const [twitchState, setTwitchState] = useState<TwitchConnectionState>("disconnected");
  const [twitchRerollCommand, setTwitchRerollCommand] = useState(DEFAULT_TWITCH_REROLL_COMMAND);
  const [twitchRerollPermission, setTwitchRerollPermission] = useState<TwitchPermission>("everyone");
  const [twitchCooldownSec, setTwitchCooldownSec] = useState(DEFAULT_TWITCH_COOLDOWN_SEC);
  const [twitchPasteEnabled, setTwitchPasteEnabled] = useState(false);
  const [twitchPasteCommand, setTwitchPasteCommand] = useState(DEFAULT_TWITCH_PASTE_COMMAND);
  const [twitchPastePermission, setTwitchPastePermission] = useState<TwitchPermission>("subs_vips");

  const activeSeed =
    seedMode === "daily" ? dailyChallengeSeed(role) : seedMode === "custom" ? activeCustomSeed : null;

  useEffect(() => {
    function applyInitialClientState() {
      setExcludedSlugs(loadSlugSet(EXCLUDED_STORAGE_KEY));
      setFavoriteSlugs(loadSlugSet(FAVORITE_STORAGE_KEY));
      setPerkCount(loadPerkCount());
      setMode(loadMode());
      setLoadoutSlots(loadLoadoutSlots());
      setExcludedLoadoutSlugs(loadSlugSet(EXCLUDED_LOADOUT_STORAGE_KEY));
      setGuaranteeTeachables(safeGet("local", GUARANTEE_TEACHABLES_STORAGE_KEY) === "1");

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
        } else if (urlState.perks) {
          setSharedBuild(urlState.perks);
          setPerkCount(urlState.perks.length);
        } else if (urlState.loadoutPieces) {
          setSharedLoadoutPieces(urlState.loadoutPieces);
        }
      }
      const br = loadBattleRoyale();
      if (br.active) {
        setBattleRoyale(true);
        setBattleRoyaleUsed(new Set(br.used));
      }

      const savedChannel = safeGet("local", TWITCH_CHANNEL_STORAGE_KEY) ?? "";
      setTwitchChannel(savedChannel);
      if (safeGet("local", TWITCH_ENABLED_STORAGE_KEY) === "1" && savedChannel) {
        setTwitchEnabled(true);
      }
      setTwitchRerollCommand(
        safeGet("local", TWITCH_REROLL_COMMAND_STORAGE_KEY) || DEFAULT_TWITCH_REROLL_COMMAND,
      );
      setTwitchRerollPermission(
        loadTwitchPermission(TWITCH_REROLL_PERMISSION_STORAGE_KEY, "everyone"),
      );
      setTwitchCooldownSec(loadTwitchCooldownSec());
      setTwitchPasteEnabled(safeGet("local", TWITCH_PASTE_ENABLED_STORAGE_KEY) === "1");
      setTwitchPasteCommand(
        safeGet("local", TWITCH_PASTE_COMMAND_STORAGE_KEY) || DEFAULT_TWITCH_PASTE_COMMAND,
      );
      setTwitchPastePermission(
        loadTwitchPermission(TWITCH_PASTE_PERMISSION_STORAGE_KEY, "subs_vips"),
      );
    }
    applyInitialClientState();
  }, []);

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

  const availableCount = mounted ? getAvailablePool(role, combinedExcluded).length : 0;
  // Applies to both causes of a too-small pool: Battle Royale attrition and
  // the player just manually excluding too many perks in Manage Pool. Either
  // way, getRandomPerks() refuses to top up from excluded perks (see
  // lib/perks.ts), so this must be checked up front rather than discovered
  // after the fact from a short/empty result.
  const poolExhausted =
    !activeSeed && mounted && perkCount > 0 && availableCount < perkCount;

  const perks = useMemo(() => {
    void nonce; // intentional cache-buster: forces a reshuffle on "regenerate"
    // Gated on mode so every effect keyed off `perks` (stats, URL sync, the
    // "perks" half of the OBS payload) naturally goes idle in loadout mode
    // instead of needing its own mode check duplicated everywhere.
    if (!mounted || mode !== "perks") return [];
    if (sharedBuild) return sharedBuild;
    if (perkCount === 0) return [];
    if (activeSeed) return getSeededPerks(role, perkCount, activeSeed);
    if (poolExhausted) return [];
    const character = guaranteeTeachables ? selectedCharacter : null;
    return getRandomPerksWithTeachables(role, perkCount, character, combinedExcluded, Math.random, favoriteSlugs);
  }, [
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

  // Loadout counterpart of combinedExcluded above — same Battle Royale +
  // manual-exclusion merge, just namespaced "kind:slug" keys instead of
  // plain perk slugs (see lib/loadout.ts's excludeKey).
  const combinedExcludedLoadout = useMemo(() => {
    if (!battleRoyale || battleRoyaleUsed.size === 0) return excludedLoadoutSlugs;
    const merged = new Set(excludedLoadoutSlugs);
    for (const key of battleRoyaleUsed) merged.add(key);
    return merged;
  }, [excludedLoadoutSlugs, battleRoyale, battleRoyaleUsed]);

  const loadout = useMemo((): Loadout | null => {
    void nonce;
    if (!mounted || mode !== "loadout" || sharedLoadoutPieces) return null;
    if (activeSeed) return getSeededLoadout(role, loadoutSlots, activeSeed);
    return getRandomLoadout(role, loadoutSlots, combinedExcludedLoadout, Math.random, selectedCharacter);
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
    if (mode !== "loadout") return [];
    if (sharedLoadoutPieces) return sharedLoadoutPieces;
    if (!loadout) return [];
    return flattenLoadout(loadout);
  }, [mode, sharedLoadoutPieces, loadout]);

  useEffect(() => {
    function syncUrl() {
      const params = new URLSearchParams();
      params.set("r", ROLE_SHORT[role]);
      if (mode === "loadout") params.set("mode", "loadout");
      if (activeSeed) {
        params.set("seed", activeSeed);
      } else if (mode === "loadout") {
        if (loadoutPieces.length > 0) {
          const ids = loadoutPieces.map((p) => getIdForLoadoutPiece(p.kind, p.slug));
          if (ids.every((id): id is number => id !== undefined)) {
            params.set("lp", ids.join(","));
          }
          // No legacy fallback needed here (unlike perks below) — every
          // loadout piece gets a short ID at scrape time, same guarantee
          // data/perk-ids.json has always made for perks.
        }
      } else if (perks.length > 0) {
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
      window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
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
    setStatsVersion((v) => v + 1);
  }, [perks, role, nonce, mounted, activeSeed, sharedBuild]);

  // Mirrors whatever's currently on screen to the OBS overlay tab, if one's
  // open — see lib/obs-sync.ts. Fires on every display change (regenerate,
  // role switch, seed, shared-build view), same trigger set as stats above.
  // Also fires when obsModalOpen flips true: opening the modal is what
  // lazily creates this session's Firebase room code (see
  // getOrCreateRoomCode), so without this, a build generated *before* the
  // modal's first-ever open would never get published to that room at
  // all — the overlay would sit on "waiting for a build" until the next
  // regenerate, even though a build is already showing on the main page.
  useEffect(() => {
    if (!mounted) return;
    // The overlay only ever renders slug/icon/name (see obs-overlay.tsx) —
    // a loadout piece fits that same ObsPerk shape as-is, so no separate
    // payload field is needed. Piece slugs are prefixed "kind:" here purely
    // so a killer add-on and an offering that happen to share a slug can't
    // collide as the same React key on the overlay's own list.
    const displayPieces =
      mode === "loadout"
        ? loadoutPieces.map((p) => ({ slug: `${p.kind}:${p.slug}`, icon: p.icon, name: p.name }))
        : perks.map((p) => ({ slug: p.slug, icon: p.icon, name: p.name }));
    publishObsState({ role, language, perks: displayPieces });
  }, [mounted, mode, role, language, perks, loadoutPieces, obsModalOpen]);

  const eliminateCurrentBuild = useCallback(() => {
    if (mode === "loadout") {
      if (loadoutPieces.length === 0) return;
      setBattleRoyaleUsed((prev) => {
        const next = new Set(prev);
        loadoutPieces.forEach((p) => next.add(`${p.kind}:${p.slug}`));
        persistBattleRoyale({ active: true, used: [...next] });
        return next;
      });
      return;
    }
    if (perks.length === 0) return;
    setBattleRoyaleUsed((prev) => {
      const next = new Set(prev);
      perks.forEach((p) => next.add(p.slug));
      persistBattleRoyale({ active: true, used: [...next] });
      return next;
    });
  }, [mode, perks, loadoutPieces]);

  const regenerate = useCallback(() => {
    // Battle Royale's whole premise is elimination — the pool should shrink
    // every round regardless of *how* you moved on, not only when you
    // happened to copy a perk first. Without this, spamming Generate (or
    // its Space/Enter shortcut) never drains the pool, so "play until every
    // perk is gone" never actually triggers.
    if (battleRoyale) eliminateCurrentBuild();
    setSharedBuild(null);
    setSharedLoadoutPieces(null);
    setNonce((n) => n + 1);
  }, [battleRoyale, eliminateCurrentBuild]);

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

  useEffect(() => {
    function markDisconnected() {
      setTwitchState("disconnected");
    }
    if (!mounted || !twitchEnabled || !twitchChannel.trim()) {
      markDisconnected();
      return;
    }
    const commands: TwitchCommand[] = [
      {
        trigger: twitchRerollCommand.trim() || DEFAULT_TWITCH_REROLL_COMMAND,
        permission: twitchRerollPermission,
        cooldownMs: twitchCooldownSec * 1000,
        onTrigger: () => regenerateRef.current(),
      },
    ];
    if (twitchPasteEnabled) {
      commands.push({
        trigger: twitchPasteCommand.trim() || DEFAULT_TWITCH_PASTE_COMMAND,
        permission: twitchPastePermission,
        cooldownMs: twitchCooldownSec * 1000,
        onTrigger: (args) => handleTwitchPaste(args),
      });
    }
    const disconnect = connectTwitchChat({
      channel: twitchChannel,
      commands,
      onStateChange: setTwitchState,
    });
    return disconnect;
  }, [
    mounted,
    twitchEnabled,
    twitchChannel,
    twitchRerollCommand,
    twitchRerollPermission,
    twitchCooldownSec,
    twitchPasteEnabled,
    twitchPasteCommand,
    twitchPastePermission,
    handleTwitchPaste,
  ]);

  // Spacebar/Enter triggers Generate from anywhere on the page — except
  // while the user is typing (the seed input) or a modal is open, where
  // those keys already mean something else (confirm a dialog, type a
  // space, activate whatever's focused).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== " " && e.key !== "Enter") return;
      if (perkCount === 0 || !!activeSeed || poolExhausted) return;
      if (excludePanelOpen || statsModalOpen || obsModalOpen) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTypingTarget =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable;
      const isAlreadyInteractive = tag === "BUTTON" || tag === "A";
      if (isTypingTarget || isAlreadyInteractive) return;

      e.preventDefault();
      regenerate();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [perkCount, activeSeed, poolExhausted, excludePanelOpen, statsModalOpen, obsModalOpen, regenerate]);

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

  function toggleExcluded(slug: string) {
    setExcludedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      safeSetJSON("local", EXCLUDED_STORAGE_KEY, [...next]);
      return next;
    });
  }

  function bulkSetExcluded(slugs: string[], excluded: boolean) {
    setExcludedSlugs((prev) => {
      const next = new Set(prev);
      for (const slug of slugs) {
        if (excluded) next.add(slug);
        else next.delete(slug);
      }
      safeSetJSON("local", EXCLUDED_STORAGE_KEY, [...next]);
      return next;
    });
  }

  function resetExcludedForRole(targetRole: PerkRole) {
    const roleSlugs = new Set(getPerksByRole(targetRole).map((p) => p.slug));
    setExcludedSlugs((prev) => {
      const next = new Set([...prev].filter((slug) => !roleSlugs.has(slug)));
      safeSetJSON("local", EXCLUDED_STORAGE_KEY, [...next]);
      return next;
    });
  }

  function toggleExcludedLoadoutPiece(kind: LoadoutPiece["kind"], slug: string) {
    const key = `${kind}:${slug}`;
    setExcludedLoadoutSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      safeSetJSON("local", EXCLUDED_LOADOUT_STORAGE_KEY, [...next]);
      return next;
    });
  }

  function bulkSetExcludedLoadout(keys: string[], excluded: boolean) {
    setExcludedLoadoutSlugs((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (excluded) next.add(key);
        else next.delete(key);
      }
      safeSetJSON("local", EXCLUDED_LOADOUT_STORAGE_KEY, [...next]);
      return next;
    });
  }

  function resetExcludedLoadoutForRole(targetRole: PerkRole) {
    const roleKeys = new Set(getLoadoutPoolForRole(targetRole).map((p) => `${p.kind}:${p.slug}`));
    setExcludedLoadoutSlugs((prev) => {
      const next = new Set([...prev].filter((key) => !roleKeys.has(key)));
      safeSetJSON("local", EXCLUDED_LOADOUT_STORAGE_KEY, [...next]);
      return next;
    });
  }

  function toggleFavorite(slug: string) {
    setFavoriteSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      safeSetJSON("local", FAVORITE_STORAGE_KEY, [...next]);
      return next;
    });
  }

  function updateTwitchChannel(channel: string) {
    setTwitchChannel(channel);
    safeSet("local", TWITCH_CHANNEL_STORAGE_KEY, channel);
  }

  function toggleTwitch(enabled: boolean) {
    setTwitchEnabled(enabled);
    safeSet("local", TWITCH_ENABLED_STORAGE_KEY, enabled ? "1" : "0");
  }

  function updateTwitchRerollCommand(command: string) {
    setTwitchRerollCommand(command);
    safeSet("local", TWITCH_REROLL_COMMAND_STORAGE_KEY, command);
  }

  function updateTwitchRerollPermission(permission: TwitchPermission) {
    setTwitchRerollPermission(permission);
    safeSet("local", TWITCH_REROLL_PERMISSION_STORAGE_KEY, permission);
  }

  function updateTwitchCooldownSec(seconds: number) {
    const clamped = Math.min(MAX_TWITCH_COOLDOWN_SEC, Math.max(MIN_TWITCH_COOLDOWN_SEC, seconds));
    setTwitchCooldownSec(clamped);
    safeSet("local", TWITCH_COOLDOWN_STORAGE_KEY, String(clamped));
  }

  function toggleTwitchPaste(enabled: boolean) {
    setTwitchPasteEnabled(enabled);
    safeSet("local", TWITCH_PASTE_ENABLED_STORAGE_KEY, enabled ? "1" : "0");
  }

  function updateTwitchPasteCommand(command: string) {
    setTwitchPasteCommand(command);
    safeSet("local", TWITCH_PASTE_COMMAND_STORAGE_KEY, command);
  }

  function updateTwitchPastePermission(permission: TwitchPermission) {
    setTwitchPastePermission(permission);
    safeSet("local", TWITCH_PASTE_PERMISSION_STORAGE_KEY, permission);
  }

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  }

  function handleCopy(perk: Perk) {
    navigator.clipboard
      .writeText(perk.name[language])
      .then(() =>
        showToast(
          t({
            ru: `«${perk.name[language]}» скопировано в буфер обмена!`,
            en: `"${perk.name[language]}" copied to clipboard!`,
          }),
        ),
      )
      .catch(() => showToast(t({ ru: "Не удалось скопировать", en: "Couldn't copy" })));
    if (battleRoyale) eliminateCurrentBuild();
  }

  function handleCopyAll() {
    const text = perks.map((p) => p.name[language]).join(", ");
    navigator.clipboard
      .writeText(text)
      .then(() =>
        showToast(
          t({ ru: "Весь билд скопирован в буфер обмена!", en: "Full build copied to clipboard!" }),
        ),
      )
      .catch(() => showToast(t({ ru: "Не удалось скопировать", en: "Couldn't copy" })));
    if (battleRoyale) eliminateCurrentBuild();
  }

  function handleCopyLoadoutPiece(piece: LoadoutPiece) {
    navigator.clipboard
      .writeText(piece.name[language])
      .then(() =>
        showToast(
          t({
            ru: `«${piece.name[language]}» скопировано в буфер обмена!`,
            en: `"${piece.name[language]}" copied to clipboard!`,
          }),
        ),
      )
      .catch(() => showToast(t({ ru: "Не удалось скопировать", en: "Couldn't copy" })));
    if (battleRoyale) eliminateCurrentBuild();
  }

  function handleCopyAllLoadout() {
    const text = loadoutPieces.map((p) => p.name[language]).join(", ");
    navigator.clipboard
      .writeText(text)
      .then(() =>
        showToast(
          t({ ru: "Вся экипировка скопирована в буфер обмена!", en: "Full loadout copied to clipboard!" }),
        ),
      )
      .catch(() => showToast(t({ ru: "Не удалось скопировать", en: "Couldn't copy" })));
    if (battleRoyale) eliminateCurrentBuild();
  }

  function handleShare() {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => showToast(t({ ru: "Ссылка на билд скопирована!", en: "Build link copied!" })))
      .catch(() =>
        showToast(t({ ru: "Не удалось скопировать ссылку", en: "Couldn't copy the link" })),
      );
  }

  async function handleDownloadImage(layout: ShareCardLayout) {
    const target = layout === "story" ? storyShareCardRef.current : shareCardRef.current;
    if (!target || perks.length === 0 || generatingImage) return;
    setGeneratingImage(layout);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(target, {
        // Background is baked into ShareCard's own gradient now (see
        // share-card.tsx), not a flat fill — this backgroundColor is just
        // the fallback if that CSS somehow fails to paint.
        backgroundColor: "#0d0e12",
        // 3x renders crisp text/vector edges (borders, icon rounding) at
        // typical viewing sizes. It can't fix the perk icons themselves —
        // those are capped by their 128x128 source resolution, which is
        // why ShareCard keeps icon display size close to that instead of
        // relying on this to compensate.
        scale: 3,
        useCORS: true,
      });
      const link = document.createElement("a");
      const suffix = layout === "story" ? "-story" : "";
      link.download = `dbd-${role}-build-${perks.map((p) => p.slug).join("-")}${suffix}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      showToast(t({ ru: "Картинка билда скачана!", en: "Build image downloaded!" }));
    } catch {
      showToast(t({ ru: "Не удалось создать картинку", en: "Couldn't generate the image" }));
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
    ? mode === "loadout" && role === "killer"
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
    ? loadoutPoolForRole.filter((p) => !combinedExcludedLoadout.has(`${p.kind}:${p.slug}`)).length
    : 0;
  const battleRoyaleUsedLoadoutInRole = mounted
    ? loadoutPoolForRole.filter((p) => battleRoyaleUsed.has(`${p.kind}:${p.slug}`)).length
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
      <div className="flex flex-wrap items-center justify-center gap-4">
        <div className="flex flex-wrap items-center justify-center gap-2">
          {(Object.keys(ROLE_LABEL) as PerkRole[]).map((r) => {
            const c = ROLE_COLOR[r];
            return (
              <button
                key={r}
                type="button"
                onClick={() => selectRole(r)}
                className={cn(
                  "rounded-full border px-5 py-1.5 text-sm font-medium capitalize transition-colors",
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
          {(["perks", "loadout"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => selectMode(m)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                mode === m
                  ? cn(roleColor.border, roleColor.bg, roleColor.text, "border")
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {m === "perks" ? t({ ru: "Перки", en: "Perks" }) : t({ ru: "Экипировка", en: "Full Loadout" })}
            </button>
          ))}
        </div>

        {mode === "perks" && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">{t({ ru: "Перков:", en: "Perks:" })}</span>
            {Array.from({ length: MAX_PERK_COUNT + 1 }, (_, n) => n).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => selectPerkCount(n)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  perkCount === n
                    ? cn(roleColor.border, roleColor.bg, roleColor.text)
                    : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        {mode === "perks" && mounted && getTagsForRole(role).length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">{t({ ru: "Тема:", en: "Theme:" })}</span>
            <select
              value={themeTag ?? ""}
              onChange={(e) => selectTheme(e.target.value || null)}
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

        {mode === "loadout" && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">{t({ ru: "Слоты:", en: "Slots:" })}</span>
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
                    src={withBasePath(getCharacterPortrait(selectedCharacter) as string)}
                    alt={getCharacterName(selectedCharacter, language)}
                    className="size-7 object-cover"
                  />
                ) : (
                  <span className="text-[10px] text-muted">?</span>
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
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <Users className="size-3.5" />
            {t({ ru: "Выбрать персонажа", en: "Choose Character" })}
          </button>
        )}

        {mode === "perks" && selectedCharacter && (
          <ToggleSwitch
            checked={guaranteeTeachables}
            onChange={toggleGuaranteeTeachables}
            label={t({ ru: "Гарантировать тичеблы", en: "Guarantee teachables" })}
            tooltip={t({
              ru: "В билд гарантированно попадут собственные перки этого персонажа (если они не исключены из пула).",
              en: "The build is guaranteed to include this character's own perks (unless they're excluded from the pool).",
            })}
          />
        )}
      </div>

      {/* Utility bar — Daily Challenge/seed and the pool/stats dialogs live
          here, deliberately separated from the primary Generate action
          below the perk grid so the two don't compete for attention. */}
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-full border border-border bg-surface/60 px-2 py-1.5">
          <button
            type="button"
            onClick={toggleDailyChallenge}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              seedMode === "daily"
                ? "bg-accent/15 text-accent"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <CalendarClock className="size-3.5" />
            {t({ ru: "Задание дня", en: "Daily Challenge" })}
          </button>
          <input
            type="text"
            value={customSeedInput}
            onChange={(e) => setCustomSeedInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyCustomSeed()}
            placeholder={t({ ru: "Свой сид…", en: "Custom seed…" })}
            className="w-28 rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground placeholder:text-muted/60 focus:ring-2 focus:ring-accent/40 focus:outline-none"
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
              className="flex size-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <button
            type="button"
            onClick={() => setExcludePanelOpen(true)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <ListFilter className="size-3.5" />
            {t({ ru: "Пул", en: "Pool" })}
            {(mode === "perks" ? excludedSlugs.size : excludedLoadoutSlugs.size) > 0 && (
              <span className="rounded-full bg-accent/15 px-1.5 text-accent">
                {mode === "perks" ? excludedSlugs.size : excludedLoadoutSlugs.size}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setStatsModalOpen(true)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <BarChart3 className="size-3.5" />
            {t({ ru: "Статистика", en: "Stats" })}
          </button>
          <button
            type="button"
            onClick={() => setObsModalOpen(true)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <MonitorPlay className="size-3.5" />
            {t({ ru: "Оверлей OBS", en: "OBS Overlay" })}
          </button>
        </div>
        {activeSeed && (
          <p className="text-xs text-muted">
            {t({ ru: "Активный сид:", en: "Active seed:" })}{" "}
            <code className="rounded bg-surface px-1.5 py-0.5 text-accent">{activeSeed}</code>
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

      {mode === "loadout" ? (
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
      ) : poolExhausted ? (
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
              : t({ ru: "В пуле недостаточно перков", en: "Not enough perks in the pool" })}
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
            onClick={battleRoyale ? restartBattleRoyale : () => setExcludePanelOpen(true)}
            className="mt-1 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground transition-transform hover:scale-105 active:scale-95"
          >
            {battleRoyale
              ? t({ ru: "Начать заново", en: "Start over" })
              : t({ ru: "Открыть пул перков", en: "Open perk pool" })}
          </button>
        </div>
      ) : (
        <PerkGrid
          perks={perks}
          language={language}
          loading={!mounted}
          emptyMessage={
            perkCount === 0
              ? t({ ru: "Ноль перков — режим испытания", en: "Zero perks — challenge mode" })
              : undefined
          }
          onCopy={handleCopy}
        />
      )}

      {/* Secondary toolbar — sleek, compact, sits right under the cards it
          acts on rather than competing with Generate for weight. */}
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={mode === "loadout" ? handleCopyAllLoadout : handleCopyAll}
          disabled={mode === "loadout" ? loadoutPieces.length === 0 : perks.length === 0}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <Copy className="size-3.5" />
          {mode === "loadout"
            ? t({ ru: "Скопировать всё", en: "Copy full loadout" })
            : t({ ru: "Скопировать всё", en: "Copy full build" })}
        </button>
        <button
          type="button"
          onClick={handleShare}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <Link2 className="size-3.5" />
          {t({ ru: "Поделиться", en: "Share" })}
        </button>
        {mode === "perks" && (
          <DownloadImageButton
            onSelect={handleDownloadImage}
            generating={generatingImage}
            disabled={perks.length === 0}
          />
        )}
      </div>

      {/* Off-screen — exists only so html2canvas has real, laid-out DOM to
          rasterize when a download button is clicked; never visible itself. */}
      <div aria-hidden style={{ position: "fixed", top: 0, left: -9999, pointerEvents: "none" }}>
        <ShareCard ref={shareCardRef} perks={perks} role={role} language={language} />
        <ShareCard ref={storyShareCardRef} perks={perks} role={role} language={language} layout="story" />
      </div>

      {/* Primary CTA — the one action on this page that should visually
          win: standalone, largest, most saturated element on the board. */}
      <button
        type="button"
        onClick={regenerate}
        disabled={!!activeSeed || (mode === "perks" && (perkCount === 0 || poolExhausted))}
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

      <p className="-mt-1 text-[11px] text-muted/70">
        {t({ ru: "Подсказка: ", en: "Tip: " })}
        <kbd className="rounded border border-border bg-surface px-1 py-0.5 font-sans">Space</kbd>
        {" / "}
        <kbd className="rounded border border-border bg-surface px-1 py-0.5 font-sans">Enter</kbd>{" "}
        {t({ ru: "тоже рандомизирует", en: "also rolls a new one" })}
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
        className="flex items-center gap-1.5 text-xs text-muted/60 transition-colors hover:text-muted"
      >
        <BarChart3 className="size-3.5" />
        {t({ ru: "Статистика пула", en: "Pool stats" })}
      </button>
      {showStats && mounted && mode === "perks" && (
        <div className="rounded-xl border border-border bg-surface px-4 py-3 text-center text-xs text-muted">
          <p>
            {t({ ru: `Всего перков ${ROLE_LABEL[role].ru}:`, en: `Total ${ROLE_LABEL[role].en} perks:` })}{" "}
            <b className="text-foreground">{totalInRole}</b>
          </p>
          <p>
            {t({ ru: "Исключено вручную:", en: "Manually excluded:" })}{" "}
            <b className="text-foreground">{excludedSlugs.size}</b>
          </p>
          {battleRoyale && (
            <p>
              {t({ ru: "Использовано в Battle Royale:", en: "Used in Battle Royale:" })}{" "}
              <b className="text-foreground">{battleRoyaleUsedInRole}</b> ·{" "}
              {t({ ru: "Осталось:", en: "Remaining:" })}{" "}
              <b className="text-foreground">{availableCount}</b>
            </p>
          )}
        </div>
      )}
      {showStats && mounted && mode === "loadout" && (
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
              {t({ ru: "Использовано в Battle Royale:", en: "Used in Battle Royale:" })}{" "}
              <b className="text-foreground">{battleRoyaleUsedLoadoutInRole}</b> ·{" "}
              {t({ ru: "Осталось:", en: "Remaining:" })}{" "}
              <b className="text-foreground">{availableLoadoutCount}</b>
            </p>
          )}
        </div>
      )}

      {mode === "perks" ? (
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

      <ObsOverlayModal
        open={obsModalOpen}
        onClose={() => setObsModalOpen(false)}
        perks={perks}
        mode={mode}
        loadoutPieces={loadoutPieces}
        language={language}
        role={role}
        twitchChannel={twitchChannel}
        twitchEnabled={twitchEnabled}
        twitchState={twitchState}
        onTwitchChannelChange={updateTwitchChannel}
        onTwitchToggle={toggleTwitch}
        twitchRerollCommand={twitchRerollCommand}
        twitchRerollPermission={twitchRerollPermission}
        twitchCooldownSec={twitchCooldownSec}
        twitchPasteEnabled={twitchPasteEnabled}
        twitchPasteCommand={twitchPasteCommand}
        twitchPastePermission={twitchPastePermission}
        onTwitchRerollCommandChange={updateTwitchRerollCommand}
        onTwitchRerollPermissionChange={updateTwitchRerollPermission}
        onTwitchCooldownSecChange={updateTwitchCooldownSec}
        onTwitchPasteToggle={toggleTwitchPaste}
        onTwitchPasteCommandChange={updateTwitchPasteCommand}
        onTwitchPastePermissionChange={updateTwitchPastePermission}
      />

      <CharacterPickerModal
        key={`char-picker-${mode === "loadout" && role === "killer" ? "killer-loadout" : role}`}
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
