// The rules that decide how a generated PNG reaches the visitor.
//
// Worth testing rather than eyeballing, because the failure this replaces
// was invisible: on an iPhone the download did nothing and the UI still said
// it had worked. Everything here is the decision, not the pixels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShare, type ShareCapableNavigator } from "./save-image";

const file = new File([new Uint8Array([1, 2, 3])], "build.png", { type: "image/png" });

const canShareEverything: ShareCapableNavigator = {
  canShare: () => true,
  share: async () => {},
};

test("a phone that can share files gets the share sheet", () => {
  // On iOS this is the only path that reliably puts the image in Photos.
  assert.equal(shouldShare(file, canShareEverything, true), true);
});

test("a desktop is never diverted into a share sheet", () => {
  // Desktop Chrome on Windows reports canShare({files}) as true. Swapping a
  // working one-click download for a share dialog would be a downgrade for
  // exactly the people the feature already worked for.
  assert.equal(shouldShare(file, canShareEverything, false), false);
});

test("a phone with no share support falls back to downloading", () => {
  assert.equal(shouldShare(file, {}, true), false);
  assert.equal(shouldShare(file, { canShare: () => true }, true), false);
});

test("a browser that shares links but not files is not offered the sheet", () => {
  // canShare has to be asked about the actual file: support for sharing
  // text says nothing about support for sharing a PNG.
  const linksOnly: ShareCapableNavigator = {
    canShare: (data) => !data.files,
    share: async () => {},
  };
  assert.equal(shouldShare(file, linksOnly, true), false);
});

test("canShare is asked about the file being saved, not about nothing", () => {
  const asked: Array<{ files?: File[] }> = [];
  const nav: ShareCapableNavigator = {
    canShare: (data) => {
      asked.push(data);
      return true;
    },
    share: async () => {},
  };
  shouldShare(file, nav, true);
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].files, [file]);
});

test("a canShare that answers anything but true is treated as no", () => {
  // Some browsers expose canShare returning undefined rather than a boolean.
  const vague = { canShare: () => undefined, share: async () => {} } as unknown as ShareCapableNavigator;
  assert.equal(shouldShare(file, vague, true), false);
});
