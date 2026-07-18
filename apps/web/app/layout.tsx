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

// Keep the browser-tab icon inside the document itself. This avoids static-file,
// proxy, redirect and stale-path failures: the browser receives the exact rounded
// logo together with every HTML response and does not need a second request.
const FAVICON_DATA_URL =
  "data:image/png;base64,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";

export const metadata: Metadata = {
  title: "Recruiter Radar",
  description: "Ежедневный радар по компаниям с активным наймом для рекрутеров и агентств.",
  manifest: "/manifest.webmanifest?v=brand-25",
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
      <head>
        <link rel="icon" type="image/png" sizes="64x64" href={FAVICON_DATA_URL} />
        <link rel="shortcut icon" type="image/png" href={FAVICON_DATA_URL} />
        <link rel="apple-touch-icon" href="/apple-icon.png?v=brand-25" />
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
