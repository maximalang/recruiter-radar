import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAccountSecurityProfile } from "@/lib/auth-v2/account-security";
import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import { listAuthSessions } from "@/lib/auth-v2/sessions";
import { buildAccountNavigation } from "../../ui/account-navigation";
import {
  EmptyState,
  InternalPageFrame,
  InternalPageHeader,
} from "../../ui/internal-page";
import { SiteFooter } from "../../ui/site-footer";
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

  const [profile, sessions, searchParams] = await Promise.all([
    getAccountSecurityProfile({
      userId: session.userId,
      workspaceId: session.workspaceId,
    }),
    listAuthSessions({
      userId: session.userId,
      currentSessionId: session.id,
    }),
    props.searchParams,
  ]);

  if (!profile) {
    return (
      <InternalPageFrame
        navItems={buildAccountNavigation("settings")}
        footer={<SiteFooter />}
      >
        <InternalPageHeader
          title="Безопасность аккаунта"
          subtitle="Управление доступом временно недоступно."
        />
        <EmptyState
          title="Не удалось открыть профиль"
          text="Обновите страницу. Если проблема повторится, войдите в аккаунт заново."
          action={{ href: "/login?returnTo=/settings/security", label: "Войти заново" }}
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
      footer={<SiteFooter />}
    >
      <InternalPageHeader
        title="Безопасность аккаунта"
        subtitle="Управляйте email и активными входами. Чувствительные изменения требуют недавней авторизации."
      />
      <SecuritySettingsView
        profile={profile}
        sessions={sessions}
        status={status}
      />
    </InternalPageFrame>
  );
}
