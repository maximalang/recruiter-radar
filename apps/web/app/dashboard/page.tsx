import type { Metadata } from "next";
import Link from "next/link";

import { getAccountById } from "@/lib/account-auth";
import { getSession } from "@/lib/auth-v2/authorization";
import { getClientProfileByOwnerId } from "@/lib/clientProfiles";
import { getDashboardTodayRadar } from "@/lib/dashboard-data";
import { getDeliveryPreferencesByOwnerId } from "@/lib/deliveryPreferences";
import { computeProfileCompletion } from "@/lib/profileCompletion";
import { getEffectiveEntitlement } from "@/lib/entitlements";
import DashboardAccountOverview from "./dashboard-account-overview";
import DashboardTodayRadar from "./dashboard-today-radar";
import { buildAccountNavigation } from "../ui/account-navigation";
import { EmptyState, ErrorState } from "../ui/internal-page";
import { ProductWorkspaceFrame, ProductWorkspaceHeader } from "../ui/product-workspace";
import dashStyles from "./dashboard-workspace.module.css";

export const metadata: Metadata = {
  title: "Сегодня — Recruiter Radar",
  description: "Приоритетные компании, очередь проверки и рабочий контур на сегодня.",
};

export const dynamic = "force-dynamic";

const DASHBOARD_NAV = buildAccountNavigation("dashboard");

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
        <EmptyState
          title="Нужен вход в аккаунт"
          text="Сессия этого браузера не связана с аккаунтом. Восстановите доступ или активируйте Радар."
          action={{ href: "/login?returnTo=/dashboard", label: "Войти в аккаунт" }}
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
        <ErrorState
          title="Данные аккаунта временно недоступны"
          description="Обновите страницу немного позже. Повторный вход не требуется."
          action={{ href: "/settings/account", label: "Открыть настройки аккаунта" }}
        />
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
        <ErrorState
          title="Проверка доступа временно недоступна"
          description="Обновите страницу немного позже. Настройки аккаунта остаются доступны."
          action={{ href: "/settings/access", label: "Открыть доступ и оплату" }}
        />
      </ProductWorkspaceFrame>
    );
  }
  if (entitlement.status !== "active" || !entitlement.features.includes("dashboard")) {
    return (
      <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
        <ProductWorkspaceHeader title="Сегодня" subtitle="Профиль и история аккаунта сохранены." />
        <EmptyState
          title="Доступ к Радару не активен"
          text="Выберите срок доступа. После активации рабочий набор откроется без повторной настройки."
          action={{ href: "/settings/access", label: "Проверить доступ" }}
        />
      </ProductWorkspaceFrame>
    );
  }

  const [profileResult, todayRadarResult, deliveryPreferencesResult] = await Promise.allSettled([
    getClientProfileByOwnerId(authorization.dataOwnerId),
    getDashboardTodayRadar(authorization.dataOwnerId),
    getDeliveryPreferencesByOwnerId(authorization.dataOwnerId),
  ]);

  if (profileResult.status === "rejected") {
    return (
      <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
        <ProductWorkspaceHeader title="Сегодня" subtitle="Не удалось загрузить профиль радара." />
        <ErrorState
          title="Профиль радара временно недоступен"
          description="Это временная ошибка данных. Сохранённые настройки не потеряны."
          action={{ href: "/settings/radar", label: "Открыть профиль радара" }}
        />
      </ProductWorkspaceFrame>
    );
  }

  const profile = profileResult.value;
  const todayRadar = todayRadarResult.status === "fulfilled" ? todayRadarResult.value : null;
  const deliveryPreferences = deliveryPreferencesResult.status === "fulfilled" ? deliveryPreferencesResult.value : null;
  const deliveryPreferencesUnavailable = deliveryPreferencesResult.status === "rejected";

  if (!profile) {
    return (
      <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
        <ProductWorkspaceHeader title="Сегодня" subtitle="Аккаунт найден, но рабочий профиль ещё не создан." />
        <EmptyState
          title="Радар ещё не настроен"
          text="Пройдите четыре коротких шага: команда, практика, рынок и доставка."
          action={{ href: "/onboarding", label: "Настроить Радар" }}
        />
      </ProductWorkspaceFrame>
    );
  }

  if (!profile.isActive) {
    return (
      <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
        <ProductWorkspaceHeader title="Сегодня" subtitle="Настройки сохранены, но новые компании не формируются." />
        <EmptyState
          title="Профиль радара приостановлен"
          text="Возобновите профиль в настройках — после этого следующие сканирования снова будут учитывать вашу практику."
          action={{ href: "/settings/radar", label: "Открыть профиль радара" }}
        />
      </ProductWorkspaceFrame>
    );
  }

  const completion = deliveryPreferencesUnavailable ? null : computeProfileCompletion(profile, deliveryPreferences);
  const deliveryReady = completion?.groups.find((group) => group.key === "delivery")?.filled ?? false;
  const completionPercent = completion ? Math.round(completion.ratio * 100) : 0;

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
        {deliveryPreferencesUnavailable ? (
          <ErrorState
            title="Не удалось проверить готовность доставки"
            description="Компании и подтверждения доступны ниже, но статус каналов доставки сейчас не подтверждён."
            action={{ href: "/settings/delivery", label: "Открыть настройки доставки" }}
          />
        ) : (
          <DashboardAccountOverview
            agencyName={profile.agencyName}
            todayLeads={todayRadar?.topLeads.length ?? 0}
            pendingReview={todayRadar?.pendingReview ?? 0}
            completionPercent={completionPercent}
            deliveryReady={deliveryReady}
          />
        )}

        {todayRadar ? (
          <DashboardTodayRadar
            topLeads={todayRadar.topLeads}
            pendingReview={todayRadar.pendingReview}
            hiringModeByProfileId={todayRadar.hiringModeByProfileId}
            lastRunAt={todayRadar.lastRunAt}
          />
        ) : (
          <ErrorState
            title="Радар временно не загрузился"
            description="Профиль и настройки доступны. Обновите страницу через минуту — данные других аккаунтов здесь не показываются."
            action={{ href: "/settings/radar", label: "Проверить профиль радара" }}
          />
        )}
      </div>
    </ProductWorkspaceFrame>
  );
}
