// A DOM for the hook tests, installed before anything imports React.
//
// Loaded via `tsx --test --import ./lib/test-dom.ts`. It has to be a preload
// rather than setup inside a test file: ESM imports are hoisted, so
// `import { render } from "@testing-library/react"` at the top of a spec runs
// before any statement in that file's body — React would see no document and
// react-dom would fail on load.
//
// The pure-logic tests do not need any of this and do not care that it is
// here; one jsdom instance costs a few hundred milliseconds for the whole run.
import { JSDOM } from "jsdom";

/* pretendToBeVisual is deliberately OFF. It gives jsdom a real
 * requestAnimationFrame, but that is a 60fps loop that never stops — it holds
 * the event loop open and the test process simply never exits. Cost me a
 * hung run to find. rAF is shimmed below instead, on an unref'd timer that
 * cannot keep the process alive. */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://localhost/",
});

/* defineProperty rather than assignment. Node 24 defines some of these on
 * the global itself as getter-only accessors (navigator is the one that
 * bites), and a plain `globalThis.navigator = …` throws outright. */
function define(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
  });
}

define("window", dom.window);
define("document", dom.window.document);
define("navigator", dom.window.navigator);
define("location", dom.window.location);
define("HTMLElement", dom.window.HTMLElement);
define("HTMLCanvasElement", dom.window.HTMLCanvasElement);
define("Element", dom.window.Element);
define("Node", dom.window.Node);
define("Event", dom.window.Event);
define("CustomEvent", dom.window.CustomEvent);
define("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
const raf = (cb: FrameRequestCallback) => {
  const handle = setTimeout(() => cb(Date.now()), 0);
  // Node keeps running while a timer is pending; unref lets the process exit
  // with a frame still queued, which is exactly what happens at teardown.
  handle.unref?.();
  return handle as unknown as number;
};
const caf = (handle: number) => clearTimeout(handle as unknown as NodeJS.Timeout);
define("requestAnimationFrame", raf);
define("cancelAnimationFrame", caf);
Object.defineProperty(dom.window, "requestAnimationFrame", { value: raf, writable: true });
Object.defineProperty(dom.window, "cancelAnimationFrame", { value: caf, writable: true });
define("Storage", dom.window.Storage);
define("localStorage", dom.window.localStorage);
define("sessionStorage", dom.window.sessionStorage);

/* React reads this to decide whether it is running under a test renderer, and
 * without it every act() call warns. Set on the real global rather than on
 * `window`, which is where React looks. */
define("IS_REACT_ACT_ENVIRONMENT", true);

/* Storage is the one capability these tests genuinely depend on, and
 * lib/safe-storage.ts swallows every failure by design — so a jsdom without
 * working storage would make every persistence assertion pass while testing
 * nothing. Checked once, loudly, rather than trusted. */
{
  const probe = "__storage_probe__";
  dom.window.localStorage.setItem(probe, "1");
  if (dom.window.localStorage.getItem(probe) !== "1") {
    throw new Error("jsdom localStorage is not working — persistence tests would pass vacuously");
  }
  dom.window.localStorage.removeItem(probe);
}

/* The one thing jsdom does not implement that this code reaches for. Returns
 * "no preference" for every query: the presentation and motion code reads it,
 * and a test that cares should stub it itself rather than inherit an opinion
 * from here. */
if (!dom.window.matchMedia) {
  Object.defineProperty(dom.window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
