import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { oswald, plexMono } from "@/lib/export-fonts";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { LanguageProvider } from "@/lib/i18n";
import { MotionProvider } from "@/components/motion-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const basePath = process.env.NEXT_BASE_PATH || "";

const SITE_TITLE = "DBD Perk Randomizer";
const SITE_DESCRIPTION =
  "Рандомайзер перков Dead by Daylight с актуальным списком прямо с официальной wiki — обновляется автоматически после каждого патча, без устаревших перков.";

export const metadata: Metadata = {
  metadataBase: new URL(`https://flexeykindev.github.io${basePath}/`),
  // No top-level `title` — see the comment in app/page.tsx for why.
  // openGraph.title/twitter.title below are set explicitly rather than
  // inheriting from it, so social-card previews are unaffected.
  description: SITE_DESCRIPTION,
  // og:image itself comes from app/opengraph-image.tsx — Next's file
  // convention picks that up automatically and generates the right
  // <meta property="og:image"> pointing at it, no manual `images` needed
  // here (and declaring one explicitly risks fighting the auto-generated
  // one rather than complementing it).
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: SITE_TITLE,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#121212",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      // Oswald and IBM Plex Mono are used only by the off-screen export card,
      // but their @font-face rules have to exist in the document for the
      // browser to load them at all — so the variables ride here with the
      // site's own faces. See lib/export-fonts.ts.
      className={`${geistSans.variable} ${geistMono.variable} ${oswald.variable} ${plexMono.variable} h-full antialiased`}
      // data-theme is set by the inline script in <head> below, outside
      // React's render — without this, React "fixes" the attribute away
      // (since its own JSX never sets it) on the next re-render, e.g. a
      // client-side navigation, silently reverting the theme.
      suppressHydrationWarning
    >
      <head>
        {/* Sets the theme before first paint so there's no dark->light flash.
            A raw <script> (not next/script) is required here — beforeInteractive
            only supports external `src` scripts, and next/script's inline
            variant renders as a real <script> element that React 19 warns
            about ("Encountered a script tag while rendering React component")
            and can hydration-mismatch on. The type toggle is the documented
            workaround: the server emits a real script (type="text/javascript")
            that the browser executes while parsing, while the client's own
            render of this element is inert (type="text/plain") so React never
            sees a live <script> node during hydration.
            See https://nextjs.org/docs/app/guides/preventing-flash-before-hydration */}
        <script
          type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('${THEME_STORAGE_KEY}')==='light')document.documentElement.dataset.theme='light'}catch(e){}`,
          }}
        />
        {/* Same before-first-paint trick as the theme script above, for
            the OBS overlay route instead of the theme — see the
            data-obs-pending CSS rule in globals.css for why this exists:
            a static export can't know the #/obs hash/obs=1 query at
            build time, so without this, an OBS Browser Source always
            gets one flash (sometimes longer, on a slow/CEF renderer) of
            the full site before React's own useIsObsMode effect swaps
            to the transparent overlay. */}
        <script
          type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `try{if(location.hash==='#/obs'||new URLSearchParams(location.search).get('obs')==='1')document.documentElement.dataset.obsPending='1'}catch(e){}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <LanguageProvider>
          <MotionProvider>
            <div className="app-shell flex min-h-full flex-1 flex-col">
              <Nav />
              {/* max-w-6xl reads comfortably up to a normal 1080p/1440p
                  screen, but on anything wider than 16:9 (ultrawide, 4K) it
                  left a huge dead margin on both sides with the whole app
                  looking small in the middle — the 2xl step gives large
                  monitors meaningfully more room without going full-bleed
                  (which would stretch card grids and text lines too wide to
                  read comfortably). */}
              <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 2xl:max-w-[100rem]">
                {children}
              </main>
              <Footer />
            </div>
          </MotionProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
