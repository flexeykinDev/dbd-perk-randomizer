import type { Metadata } from "next";
import { RandomizerContent } from "./randomizer-content";

// No `title` here — RandomizerBoard renders <title> itself so the tab can
// reflect the selected role/build size, and Next.js would otherwise render
// its own <title> alongside that one rather than being overridden by it
// (the browser then uses whichever comes first in the DOM, which isn't ours).
export const metadata: Metadata = {
  description:
    "Рандомайзер перков Dead by Daylight с актуальным списком прямо с официальной wiki — без хардкода и без устаревших перков.",
};

export default function Home() {
  return <RandomizerContent />;
}
