import type { Metadata } from "next";

import { getAccountById } from "@/lib/account-auth";
import { getSession } from "@/lib/auth-v2/authorization";
import { getClientProfileByOwnerId } from "@/lib/clientProfiles";
import { getDashboardTodayRadar } from "@/lib/dashboard-data";
import { getDeliveryPreferencesByOwnerId } from "@/lib/deliveryPreferences";
import { computeProfileCompletion } from "@/lib/profileCompletion";
import DashboardAccountOverview from "./dashboard-account-overview";
import DashboardTodayRadar from "./dashboard-today-radar";
import { buildAccountNavigation } from "../ui/account-navigation";
import {
  ContentCard,
  EmptyState,
  ErrorState,
  InternalPageFrame,
  InternalPageHeader,
} from "../ui/internal-page";
import { SiteFooter } from "../ui/site-footer";
import dashStyles from "./dashboard.module.css";

export const metadata: Metadata = {
  title: "Рабочий стол — Recruiter Radar",
  description: "Компании на сегодня, очередь проверки и готовность личного радара.",
};

export const dynamic = "force-dynamic";

const DASHBOARD_NAV = buildAccountNavigation("dashboard");

export default async function DashboardPage() {
  const authorization = await getSession({
    permissions: [
      "workspace:read",
      "profiles:read",
      "leads:read",
      "notifications:read",
    ],
  });
  const account = await getAccountById(authorization?.userId ?? null).catch(() => null);

  if (!authorization || !account) {
    return (
      <InternalPageFrame navItems={DASHBOARD_NAV} footer={<SiteFooter />}>
        <InternalPageHeader
          title="Личный кабинет"
          subtitle="Войдите, чтобы видеть только свой профиль, лиды и историю работы."
        />
        <ContentCard variant="hero">
          <EmptyState
            title="Нужен вход в аккаунт"
            text="Сессия этого браузера не связана с аккаунтом. Восстановите доступ по данным заказа или активируйте новый радар."
            action={{ href: "/login", label: "Войти в аккаунт" }}
          />
        </ContentCard>
      </InternalPageFrame>
    );
  }

  const [profile, todayRadar, deliveryPreferences] = await Promise.all([
    getClientProfileByOwnerId(authorization.dataOwnerId).catch(() => null),
    getDashboardTodayRadar(authorization.dataOwnerId).catch(() => null),
    getDeliveryPreferencesByOwnerId(authorization.dataOwnerId).catch(() => null),
  ]);

  if (!profile) {
    return (
      <InternalPageFrame navItems={DASHBOARD_NAV} footer={<SiteFooter />}>
        <InternalPageHeader
          title="Завершите активацию"
          subtitle="Аккаунт найден, но рабочий профиль ещё не создан."
        />
        <ContentCard variant="hero">
          <EmptyState
            title="Радар ещё не настроен"
            text="Активируйте тариф и укажите специализацию агентства — после этого здесь появятся компании и очередь работы."
            action={{ href: "/checkout", label: "Активировать радар" }}
          />
        </ContentCard>
      </InternalPageFrame>
    );
  }

  const completion = computeProfileCompletion(profile, deliveryPreferences);
  const deliveryReady = completion.groups.find((group) => group.key === "delivery")?.filled ?? false;
  const completionPercent = Math.round(completion.ratio * 100);

  return (
    <InternalPageFrame navItems={DASHBOARD_NAV} footer={<SiteFooter />}>
      <InternalPageHeader
        title="Ваш радар"
        subtitle="Один экран для приоритетных компаний, очереди проверки и готовности аккаунта."
      />
      <div className={dashStyles.dashboardStack}>
        <DashboardAccountOverview
          agencyName={profile.agencyName}
          todayLeads={todayRadar?.topLeads.length ?? 0}
          pendingReview={todayRadar?.pendingReview ?? 0}
          completionPercent={completionPercent}
          deliveryReady={deliveryReady}
        />

        {todayRadar ? (
          <DashboardTodayRadar
            topLeads={todayRadar.topLeads}
            pendingReview={todayRadar.pendingReview}
            hiringModeByProfileId={todayRadar.hiringModeByProfileId}
          />
        ) : (
          <ErrorState
            title="Радар временно не загрузился"
            description="Профиль и настройки доступны. Обновите страницу через минуту — данные других аккаунтов здесь не показываются."
            action={{ href: "/profile", label: "Проверить профиль" }}
          />
        )}
      </div>
    </InternalPageFrame>
  );
}
