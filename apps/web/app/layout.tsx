import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";

import { PushReadinessBoot } from "./push-readiness-boot";
import "./globals.css";

const inter = Inter({
  subsets: ["cyrillic", "latin"],
  variable: "--font-inter",
  display: "swap",
});

const brandVersion = "brand-30";
const tabIcon = `/recruiter-radar-logo.svg?v=${brandVersion}`;
const installIcon192 = `/app-icons/app-icon-192.png?v=${brandVersion}`;
const installIcon512 = `/app-icons/app-icon-512.png?v=${brandVersion}`;
const appleIcon = `/app-icons/app-icon-180.png?v=${brandVersion}`;

export const metadata: Metadata = {
  title: "Recruiter Radar",
  description: "Ежедневный радар по компаниям с активным наймом для рекрутеров и агентств.",
  manifest: `/manifest.webmanifest?v=${brandVersion}`,
  applicationName: "Recruiter Radar",
  icons: {
    icon: [
      { url: tabIcon, type: "image/svg+xml", sizes: "any" },
      { url: installIcon192, type: "image/png", sizes: "192x192" },
      { url: installIcon512, type: "image/png", sizes: "512x512" },
    ],
    shortcut: [{ url: tabIcon, type: "image/svg+xml", sizes: "any" }],
    apple: [{ url: appleIcon, type: "image/png", sizes: "180x180" }],
  },
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
      <head>
        <link rel="icon" type="image/svg+xml" sizes="any" href={tabIcon} />
        <link rel="icon" type="image/png" sizes="192x192" href={installIcon192} />
        <link rel="icon" type="image/png" sizes="512x512" href={installIcon512} />
        <link rel="shortcut icon" type="image/svg+xml" href={tabIcon} />
        <link rel="apple-touch-icon" sizes="180x180" href={appleIcon} />
        <meta
          name="msapplication-TileImage"
          content={`/app-icons/app-icon-144.png?v=${brandVersion}`}
        />
      </head>
      <body
        className={`${inter.variable} font-sans`}
        style={{
          margin: 0,
          /* Shared calm background; the landing adds its own radar field. */
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
