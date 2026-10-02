// The analytics seam.
//
// Two properties matter, and they pull in opposite directions, which is why
// both are asserted rather than assumed: nothing is sent until somebody
// installs a sink, and once one is installed it cannot take the page down with
// it.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setTrackSink, track, type TrackEvent } from "./track";

beforeEach(() => {
  setTrackSink(null);
});

test("a page with no sink installed sends nothing, and does not throw", () => {
  // The shipped state. If this ever fails, the site started talking to
  // somebody without the privacy notes in CLAUDE.md being revisited.
  assert.doesNotThrow(() => {
    track({ name: "role_chosen", role: "killer" });
    track({ name: "build_generated", source: "keyboard" });
  });
});

test("an installed sink receives the events, in order", () => {
  const seen: TrackEvent[] = [];
  setTrackSink((e) => seen.push(e));

  track({ name: "role_chosen", role: "survivor" });
  track({ name: "mode_chosen", mode: "loadout" });
  track({ name: "obs_link_copied" });

  assert.deepEqual(seen, [
    { name: "role_chosen", role: "survivor" },
    { name: "mode_chosen", mode: "loadout" },
    { name: "obs_link_copied" },
  ]);
});

test("a sink that throws does not reach the caller", () => {
  // A blocked script or an ad blocker must never stop a button working. This
  // is the whole reason track() has a try/catch rather than the call sites
  // each having one.
  setTrackSink(() => {
    throw new Error("blocked by an extension");
  });
  assert.doesNotThrow(() => track({ name: "battle_royale_toggled", active: true }));
});

test("uninstalling stops delivery", () => {
  let count = 0;
  setTrackSink(() => count++);
  track({ name: "obs_overlay_opened" });
  setTrackSink(null);
  track({ name: "obs_overlay_opened" });
  assert.equal(count, 1);
});

test("the payloads carry nothing that identifies anybody", () => {
  /* Guarded as a shape rather than left to review. Every event here is an
     enumeration — a role, a mode, a skin name, a boolean — and the things
     deliberately NOT in the list are the ones that look harmless and are not:
     a build is four perks out of 321 and is closer to a fingerprint than it
     looks, and a room code or channel name names a person outright. */
  const forbidden = ["perk", "perks", "slug", "seed", "room", "channel", "url", "build"];
  const samples: TrackEvent[] = [
    { name: "role_chosen", role: "survivor" },
    { name: "mode_chosen", mode: "all" },
    { name: "skin_chosen", skin: "minimal" },
    { name: "battle_royale_toggled", active: false },
    { name: "obs_link_copied" },
    { name: "obs_overlay_opened" },
    { name: "build_generated", source: "button" },
  ];
  for (const event of samples) {
    for (const key of Object.keys(event)) {
      assert.ok(
        !forbidden.includes(key),
        `${event.name} carries "${key}", which can identify a session`,
      );
    }
    // And no payload is a free-text field a caller could put anything into.
    for (const [key, value] of Object.entries(event)) {
      assert.ok(
        typeof value === "string" || typeof value === "boolean",
        `${event.name}.${key} should be a scalar, not a structure`,
      );
    }
  }
});
