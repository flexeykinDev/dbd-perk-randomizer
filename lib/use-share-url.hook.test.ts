// useShareUrl, rendered.
//
// The format itself is covered in share-link.test.ts; what is left here is the
// only thing the hook adds, which is *when* it fires. Two rules matter:
// nothing is written before mount, because the shared build has not been
// applied yet and the link would describe the default one instead; and an
// unrelated re-render must not rewrite the address bar, which is what pinning
// the dependency list to the fields rather than the object they arrive in
// buys.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { useShareUrl } from "./use-share-url";
import { getPerksByRole } from "./perks";
import type { ShareLinkState } from "./share-link";

const perks = getPerksByRole("survivor").slice(0, 4);
const otherPerks = getPerksByRole("survivor").slice(4, 8);

const base: ShareLinkState & { mounted: boolean } = {
  mounted: true,
  role: "survivor",
  mode: "perks",
  coherence: 0,
  seed: null,
  perks: [],
  loadoutPieces: [],
  squad: null,
};

let written: string[] = [];
const realReplaceState = window.history.replaceState;

beforeEach(() => {
  written = [];
  window.history.replaceState = (_data, _unused, url) => {
    written.push(String(url));
  };
});

afterEach(() => {
  window.history.replaceState = realReplaceState;
});

/** StrictMode double-invokes effects in development, so every write lands
 *  twice here. The count that matters is how many *distinct* rewrites a
 *  render caused, which is what this collapses to. */
const rewrites = () => [...new Set(written)].length;

test("nothing is written until the board has mounted", () => {
  renderHook(() => useShareUrl({ ...base, mounted: false, perks }), {
    wrapper: StrictMode,
  });
  assert.equal(written.length, 0);
});

test("the build on screen reaches the address bar", () => {
  renderHook(() => useShareUrl({ ...base, perks }), { wrapper: StrictMode });
  assert.ok(written.length > 0, "a mounted board writes its link");
  // URLSearchParams escapes the separator, so the ids arrive as %2C — which
  // is what this site has always written, and what the reader splits on after
  // the browser decodes it.
  assert.match(written[0], /\?r=s&p=\d+(%2C\d+)*$/);
});

test("a new build rewrites the link", () => {
  const view = renderHook((props: ShareLinkState & { mounted: boolean }) => useShareUrl(props), {
    wrapper: StrictMode,
    initialProps: { ...base, perks },
  });
  const first = rewrites();
  view.rerender({ ...base, perks: otherPerks });
  assert.ok(rewrites() > first, "rolling again should update the link");
});

test("a re-render that changes nothing leaves the address bar alone", () => {
  const view = renderHook((props: ShareLinkState & { mounted: boolean }) => useShareUrl(props), {
    wrapper: StrictMode,
    initialProps: { ...base, perks },
  });
  const after = rewrites();
  // A fresh object carrying identical fields — exactly what a caller writing
  // the argument inline hands over on every render of the board.
  view.rerender({ ...base, perks });
  assert.equal(rewrites(), after, "the object's identity must not be the trigger");
});

test("the role alone is enough to write a link", () => {
  renderHook(() => useShareUrl({ ...base, role: "killer" }), {
    wrapper: StrictMode,
  });
  assert.match(written[0], /\?r=k$/);
});
