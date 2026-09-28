import type { Perk, PerkRole } from "./types";
import { safeGetJSON, safeRemove, safeSetJSON } from "./safe-storage";

const STORAGE_KEY = "dbd-randomizer:stats";

interface RoleStats {
  totalBuilds: number;
  rolls: Record<string, number>;
}

interface StatsState {
  survivor: RoleStats;
  killer: RoleStats;
}

function emptyRoleStats(): RoleStats {
  return { totalBuilds: 0, rolls: {} };
}

/** One role's saved tally, or an empty one.
 *
 *  Spreading whatever was stored was not enough. Spreading a *string* gives
 *  its characters as numbered keys, and a `rolls` that is a string or an
 *  array survives far enough to be summed — which produces NaN, and "NaN
 *  builds" on screen reads as the site being broken rather than as a bad
 *  saved value. Every field is checked for the type it is about to be used
 *  as. */
function readRoleStats(value: unknown): RoleStats {
  const empty = emptyRoleStats();
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const raw = value as Record<string, unknown>;

  const totalBuilds =
    typeof raw.totalBuilds === "number" && Number.isFinite(raw.totalBuilds) && raw.totalBuilds >= 0
      ? raw.totalBuilds
      : 0;

  const rolls: Record<string, number> = {};
  if (raw.rolls && typeof raw.rolls === "object" && !Array.isArray(raw.rolls)) {
    for (const [slug, count] of Object.entries(raw.rolls as Record<string, unknown>)) {
      if (typeof count === "number" && Number.isFinite(count) && count > 0) rolls[slug] = count;
    }
  }

  return { totalBuilds, rolls };
}

function loadState(): StatsState {
  const parsed = safeGetJSON<unknown>("local", STORAGE_KEY, {});
  const raw = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
  return {
    survivor: readRoleStats(raw.survivor),
    killer: readRoleStats(raw.killer),
  };
}

function saveState(state: StatsState) {
  safeSetJSON("local", STORAGE_KEY, state);
}

/** Records one "a build was generated" event: bumps that role's build
 *  counter once and each rolled perk's counter once. */
export function recordRoll(role: PerkRole, perks: Perk[]): void {
  if (perks.length === 0) return;
  const state = loadState();
  const roleStats = state[role];
  roleStats.totalBuilds += 1;
  for (const perk of perks) {
    roleStats.rolls[perk.slug] = (roleStats.rolls[perk.slug] ?? 0) + 1;
  }
  saveState(state);
}

/** Every slug of `role` that has come up at least once.
 *
 *  Separate from getRoleStatsSummary, which answers "how many" for the
 *  coverage bar. This answers "which", for the roll that draws from the
 *  ones that have not — see lib/unseen-roll.ts. A count cannot be turned
 *  back into a set, so this reads the same saved tally rather than deriving
 *  anything from the summary.
 *
 *  Returns slugs, not perks: a slug that has since been retired from the
 *  pool is still a fact about what this player has rolled, and the caller
 *  intersects with the live pool anyway. */
export function getSeenSlugs(role: PerkRole): Set<string> {
  const rolls = loadState()[role].rolls;
  const seen = new Set<string>();
  for (const [slug, count] of Object.entries(rolls)) {
    // A stored count of 0 should not exist, but a hand-edited or
    // older-version payload could carry one, and "rolled zero times" is
    // exactly what unseen means.
    if (typeof count === "number" && count > 0) seen.add(slug);
  }
  return seen;
}

export function resetStats(): void {
  safeRemove("local", STORAGE_KEY);
}

export interface PerkRollStat {
  perk: Perk;
  count: number;
  percent: number;
}

export interface RoleStatsSummary {
  totalBuilds: number;
  totalRolls: number;
  top: PerkRollStat[];
  bottom: PerkRollStat[];
  /** How many of the role's perks have come up at least once, against how
   *  many exist.
   *
   *  "Least rolled" already lists five perks that haven't appeared, which
   *  answers *which* — it can't answer *how many are left*, and that is
   *  the question a randomizer actually invites. Two counters rather than
   *  a percentage so the modal can phrase it; a percentage alone loses the
   *  fact that the pool grows with every chapter. */
  seen: number;
  poolSize: number;
}

/** @param allPerksForRole Full role pool, so "least rolled" can surface
 *  perks that have never come up (count 0) — not just the smallest nonzero
 *  counts. */
export function getRoleStatsSummary(role: PerkRole, allPerksForRole: Perk[]): RoleStatsSummary {
  const state = loadState();
  const roleStats = state[role];
  const totalRolls = Object.values(roleStats.rolls).reduce((sum, n) => sum + n, 0);

  const withCounts: PerkRollStat[] = allPerksForRole.map((perk) => {
    const count = roleStats.rolls[perk.slug] ?? 0;
    return { perk, count, percent: totalRolls > 0 ? (count / totalRolls) * 100 : 0 };
  });

  const rolledOnly = withCounts.filter((s) => s.count > 0);
  const top = [...rolledOnly].sort((a, b) => b.count - a.count).slice(0, 5);
  const bottom = [...withCounts].sort((a, b) => a.count - b.count).slice(0, 5);

  return {
    totalBuilds: roleStats.totalBuilds,
    totalRolls,
    top,
    bottom,
    // Counted from the live pool rather than from the saved tally: a perk
    // that has been retired since it was rolled shouldn't keep counting
    // towards a total it is no longer part of, or coverage could read
    // above 100%.
    seen: rolledOnly.length,
    poolSize: allPerksForRole.length,
  };
}
