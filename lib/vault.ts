// Builds the player names and keeps.
//
// There is already history — the last twenty rolls, unnamed, dropping off the
// end — and there are presets, which are authored in the repo and the same
// for everybody. Neither is "this one was good, I want it back next week".
// That is what this is.
//
// The shape deliberately mirrors HistoryEntry: same role, same mode, same
// `keys` convention (plain slugs for perks, "kind:slug" for loadout pieces,
// see lib/history.ts). A saved build and a history entry describe the same
// thing, and two shapes for one idea is how a reopen path ends up written
// twice and diverging.
import { getPerkBySlug } from "./perks";
import { getLoadoutPiece } from "./loadout";
import { parseLoadoutKey } from "./history";
import { safeGetJSON, safeSetJSON } from "./safe-storage";
import type { PerkRole } from "./types";

const STORAGE_KEY = "dbd-randomizer:vault";

/** Generous, but bounded: a name is a label, and an export carrying a
 *  megabyte of "name" is either a mistake or an attack. */
const MAX_NAME_LENGTH = 60;
/** Enough that nobody sensible hits it, small enough that an imported file
 *  cannot fill the origin's storage quota and break every other setting. */
const MAX_BUILDS = 200;

export type VaultMode = "perks" | "loadout";

export interface VaultBuild {
  id: string;
  name: string;
  role: PerkRole;
  mode: VaultMode;
  /** Perks mode: perk slugs. Loadout mode: "kind:slug". */
  keys: string[];
  /** Unix ms. */
  savedAt: number;
}

/** What an export file looks like. Versioned so a future change has
 *  somewhere to say so, and stamped with the app so a file dropped in by
 *  mistake can be recognised as not ours rather than parsed hopefully. */
export interface VaultFile {
  app: "dbd-perk-randomizer";
  kind: "vault";
  version: 1;
  exportedAt: number;
  builds: VaultBuild[];
}

export const VAULT_FILE_VERSION = 1;

/** Why a file could not be read, in terms the UI can translate. Never an
 *  exception: a player who picked the wrong file deserves a sentence, not a
 *  blank screen. */
export type VaultProblem = "not-json" | "not-a-vault" | "empty";

export interface VaultParseResult {
  builds: VaultBuild[];
  /** Null when the file was usable, even if parts of it were dropped. */
  problem: VaultProblem | null;
  /** Entries thrown away whole — wrong shape, or nothing left after their
   *  unknown perks were dropped. */
  droppedBuilds: number;
  /** Perks and pieces dropped from builds that survived. A perk retired
   *  from the game since the file was written is the ordinary cause. */
  droppedKeys: number;
}

function newId(): string {
  // Same shape history uses. Not a UUID: it only has to be unique within one
  // browser's vault.
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed === "" ? fallback : trimmed;
}

/**
 * Resolves one stored key against the live data, returning the key as it
 * should be stored now, or null if nothing answers to it.
 *
 * getPerkBySlug follows renames, so a build saved when a perk was called
 * Decisive Strike still opens after it became Will to Live — and the
 * returned slug is the *current* one, so importing quietly repairs the file
 * rather than carrying the old name forward forever.
 */
function resolveKey(mode: VaultMode, key: unknown): string | null {
  if (typeof key !== "string" || key === "") return null;

  if (mode === "perks") {
    const perk = getPerkBySlug(key);
    return perk ? perk.slug : null;
  }

  const parsed = parseLoadoutKey(key);
  if (!parsed) return null;
  const piece = getLoadoutPiece(parsed.kind, parsed.slug);
  return piece ? `${parsed.kind}:${piece.slug}` : null;
}

/** One entry from an untrusted file, or null if there is nothing usable in
 *  it. Unknown fields are ignored rather than rejected — a file from a later
 *  version of the app should still import what this version understands. */
function parseBuild(raw: unknown, index: number): { build: VaultBuild | null; droppedKeys: number } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { build: null, droppedKeys: 0 };
  const entry = raw as Record<string, unknown>;

  const role = entry.role === "survivor" || entry.role === "killer" ? entry.role : null;
  const mode = entry.mode === "perks" || entry.mode === "loadout" ? entry.mode : null;
  if (!role || !mode) return { build: null, droppedKeys: 0 };
  if (!Array.isArray(entry.keys)) return { build: null, droppedKeys: 0 };

  const keys: string[] = [];
  let droppedKeys = 0;
  for (const key of entry.keys) {
    const resolved = resolveKey(mode, key);
    if (resolved === null) {
      droppedKeys++;
      continue;
    }
    // A file listing the same perk twice is not a build; keep the first.
    if (!keys.includes(resolved)) keys.push(resolved);
  }
  // Nothing left to reopen. Keeping it would put a row in the list that does
  // nothing when pressed.
  if (keys.length === 0) return { build: null, droppedKeys };

  const savedAt =
    typeof entry.savedAt === "number" && Number.isFinite(entry.savedAt) && entry.savedAt > 0
      ? entry.savedAt
      : Date.now();

  return {
    build: {
      // Always a fresh id. An imported id could collide with one already in
      // this vault, and ids are not meaningful to anybody.
      id: newId(),
      name: cleanName(entry.name, `Build ${index + 1}`),
      role,
      mode,
      keys,
      savedAt,
    },
    droppedKeys,
  };
}

