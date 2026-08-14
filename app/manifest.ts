import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const basePath = process.env.NEXT_BASE_PATH || "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DBD Perk Randomizer",
    short_name: "DBD Perks",
    description:
      "Рандомайзер перков Dead by Daylight с актуальным списком прямо с официальной wiki",
    start_url: `${basePath}/`,
    scope: `${basePath}/`,
    display: "standalone",
    background_color: "#0b0c0f",
    theme_color: "#0b0c0f",
    icons: [
      {
        src: `${basePath}/icons/icon-192.png`,
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: `${basePath}/icons/icon-512.png`,
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
