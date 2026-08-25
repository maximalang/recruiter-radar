import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Inter } from "next/font/google";

import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";
import { PushReadinessBoot } from "./push-readiness-boot";
import { shouldRunAuthV2SessionRefresh } from "@/lib/auth-v2/config";
import { AuthSessionRefresh } from "./auth-session-refresh";
import "./globals.css";
import "./product-visual-system.css";
import "./product-motion-system.css";
import "./site-interactions.css";

const inter = Inter({
  subsets: ["cyrillic", "latin"],
  variable: "--font-inter",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["cyrillic", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

const brandVersion = "brand-34";
const tabIcon16 = `/tab-icons/tab-icon-16.png?v=${brandVersion}`;
const tabIcon32 = `/tab-icons/tab-icon-32.png?v=${brandVersion}`;
const tabIcon48 = `/tab-icons/tab-icon-48.png?v=${brandVersion}`;
const appleIcon = `/app-icons/app-icon-180.png?v=${brandVersion}`;

export const metadata: Metadata = {
  title: "Recruiter Radar",
  description: "Ежедневный радар по компаниям с активным наймом для рекрутеров и агентств.",
  metadataBase: new URL(OPERATOR_REQUISITES.website),
  alternates: { canonical: "/" },
  manifest: `/manifest.webmanifest?v=${brandVersion}`,
  applicationName: "Recruiter Radar",
  icons: {
    icon: [
      { url: tabIcon16, type: "image/png", sizes: "16x16" },
      { url: tabIcon32, type: "image/png", sizes: "32x32" },
      { url: tabIcon48, type: "image/png", sizes: "48x48" },
    ],
    shortcut: [{ url: tabIcon32, type: "image/png", sizes: "32x32" }],
    apple: [{ url: appleIcon, type: "image/png", sizes: "180x180" }],
  },
  other: {
    "msapplication-TileImage": `/app-icons/app-icon-144.png?v=${brandVersion}`,
  },
  appleWebApp: {
    capable: true,
    title: "Recruiter Radar",
    statusBarStyle: "default",
  },
};

type RootLayoutProps = { children: ReactNode };

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ru" className={`${inter.variable} ${plexMono.variable}`}>
      <body>
        <PushReadinessBoot />
        {shouldRunAuthV2SessionRefresh() ? <AuthSessionRefresh /> : null}
        {children}
      </body>
    </html>
  );
}
