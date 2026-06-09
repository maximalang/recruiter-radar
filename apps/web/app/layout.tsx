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
          backgroundColor: "var(--c-bg-page, #f8fbff)",
          color: "var(--c-text-primary, #0f172a)",
        }}
      >
        <PushReadinessBoot />
        {children}
      </body>
    </html>
  );
}
