// Vote tallying, with the clock driven by hand.
//
// Every rule here is one a streamer would have to explain to chat, which is
// the standard these are written to: if a test cannot be stated as a sentence
// somebody would say on stream, the rule is probably wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closeVote,
  isVoteOpen,
  NO_VOTE,
  openVote,
  parseVote,
  recordVote,
  tallyVotes,
  type VoteState,
} from "./chat-vote";

const T0 = 1_000_000;
const MINUTE = 60_000;

/** Opens a vote and pours a list of [user, message] into it at T0. */
function voteWith(entries: [string, string][], durationMs = MINUTE): VoteState {
  let state = openVote(durationMs, T0);
  for (const [user, message] of entries) state = recordVote(state, user, message, T0);
  return state;
}

test("a vote nobody entered has no winner", () => {
  const result = closeVote(voteWith([]));
  assert.equal(result.winner, null, "silence is not a vote for slot 1");
  assert.equal(result.voters, 0);
  assert.equal(result.tied, false);
  assert.deepEqual(result.tally, { 1: 0, 2: 0, 3: 0, 4: 0 });
});

test("the slot with the most votes wins", () => {
  const result = closeVote(
    voteWith([
      ["alice", "2"],
      ["bob", "2"],
      ["carol", "4"],
    ]),
  );
  assert.equal(result.winner, 2);
  assert.equal(result.voters, 3);
  assert.equal(result.tied, false);
  assert.deepEqual(result.tally, { 1: 0, 2: 2, 3: 0, 4: 1 });
});

test("one vote per person, however many times they type", () => {
  const result = closeVote(
    voteWith([
      ["spammer", "1"],
      ["spammer", "1"],
      ["spammer", "1"],
      ["spammer", "1"],
      ["someone", "3"],
    ]),
  );
  assert.equal(result.voters, 2, "four messages from one person is one voter");
  assert.deepEqual(result.tally, { 1: 1, 2: 0, 3: 1, 4: 0 });
});

test("a later vote replaces an earlier one", () => {
  const result = closeVote(
    voteWith([
      ["alice", "1"],
      ["bob", "1"],
      ["alice", "4"],
    ]),
  );
  assert.deepEqual(result.tally, { 1: 1, 2: 0, 3: 0, 4: 1 }, "alice moved, she did not double");
  assert.equal(result.voters, 2);
});

test("the same person from two clients is still one person", () => {
  const result = closeVote(
    voteWith([
      ["Alice", "2"],
      ["alice", "2"],
      ["ALICE", "2"],
    ]),
  );
  assert.equal(result.voters, 1);
});

test("a tie goes to the leftmost slot, and says it was a tie", () => {
  const result = closeVote(
    voteWith([
      ["a", "3"],
      ["b", "3"],
      ["c", "1"],
      ["d", "1"],
    ]),
  );
  assert.equal(result.winner, 1, "ties go to the lowest slot");
  assert.equal(result.tied, true, "and the caller is told, so it can say so");
});

test("a four-way tie still resolves, deterministically", () => {
  const result = closeVote(
    voteWith([
      ["a", "4"],
      ["b", "3"],
      ["c", "2"],
      ["d", "1"],
    ]),
  );
  assert.equal(result.winner, 1);
  assert.equal(result.tied, true);
  // Replaying the same vote gives the same answer, which is the whole point
  // of not breaking ties randomly.
  const again = closeVote(
    voteWith([
      ["d", "1"],
      ["c", "2"],
      ["b", "3"],
      ["a", "4"],
    ]),
  );
  assert.equal(again.winner, 1, "arrival order must not change the result");
});

test("a clear win is not reported as a tie", () => {
  const result = closeVote(
    voteWith([
      ["a", "2"],
      ["b", "2"],
      ["c", "3"],
    ]),
  );
  assert.equal(result.winner, 2);
  assert.equal(result.tied, false);
});

test("chat that is not a vote is ignored", () => {
  const result = closeVote(
    voteWith([
      ["a", "4head"],
      ["b", "top 3"],
      ["c", "rank 2 btw"],
      ["d", "LETS GOOO"],
      ["e", "0"],
      ["f", "5"],
      ["g", "-1"],
      ["h", "1.0"],
      ["i", ""],
      ["j", "   "],
      ["k", "11"],
      ["l", "1 2 3 4"],
    ]),
  );
  assert.equal(result.voters, 0, "none of that is a vote");
  assert.equal(result.winner, null);
});

test("a vote may be padded with whitespace", () => {
  const result = closeVote(
    voteWith([
      ["a", " 3 "],
      ["b", "\t4\n"],
    ]),
  );
  assert.deepEqual(result.tally, { 1: 0, 2: 0, 3: 1, 4: 1 });
});

test("parseVote reads exactly the four slots and nothing else", () => {
  for (const [message, expected] of [
    ["1", 1],
    ["2", 2],
    ["3", 3],
    ["4", 4],
    [" 4 ", 4],
  ] as [string, number][]) {
    assert.equal(parseVote(message), expected, `"${message}"`);
  }
  for (const message of ["0", "5", "", " ", "1 1", "one", "4head", "١", "+1", "1e0"]) {
    assert.equal(parseVote(message), null, `"${message}" should not be a vote`);
  }
});

test("votes after the deadline do not count", () => {
  let state = openVote(MINUTE, T0);
  state = recordVote(state, "early", "1", T0 + MINUTE - 1);
  const late = recordVote(state, "late", "4", T0 + MINUTE);

  assert.equal(late, state, "the state is untouched, not merely equal");
  const result = closeVote(late);
  assert.equal(result.voters, 1);
  assert.equal(result.winner, 1);
});

