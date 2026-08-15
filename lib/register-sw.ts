"use client";

import { withBasePath } from "./asset-path";

/** Registers public/sw.js for offline support (cached app shell + perk
 *  icons) and installability. Safe to call unconditionally — no-ops in
 *  unsupported browsers or non-secure contexts, and a failed registration
 *  (blocked by an extension, private-browsing quirk, etc.) is swallowed
 *  since offline support is a nice-to-have, not core functionality. */
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // Registration rejects outright on a plain http origin (service workers
  // require a secure context) — skip the attempt instead of logging a
  // rejection from every local network preview.
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;

  function register() {
    navigator.serviceWorker.register(withBasePath("/sw.js")).catch(() => {});
  }
  // This runs inside a React effect, which fires well after the page's own
  // `load` event on a client-rendered app — an addEventListener("load", ...)
  // here would almost always attach after that event already fired and
  // never run. Register immediately if the page is already loaded, and only
  // wait for the event on the rare chance it genuinely hasn't yet.
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
