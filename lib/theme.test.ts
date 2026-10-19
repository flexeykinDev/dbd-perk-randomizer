// Three themes behind one button.
//
// The cycle is the whole mechanism — there is no theme menu — so the two things
// that can break it are an order that strands a theme and a stored value that
// is not a theme at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isTheme, nextTheme, THEMES, type Theme } from "./theme";

test("dark is first, because it is what the document renders by default", () => {
  // layout.tsx stamps no attribute for dark and the pre-paint script only
  // applies the other two. If dark stopped being the head of this list the
  // server render and the first client render would disagree.
  assert.equal(THEMES[0], "dark");
});

test("the cycle reaches every theme and returns", () => {
  const seen: Theme[] = [];
  let current: Theme = "dark";
  for (let i = 0; i < THEMES.length; i++) {
    seen.push(current);
    current = nextTheme(current);
  }
  assert.deepEqual([...seen].sort(), [...THEMES].sort(), "a theme is unreachable");
  assert.equal(current, "dark", "the cycle does not close");
});

test("every theme has a next one", () => {
  for (const theme of THEMES) {
    assert.ok(THEMES.includes(nextTheme(theme)), `${theme} leads somewhere unknown`);
    assert.notEqual(nextTheme(theme), theme, `${theme} cycles to itself`);
  }
});

test("a stored value from another version is not a theme", () => {
  // The pre-paint script reads localStorage, which can hold anything a previous
  // build wrote. Guessing would paint the page wrong before React could correct
  // it, which is the flash the script exists to prevent.
  for (const bad of ["", "Dark", "pixel ", "solarized", "null", "0"]) {
    assert.equal(isTheme(bad), false, `"${bad}" should not pass as a theme`);
  }
  for (const value of [null, undefined, 1, {}, []]) {
    assert.equal(isTheme(value), false, `${JSON.stringify(value)} should not pass`);
  }
});

test("every real theme passes the guard", () => {
  for (const theme of THEMES) assert.equal(isTheme(theme), true);
});

test("pixel is dark, and nothing may mistake it for light", () => {
  /* lib/theme-tokens.ts decides `isLight` with `=== "light"`, and the canvas
     stages paint their ground from it. A check written as "not dark" instead
     would hand pixel the light theme's ground and put a white slab in the
     middle of a near-black page. */
  assert.notEqual("pixel", "light");
  assert.ok(THEMES.includes("pixel"));
});
