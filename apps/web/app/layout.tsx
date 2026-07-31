import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";

import { PushReadinessBoot } from "./push-readiness-boot";
import { shouldRunAuthV2SessionRefresh } from "@/lib/auth-v2/config";
import { AuthSessionRefresh } from "./auth-session-refresh";
import { PremiumUiEffects } from "./premium-ui-effects";
import "./globals.css";
import "./premium-ui.css";
import "./premium-ui-refinements.css";
import "./internal-workspace-bridge.css";
import "./internal-workspace-refinements.css";
import "./landing-cinematic.css";
import "./landing-cinematic-refinements.css";

const inter = Inter({
  subsets: ["cyrillic", "latin"],
  variable: "--font-inter",
  display: "swap",
});

const brandVersion = "brand-34";
const tabIcon16 = "/tab-favicon-brand34-16";
const tabIcon32 = "/tab-favicon-brand34-32";
const tabIcon48 = "/tab-favicon-brand34-48";
const appleIcon = `/apple-icon-180?v=${brandVersion}`;

export const metadata: Metadata = {
  title: "Recruiter Radar",
  description: "Ежедневный радар по компаниям с активным наймом для рекрутеров и агентств.",
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
          color: "var(--c-text-primary, #0f172a)",
        }}
      >
        <PremiumUiEffects />
        <PushReadinessBoot />
        {shouldRunAuthV2SessionRefresh() ? <AuthSessionRefresh /> : null}
        {children}
      </body>
    </html>
  );
}
