import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";

import { PushReadinessBoot } from "./push-readiness-boot";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Recruiter Radar",
  description: "Ежедневный радар по компаниям с активным наймом для рекрутеров и агентств.",
  manifest: "/manifest.webmanifest",
  applicationName: "Recruiter Radar",
  appleWebApp: {
    capable: true,
    title: "Recruiter Radar",
    statusBarStyle: "default"
  }
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ru">
      <body
        className={`${inter.variable} font-sans`}
        style={{
          margin: 0,
          /* Base page background — a calm cool gradient, NOT a flat white. A soft
             blue glow lifts the top of the viewport and settles into the page
             tint lower down, so the page reads as a cool airspace the moment it
             loads (before the slow drifting ambient blobs have moved). The
             animated ambient layer renders above this and blends over it; the
             near-white `--c-bg-page` is the floor the glows drift across, but
             the gradient means the gaps between cards are tinted, not paper-
             white. Kept restrained — premium/calm, not a loud wash. */
          background:
            "radial-gradient(125% 90% at 50% -12%, #dde6fb 0%, var(--c-bg-page, #f7faff) 46%, #f3f6fe 100%)",
          backgroundAttachment: "fixed",
          color: "var(--c-text-primary, #0f172a)",
        }}
      >
        <PushReadinessBoot />
        {children}
      </body>
    </html>
  );
}
