import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getAccountSecurityProfile } from "@/lib/auth-v2/account-security";
import { isAuthPasskeysEnabledForUser } from "@/lib/auth-v2/config";
import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import { listUserPasskeys } from "@/lib/auth-v2/passkeys";
import { listAuthSessions } from "@/lib/auth-v2/sessions";
import { buildAccountNavigation } from "../../ui/account-navigation";
import {
  InternalPageFrame,
  InternalPageHeader,
} from "../../ui/internal-page";
import { StaticEmptyState } from "../../ui/static-empty-state";
import {
  SecuritySettingsView,
  type SecuritySettingsStatus,
} from "./security-settings-view";

export const metadata: Metadata = {
  title: "Безопасность аккаунта — Recruiter Radar",
  description: "Профиль, активные сессии, смена email и удаление аккаунта.",
};

export const dynamic = "force-dynamic";

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function SecuritySettingsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readCurrentAuthSession({ requireWorkspace: true });
  if (!session?.workspaceId) {
    redirect("/login?returnTo=/settings/security");
  }

  const passkeysEnabled = isAuthPasskeysEnabledForUser(session.userId);
  const [profile, sessions, passkeys, searchParams] = await Promise.all([
    getAccountSecurityProfile({
      userId: session.userId,
      workspaceId: session.workspaceId,
    }),
    listAuthSessions({
      userId: session.userId,
      currentSessionId: session.id,
    }),
    passkeysEnabled ? listUserPasskeys(session.userId) : Promise.resolve([]),
    props.searchParams,
  ]);

  if (!profile) {
    return (
      <InternalPageFrame
        navItems={buildAccountNavigation("settings")}
      >
        <InternalPageHeader
          title="Безопасность аккаунта"
          subtitle="Управление доступом временно недоступно."
        />
        <StaticEmptyState
          title="Не удалось открыть профиль"
          description="Обновите страницу. Если проблема повторится, войдите в аккаунт заново."
          action={(
            <Link href="/login?returnTo=/settings/security">
              Войти заново
            </Link>
          )}
        />
      </InternalPageFrame>
    );
  }

  const status: SecuritySettingsStatus = {
    email: scalar(searchParams.email),
    sessions: scalar(searchParams.sessions),
    deletion: scalar(searchParams.deletion),
    error: scalar(searchParams.error),
  };

  return (
    <InternalPageFrame
      navItems={buildAccountNavigation("settings")}
    >
      <InternalPageHeader
        title="Безопасность аккаунта"
        subtitle="Управляйте email и активными входами. Чувствительные изменения требуют недавней авторизации."
      />
      <SecuritySettingsView
        profile={profile}
        sessions={sessions}
        passkeysEnabled={passkeysEnabled}
        passkeys={passkeys.map((passkey) => ({
          ...passkey,
          createdAt: passkey.createdAt.toISOString(),
          lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
        }))}
        status={status}
      />
    </InternalPageFrame>
  );
}
