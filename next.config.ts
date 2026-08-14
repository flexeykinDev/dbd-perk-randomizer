import type { NextConfig } from "next";

// Set NEXT_BASE_PATH in CI to the repo name (e.g. "/vortex-info") when
// deploying to GitHub Pages under a project subpath. Leave unset for local
// dev or a user/org page served from the domain root.
const basePath = process.env.NEXT_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  // next/image with `unoptimized: true` renders a plain <img> and does NOT
  // prepend basePath to runtime src strings (only its own optimized-loader
  // path does that). Perk icon paths come from data/perks.json at runtime,
  // so we expose the same basePath to client code to prefix them manually
  // — see components/dbd/perk-grid.tsx.
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
