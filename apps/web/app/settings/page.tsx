import type { Metadata } from "next";

import { getClientProfileByOwnerId } from "@/lib/clientProfiles";
import { getDeliveryPreferencesByOwnerId } from "@/lib/deliveryPreferences";
import { computeProfileCompletion } from "@/lib/profileCompletion";
import { readOwnerSession } from "@/lib/session";
import { buildAccountNavigation } from "../ui/account-navigation";
import { ContentCard, EmptyState, InternalPageFrame, InternalPageHeader } from "../ui/internal-page";
import { SiteFooter } from "../ui/site-footer";
import SettingsOverview from "./settings-overview";

export const metadata: Metadata = {
  title: "Настройки — Recruiter Radar",
  description: "Профиль поиска, расписание и каналы доставки радара.",
};

export const dynamic = "force-dynamic";

export default async function SettingsIndexPage() {
  const ownerId = await readOwnerSession();

  if (!ownerId) {
    return (
      <InternalPageFrame navItems={buildAccountNavigation("settings")} footer={<SiteFooter />}>
        <InternalPageHeader title="Настройки аккаунта" subtitle="Для доступа к настройкам нужен вход." />
        <ContentCard variant="hero">
          <EmptyState
            title="Сессия не найдена"
            text="Восстановите доступ по данным заказа — после входа здесь появятся профиль и каналы доставки."
            action={{ href: "/login", label: "Войти в аккаунт" }}
          />
        </ContentCard>
      </InternalPageFrame>
    );
  }

  const [profile, preferences] = await Promise.all([
    getClientProfileByOwnerId(ownerId).catch(() => null),
    getDeliveryPreferencesByOwnerId(ownerId).catch(() => null),
  ]);

  if (!profile) {
    return (
      <InternalPageFrame navItems={buildAccountNavigation("settings")} footer={<SiteFooter />}>
        <InternalPageHeader title="Настройки аккаунта" />
        <ContentCard variant="hero">
          <EmptyState
            title="Профиль ещё не создан"
            text="Сначала активируйте радар, затем настройте поиск и доставку."
            action={{ href: "/checkout", label: "Активировать радар" }}
          />
        </ContentCard>
      </InternalPageFrame>
    );
  }

  const completion = computeProfileCompletion(profile, preferences);
  const completionPercent = Math.round(completion.ratio * 100);
  const frequency = preferences?.deliveryFrequency === "weekly" ? "Раз в неделю" : "Каждый день";
  const deliverySchedule = preferences?.deliveryEnabled
    ? `${frequency}, ${preferences.deliveryTimeLocal ?? "время по умолчанию"}`
    : "Включите доставку, выберите частоту и местное время";

  return (
    <InternalPageFrame navItems={buildAccountNavigation("settings")} footer={<SiteFooter />}>
      <InternalPageHeader
        title="Настройки"
        subtitle="Проверьте готовность профиля и каналов. Изменения сохраняются в соответствующем разделе редактора."
      />
      <SettingsOverview
        agencyName={profile.agencyName}
        completionPercent={completionPercent}
        deliveryEnabled={preferences?.deliveryEnabled ?? false}
        deliverySchedule={deliverySchedule}
        telegramConnected={Boolean(profile.telegramChatId)}
        emailEnabled={preferences?.emailDigestEnabled ?? false}
        webPushEnabled={preferences?.webPushEnabled ?? false}
      />
    </InternalPageFrame>
  );
}
