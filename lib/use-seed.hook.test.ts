// useSeed, rendered.
//
// The pure part (seedModeForLink) is covered in hooks.test.ts. This is the
// part that needed a renderer: the state machine, and specifically WHICH
// onChange each verb fires. Getting that wrong is silent — a seed that
// changes without dropping the shared build shows the wrong build, and a
// clear that forgets to reroll leaves the seed's build sitting there
// unpinned, looking like the button did nothing.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { useSeed, type SeedController } from "./use-seed";
import { dailyChallengeSeed } from "./seeded-random";
import type { PerkRole } from "./types";

/** Renders the hook and records every onChange it fires. */
function setup(role: PerkRole = "survivor") {
  const changes: Array<{ reroll: boolean }> = [];
  /* StrictMode, because that is how the app runs — Next enables it by
     default and this project does not turn it off. It double-invokes render
     and setState updaters to surface impurity, so a hook that passes here is
     a hook that behaves in development. */
  const view = renderHook(
    ({ r }: { r: PerkRole }) =>
      useSeed({ role: r, onChange: (opts) => void changes.push(opts) }),
    { initialProps: { r: role }, wrapper: StrictMode },
  );
  return {
    changes,
    get seed(): SeedController {
      return view.result.current;
    },
    setRole: (r: PerkRole) => act(() => view.rerender({ r })),
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test("nothing is pinned until something pins it", () => {
  const s = setup();
  assert.equal(s.seed.mode, "none");
  assert.equal(s.seed.active, null);
  assert.deepEqual(s.changes, []);
});

test("an empty or whitespace input is not a seed", () => {
  const s = setup();
  act(() => s.seed.setInput("   "));
  act(() => s.seed.applyCustom());
  assert.equal(s.seed.mode, "none", "whitespace must not become a seed");
  assert.deepEqual(s.changes, [], "and must not disturb the build");
});

test("a typed seed is trimmed and takes hold without rerolling", () => {
  const s = setup();
  act(() => s.seed.setInput("  phase-two  "));
  act(() => s.seed.applyCustom());

  assert.equal(s.seed.mode, "custom");
  assert.equal(s.seed.active, "phase-two", "the stored seed is trimmed");
  // reroll:false — the build comes FROM the seed, so re-rolling would
  // immediately discard what the seed just decided.
  assert.deepEqual(s.changes, [{ reroll: false }]);
});

test("the Daily Challenge derives its seed from the CURRENT role", () => {
  /* Derived on read rather than stored. A stored copy would keep saying
     "-survivor" after a role switch while the board rolled killer perks —
     the seed line and the build would disagree with nothing to explain it. */
  const s = setup("survivor");
  act(() => s.seed.toggleDaily());
  assert.equal(s.seed.active, dailyChallengeSeed("survivor"));

  s.setRole("killer");
  assert.equal(s.seed.active, dailyChallengeSeed("killer"));
  assert.equal(s.seed.mode, "daily", "switching role does not leave the mode");
});

test("toggling the Daily Challenge off rerolls, unlike turning it on", () => {
  const s = setup();
  act(() => s.seed.toggleDaily());
  assert.deepEqual(s.changes, [{ reroll: false }], "on: the seed decides the build");

  act(() => s.seed.toggleDaily());
  assert.equal(s.seed.mode, "none");
  assert.equal(s.seed.active, null);
  assert.deepEqual(
    s.changes,
    [{ reroll: false }, { reroll: true }],
    "off: there is no seed left, so something has to be rolled",
  );
});

test("clear drops the seed, the input, and rerolls", () => {
  const s = setup();
  act(() => s.seed.setInput("gone"));
  act(() => s.seed.applyCustom());
  act(() => s.seed.clear());

  assert.equal(s.seed.mode, "none");
  assert.equal(s.seed.active, null);
  assert.equal(s.seed.input, "", "the box is emptied, not left showing a dead seed");
  assert.deepEqual(s.changes.at(-1), { reroll: true });
});

test("release drops the seed WITHOUT rerolling or notifying", () => {
  /* For a caller that is about to install a build of its own — the preset
     picker. A reroll here would throw away the preset it is installing, and
     that is exactly the bug `release` exists to avoid. */
  const s = setup();
  act(() => s.seed.setInput("preset-incoming"));
  act(() => s.seed.applyCustom());
  const before = s.changes.length;

  act(() => s.seed.release());
  assert.equal(s.seed.mode, "none");
  assert.equal(s.changes.length, before, "release must not fire onChange at all");
});

test("a daily link restores as the Daily Challenge, a typed one as custom", () => {
  const s = setup("survivor");
  act(() => s.seed.hydrateFromUrl(dailyChallengeSeed("survivor"), "survivor"));
  assert.equal(s.seed.mode, "daily");
  assert.equal(s.seed.input, dailyChallengeSeed("survivor"));

  const other = setup("survivor");
  act(() => other.seed.hydrateFromUrl("someones-seed", "survivor"));
  assert.equal(other.seed.mode, "custom");
  assert.equal(other.seed.active, "someones-seed");
});

test("hydrating from a link does not fire onChange", () => {
  // It runs inside the mount effect. Notifying there would drop the shared
  // build the very same link is trying to restore.
  const s = setup();
  act(() => s.seed.hydrateFromUrl("from-a-link", "survivor"));
  assert.deepEqual(s.changes, []);
});
