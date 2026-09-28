// The overlay's URL, read back.
//
// Every option a streamer sets lives in the link pasted into an OBS Browser
// Source, and that link then sits there for months. Nothing re-validates it,
// nothing reports when a value is not understood, and the overlay renders
// whatever it made of it — so a parser that quietly picked a different
// background would show up as "my overlay looks wrong" weeks later, with no
// way to tell when it changed.
//
// The README makes one promise about this in writing: "An old link with none
// of these keeps looking exactly as it did." That is the last test here.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { renderHook } from "@testing-library/react";
import {
  DEFAULT_OBS_OPTIONS,
  OBS_ENTRANCES,
  useObsOverlayOptions,
  type ObsOverlayOptions,
} from "./use-obs-mode";

/** Points jsdom's location at a query string, then reads the options an
 *  overlay opened on that link would have. */
function optionsFor(search: string): ObsOverlayOptions {
  window.history.replaceState({}, "", `/${search}#/obs`);
  return renderHook(() => useObsOverlayOptions()).result.current;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});

test("a link with none of the parameters is exactly the default overlay", () => {
  /* The README's promise, as a test. Someone's link from before backgrounds,
   * frames and entrances existed carries none of these, and must keep
   * looking the way it did the day they pasted it in. */
  assert.deepEqual(optionsFor(""), DEFAULT_OBS_OPTIONS);
  assert.deepEqual(optionsFor("?room=ABCD2345"), DEFAULT_OBS_OPTIONS);
});

test("every background parses", () => {
  for (const bg of ["transparent", "dark", "vortex", "slots"] as const) {
    assert.equal(optionsFor(`?bg=${bg}`).background, bg);
  }
});

test("every frame parses", () => {
  for (const frame of ["plain", "ritual", "slots"] as const) {
    assert.equal(optionsFor(`?frame=${frame}`).frame, frame);
  }
});

test("both motion settings parse", () => {
  assert.equal(optionsFor("?fx=live").motion, "live");
  assert.equal(optionsFor("?fx=still").motion, "still");
});

test("every entrance parses", () => {
  // Read from the exported list rather than a copy, so an entrance added
  // later is covered without anyone remembering to add it here.
  for (const anim of OBS_ENTRANCES) {
    assert.equal(optionsFor(`?anim=${anim}`).entrance, anim);
  }
});

test("the four combine without interfering", () => {
  const options = optionsFor("?bg=vortex&frame=slots&fx=still&anim=spin");
  assert.equal(options.background, "vortex");
  assert.equal(options.frame, "slots");
  assert.equal(options.motion, "still");
  assert.equal(options.entrance, "spin");
});

test("an unknown value falls back to the default instead of rendering nothing", () => {
  /* A typo, a truncated link, or a value from a newer build than the one in
   * OBS. Any of them must leave the overlay looking like the default, not
   * blank and not thrown. */
  assert.equal(optionsFor("?bg=rainbow").background, DEFAULT_OBS_OPTIONS.background);
  assert.equal(optionsFor("?frame=gilded").frame, DEFAULT_OBS_OPTIONS.frame);
  assert.equal(optionsFor("?fx=sideways").motion, DEFAULT_OBS_OPTIONS.motion);
  assert.equal(optionsFor("?anim=cartwheel").entrance, DEFAULT_OBS_OPTIONS.entrance);
});

test("an empty or malformed value is not a value", () => {
  for (const search of [
    "?bg=&frame=&fx=&anim=",
    "?bg&frame&fx&anim",
    "?bg=%00&frame=%20&fx=null&anim=undefined",
    "?BG=vortex",
  ]) {
    const options = optionsFor(search);
    assert.equal(options.background, DEFAULT_OBS_OPTIONS.background, search);
    assert.equal(options.frame, DEFAULT_OBS_OPTIONS.frame, search);
    assert.equal(options.motion, DEFAULT_OBS_OPTIONS.motion, search);
    assert.equal(options.entrance, DEFAULT_OBS_OPTIONS.entrance, search);
  }
});

test("per-slot positions parse, and are read as percentages", () => {
  // Flat pairs: x1,y1,x2,y2… one pair per slot.
  const options = optionsFor("?pos=10.5,20,30,40,50,60,70,80");
  assert.ok(options.positions, "positions should be present when pos= is");
  assert.equal(options.positions?.length, 4);
  assert.deepEqual(options.positions?.[0], { x: 10.5, y: 20 });
  assert.deepEqual(options.positions?.[3], { x: 70, y: 80 });
});

test("a position outside the canvas is clamped, not honoured", () => {
  /* These are percentages of the overlay viewport. A hand-edited link
   * asking for 400% would put a card somewhere OBS will never draw, and the
   * streamer would see three icons and an empty space. */
  const options = optionsFor("?pos=-50,400,150,-10");
  assert.deepEqual(options.positions?.[0], { x: 0, y: 100 });
  assert.deepEqual(options.positions?.[1], { x: 100, y: 0 });
});

test("no pos= means the default centred row, not an empty layout", () => {
  /* `null` is the documented "no override" value. An empty array would be a
   * layout with no slots in it, which is a blank overlay. */
  assert.equal(optionsFor("").positions, null);
  assert.equal(optionsFor("?bg=dark").positions, null);
});

test("a malformed pos= is ignored rather than placing icons off screen", () => {
  for (const search of [
    "?pos=",
    "?pos=nonsense",
    "?pos=10",
    "?pos=10,",
    "?pos=,20",
    "?pos=abc,def",
    "?pos=10,20,30",
  ]) {
    const positions = optionsFor(search).positions;
    // Either nothing, or only entries that are real numbers — never NaN,
    // which would put a card at `left: NaN%` and vanish it.
    if (positions) {
      for (const p of positions) {
        assert.ok(Number.isFinite(p.x), `${search} produced x=${p.x}`);
        assert.ok(Number.isFinite(p.y), `${search} produced y=${p.y}`);
      }
    }
  }
});

test("names and character badges are explicit opt-outs, not silent ones", () => {
  // `names=0` turns them off; the absence of the parameter keeps today's
  // default, which is what an old link relies on.
  assert.equal(optionsFor("?names=0").showNames, false);
  assert.equal(optionsFor("?names=1").showNames, true);
  assert.equal(optionsFor("").showNames, DEFAULT_OBS_OPTIONS.showNames);
  assert.equal(optionsFor("?char=0").showCharacter, false);
  assert.equal(optionsFor("").showCharacter, DEFAULT_OBS_OPTIONS.showCharacter);
});

test("scale is clamped rather than trusted", () => {
  // A hand-edited link should not be able to render a 10,000% icon.
  const huge = optionsFor("?scale=99999").scale;
  const tiny = optionsFor("?scale=-500").scale;
  assert.ok(huge <= 200, `scale ${huge} was not clamped`);
  assert.ok(tiny >= 50, `scale ${tiny} was not clamped`);
  assert.equal(optionsFor("?scale=abc").scale, DEFAULT_OBS_OPTIONS.scale);
});
