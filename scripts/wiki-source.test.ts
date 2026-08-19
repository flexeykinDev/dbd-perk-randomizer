// URL handling for wiki images, tested because getting it wrong is
// expensive in an unusually quiet way: every icon is fetched by a scraper
// that would simply store fewer files, and the site would render 1478
// broken images with nothing having thrown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { preferFullSize, resolveImageUrl, WIKI_GG, FANDOM } from "./wiki-source";

const ORIGIN = WIKI_GG.origin;

test("a thumbnail URL is redirected to the file it is a thumbnail of", () => {
  assert.equal(
    preferFullSize(
      "https://deadbydaylight.wiki.gg/images/thumb/IconPerks_adrenaline.png/96px-IconPerks_adrenaline.png",
    ),
    "https://deadbydaylight.wiki.gg/images/IconPerks_adrenaline.png",
  );
});

test("the cache-busting query is carried across", () => {
  // Dropping it would be harmless for correctness and would quietly defeat
  // the wiki's own cache invalidation.
  assert.equal(
    preferFullSize(
      "https://deadbydaylight.wiki.gg/images/thumb/IconPerks_adrenaline.png/96px-IconPerks_adrenaline.png?528a2e",
    ),
    "https://deadbydaylight.wiki.gg/images/IconPerks_adrenaline.png?528a2e",
  );
});

test("a URL that is already the original is left exactly as it is", () => {
  const original = "https://deadbydaylight.wiki.gg/images/IconPerks_adrenaline.png";
  assert.equal(preferFullSize(original), original);
});

test("a file whose name contains digits and px is not mangled", () => {
  // The pattern has to match the *thumb size* segment, not any digits in
  // the filename — "K26_TheArtist" and "96px" both look like candidates to
  // a careless regex.
  const url =
    "https://deadbydaylight.wiki.gg/images/thumb/K26_TheArtist_Portrait.png/128px-K26_TheArtist_Portrait.png";
  assert.equal(
    preferFullSize(url),
    "https://deadbydaylight.wiki.gg/images/K26_TheArtist_Portrait.png",
  );
});

test("a nested thumb path keeps its directories", () => {
  assert.equal(
    preferFullSize("https://example.org/images/thumb/a/ab/Icon.png/96px-Icon.png"),
    "https://example.org/images/a/ab/Icon.png",
  );
});

test("Fandom's own thumb scheme is deliberately left alone", () => {
  // A different layout entirely, and not the live source. Rewriting it
  // half-understood would be worse than not touching it.
  const fandom =
    "https://static.wikia.nocookie.net/deadbydaylight_gamepedia_en/images/Icon.png/scale-to-width-down/96";
  assert.equal(preferFullSize(fandom), fandom);
});

test("resolveImageUrl still absolutises, strips revisions, and now un-thumbs", () => {
  // Root-relative, the wiki.gg case.
  assert.equal(
    resolveImageUrl("/images/thumb/IconPerks_ironWill.png/96px-IconPerks_ironWill.png", ORIGIN),
    `${ORIGIN}/images/IconPerks_ironWill.png`,
  );
  // Protocol-relative.
  assert.equal(
    resolveImageUrl("//example.org/images/Icon.png", ORIGIN),
    "https://example.org/images/Icon.png",
  );
  // Fandom's /revision/ cache-buster segment is still cut off.
  assert.equal(
    resolveImageUrl(`${FANDOM.origin}/images/Icon.png/revision/latest?cb=123`, FANDOM.origin),
    `${FANDOM.origin}/images/Icon.png`,
  );
  // Nothing in, nothing out.
  assert.equal(resolveImageUrl(undefined, ORIGIN), "");
});
