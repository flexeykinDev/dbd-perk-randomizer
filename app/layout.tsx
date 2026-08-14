import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
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

export const metadata: Metadata = {
  metadataBase: new URL(`https://flexeykindev.github.io${basePath}/`),
  title: "DBD Perk Randomizer",
  description:
    "Рандомайзер перков Dead by Daylight с актуальным списком прямо с официальной wiki — без хардкода и без устаревших перков.",
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: "DBD Perk Randomizer",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0c0f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // data-theme is set by the beforeInteractive script below, outside
      // React's render — without this, React "fixes" the attribute away
      // (since its own JSX never sets it) on the next re-render, e.g. a
      // client-side navigation, silently reverting the theme.
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {/* Sets the theme before first paint so there's no dark->light flash.
            next/script's beforeInteractive strategy (not a raw <script> tag)
            is required here — a plain JSX <script> only runs on the initial
            HTML parse and breaks hydration on subsequent client navigations. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`try{if(localStorage.getItem('${THEME_STORAGE_KEY}')==='light')document.documentElement.dataset.theme='light'}catch(e){}`}
        </Script>
        <LanguageProvider>
          <Nav />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
            {children}
          </main>
          <Footer />
        </LanguageProvider>
      </body>
    </html>
  );
}
