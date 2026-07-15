import type { Metadata } from "next";

import VerifyLoginClient from "./verify-client";

export const metadata: Metadata = {
  title: "Проверка ссылки — Recruiter Radar",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function VerifyLoginPage() {
  return <VerifyLoginClient />;
}
