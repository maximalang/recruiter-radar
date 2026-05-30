import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PushReadinessBoot } from "./push-readiness-boot";

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
        style={{
          margin: 0,
          backgroundColor: "#f8fafc",
          color: "#111827",
          fontFamily: "ui-sans-serif, system-ui, sans-serif"
        }}
      >
        <PushReadinessBoot />
        {children}
      </body>
    </html>
  );
}
