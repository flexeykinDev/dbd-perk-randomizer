import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const basePath = process.env.NEXT_BASE_PATH || "";
const baseUrl = `https://flexeykindev.github.io${basePath}`;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
