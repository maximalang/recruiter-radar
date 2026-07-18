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

const faviconUrl = "/favicon-brand23?v=brand-23";

export const metadata: Metadata = {
  title: "Recruiter Radar",
  description: "Ежедневный радар по компаниям с активным наймом для рекрутеров и агентств.",
  manifest: "/manifest.webmanifest?v=brand-23",
  applicationName: "Recruiter Radar",
  icons: {
    icon: [
      {
        url: faviconUrl,
        type: "image/png",
        sizes: "64x64",
      },
    ],
    shortcut: faviconUrl,
    apple: faviconUrl,
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
        <link rel="icon" type="image/png" sizes="64x64" href={faviconUrl} />
        <link rel="shortcut icon" type="image/png" href={faviconUrl} />
        <link rel="apple-touch-icon" href={faviconUrl} />
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
