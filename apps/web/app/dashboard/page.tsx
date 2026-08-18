import type { Metadata } from "next";
import Link from "next/link";

import { getAccountById } from "@/lib/account-auth";
import { getSession } from "@/lib/auth-v2/authorization";
import { getClientProfileByOwnerId } from "@/lib/clientProfiles";
import { getDashboardTodayRadar } from "@/lib/dashboard-data";
import { getDeliveryPreferencesByOwnerId } from "@/lib/deliveryPreferences";
import { computeProfileCompletion } from "@/lib/profileCompletion";
import DashboardAccountOverview from "./dashboard-account-overview";
import DashboardTodayRadar from "./dashboard-today-radar";
import { buildAccountNavigation } from "../ui/account-navigation";
import { StaticEmptyState, ProductErrorState } from "../ui/product-state";
import {
  ProductWorkspaceFrame,
  ProductWorkspaceHeader,
} from "../ui/product-workspace";
import dashStyles from "./dashboard-workspace.module.css";

export const metadata: Metadata = {
  title: "Командный центр — Recruiter Radar",
  description: "Компании на сегодня, очередь проверки и готовность личного радара.",
};

export const dynamic = "force-dynamic";

const DASHBOARD_NAV = buildAccountNavigation("dashboard");

export default async function DashboardPage() {
  const authorization = await getSession({
    permissions: ["workspace:read", "profiles:read", "leads:read", "notifications:read"],
  });

  if (!authorization) {
    return <ProductWorkspaceFrame navItems={DASHBOARD_NAV}><ProductWorkspaceHeader eyebrow="Защищённое рабочее пространство" title="Личный кабинет" subtitle="Войдите, чтобы видеть только свой профиль, лиды и историю работы." /><StaticEmptyState title="Нужен вход в аккаунт" text="Сессия этого браузера не связана с аккаунтом. Восстановите доступ по данным заказа или активируйте новый радар." action={{ href: "/login?returnTo=/dashboard", label: "Войти в аккаунт" }} /></ProductWorkspaceFrame>;
  }

  const accountResult = await Promise.allSettled([getAccountById(authorization.userId)]);
  const account = accountResult[0];
  if (account.status === "rejected" || !account.value) {
    return <ProductWorkspaceFrame navItems={DASHBOARD_NAV}><ProductWorkspaceHeader eyebrow="Аккаунт" title="Не удалось загрузить аккаунт" subtitle="Сессия активна, но данные аккаунта временно недоступны." /><ProductErrorState title="Данные аккаунта временно недоступны" description="Обновите страницу немного позже. Повторный вход не требуется." action={{ href: "/settings/account", label: "Открыть настройки аккаунта" }} /></ProductWorkspaceFrame>;
  }

  const entitlement = authorization.workspaceId ? await getEffectiveEntitlement(authorization.dataOwnerId, { workspaceId: authorization.workspaceId }).catch(() => null) : null;
  if (!entitlement) return <ProductWorkspaceFrame navItems={DASHBOARD_NAV}><ProductWorkspaceHeader eyebrow="Доступ" title="Не удалось проверить доступ" subtitle="Мы не показываем Radar, пока сервер не подтвердит права аккаунта." /><ProductErrorState title="Проверка доступа временно недоступна" description="Обновите страницу немного позже. Настройки аккаунта остаются доступны." action={{ href: "/settings/access", label: "Открыть доступ и оплату" }} /></ProductWorkspaceFrame>;
  if (entitlement.status !== "active" || !entitlement.features.includes("dashboard")) return <ProductWorkspaceFrame navItems={DASHBOARD_NAV}><ProductWorkspaceHeader eyebrow="Доступ" title="Доступ к Radar не активен" subtitle="Профиль и история аккаунта сохранены." /><StaticEmptyState title="Нужен активный доступ" text="Выберите срок доступа или обратитесь к оператору. После активации dashboard откроется без повторной настройки." action={{ href: "/settings/access", label: "Проверить доступ" }} /></ProductWorkspaceFrame>;

  const [profileResult, todayRadarResult, deliveryPreferencesResult] = await Promise.allSettled([
    getClientProfileByOwnerId(authorization.dataOwnerId),
    getDashboardTodayRadar(authorization.dataOwnerId),
    getDeliveryPreferencesByOwnerId(authorization.dataOwnerId),
  ]);
  if (profileResult.status === "rejected") return <ProductWorkspaceFrame navItems={DASHBOARD_NAV}><ProductWorkspaceHeader eyebrow="Radar" title="Не удалось загрузить профиль Radar" subtitle="Это временная ошибка данных, а не незавершённая настройка." /><ProductErrorState title="Профиль Radar временно недоступен" description="Обновите страницу немного позже. Сохранённые настройки не потеряны." action={{ href: "/settings/radar", label: "Открыть настройки Radar" }} /></ProductWorkspaceFrame>;

  const profile = profileResult.value;
  const todayRadar = todayRadarResult.status === "fulfilled" ? todayRadarResult.value : null;
  const deliveryPreferences = deliveryPreferencesResult.status === "fulfilled" ? deliveryPreferencesResult.value : null;
  const deliveryPreferencesUnavailable = deliveryPreferencesResult.status === "rejected";
  if (!profile) return <ProductWorkspaceFrame navItems={DASHBOARD_NAV}><ProductWorkspaceHeader eyebrow="Активация" title="Завершите настройку радара" subtitle="Аккаунт найден, но рабочий профиль ещё не создан." /><StaticEmptyState title="Радар ещё не настроен" text="Пройдите четыре коротких шага: команда, практика, рынок и доставка." action={{ href: "/onboarding", label: "Настроить Radar" }} /></ProductWorkspaceFrame>;
  if (!profile.isActive) return <ProductWorkspaceFrame navItems={DASHBOARD_NAV}><ProductWorkspaceHeader eyebrow="Radar" title="Профиль приостановлен" subtitle="Настройки сохранены, но новые возможности не формируются." /><StaticEmptyState title="Включите Radar-профиль" text="Возобновите профиль в настройках." action={{ href: "/settings/radar", label: "Открыть настройки Radar" }} /></ProductWorkspaceFrame>;

  const completion = deliveryPreferencesUnavailable ? null : computeProfileCompletion(profile, deliveryPreferences);
  const deliveryReady = completion?.groups.find((group) => group.key === "delivery")?.filled ?? false;
  const completionPercent = completion ? Math.round(completion.ratio * 100) : 0;

  return <ProductWorkspaceFrame navItems={DASHBOARD_NAV}><ProductWorkspaceHeader eyebrow="Утренний обзор" title="Командный центр" subtitle="Приоритетные компании, очередь проверки и состояние радара — в одном рабочем контексте." status="Наблюдение активно" actions={<Link href="/leads" className={dashStyles.workspaceCta}>Открыть все возможности</Link>} /><div className={dashStyles.dashboardStack}>{deliveryPreferencesUnavailable ? <ProductErrorState title="Не удалось проверить готовность доставки" description="Возможности Radar доступны ниже, но статус каналов доставки сейчас не подтверждён." action={{ href: "/settings/delivery", label: "Открыть настройки доставки" }} /> : <DashboardAccountOverview agencyName={profile.agencyName} todayLeads={todayRadar?.topLeads.length ?? 0} pendingReview={todayRadar?.pendingReview ?? 0} completionPercent={completionPercent} deliveryReady={deliveryReady} />}{todayRadar ? <DashboardTodayRadar topLeads={todayRadar.topLeads} pendingReview={todayRadar.pendingReview} hiringModeByProfileId={todayRadar.hiringModeByProfileId} lastRunAt={todayRadar.lastRunAt} /> : <ProductErrorState title="Радар временно не загрузился" description="Профиль и настройки доступны." action={{ href: "/settings/radar", label: "Проверить настройки Radar" }} />}</div></ProductWorkspaceFrame>;
}
