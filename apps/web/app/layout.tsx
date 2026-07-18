import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";

import { PushReadinessBoot } from "./push-readiness-boot";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Recruiter Radar",
  description: "Ежедневный радар по компаниям с активным наймом для рекрутеров и агентств.",
  manifest: "/manifest.webmanifest?v=brand-14",
  applicationName: "Recruiter Radar",
  icons: {
    icon: [
      {
        url: "/icon.svg?v=brand-14",
        type: "image/svg+xml",
        sizes: "any",
      },
    ],
    shortcut: "/icon.svg?v=brand-14",
    apple: "/icon.svg?v=brand-14",
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
