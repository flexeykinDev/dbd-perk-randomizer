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

function loadState(): StatsState {
  // Partial<StatsState> in case an older/incompatible app version left a
  // differently-shaped value behind — spreading undefined below is a no-op,
  // so this degrades to emptyRoleStats() per role rather than throwing.
  const parsed = safeGetJSON<Partial<StatsState>>("local", STORAGE_KEY, {});
  return {
    survivor: { ...emptyRoleStats(), ...parsed.survivor },
    killer: { ...emptyRoleStats(), ...parsed.killer },
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
