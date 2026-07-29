import type { Metadata } from "next";
import Link from "next/link";

import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import { hasPendingAuthActionToken } from "@/lib/auth-v2/pending-action-cookie";
import { PendingAuthActionView } from "../pending-auth-action-view";
import styles from "../pending-auth-action.module.css";

export const metadata: Metadata = {
  title: "Подтверждение email — Recruiter Radar",
  description: "Безопасное подтверждение нового email.",
};

export const dynamic = "force-dynamic";

export default async function ChangeEmailPage() {
  const [session, hasPending] = await Promise.all([
    readCurrentAuthSession(),
    hasPendingAuthActionToken("email_change"),
  ]);
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link href="/" className={styles.brand}>Recruiter Radar</Link>
        <PendingAuthActionView
          kind="email_change"
          authenticated={Boolean(session)}
          hasPending={hasPending}
        />
      </div>
    </main>
  );
}
