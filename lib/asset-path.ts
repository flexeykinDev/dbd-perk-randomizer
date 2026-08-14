// next/image with `unoptimized: true` (required for static export) renders a
// plain <img> and does not prepend Next's `basePath` to runtime src strings —
// only its own optimized-loader path does that. Anything sourced from JSON
// data at runtime (e.g. perk icons) needs this applied manually.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
