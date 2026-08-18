import type { Metadata } from "next";
import Link from "next/link";

import { getAccountById } from "@/lib/account-auth";
import { getSession } from "@/lib/auth-v2/authorization";
import { getClientProfileByOwnerId } from "@/lib/clientProfiles";
import { getDashboardSourceHealth, getDashboardTodayRadar } from "@/lib/dashboard-data";
import { getEffectiveEntitlement } from "@/lib/entitlements";
import DashboardTodayRadar from "./dashboard-today-radar";
import { buildAccountNavigation } from "../ui/account-navigation";
import { ProductErrorState } from "../ui/product-error-state";
import { ProductWorkspaceFrame, ProductWorkspaceHeader } from "../ui/product-workspace";
import { RadarOperationalState } from "../ui/radar-operational-state";
import { StaticEmptyState } from "../ui/static-empty-state";
import dashStyles from "./dashboard-workspace.module.css";

export const metadata: Metadata = {
  title: "Сегодня — Recruiter Radar",
  description: "Приоритетные компании, очередь проверки и рабочий контур на сегодня.",
};

export const dynamic = "force-dynamic";

const DASHBOARD_NAV = buildAccountNavigation("dashboard");

function StateLink({ href, label }: { href: string; label: string }) {
  return <Link href={href}>{label}</Link>;
}

