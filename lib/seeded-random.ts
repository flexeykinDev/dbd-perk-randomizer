/** Deterministic PRNG support for Daily Challenge / shareable custom-seed
 *  builds — replaces Math.random() when a seed is active so the same seed
 *  always shuffles into the same order. */

/** cyrb53 string hash — turns an arbitrary seed string into a 32-bit int
 *  for mulberry32. Not cryptographic, just a fast, well-distributed mix. */
function hashStringToSeed(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 >>> 0) ^ (h2 >>> 0);
}

/** mulberry32 — tiny, fast, decent-quality PRNG. Returns a function that
 *  yields floats in [0, 1), same interface as Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a seeded RNG from an arbitrary string — same string always
 *  produces the same sequence. */
export function createSeededRandom(seedString: string): () => number {
  return mulberry32(hashStringToSeed(seedString));
}

/** Today's date as YYYY-MM-DD in UTC, so "today" means the same calendar
 *  day for every player regardless of their local timezone. */
export function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dailyChallengeSeed(role: string): string {
  return `${todayUtcDateString()}-${role}`;
}

/** Fisher-Yates on a copy — shared by lib/perks.ts and lib/loadout.ts.
 *  @param random Defaults to Math.random; pass a seeded RNG (from
 *  createSeededRandom above) for deterministic shuffling, e.g. Daily
 *  Challenge. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
