import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { LanguageProvider } from "@/lib/i18n";
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
  "Рандомайзер перков Dead by Daylight с актуальным списком прямо с официальной wiki — без хардкода и без устаревших перков.";

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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <LanguageProvider>
          <Nav />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4">
            {children}
          </main>
          <Footer />
        </LanguageProvider>
      </body>
    </html>
  );
}
