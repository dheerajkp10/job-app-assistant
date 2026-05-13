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
    >
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
