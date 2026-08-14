import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

// True only after hydration. Used to defer randomized content (which would
// otherwise differ between the server-rendered HTML and the client's first
// render, causing a hydration mismatch) until it's safe to compute.
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
