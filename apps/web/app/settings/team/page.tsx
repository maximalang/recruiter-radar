import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { readCurrentAuthSession } from "@/lib/auth-v2/current-session";
import { getWorkspaceTeam } from "@/lib/auth-v2/workspace-team";
import { buildAccountNavigation } from "../../ui/account-navigation";
import {
  ContentCard,
  EmptyState,
  InternalPageFrame,
  InternalPageHeader,
} from "../../ui/internal-page";
import {
  TeamSettingsView,
  type TeamSettingsStatus,
} from "./team-settings-view";

export const metadata: Metadata = {
  title: "Команда — Recruiter Radar",
  description: "Участники, роли и приглашения рабочего пространства.",
};

export const dynamic = "force-dynamic";

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function TeamSettingsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readCurrentAuthSession({ requireWorkspace: true });
  if (!session?.workspaceId) {
    redirect("/login?returnTo=/settings/team");
  }

  const [team, searchParams] = await Promise.all([
    getWorkspaceTeam({
      actorUserId: session.userId,
      workspaceId: session.workspaceId,
    }),
    props.searchParams,
  ]);

  if (!team) {
    return (
      <InternalPageFrame
        navItems={buildAccountNavigation("settings")}
      >
        <InternalPageHeader
          title="Команда"
          subtitle="Управление участниками доступно владельцу и администраторам."
        />
        <ContentCard>
          <EmptyState
            title="Недостаточно прав"
            text="Ваш доступ к рабочему пространству не позволяет управлять командой."
            action={{ href: "/settings/security", label: "Открыть безопасность" }}
          />
        </ContentCard>
      </InternalPageFrame>
    );
  }

  const status: TeamSettingsStatus = {
    invite: scalar(searchParams.invite),
    member: scalar(searchParams.member),
    transfer: scalar(searchParams.transfer),
    error: scalar(searchParams.error),
  };

  return (
    <InternalPageFrame
      navItems={buildAccountNavigation("settings")}
    >
      <InternalPageHeader
        title="Команда"
        subtitle="Роли проверяются на сервере, а потеря доступа завершает связанные сессии немедленно."
      />
      <TeamSettingsView
        currentUserId={session.userId}
        team={team}
        status={status}
      />
    </InternalPageFrame>
  );
}