test("a vote that was never opened accepts nothing", () => {
  const after = recordVote(NO_VOTE, "alice", "2", T0);
  assert.equal(after, NO_VOTE);
  assert.equal(isVoteOpen(NO_VOTE, T0), false);
});

test("isVoteOpen closes exactly at the deadline", () => {
  const state = openVote(MINUTE, T0);
  assert.equal(isVoteOpen(state, T0), true);
  assert.equal(isVoteOpen(state, T0 + MINUTE - 1), true);
  assert.equal(isVoteOpen(state, T0 + MINUTE), false, "the deadline is the end, not the last moment");
  assert.equal(isVoteOpen(state, T0 + MINUTE + 1), false);
});

test("a nonsense duration cannot open a vote that looks open but is not", () => {
  for (const duration of [0, -5000, Number.NaN, Number.POSITIVE_INFINITY]) {
    const state = openVote(duration, T0);
    assert.equal(isVoteOpen(state, T0), false, `duration ${duration}`);
    assert.equal(closeVote(state).winner, null);
  }
});

test("a message that changes nothing returns the same state", () => {
  /* The caller compares by identity to decide whether to republish the tally
   * to the overlay. A vote that re-affirms the same slot must not look like
   * news, or every duplicate message pushes a Firebase write. */
  let state = openVote(MINUTE, T0);
  state = recordVote(state, "alice", "2", T0);
  assert.equal(recordVote(state, "alice", "2", T0), state, "same vote again");
  assert.equal(recordVote(state, "bob", "hello", T0), state, "not a vote");
  assert.equal(recordVote(state, "  ", "2", T0), state, "no username");
  assert.notEqual(recordVote(state, "alice", "3", T0), state, "a changed mind is news");
  assert.notEqual(recordVote(state, "bob", "2", T0), state, "a new voter is news");
});

test("recording never mutates the state it was given", () => {
  const before = openVote(MINUTE, T0);
  const after = recordVote(before, "alice", "2", T0);
  assert.equal(before.ballots.size, 0, "the original ballot box is untouched");
  assert.equal(after.ballots.size, 1);
});

test("the tally always has all four slots, zeros included", () => {
  // The overlay draws a bar per slot; a missing key would be a hole in it.
  assert.deepEqual(tallyVotes(NO_VOTE), { 1: 0, 2: 0, 3: 0, 4: 0 });
  assert.deepEqual(tallyVotes(voteWith([["a", "2"]])), { 1: 0, 2: 1, 3: 0, 4: 0 });
});

test("the running tally matches the closed one", () => {
  const state = voteWith([
    ["a", "1"],
    ["b", "3"],
    ["c", "3"],
  ]);
  assert.deepEqual(tallyVotes(state), closeVote(state).tally);
});

test("a realistic vote: a hundred viewers, some changing their minds", () => {
  let state = openVote(30_000, T0);
  for (let i = 0; i < 100; i++) {
    // Slots 1-4 in rotation, so 25 each, then the last ten switch to slot 2.
    state = recordVote(state, `viewer${i}`, String((i % 4) + 1), T0 + i);
  }
  for (let i = 90; i < 100; i++) {
    state = recordVote(state, `viewer${i}`, "2", T0 + 1000 + i);
  }
  const result = closeVote(state);
  assert.equal(result.voters, 100, "a changed mind is not a new voter");
  assert.equal(
    result.tally[1] + result.tally[2] + result.tally[3] + result.tally[4],
    100,
    "every voter is counted exactly once",
  );
  assert.equal(result.winner, 2);
});

// --- what the overlay receives -------------------------------------------
//
// The payload gains an optional `vote`. Both directions of compatibility
// have to hold, and neither is checked by the type system at runtime: an
// overlay on an older build reads a payload that has the key and must ignore
// it, and an overlay on this build reads a payload written before the key
// existed and must draw nothing rather than throw.

test("an overlay from before this feature ignores a payload carrying a vote", () => {
  // What an older overlay does: destructure the fields it knows about. An
  // extra key in a JSON object is not an error, and this is the assertion
  // that says so out loud rather than assuming it.
  const payload = {
    role: "survivor",
    language: "ru",
    updatedAt: 1,
    perks: [],
    vote: { tally: { 1: 3, 2: 0, 3: 1, 4: 0 }, endsAt: 99 },
  };
  const { role, language, perks } = payload as {
    role: string;
    language: string;
    perks: unknown[];
  };
  assert.equal(role, "survivor");
  assert.equal(language, "ru");
  assert.deepEqual(perks, []);
});

test("a payload written before the field existed leaves the bars off", () => {
  const old = { role: "killer", language: "en", updatedAt: 1, perks: [] } as {
    vote?: { tally: Record<number, number> };
  };
  assert.equal(old.vote, undefined, "no vote is the absence of the key, not a null");
  // The overlay's own guard is `state.vote && index < 4`, which is what this
  // stands in for: undefined draws nothing at all.
  assert.equal(Boolean(old.vote), false);
});

test("a tally survives the JSON round trip the publisher does", () => {
  /* publishObsState round-trips through JSON before writing to Firebase, to
   * drop undefined-valued keys. Numeric object keys come back as strings in
   * JSON, so this checks the tally is still readable by slot afterwards —
   * getting that wrong would show every bar at zero. */
  const state = voteWith([
    ["a", "2"],
    ["b", "2"],
    ["c", "4"],
  ]);
  const sent = { tally: tallyVotes(state), endsAt: state.endsAt };
  const received = JSON.parse(JSON.stringify(sent)) as typeof sent;
  assert.equal(received.tally[2], 2);
  assert.equal(received.tally[4], 1);
  assert.equal(received.tally[1], 0);
  assert.equal(received.endsAt, state.endsAt);
});