/**
 * Reads an export file. Pure: no storage, no throwing.
 *
 * Everything here treats the input as hostile, because it is — a file the
 * player picked from disk, which may have been edited, truncated, or not
 * ours at all. The rule throughout is to salvage what is valid, count what
 * was not, and hand the caller something it can explain.
 */
export function parseVaultFile(text: string): VaultParseResult {
  const empty: VaultParseResult = { builds: [], problem: null, droppedBuilds: 0, droppedKeys: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...empty, problem: "not-json" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...empty, problem: "not-a-vault" };
  }
  const file = parsed as Record<string, unknown>;
  // Checked loosely: the stamp is there to catch a file that is plainly
  // something else, not to refuse a future version of our own format.
  if (file.app !== "dbd-perk-randomizer" || !Array.isArray(file.builds)) {
    return { ...empty, problem: "not-a-vault" };
  }

  const builds: VaultBuild[] = [];
  let droppedBuilds = 0;
  let droppedKeys = 0;
  for (const [index, raw] of file.builds.entries()) {
    const { build, droppedKeys: lost } = parseBuild(raw, index);
    droppedKeys += lost;
    if (build) builds.push(build);
    else droppedBuilds++;
  }

  if (builds.length === 0) {
    return { builds: [], problem: "empty", droppedBuilds, droppedKeys };
  }
  return { builds, problem: null, droppedBuilds, droppedKeys };
}

// --- storage ---------------------------------------------------------------

/** Reads the saved vault, applying the same validation an imported file
 *  gets. What is in localStorage is no more trustworthy than what is on
 *  disk — an older version of this app wrote it, or a person did. */
export function getVault(): VaultBuild[] {
  const stored = safeGetJSON<unknown>("local", STORAGE_KEY, []);
  if (!Array.isArray(stored)) return [];
  const builds: VaultBuild[] = [];
  for (const [index, raw] of stored.entries()) {
    const { build } = parseBuild(raw, index);
    // Keep the stored id when it is usable, so a rename or a delete keeps
    // addressing the same row across a reload.
    if (build) {
      const id = (raw as Record<string, unknown>).id;
      builds.push(typeof id === "string" && id !== "" ? { ...build, id } : build);
    }
  }
  return builds;
}

function save(builds: VaultBuild[]): VaultBuild[] {
  const capped = builds.slice(0, MAX_BUILDS);
  safeSetJSON("local", STORAGE_KEY, capped);
  return capped;
}

/** Two builds are the same build when they would reopen identically —
 *  same side, same mode, same pieces. The name is not part of it: saving one
 *  build twice under two names is still one build, and an import that
 *  duplicated it would grow the list every time someone re-imported. */
function sameBuild(a: VaultBuild, b: VaultBuild): boolean {
  if (a.role !== b.role || a.mode !== b.mode || a.keys.length !== b.keys.length) return false;
  const keys = new Set(a.keys);
  return b.keys.every((key) => keys.has(key));
}

export function saveBuild(entry: Omit<VaultBuild, "id" | "savedAt">): VaultBuild[] {
  const build: VaultBuild = { ...entry, id: newId(), savedAt: Date.now() };
  // Newest first, matching history.
  return save([build, ...getVault()]);
}

export function renameBuild(id: string, name: string): VaultBuild[] {
  return save(
    getVault().map((build) =>
      build.id === id ? { ...build, name: cleanName(name, build.name) } : build,
    ),
  );
}

export function deleteBuild(id: string): VaultBuild[] {
  return save(getVault().filter((build) => build.id !== id));
}

export function exportVault(builds: VaultBuild[] = getVault()): string {
  const file: VaultFile = {
    app: "dbd-perk-randomizer",
    kind: "vault",
    version: VAULT_FILE_VERSION,
    exportedAt: Date.now(),
    builds,
  };
  // Indented: someone will open this in a text editor, and it costs nothing.
  return JSON.stringify(file, null, 2);
}

export interface VaultImportResult extends VaultParseResult {
  /** How many were actually added, after duplicates were skipped. */
  added: number;
  /** Already present, so not added again. */
  skipped: number;
  /** The vault as it now stands. */
  builds: VaultBuild[];
}

/**
 * Merges a file into the vault rather than replacing it.
 *
 * Replacing would make importing a one-way door: pick the wrong file and
 * everything you had is gone, with no undo anywhere in this app. Merging is
 * the forgiving version, and skipping duplicates is what stops re-importing
 * the same file from doubling the list.
 */
export function importVaultFile(text: string): VaultImportResult {
  const parsed = parseVaultFile(text);
  if (parsed.problem) {
    return { ...parsed, builds: getVault(), added: 0, skipped: 0 };
  }

  const existing = getVault();
  const merged = [...existing];
  let added = 0;
  let skipped = 0;
  for (const build of parsed.builds) {
    if (merged.some((have) => sameBuild(have, build))) {
      skipped++;
      continue;
    }
    merged.push(build);
    added++;
  }

  return { ...parsed, builds: save(merged), added, skipped };
}
