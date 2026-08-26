"use client";

import { useEffect } from "react";

/* Last resort: this replaces the root layout, so nothing from it survives —
 * no LanguageProvider (hence both languages spelled out rather than a `t`
 * call), no Nav, and critically no globals.css, since that is imported by the
 * layout this is standing in for. Everything here is therefore self-contained:
 * the styles ride in a <style> tag so the page still has a theme, and the
 * markup includes <html> and <body> because at this level React is rendering
 * the whole document.
 *
 * Reaching this means app/error.tsx could not handle it — a fault in the
 * layout itself. Rare, and exactly the case that used to produce a white
 * page. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[root] rendering failed:", error);
  }, [error]);

  return (
    <html lang="ru">
      <body>
        <style>{`
          :root { --bg: #fbfbfb; --fg: #121212; --muted: #6b6b6b; --line: #e3e3e3; }
          @media (prefers-color-scheme: dark) {
            :root { --bg: #121212; --fg: #f2f2f2; --muted: #9a9a9a; --line: #2c2c2c; }
          }
          html, body { margin: 0; height: 100%; }
          body {
            background: var(--bg); color: var(--fg);
            font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
            display: flex; align-items: center; justify-content: center;
            padding: 1.5rem; text-align: center;
          }
          .wrap { display: flex; flex-direction: column; gap: .875rem; max-width: 26rem; }
          h1 { margin: 0; font-size: 1.25rem; font-weight: 600; }
          p { margin: 0; font-size: .875rem; color: var(--muted); line-height: 1.5; }
          button {
            cursor: pointer; align-self: center;
            border: 1px solid var(--line); border-radius: 999px;
            background: transparent; color: var(--fg);
            padding: .5rem 1.25rem; font: inherit; font-size: .875rem;
          }
          button:hover { border-color: var(--muted); }
          code { font-size: .75rem; color: var(--muted); opacity: .7; }
        `}</style>
        <div className="wrap" role="alert">
          <h1>Что-то сломалось</h1>
          <p>
            Приложение не запустилось. Попробуйте перезагрузить страницу.
            <br />
            The app failed to start. Try reloading the page.
          </p>
          <button type="button" onClick={reset}>
            Перезагрузить / Reload
          </button>
          {error.digest && <code>{error.digest}</code>}
        </div>
      </body>
    </html>
  );
}
