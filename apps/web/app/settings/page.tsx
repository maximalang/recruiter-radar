import type { Metadata } from "next";

import { getAccountById } from "@/lib/account-auth";
import { getSession } from "@/lib/auth-v2/authorization";
import { getClientProfileByOwnerId } from "@/lib/clientProfiles";
import { getDeliveryPreferencesByOwnerId } from "@/lib/deliveryPreferences";
import {
  isAuthPlatformV2EnabledForUser,
  isAuthWorkspacesV2EnabledForUser,
} from "@/lib/auth-v2/config";
import { computeProfileCompletion } from "@/lib/profileCompletion";
import { buildAccountNavigation } from "../ui/account-navigation";
import { logoutAction } from "../login/actions";
import { EmptyState, InternalPageFrame, InternalPageHeader } from "../ui/internal-page";
import ppStyles from "../ui/page-primitives.module.css";
import SettingsDocumentSummary from "./settings-overview";
import styles from "./settings-account.module.css";

export const metadata: Metadata = {
  title: "Настройки — Recruiter Radar",
  description: "Аккаунт, профиль радара, расписание и каналы доставки.",
};

export const dynamic = "force-dynamic";

export default async function SettingsIndexPage() {
  const authorization = await getSession({
    permissions: [
      "workspace:read",
      "profiles:read",
      "notifications:read",
    ],
  });
  const account = await getAccountById(authorization?.userId ?? null).catch(() => null);

  if (!authorization || !account) {
    return (
      <InternalPageFrame navItems={buildAccountNavigation("settings")}>
        <InternalPageHeader title="Настройки" subtitle="Для доступа к настройкам нужен вход." />
        <div className={styles.emptySection}>
          <EmptyState
            title="Сессия не найдена"
            text="Восстановите доступ — после входа здесь появятся профиль радара и каналы доставки."
            action={{ href: "/login", label: "Войти в аккаунт" }}
          />
        </div>
      </InternalPageFrame>
    );
  }

  const [profile, preferences] = await Promise.all([
    getClientProfileByOwnerId(authorization.dataOwnerId).catch(() => null),
    getDeliveryPreferencesByOwnerId(authorization.dataOwnerId).catch(() => null),
  ]);

  if (!profile) {
    return (
      <InternalPageFrame navItems={buildAccountNavigation("settings")}>
        <InternalPageHeader title="Настройки" subtitle="Аккаунт активен, профиль радара ещё не создан." />
        <div className={styles.emptySection}>
          <EmptyState
            title="Профиль ещё не создан"
            text="Сначала активируйте Радар, затем настройте практику и доставку."
            action={{ href: "/checkout", label: "Активировать Радар" }}
          />
        </div>
        <section className={styles.accountSection} aria-labelledby="account-title">
          <h2 id="account-title">Аккаунт</h2>
          <p>Рабочий email: {account.email}.</p>
          <form action={logoutAction}>
            <button className={ppStyles.secondaryAction} type="submit">Выйти из аккаунта</button>
          </form>
        </section>
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
    <InternalPageFrame navItems={buildAccountNavigation("settings")}>
      <InternalPageHeader
        title="Настройки"
        subtitle="Аккаунт, профиль радара и доставка — в одном спокойном контуре конфигурации."
      />
      <SettingsDocumentSummary
        agencyName={profile.agencyName}
        completionPercent={completionPercent}
        deliveryEnabled={preferences?.deliveryEnabled ?? false}
        deliverySchedule={deliverySchedule}
        telegramConnected={Boolean(profile.telegramChatId)}
        emailEnabled={preferences?.emailDigestEnabled ?? false}
        webPushEnabled={preferences?.webPushEnabled ?? false}
        authSecurityEnabled={
          isAuthPlatformV2EnabledForUser(account.id)
          && isAuthWorkspacesV2EnabledForUser(account.id)
        }
      />
      <section className={styles.accountSection} aria-labelledby="account-access-title">
        <h2 id="account-access-title">Доступ к аккаунту</h2>
        <p>Рабочий email: {account.email}. Вход выполняется одноразовой ссылкой, без хранения пароля.</p>
        <form action={logoutAction}>
          <button className={ppStyles.secondaryAction} type="submit">Выйти из аккаунта</button>
        </form>
      </section>
    </InternalPageFrame>
  );
}
