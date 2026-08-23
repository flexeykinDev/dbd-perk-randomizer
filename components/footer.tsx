"use client";

import author from "@/data/author.json";
import { withBasePath } from "@/lib/asset-path";
import { useT } from "@/lib/i18n";
import { useIsObsMode } from "@/lib/use-obs-mode";

// Name and avatar are resolved at build time by scripts/sync-author.ts and
// shipped as data/author.json + public/author-avatar.webp, so the footer
// makes no network request of its own.
//
// It used to fetch api.github.com on every page load for exactly these two
// values. Unauthenticated, that endpoint allows 60 requests an hour per IP,
// so any machine that opens the site regularly gets 403 and falls back —
// and the fallback was already the right answer, because the account has no
// display name set and the code dropped through to the login either way.
// Four requests in the load path of every visit, for a name that had not
// changed and an avatar URL that was already known.
export function Footer() {
  const t = useT();
  const isObsMode = useIsObsMode();

  if (isObsMode) return null;

  return (
    <footer className="mt-auto border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-3 text-sm text-muted sm:flex-row sm:justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- unoptimized static export */}
        <img
          src={withBasePath("/author-avatar.webp")}
          alt={t({ ru: "Аватар автора", en: "Author avatar" })}
          width={36}
          height={36}
          className="size-9 rounded-full object-cover"
        />
        <a
          href={`https://github.com/${author.login}`}
          target="_blank"
          rel="noreferrer"
          className="tap flex items-center font-medium text-foreground transition-colors hover:text-accent"
        >
          {t({ ru: "Автор сайта:", en: "Site by:" })} {author.name}
        </a>
      </div>
    </footer>
  );
}
