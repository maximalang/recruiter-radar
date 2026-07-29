import type { Metadata } from "next";
import Link from "next/link";

import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import { hasPendingAuthActionToken } from "@/lib/auth-v2/pending-action-cookie";
import { PendingAuthActionView } from "../pending-auth-action-view";
import styles from "../pending-auth-action.module.css";

export const metadata: Metadata = {
  title: "Приглашение в команду — Recruiter Radar",
  description: "Безопасное принятие приглашения в рабочее пространство.",
};

export const dynamic = "force-dynamic";

export default async function WorkspaceInvitePage() {
  const [session, hasPending] = await Promise.all([
    readCurrentAuthSession(),
    hasPendingAuthActionToken("workspace_invite"),
  ]);
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link href="/" className={styles.brand}>Recruiter Radar</Link>
        <PendingAuthActionView
          kind="workspace_invite"
          authenticated={Boolean(session)}
          hasPending={hasPending}
        />
      </div>
    </main>
  );
}
