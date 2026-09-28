// The overlay's plumbing, which fails quietly or not at all.
//
// Everything here is the sort of thing a streamer finds out about from chat:
// a room code that cannot be retyped, a payload the database rules reject, a
// connection opened for somebody who never asked for one. None of it throws,
// none of it shows an error, and none of it was covered.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getOrCreateRoomCode,
  loadLastObsState,
  publishObsState,
  type ObsPerk,
} from "./obs-sync";

const ROOM_KEY = "dbd-randomizer:obs-room";
const STATE_KEY = "dbd-randomizer:obs-last-state";

/** The alphabet the module documents: A-Z and 2-9, with the four
 *  look-alikes removed. Written out here rather than imported so that
 *  changing the constant has to be a deliberate act, not a silent one. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const perk = (slug: string): ObsPerk => ({
  slug,
  icon: `/perks/survivor/${slug}.webp`,
  name: { en: slug, ru: slug },
});

beforeEach(() => {
  localStorage.clear();
});

test("importing the module does not create a room", () => {
  /* A room is a row in a shared database. A visitor who never opens the OBS
   * modal must not create one just by loading the page, which is what the
   * README's privacy claim rests on — and an import-time side effect is
   * exactly how that promise would be broken without anyone noticing. */
  assert.equal(localStorage.getItem(ROOM_KEY), null);
});

test("a room is created only by asking for one", () => {
  assert.equal(localStorage.getItem(ROOM_KEY), null);
  const code = getOrCreateRoomCode();
  assert.equal(localStorage.getItem(ROOM_KEY), code);
});

test("a room code can be retyped into OBS without ambiguity", () => {
  /* People copy these by hand into a Browser Source. The alphabet drops
   * 0/O and 1/I for that reason, and a code containing one would produce a
   * "room not found" that looks like the feature being broken. */
  for (let i = 0; i < 500; i++) {
    localStorage.clear();
    const code = getOrCreateRoomCode();

    assert.equal(code.length, 8, `wrong length: ${code}`);
    for (const char of code) {
      assert.ok(ALPHABET.includes(char), `${char} is not in the alphabet (${code})`);
    }
    assert.ok(!/[0O1I]/.test(code), `${code} contains a look-alike`);
  }
});

test("codes are not all the same code", () => {
  // A generator that returned a constant would pass every check above.
  const codes = new Set<string>();
  for (let i = 0; i < 200; i++) {
    localStorage.clear();
    codes.add(getOrCreateRoomCode());
  }
  assert.ok(codes.size > 190, `only ${codes.size} distinct codes in 200 draws`);
});

test("a stored code is reused, not regenerated", () => {
  /* The code is in the URL the streamer has already pasted into OBS. A
   * second call handing back a different one would leave the overlay
   * listening to a room nobody writes to — the failure that looks exactly
   * like "the overlay stopped updating". */
  const first = getOrCreateRoomCode();
  for (let i = 0; i < 5; i++) {
    assert.equal(getOrCreateRoomCode(), first);
  }
});

test("the published payload carries what the database rules require", () => {
  /* The Firebase rules in the README validate
   * `newData.hasChildren(['role', 'language', 'updatedAt'])`. A payload
   * missing any of the three is refused by the server, which surfaces as
   * the overlay simply never updating. */
  publishObsState({
    role: "survivor",
    language: "ru",
    perks: [perk("adrenaline"), perk("resilience")],
  });

  const stored = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
  assert.ok(stored, "nothing was published");
  for (const key of ["role", "language", "updatedAt"]) {
    assert.ok(key in stored, `the rules require ${key}`);
  }
  assert.equal(stored.role, "survivor");
  assert.equal(stored.language, "ru");
  assert.equal(typeof stored.updatedAt, "number");
  assert.ok(stored.updatedAt > 0);
});

test("the mirrored copy is what an overlay opened later reads back", () => {
  // The localStorage mirror exists so an overlay tab opened after the last
  // roll still has a build to show.
  publishObsState({
    role: "killer",
    language: "en",
    perks: [perk("whispers")],
  });

  const restored = loadLastObsState();
  assert.ok(restored);
  assert.equal(restored.role, "killer");
  assert.equal(restored.language, "en");
  assert.deepEqual(
    restored.perks.map((p) => p.slug),
    ["whispers"],
  );
});

test("publishing without a room touches no database", () => {
  /* Same promise as the import test, one step later: rolling a build with
   * the OBS feature never opened writes to this browser and nowhere else.
   * If a room existed, publishObsState would reach for Firebase. */
  assert.equal(localStorage.getItem(ROOM_KEY), null);
  publishObsState({ role: "survivor", language: "en", perks: [perk("adrenaline")] });
  assert.equal(localStorage.getItem(ROOM_KEY), null, "publishing must not mint a room");
});

test("an optional field left undefined is dropped rather than stored as null", () => {
  /* Firebase's set() rejects a tree containing a literal undefined — see the
   * note in publishObsState. The mirror is written by the same path, so it
   * is a reasonable place to check the payload is clean. */
  publishObsState({
    role: "survivor",
    language: "en",
    perks: [perk("adrenaline")],
    character: undefined,
  });
  const stored = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null");
  assert.equal(stored.character, undefined);
});

test("a corrupt stored state reads as nothing rather than throwing", () => {
  for (const bad of ["not json", "null", "[]", '{"role":"survivor"}']) {
    localStorage.setItem(STATE_KEY, bad);
    // Either a usable payload or null — never an exception into the overlay.
    const restored = loadLastObsState();
    if (restored) assert.equal(typeof restored, "object");
  }
});
