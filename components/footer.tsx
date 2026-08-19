"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { useIsObsMode } from "@/lib/use-obs-mode";

const GITHUB_USERNAME = "flexeykinDev";
// Shown until the profile fetch resolves, and permanently whenever it
// can't — an unauthenticated api.github.com call is rate-limited per IP and
// is exactly the sort of request an ad-blocker drops. So the fallback has
// to be a name that is correct on its own, not a placeholder: it used to be
// an old handle, which is what most visitors actually saw.
const FALLBACK_NAME = GITHUB_USERNAME;

interface GitHubAuthor {
  name: string;
  avatarUrl: string;
}

export function Footer() {
  const t = useT();
  const isObsMode = useIsObsMode();
  const [author, setAuthor] = useState<GitHubAuthor>({
    name: FALLBACK_NAME,
    avatarUrl: `https://github.com/${GITHUB_USERNAME}.png`,
  });

  useEffect(() => {
    if (isObsMode) return;
    let cancelled = false;

    fetch(`https://api.github.com/users/${GITHUB_USERNAME}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { name?: string; login?: string; avatar_url?: string } | null) => {
        if (cancelled || !data) return;
        setAuthor({
          name: data.name || data.login || FALLBACK_NAME,
          avatarUrl: data.avatar_url ?? `https://github.com/${GITHUB_USERNAME}.png`,
        });
      })
      .catch(() => {
        // Keep the fallback — no GitHub access, no big deal.
      });

    return () => {
      cancelled = true;
    };
  }, [isObsMode]);

  if (isObsMode) return null;

  return (
    <footer className="mt-auto border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-3 text-sm text-muted sm:flex-row sm:justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- external GitHub avatar, unoptimized static export */}
        <img
          src={author.avatarUrl}
          alt={t({ ru: "Аватар автора", en: "Author avatar" })}
          width={36}
          height={36}
          className="size-9 rounded-full object-cover"
        />
        <a
          href={`https://github.com/${GITHUB_USERNAME}`}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground transition-colors hover:text-accent"
        >
          {t({ ru: "Автор сайта:", en: "Site by:" })} {author.name}
        </a>
      </div>
    </footer>
  );
}
