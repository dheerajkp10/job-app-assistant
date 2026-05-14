import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import TopNav from "@/components/layout/top-nav";
import ResetButton from "@/components/layout/reset-button";
import { getSettings } from "@/lib/db";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "Job Application Assistant",
  description: "Track and manage job applications across portals",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getSettings();
  const onboardingDone = settings.onboardingComplete;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The actual theme is applied client-side by the inline
      // script below before React hydrates — keeps the first paint
      // in the right theme so the user doesn't see a light flash
      // before the dark theme kicks in.
      suppressHydrationWarning
    >
      <head>
        {/* Inline theme initializer. Runs before React hydrates, so
            `<html data-theme="dark">` is set before any CSS paints.
            Reads localStorage; falls back to the OS prefers-color-
            scheme media query when no explicit choice is stored. */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('jobassist-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen">
        {/* HeroUI v3 components rely on react-aria-components' built-in
            context, so no top-level provider is needed. */}
        {onboardingDone && <TopNav />}
        <main className="relative">
          {onboardingDone && <ResetButton />}
          {children}
        </main>
      </body>
    </html>
  );
}
