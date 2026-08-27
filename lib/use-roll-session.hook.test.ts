// useRollSession, rendered.
//
// The verbs are the point. "Drop what is showing and roll again" was three
// statements repeated at nine call sites, and several deliberately did only
// PART of it — changing the perk count keeps a shared loadout, toggling a
// loadout slot keeps a shared build, a theme change touches perks only. That
// was real behaviour discoverable only by reading which lines each function
// happened to have, and it is exactly what these pin down.
//
// One of them, restoreShared, exists because the obvious version broke an
// all-mode share link: routing hydration through showPerks and
// showLoadoutPieces made them clear each other, so the link restored one half
// and silently re-rolled the other.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { useRollSession, type RollSession } from "./use-roll-session";
import { getPerksByRole } from "./perks";
import { getLoadoutPoolForRole } from "./loadout";
import type { BuildMode, LoadoutPiece, Perk, PerkRole } from "./types";

interface Options {
  mode?: BuildMode;
  role?: PerkRole;
  perkCount?: number;
  activeSeed?: string | null;
}

function setup({ mode = "all", role = "survivor", perkCount = 4, activeSeed = null }: Options = {}) {
  const view = renderHook(
    (p: Required<Options>) =>
      useRollSession({
        mounted: true,
        mode: p.mode,
        role: p.role,
        perkCount: p.perkCount,
        loadoutSlots: { item: true, addons: true, offering: true },
        activeSeed: p.activeSeed,
        poolExhausted: false,
        availableCount: getPerksByRole(p.role).length,
        excludedPerks: new Set(),
        excludedLoadout: new Set(),
        favoriteSlugs: new Set(),
        guaranteeTeachables: false,
        selectedCharacter: null,
        maxPerkCount: 4,
      }),
    { initialProps: { mode, role, perkCount, activeSeed }, wrapper: StrictMode },
  );
  return {
    get roll(): RollSession {
      return view.result.current;
    },
  };
}

const slugsOf = (perks: Perk[]) => perks.map((p) => p.slug).join(",");
const keysOf = (pieces: LoadoutPiece[]) => pieces.map((p) => `${p.kind}:${p.slug}`).join(",");

const somePerks = () => getPerksByRole("survivor").slice(0, 4);
const somePieces = () => getLoadoutPoolForRole("survivor").slice(0, 3);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test("a fresh session rolls a build of the requested size", () => {
  const s = setup({ mode: "perks", perkCount: 4 });
  assert.equal(s.roll.perks.length, 4);
  assert.equal(s.roll.sharedBuild, null, "a rolled build is not a shared one");
});

test("rerollAll produces a different build", () => {
  const s = setup({ mode: "perks" });
  const before = slugsOf(s.roll.perks);
  act(() => s.roll.rerollAll());
  assert.notEqual(slugsOf(s.roll.perks), before);
});

/* ---- the shared-build verbs, which is where the subtlety lives ---- */

test("showPerks installs a build and clears a shared loadout", () => {
  const s = setup();
  act(() => s.roll.showLoadoutPieces(somePieces()));
  assert.ok(s.roll.sharedLoadoutPieces);

  const build = somePerks();
  act(() => s.roll.showPerks(build));
  assert.equal(slugsOf(s.roll.perks), slugsOf(build));
  assert.equal(
    s.roll.sharedLoadoutPieces,
    null,
    "a share link or history entry describes one side, so the other is dropped",
  );
});

test("showPerksKeepingLoadout leaves a shared loadout alone", () => {
  /* Twitch !paste and the preset picker hand over perks only, and neither has
     ever disturbed a loadout already on screen. A separate verb rather than a
     flag, so the difference is visible where it is used. */
  const s = setup();
  const pieces = somePieces();
  act(() => s.roll.showLoadoutPieces(pieces));

  const build = somePerks();
  act(() => s.roll.showPerksKeepingLoadout(build));
  assert.equal(slugsOf(s.roll.perks), slugsOf(build));
  assert.equal(
    keysOf(s.roll.sharedLoadoutPieces ?? []),
    keysOf(pieces),
    "the loadout must survive a perks-only hand-over",
  );
});

test("restoreShared installs BOTH halves without them clearing each other", () => {
  /* The all-mode share link. This is the regression the obvious refactor
     introduced: showPerks then showLoadoutPieces cancel out, so the link
     restores one half and silently re-rolls the other. */
  const s = setup();
  const build = somePerks();
  const pieces = somePieces();

  act(() => s.roll.restoreShared({ perks: build, loadoutPieces: pieces }));

  assert.equal(slugsOf(s.roll.perks), slugsOf(build), "the perks half was lost");
  assert.equal(keysOf(s.roll.loadoutPieces), keysOf(pieces), "the loadout half was lost");
});

