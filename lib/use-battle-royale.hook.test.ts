// useBattleRoyale, rendered.
//
// The mode's whole premise is that a used build never comes back, and every
// way of breaking that is invisible in a single round: the build still rolls,
// it just quietly stops draining the pool and the mode becomes ordinary
// randomisation.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { useBattleRoyale, type BattleRoyaleController } from "./use-battle-royale";
import type { Item, LoadoutPiece, Perk } from "./types";

const STORAGE_KEY = "dbd-randomizer:battle-royale";

/* Rendered under StrictMode, which is how the app itself runs — Next enables
 * it by default and does not turn it off here. It matters for more than
 * principle: StrictMode double-invokes setState updaters to catch impurity,
 * and the once-per-click write test below cannot fail without it. Verified —
 * folding the setters back into the updater passes a non-Strict render. */
function setup() {
  const view = renderHook(() => useBattleRoyale(), { wrapper: StrictMode });
  return {
    get br(): BattleRoyaleController {
      return view.result.current;
    },
  };
}

const perk = (slug: string) => ({ slug, role: "survivor" }) as Perk;
const item = (slug: string) => ({ kind: "item", slug }) as Item as LoadoutPiece;

const stored = () => JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test("off by default, and nothing is spent", () => {
  const s = setup();
  assert.equal(s.br.active, false);
  assert.equal(s.br.used.size, 0);
});

test("eliminating retires the whole build and persists it", () => {
  const s = setup();
  act(() => s.br.toggle());
  act(() =>
    s.br.eliminate({ mode: "perks", perks: [perk("a"), perk("b")], loadoutPieces: [] }),
  );

  assert.deepEqual([...s.br.used].sort(), ["a", "b"]);
  assert.deepEqual(stored(), { active: true, used: ["a", "b"] });
});

test("attrition accumulates across rounds rather than replacing", () => {
  const s = setup();
  act(() => s.br.toggle());
  act(() => s.br.eliminate({ mode: "perks", perks: [perk("round-one")], loadoutPieces: [] }));
  act(() => s.br.eliminate({ mode: "perks", perks: [perk("round-two")], loadoutPieces: [] }));
  assert.deepEqual([...s.br.used].sort(), ["round-one", "round-two"]);
});

test("all mode retires both halves in ONE write", () => {
  /* One player action should be one write to storage. Two setState calls here
     persisted the evolving set twice, which is both wasteful and a chance for
     the two writes to disagree. */
  const s = setup();
  act(() => s.br.toggle());
  sessionStorage.clear();

  act(() =>
    s.br.eliminate({
      mode: "all",
      perks: [perk("a-perk")],
      loadoutPieces: [item("toolbox")],
    }),
  );
  assert.deepEqual(stored().used.sort(), ["a-perk", "item:toolbox"]);
});

test("mode decides which half is retired", () => {
  const s = setup();
  act(() => s.br.toggle());
  // perks-only: the loadout on screen is not part of this round.
  act(() =>
    s.br.eliminate({ mode: "perks", perks: [perk("p")], loadoutPieces: [item("i")] }),
  );
  assert.deepEqual([...s.br.used], ["p"]);
});

test("eliminating nothing is a no-op, not an empty write", () => {
  const s = setup();
  act(() => s.br.toggle());
  sessionStorage.removeItem(STORAGE_KEY);
  act(() => s.br.eliminate({ mode: "perks", perks: [], loadoutPieces: [] }));
  assert.equal(sessionStorage.getItem(STORAGE_KEY), null);
});

test("switching the mode on starts a fresh run; switching off keeps nothing", () => {
  const s = setup();
  act(() => s.br.toggle());
  act(() => s.br.eliminate({ mode: "perks", perks: [perk("spent")], loadoutPieces: [] }));
  assert.equal(s.br.used.size, 1);

  act(() => s.br.toggle());
  assert.equal(s.br.active, false);

  act(() => s.br.toggle());
  assert.equal(s.br.used.size, 0, "turning it back on must start a new run");
});

test("toggle writes to storage exactly once per click", () => {
  /* Strict Mode invokes a setState updater twice to catch impurity. These
     side effects used to live inside setActive's updater and so fired twice
     per toggle — see the note in the hook. */
  const s = setup();
  let writes = 0;
  const real = Storage.prototype.setItem;
  Storage.prototype.setItem = function (...args) {
    if (args[0] === STORAGE_KEY) writes++;
    return real.apply(this, args);
  };
  try {
    act(() => s.br.toggle());
  } finally {
    Storage.prototype.setItem = real;
  }
  assert.equal(writes, 1, `expected one write per toggle, got ${writes}`);
});

test("restart empties the pool without leaving the mode", () => {
  const s = setup();
  act(() => s.br.toggle());
  act(() => s.br.eliminate({ mode: "perks", perks: [perk("spent")], loadoutPieces: [] }));

  act(() => s.br.restart());
  assert.equal(s.br.used.size, 0);
  assert.equal(s.br.active, true, "restart is not a way out of the mode");
  assert.deepEqual(stored(), { active: true, used: [] });
});

test("a run in progress is restored, and a finished one is not", () => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ active: true, used: ["x", "y"] }));
  const running = setup();
  act(() => running.br.hydrate());
  assert.equal(running.br.active, true);
  assert.deepEqual([...running.br.used].sort(), ["x", "y"]);

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ active: false, used: ["x"] }));
  const idle = setup();
  act(() => idle.br.hydrate());
  assert.equal(idle.br.active, false);
  assert.equal(idle.br.used.size, 0, "a mode that is off has no spent set to show");
});

test("hydrate survives junk in storage", () => {
  // Session storage is editable by hand and shared with anything else on the
  // origin; a malformed entry must not take the page down.
  for (const junk of ['{"active":true,"used":"not-an-array"}', '{"active":true}', "not json"]) {
    sessionStorage.setItem(STORAGE_KEY, junk);
    const s = setup();
    act(() => s.br.hydrate());
    assert.equal(s.br.used.size, 0, `junk survived: ${junk}`);
  }
});
