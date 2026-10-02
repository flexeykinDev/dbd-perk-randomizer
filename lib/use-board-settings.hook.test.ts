// useBoardSettings, rendered.
//
// Five settings that only have their storage key in common, so most of what
// matters here is the boring half: a default that holds when nothing is saved,
// a saved value that survives a reload, and a stored value from another version
// that cannot put the board in a state it cannot read back.
//
// The one rule worth stating out loud is the split between `setX` and `showX`.
// A build that arrives whole — a share link, a saved build, a squad — decides
// the mode and the perk count for as long as it is on screen, and must not
// quietly become the visitor's saved preference. Opening a two-perk link once
// should not leave them rolling two perks next week.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { useBoardSettings, type BoardSettings } from "./use-board-settings";

function setup() {
  const view = renderHook(() => useBoardSettings(), { wrapper: StrictMode });
  return {
    get s(): BoardSettings {
      return view.result.current;
    },
  };
}

/** A fresh mount that has read storage, which is what a returning visitor is. */
function reopened() {
  const s = setup();
  act(() => s.s.hydrate());
  return s;
}

beforeEach(() => {
  localStorage.clear();
});

test("the defaults are a full four-perk build with every slot on", () => {
  const { s } = setup();
  assert.equal(s.perkCount, 4);
  assert.equal(s.mode, "perks");
  assert.deepEqual(s.loadoutSlots, { item: true, addons: true, offering: true });
  assert.equal(s.guaranteeTeachables, false);
  assert.deepEqual(s.pieceVisibility, {
    perks: true,
    item: true,
    addon: true,
    offering: true,
  });
});

test("a fresh mount ignores storage until it is hydrated", () => {
  localStorage.setItem("dbd-randomizer:mode", "loadout");
  localStorage.setItem("dbd-randomizer:perk-count", "2");
  const s = setup();
  assert.equal(s.s.mode, "perks", "the first render must match the server's HTML");
  assert.equal(s.s.perkCount, 4);
  act(() => s.s.hydrate());
  assert.equal(s.s.mode, "loadout");
  assert.equal(s.s.perkCount, 2);
});

test("a chosen perk count comes back next visit", () => {
  const s = setup();
  act(() => s.s.setPerkCount(3));
  assert.equal(s.s.perkCount, 3);
  assert.equal(reopened().s.perkCount, 3);
});

test("a chosen mode comes back next visit", () => {
  const s = setup();
  act(() => s.s.setMode("all"));
  assert.equal(reopened().s.mode, "all");
});

test("a build handed over sets the count without saving it", () => {
  // The whole reason showPerkCount exists: a two-perk share link is somebody
  // else's build, not a preference.
  const s = setup();
  act(() => s.s.setPerkCount(4));
  act(() => s.s.showPerkCount(2));
  assert.equal(s.s.perkCount, 2, "what is on screen follows the link");
  assert.equal(reopened().s.perkCount, 4, "what is remembered does not");
});

test("a build handed over sets the mode without saving it", () => {
  const s = setup();
  act(() => s.s.setMode("perks"));
  act(() => s.s.showMode("loadout"));
  assert.equal(s.s.mode, "loadout");
  assert.equal(reopened().s.mode, "perks");
});

test("turning a loadout slot off persists it, and only it", () => {
  const s = setup();
  act(() => s.s.toggleLoadoutSlot("addons"));
  assert.deepEqual(s.s.loadoutSlots, {
    item: true,
    addons: false,
    offering: true,
  });
  assert.deepEqual(reopened().s.loadoutSlots, {
    item: true,
    addons: false,
    offering: true,
  });
});

test("a slot nobody has ever touched is on", () => {
  // Absent is not "off": only an explicit "0" turns a slot off, or a first
  // visit would roll nothing.
  localStorage.setItem("dbd-randomizer:loadout-slot-item", "0");
  const { s } = reopened();
  assert.deepEqual(s.loadoutSlots, { item: false, addons: true, offering: true });
});

