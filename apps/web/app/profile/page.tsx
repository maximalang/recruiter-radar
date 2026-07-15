import type { Metadata } from "next";
import { getAccountById } from "../../lib/account-auth";
import {
  InternalPageFrame,
  InternalPageHeader,
  ContentCard,
  EmptyState,
} from "../ui/internal-page";
import { buildAccountNavigation } from "../ui/account-navigation";
import { SiteFooter } from "../ui/site-footer";
import { getClientProfileByOwnerId, resolveHiringMode } from "../../lib/clientProfiles";
import { getDeliveryPreferencesByOwnerId } from "../../lib/deliveryPreferences";
import { countMatchingCandidatesForProfile } from "../../lib/digest";
import { listNotificationConnectionsByOwnerId } from "../../lib/notifications";
import { computeProfileCompletion } from "../../lib/profileCompletion";
import { readOwnerSession } from "../../lib/session";
import { ProfileForm } from "./profile-form";
import { DeliveryForm } from "./delivery-form";
import { NotificationChannels } from "./notification-channels";
import ProfileCompletionPanel from "./profile-completion-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Профиль — Recruiter Radar",
  description: "Кого вы ищете: роли, отрасли, география и точная настройка радара.",
};

const PROFILE_NAV = buildAccountNavigation("profile");

export default async function ProfilePage() {
  const account = await getAccountById(await readOwnerSession()).catch(() => null);
  const ownerId = account?.id ?? null;
  const profile = ownerId ? await getClientProfileByOwnerId(ownerId) : null;
  const deliveryPreferences =
    ownerId && profile ? await getDeliveryPreferencesByOwnerId(ownerId) : null;
  const notificationConnections =
    ownerId && profile
      ? await listNotificationConnectionsByOwnerId(ownerId).catch(() => [])
      : [];

  // Completion + live match-count: both best-effort. The match count is the same
  // gate path the digest uses, so the number reflects exactly what the filters do.
  // Delivery preferences are passed in so the "configured delivery" milestone is
  // counted toward completion — but only when the prefs were actually loaded.
  const completion = profile
    ? computeProfileCompletion(profile, deliveryPreferences)
    : null;
  const matchCount = profile
    ? await countMatchingCandidatesForProfile(profile).catch(() => null)
    : null;
  // Resolve the effective hiring mode server-side: 'auto' is inferred from the
  // agency's declared roles, and the result is shown as a "currently active
  // mode" badge on the form so the agency sees what the radar is actually doing
  // — not just what radio card is checked. Degrades to 'specialist' when there
  // is no profile.
  const resolvedHiringMode = profile ? resolveHiringMode(profile) : "specialist";

  return (
    <InternalPageFrame navItems={PROFILE_NAV} footer={<SiteFooter />}>
      <InternalPageHeader
        title="Кто ваши идеальные клиенты?"
        subtitle="Чем точнее профиль, тем релевантнее ежедневная подборка. Заполните сверху вниз — основные блоки идут раньше, точная настройка в конце."
      />
      {profile && completion ? (
        <ContentCard>
          <ProfileCompletionPanel completion={completion} matchCount={matchCount} />
        </ContentCard>
      ) : null}
      <ContentCard>
        {profile ? (
          <ProfileForm profile={profile} resolvedHiringMode={resolvedHiringMode} />
        ) : (
          <EmptyState
            title={ownerId ? "Профиль ещё не активирован" : "Нужен вход в аккаунт"}
            text={ownerId
              ? "Профиль появится после активации радара. Завершите онбординг, чтобы настроить идеального клиента."
              : "Сессия этого браузера не связана с аккаунтом. Восстановите доступ, чтобы изменить профиль."}
            action={ownerId
              ? { href: "/checkout", label: "Активировать радар" }
              : { href: "/login", label: "Войти в аккаунт" }}
          />
        )}
      </ContentCard>
      {profile ? (
        <div id="notification-channels">
          <ContentCard>
            <NotificationChannels connections={notificationConnections} />
          </ContentCard>
        </div>
      ) : null}
      {profile && deliveryPreferences ? (
        <div id="delivery">
          <ContentCard>
            <InternalPageHeader
              title="Расписание и резервные каналы"
              subtitle="Задайте частоту и время. Email и браузерные push работают параллельно с подключёнными Telegram, VK и webhook."
            />
            <DeliveryForm preferences={deliveryPreferences} />
          </ContentCard>
        </div>
      ) : null}
    </InternalPageFrame>
  );
}
