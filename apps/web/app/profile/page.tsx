import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "../../lib/auth-v2/authorization";
import {
  InternalPageFrame,
  InternalPageHeader,
} from "../ui/internal-page";
import { StaticEmptyState } from "../ui/static-empty-state";
import { buildAccountNavigation } from "../ui/account-navigation";
import { getClientProfileByOwnerId, resolveHiringMode } from "../../lib/clientProfiles";
import { getDeliveryPreferencesByOwnerId } from "../../lib/deliveryPreferences";
import { countMatchingCandidatesForProfile } from "../../lib/digest";
import { listNotificationConnectionsByOwnerId } from "../../lib/notifications";
import { computeProfileCompletion } from "../../lib/profileCompletion";
import { ProfileForm } from "./profile-form";
import { DeliveryForm } from "./delivery-form";
import { NotificationChannels } from "./notification-channels";
import ProfileCompletionPanel from "./profile-completion-panel";
import {
  getAgencyDnaProfile,
  listAgencyAccountRestrictions,
  listAgencyRestrictionOrganizationOptions,
} from "../../lib/agencyDnaProfile";
import { isAgencyDnaV1EnabledForContext } from "../../lib/opportunities/config";
import { AgencyDnaForm } from "./agency-dna-form";
import styles from "./profile-document.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Профиль радара — Recruiter Radar",
  description: "Кого и где должен замечать Recruiter Radar: практика, роли, рынок и точная настройка.",
};

const PROFILE_NAV = buildAccountNavigation("profile");

function StateLink({ href, label }: { href: string; label: string }) {
  return <Link href={href}>{label}</Link>;
}

export default async function ProfilePage() {
  const session = await getSession({ permission: "profiles:read" });
  const ownerId = session?.dataOwnerId ?? null;
  const profile = ownerId ? await getClientProfileByOwnerId(ownerId) : null;
  const deliveryPreferences = ownerId && profile
    ? await getDeliveryPreferencesByOwnerId(ownerId)
    : null;
  const notificationConnections = ownerId && profile
    ? await listNotificationConnectionsByOwnerId(ownerId).catch(() => [])
    : [];

  const completion = profile
    ? computeProfileCompletion(profile, deliveryPreferences)
    : null;
  const matchCount = profile
    ? await countMatchingCandidatesForProfile(profile).catch(() => null)
    : null;
  const resolvedHiringMode = profile ? resolveHiringMode(profile) : "specialist";
  const agencyDnaEnabled = Boolean(
    profile &&
    session?.workspaceId &&
    isAgencyDnaV1EnabledForContext({
      dataOwnerId: session.dataOwnerId,
      workspaceId: session.workspaceId,
    }),
  );
  const agencyDnaProfile = agencyDnaEnabled && session?.workspaceId
    ? await getAgencyDnaProfile({
      ownerId: session.dataOwnerId,
      workspaceId: session.workspaceId,
    })
    : null;
  const [agencyRestrictions, restrictionOrganizations] =
    agencyDnaProfile && session?.workspaceId
      ? await Promise.all([
        listAgencyAccountRestrictions({
          profileId: agencyDnaProfile.profileId,
          ownerId: session.dataOwnerId,
          workspaceId: session.workspaceId,
        }),
        listAgencyRestrictionOrganizationOptions({
          profileId: agencyDnaProfile.profileId,
          ownerId: session.dataOwnerId,
          workspaceId: session.workspaceId,
        }),
      ])
      : [[], []];

  return (
    <InternalPageFrame navItems={PROFILE_NAV}>
      <InternalPageHeader
        title="Профиль радара"
        subtitle="Кого, где и по каким признакам должен замечать Радар. Основные настройки идут первыми, точная настройка — в конце документа."
      />

      <div className={styles.document}>
        {profile && completion ? (
          <section className={styles.summaryZone} aria-label="Готовность профиля радара">
            <ProfileCompletionPanel completion={completion} matchCount={matchCount} />
          </section>
        ) : null}

        <section className={styles.formZone} aria-label="Настройки профиля радара">
          {profile ? (
            <ProfileForm profile={profile} resolvedHiringMode={resolvedHiringMode} />
          ) : (
            <div className={styles.emptyZone}>
              <StaticEmptyState
                title={ownerId ? "Профиль ещё не активирован" : "Нужен вход в аккаунт"}
                description={ownerId
                  ? "Профиль появится после активации Радара. Завершите онбординг, чтобы настроить рабочую практику."
                  : "Сессия этого браузера не связана с аккаунтом. Восстановите доступ, чтобы изменить профиль."}
                action={ownerId
                  ? <StateLink href="/checkout" label="Активировать Радар" />
                  : <StateLink href="/login" label="Войти в аккаунт" />}
              />
            </div>
          )}
        </section>

        {agencyDnaProfile ? (
          <section className={styles.secondaryZone}>
            <div className={styles.sectionIntro}>
              <h2>Практика агентства</h2>
              <p>Ограничения и рабочий контекст, которые уточняют соответствие компании вашей практике.</p>
            </div>
            <AgencyDnaForm
              profile={agencyDnaProfile}
              restrictions={agencyRestrictions}
              organizations={restrictionOrganizations}
              matchCount={matchCount}
            />
          </section>
        ) : null}

        {profile ? (
          <section id="notification-channels" className={styles.secondaryZone}>
            <div className={styles.sectionIntro}>
              <h2>Каналы доставки</h2>
              <p>Подключённые каналы для рабочих подборок и уведомлений.</p>
            </div>
            <NotificationChannels connections={notificationConnections} />
          </section>
        ) : null}

        {profile && deliveryPreferences ? (
          <section id="delivery" className={styles.secondaryZone}>
            <div className={styles.sectionIntro}>
              <h2>Расписание</h2>
              <p>Частота и местное время доставки. Резервные каналы продолжают использовать существующие настройки.</p>
            </div>
            <DeliveryForm preferences={deliveryPreferences} />
          </section>
        ) : null}
      </div>
    </InternalPageFrame>
  );
}