test("guaranteed teachables persists both ways", () => {
  const s = setup();
  act(() => s.s.toggleGuaranteeTeachables());
  assert.equal(s.s.guaranteeTeachables, true);
  assert.equal(reopened().s.guaranteeTeachables, true);

  act(() => s.s.toggleGuaranteeTeachables());
  assert.equal(s.s.guaranteeTeachables, false);
  assert.equal(reopened().s.guaranteeTeachables, false);
});

test("hiding a kind from the overlay persists it", () => {
  const s = setup();
  act(() => s.s.setPieceVisibility("offering", false));
  assert.equal(s.s.pieceVisibility.offering, false);
  assert.equal(s.s.pieceVisibility.perks, true, "the others are untouched");
  assert.equal(reopened().s.pieceVisibility.offering, false);
});

test("a perk count from another version cannot survive", () => {
  for (const bad of ["9", "-1", "four", "", "null"]) {
    localStorage.clear();
    localStorage.setItem("dbd-randomizer:perk-count", bad);
    assert.equal(
      reopened().s.perkCount,
      4,
      `"${bad}" should leave the default in place`,
    );
  }
});

test("a fractional count truncates rather than being rejected", () => {
  // parseInt's own behaviour, and harmless: the only writer is a button that
  // can produce 0 to 4, so a "1.5" in storage came from no version this site
  // has ever shipped. Recorded because the guard looks stricter than it is.
  localStorage.setItem("dbd-randomizer:perk-count", "1.5");
  assert.equal(reopened().s.perkCount, 1);
});

test("a mode this version does not have cannot survive", () => {
  for (const bad of ["squad", "", "ALL", "null"]) {
    localStorage.clear();
    localStorage.setItem("dbd-randomizer:mode", bad);
    assert.equal(reopened().s.mode, "perks", `"${bad}" is not a mode`);
  }
});

test("a zero-perk challenge is a real saved choice, not a falsy mistake", () => {
  const s = setup();
  act(() => s.s.setPerkCount(0));
  assert.equal(reopened().s.perkCount, 0);
});

test("reset puts all five back, and remembers that it did", () => {
  const s = setup();
  act(() => {
    s.s.setPerkCount(2);
    s.s.setMode("all");
    s.s.toggleLoadoutSlot("offering");
    s.s.toggleGuaranteeTeachables();
    s.s.setPieceVisibility("item", false);
  });
  assert.equal(s.s.isDefault, false);

  act(() => s.s.reset());
  assert.equal(s.s.perkCount, 4);
  assert.equal(s.s.mode, "perks");
  assert.deepEqual(s.s.loadoutSlots, { item: true, addons: true, offering: true });
  assert.equal(s.s.guaranteeTeachables, false);
  assert.equal(s.s.pieceVisibility.item, true);
  assert.equal(s.s.isDefault, true);

  // Written, not cleared: coming back must find the defaults rather than the
  // settings from before the reset.
  assert.deepEqual(reopened().s.loadoutSlots, {
    item: true,
    addons: true,
    offering: true,
  });
  assert.equal(reopened().s.perkCount, 4);
  assert.equal(reopened().s.mode, "perks");
});

test("a fresh board is already at its defaults, so there is nothing to reset", () => {
  assert.equal(setup().s.isDefault, true);
});

test("isDefault notices each setting on its own", () => {
  for (const change of [
    (s: BoardSettings) => s.setPerkCount(3),
    (s: BoardSettings) => s.setMode("loadout"),
    (s: BoardSettings) => s.toggleLoadoutSlot("item"),
    (s: BoardSettings) => s.toggleGuaranteeTeachables(),
    (s: BoardSettings) => s.setPieceVisibility("offering", false),
  ]) {
    localStorage.clear();
    const s = setup();
    act(() => change(s.s));
    assert.equal(s.s.isDefault, false, `${change} should leave isDefault false`);
  }
});
