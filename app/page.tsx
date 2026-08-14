import type { Metadata } from "next";
import { RandomizerContent } from "./randomizer-content";

export const metadata: Metadata = {
  title: "DBD Perk Randomizer",
  description:
    "Рандомайзер перков Dead by Daylight с актуальным списком прямо с официальной wiki — без хардкода и без устаревших перков.",
};

export default function Home() {
  return <RandomizerContent />;
}
