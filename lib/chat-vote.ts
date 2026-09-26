// Chat picks the perk that survives the reroll.
//
// The streamer opens a vote, viewers type 1-4, and when it closes every slot
// except the winner is rerolled. lib/twitch-chat.ts already knows how to read
// a channel, gate a command by permission and rate-limit it; none of that is
// repeated here. This is only the tallying, which is the part with rules
// worth writing down and the part that is worth being sure about before it
// runs live in front of an audience.
//
// Pure, and immutable: every operation returns a new state, and the clock is
// passed in rather than read. A vote is a thing that ends at a particular
// moment, and a module that called Date.now() itself could only be tested by
// waiting — which is no way to check what happens to a message that arrives
// half a second after the deadline.
//
// The timer that actually fires, and the connection that feeds this, belong
// to the caller.

/** The four build slots, as a viewer types them. */
export type VoteSlot = 1 | 2 | 3 | 4;

export const VOTE_SLOTS: readonly VoteSlot[] = [1, 2, 3, 4];

export interface VoteState {
  /** When the vote closes. Messages at or after this are not counted. */
  endsAt: number;
  /** Lowercased username -> the slot they last chose. A Map so the order is
   *  insertion order, which makes the tests readable; nothing depends on it. */
  ballots: ReadonlyMap<string, VoteSlot>;
}

export interface VoteResult {
  /** The slot to keep, or null when nobody voted. */
  winner: VoteSlot | null;
  /** Votes per slot, always all four entries, zeros included — the overlay
   *  draws a bar per slot and a missing key would be a hole in the chart. */
  tally: Record<VoteSlot, number>;
  /** How many people voted, which is not the same as how many messages
   *  arrived: one person changing their mind four times is one voter. */
  voters: number;
  /** True when the winner shared its count with another slot, so the caller
   *  can say so rather than presenting a coin toss as a result. */
  tied: boolean;
}

/** A vote that has not been opened, so the UI has something to render before
 *  the first one and after a reset. */
export const NO_VOTE: VoteState = { endsAt: 0, ballots: new Map() };

export function openVote(durationMs: number, now: number): VoteState {
  // A zero or negative duration would open a vote that is already over; the
  // caller's settings should prevent it, and clamping here means it cannot
  // become a vote nobody can enter but which still looks open.
  const ms = Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : 0;
  return { endsAt: now + ms, ballots: new Map() };
}

export function isVoteOpen(state: VoteState, now: number): boolean {
  return now < state.endsAt;
}

/** The slot a chat message asks for, or null if it is not a vote at all.
 *
 *  Deliberately strict: exactly one character, 1 to 4, after trimming. Chat
 *  is full of ordinary conversation containing digits — "4head", "top 3",
 *  "rank 2 btw" — and a loose parser would count all of it. A viewer who
 *  wants to vote can type one character. */
export function parseVote(message: string): VoteSlot | null {
  const trimmed = message.trim();
  if (trimmed.length !== 1) return null;
  const slot = Number(trimmed);
  return VOTE_SLOTS.includes(slot as VoteSlot) ? (slot as VoteSlot) : null;
}

/**
 * Records one chat message against an open vote.
 *
 * Returns the state unchanged when the message is not a vote, when the vote
 * is closed or has run out of time, or when it would not alter the ballot —
 * so the caller can compare by identity to decide whether anything is worth
 * republishing to the overlay.
 *
 * One vote per user, and a later vote replaces an earlier one. Changing your
 * mind is the normal way a chat vote goes, and the alternative — first answer
 * counts — punishes anyone who types before reading the cards.
 */
export function recordVote(
  state: VoteState,
  user: string,
  message: string,
  now: number,
): VoteState {
  if (!isVoteOpen(state, now)) return state;

  const slot = parseVote(message);
  if (slot === null) return state;

  // Twitch usernames are case-insensitive; the same person typing from two
  // clients must not get two votes.
  const key = user.trim().toLowerCase();
  if (key === "") return state;
  if (state.ballots.get(key) === slot) return state;

  const ballots = new Map(state.ballots);
  ballots.set(key, slot);
  return { ...state, ballots };
}

/** The tally so far, without closing anything — for the live bar on the
 *  overlay while the vote is still running. */
export function tallyVotes(state: VoteState): Record<VoteSlot, number> {
  const tally: Record<VoteSlot, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const slot of state.ballots.values()) tally[slot]++;
  return tally;
}

/**
 * Closes the vote and says which slot won.
 *
 * Ties go to the lowest slot number — the leftmost card on screen.
 *
 * It had to be something, and the alternatives are worse in a way that only
 * shows up on stream. Random is unreproducible: the streamer cannot explain
 * it, and the same vote replayed gives a different answer. First-to-reach-the
 * -count depends on the order messages arrived, which no viewer can see, so a
 * result decided that way looks arbitrary to everyone watching. "Leftmost
 * wins" is the one rule that can be said out loud before the vote starts and
 * checked by anyone afterwards.
 *
 * `tied` is reported separately so the caller can say "1 and 3 tied, keeping
 * 1" rather than quietly presenting it as a clean win.
 */
export function closeVote(state: VoteState): VoteResult {
  const tally = tallyVotes(state);
  const voters = state.ballots.size;

  if (voters === 0) {
    // Nobody voted. Null rather than a default slot: the caller has to decide
    // what an unanswered vote means, and silently keeping slot 1 would look
    // exactly like chat having chosen it.
    return { winner: null, tally, voters: 0, tied: false };
  }

  let winner: VoteSlot = 1;
  let best = -1;
  for (const slot of VOTE_SLOTS) {
    // Strictly greater, walking 1 to 4 in order, so an equal count never
    // displaces the lower slot already held.
    if (tally[slot] > best) {
      best = tally[slot];
      winner = slot;
    }
  }

  const tied = VOTE_SLOTS.some((slot) => slot !== winner && tally[slot] === best);
  return { winner, tally, voters, tied };
}