test("restoreShared applies only the half it was given", () => {
  const s = setup();
  act(() => s.roll.restoreShared({ perks: somePerks() }));
  assert.ok(s.roll.sharedBuild);
  assert.equal(s.roll.sharedLoadoutPieces, null, "an absent half is not an empty one");
});

/* ---- the partial rerolls ---- */

test("rerollPerks keeps a shared loadout", () => {
  // What changing the perk count, the theme, or the teachables toggle does.
  const s = setup();
  const pieces = somePieces();
  act(() => s.roll.restoreShared({ perks: somePerks(), loadoutPieces: pieces }));

  act(() => s.roll.rerollPerks());
  assert.equal(s.roll.sharedBuild, null, "the perks should be rolling again");
  assert.equal(keysOf(s.roll.sharedLoadoutPieces ?? []), keysOf(pieces));
});

test("rerollLoadout keeps a shared build", () => {
  // What toggling a loadout slot does.
  const s = setup();
  const build = somePerks();
  act(() => s.roll.restoreShared({ perks: build, loadoutPieces: somePieces() }));

  act(() => s.roll.rerollLoadout());
  assert.equal(s.roll.sharedLoadoutPieces, null);
  assert.equal(slugsOf(s.roll.sharedBuild ?? []), slugsOf(build));
});

test("rerollAll drops both halves", () => {
  const s = setup();
  act(() => s.roll.restoreShared({ perks: somePerks(), loadoutPieces: somePieces() }));
  act(() => s.roll.rerollAll());
  assert.equal(s.roll.sharedBuild, null);
  assert.equal(s.roll.sharedLoadoutPieces, null);
});

test("releaseShared drops both halves WITHOUT rolling", () => {
  const s = setup({ mode: "perks" });
  act(() => s.roll.showPerks(somePerks()));
  const shown = slugsOf(s.roll.perks);

  act(() => s.roll.releaseShared());
  assert.equal(s.roll.sharedBuild, null);
  assert.notEqual(
    slugsOf(s.roll.perks),
    shown,
    "the build should now be rolled rather than the one that was handed over",
  );
});

/* ---- pins ---- */

test("rerollAll does NOT clear pins", () => {
  /* Pins survive role, count and pool changes on purpose — usePerkSlots
     documents this and smoke.spec.ts covers it in the browser. Folding
     clearSlotOverrides into rerollAll looks right and would break it. */
  const s = setup({ mode: "perks" });
  const pinned = s.roll.perks[0].slug;
  act(() => s.roll.togglePin(0, pinned));
  assert.equal(s.roll.pinnedPerkSlots[0], pinned);

  act(() => s.roll.rerollAll());
  assert.equal(s.roll.pinnedPerkSlots[0], pinned, "the pin was cleared by a reroll");
  assert.equal(s.roll.perks[0].slug, pinned, "and the pinned slot must still show it");
});

test("clearSlotOverrides drops single-slot rerolls but NOT pins", () => {
  /* The two look alike and are opposites. A per-slot reroll was an
     adjustment to the build being replaced, so a whole-build roll supersedes
     it; a pin is a standing instruction about a slot and outlives the build
     entirely. I had this backwards in a comment before this test existed. */
  const s = setup({ mode: "perks" });
  const pinned = s.roll.perks[0].slug;
  act(() => s.roll.togglePin(0, pinned));

  act(() => s.roll.clearSlotOverrides());
  assert.equal(s.roll.pinnedPerkSlots[0], pinned, "the pin should have survived");
});

/* ---- seeds ---- */

test("a seeded build is identical for everyone, and ignores pins entirely", () => {
  const a = setup({ mode: "perks", activeSeed: "shared-seed" });
  const b = setup({ mode: "perks", activeSeed: "shared-seed" });
  assert.equal(slugsOf(a.roll.perks), slugsOf(b.roll.perks));

  /* fixedBuild passes the roll straight through, so a pin cannot move a
     seeded build even though the pin itself is still recorded — the board is
     what hides the padlocks. The rendered build is the thing that must not
     budge, or two people on the same seed would see different perks. */
  const before = slugsOf(a.roll.perks);
  act(() => a.roll.togglePin(1, a.roll.perks[0].slug));
  assert.equal(slugsOf(a.roll.perks), before, "a seeded build must not respond to a pin");
  assert.equal(slugsOf(a.roll.perks), slugsOf(b.roll.perks), "and must still match everyone else");
});

test("mode gates which halves are computed at all", () => {
  /* Every effect keyed off `perks` goes idle in loadout-only mode because
     `perks` is empty there, rather than each one needing its own mode check. */
  const perksOnly = setup({ mode: "perks" });
  assert.ok(perksOnly.roll.perks.length > 0);
  assert.equal(perksOnly.roll.loadoutPieces.length, 0);

  const loadoutOnly = setup({ mode: "loadout" });
  assert.equal(loadoutOnly.roll.perks.length, 0);
  assert.ok(loadoutOnly.roll.loadoutPieces.length > 0);
});