function formatOperationalTimestamp(value: string | null): string {
  if (!value) return "ещё не зафиксирована";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "время не определено";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatEvidenceFreshness(latestPublishedAt: string | null): string {
  if (!latestPublishedAt) return "свежие подтверждения не зафиксированы";
  return `последнее подтверждение ${formatOperationalTimestamp(latestPublishedAt)}`;
}

export default async function DashboardPage() {
  const authorization = await getSession({
    permissions: ["workspace:read", "profiles:read", "leads:read", "notifications:read"],
  });

  if (!authorization) {
    return (
      <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
        <ProductWorkspaceHeader
          title="Сегодня"
          subtitle="Войдите, чтобы видеть только свой профиль, компании и историю работы."
        />
        <StaticEmptyState
          title="Нужен вход в аккаунт"
          description="Сессия этого браузера не связана с аккаунтом. Восстановите доступ или активируйте Радар."
          action={<StateLink href="/login?returnTo=/dashboard" label="Войти в аккаунт" />}
        />
      </ProductWorkspaceFrame>
    );
  }

  const accountResult = await Promise.allSettled([getAccountById(authorization.userId)]);
  const account = accountResult[0];
  if (account.status === "rejected" || !account.value) {
    return (
      <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
        <ProductWorkspaceHeader
          title="Сегодня"
          subtitle="Сессия активна, но данные аккаунта временно недоступны."
        />
        <ProductErrorState
          title="Данные аккаунта временно недоступны"
          description="Обновите страницу немного позже. Повторный вход не требуется."
        >
          <StateLink href="/settings/account" label="Открыть настройки аккаунта" />
        </ProductErrorState>
      </ProductWorkspaceFrame>
    );
  }

  const entitlement = authorization.workspaceId
    ? await getEffectiveEntitlement(authorization.dataOwnerId, {
        workspaceId: authorization.workspaceId,
      }).catch(() => null)
    : null;
  if (!entitlement) {
    return (
      <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
        <ProductWorkspaceHeader title="Сегодня" subtitle="Радар не показывает рабочий набор, пока сервер не подтвердит права аккаунта." />
        <ProductErrorState
          title="Проверка доступа временно недоступна"
          description="Обновите страницу немного позже. Настройки аккаунта остаются доступны."
        >
          <StateLink href="/settings/access" label="Открыть доступ и оплату" />
        </ProductErrorState>
      </ProductWorkspaceFrame>
    );
  }
  if (entitlement.status !== "active" || !entitlement.features.includes("dashboard")) {
    return (
      <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
        <ProductWorkspaceHeader title="Сегодня" subtitle="Профиль и история аккаунта сохранены." />
        <StaticEmptyState
          title="Доступ к Радару не активен"
          description="Выберите срок доступа. После активации рабочий набор откроется без повторной настройки."
          action={<StateLink href="/settings/access" label="Проверить доступ" />}
        />
      </ProductWorkspaceFrame>
    );
  }

  const [profileResult, todayRadarResult, sourceHealthResult] = await Promise.allSettled([
    getClientProfileByOwnerId(authorization.dataOwnerId),
    getDashboardTodayRadar(authorization.dataOwnerId),
    getDashboardSourceHealth(),
  ]);

  if (profileResult.status === "rejected") {
    return (
      <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
        <ProductWorkspaceHeader title="Сегодня" subtitle="Не удалось загрузить профиль радара." />
        <ProductErrorState
          title="Профиль радара временно недоступен"
          description="Это временная ошибка данных. Сохранённые настройки не потеряны."
        >
          <StateLink href="/settings/radar" label="Открыть профиль радара" />
        </ProductErrorState>
      </ProductWorkspaceFrame>
    );
  }

  const profile = profileResult.value;
  const todayRadar = todayRadarResult.status === "fulfilled" ? todayRadarResult.value : null;
  const sourceHealth = sourceHealthResult.status === "fulfilled" ? sourceHealthResult.value : [];

  if (!profile) {
    return (
      <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
        <ProductWorkspaceHeader title="Сегодня" subtitle="Аккаунт найден, но рабочий профиль ещё не создан." />
        <StaticEmptyState
          title="Радар ещё не настроен"
          description="Пройдите четыре коротких шага: команда, практика, рынок и доставка."
          action={<StateLink href="/onboarding" label="Настроить Радар" />}
        />
      </ProductWorkspaceFrame>
    );
  }

  if (!profile.isActive) {
    return (
      <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
        <ProductWorkspaceHeader title="Сегодня" subtitle="Настройки сохранены, но новые компании не формируются." />
        <StaticEmptyState
          title="Профиль радара приостановлен"
          description="Возобновите профиль в настройках — после этого следующие сканирования снова будут учитывать вашу практику."
          action={<StateLink href="/settings/radar" label="Открыть профиль радара" />}
        />
      </ProductWorkspaceFrame>
    );
  }

  const latestEvidenceAt = todayRadar?.topLeads.reduce<string | null>((latest, lead) => {
    if (!lead.latestPublishedAt) return latest;
    if (!latest) return lead.latestPublishedAt;
    return new Date(lead.latestPublishedAt).getTime() > new Date(latest).getTime()
      ? lead.latestPublishedAt
      : latest;
  }, null) ?? null;
  const healthySources = sourceHealth.filter((source) => source.status === "excellent" || source.status === "good").length;
  const sourcesLabel = sourceHealth.length > 0
    ? `${healthySources} из ${sourceHealth.length} в норме`
    : "данные о состоянии источников недоступны";

  return (
    <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
      <ProductWorkspaceHeader
        title="Сегодня"
        subtitle="Приоритетные компании, изменения и действия, которые требуют внимания сейчас."
        status="Наблюдение активно"
        actions={(
          <Link href="/leads" className={dashStyles.workspaceCta}>
            Все компании
          </Link>
        )}
      />

      <div className={dashStyles.dashboardStack}>
        <RadarOperationalState
          profile="активен"
          evidenceFreshness={formatEvidenceFreshness(latestEvidenceAt)}
          sources={sourcesLabel}
          delivery={profile.telegramChatId ? "Telegram настроен" : "канал доставки не настроен"}
          lastSync={formatOperationalTimestamp(todayRadar?.lastRunAt ?? null)}
        />

        {todayRadar ? (
          <DashboardTodayRadar
            topLeads={todayRadar.topLeads}
            pendingReview={todayRadar.pendingReview}
            hiringModeByProfileId={todayRadar.hiringModeByProfileId}
            lastRunAt={todayRadar.lastRunAt}
          />
        ) : (
          <ProductErrorState
            title="Радар временно не загрузился"
            description="Профиль и настройки доступны. Обновите страницу через минуту — данные других аккаунтов здесь не показываются."
          >
            <StateLink href="/settings/radar" label="Проверить профиль радара" />
          </ProductErrorState>
        )}
      </div>
    </ProductWorkspaceFrame>
  );
}
