import type { Metadata } from "next";
import {
  InternalPageFrame,
  InternalPageHeader,
  ContentCard,
  EmptyState,
  type NavItem,
} from "../ui/internal-page";
import { SiteFooter } from "../ui/site-footer";
import { getClientProfileByOwnerId, resolveHiringMode } from "../../lib/clientProfiles";
import { getDeliveryPreferencesByOwnerId } from "../../lib/deliveryPreferences";
import { countMatchingCandidatesForProfile } from "../../lib/digest";
import { computeProfileCompletion } from "../../lib/profileCompletion";
import { readOwnerSession } from "../../lib/session";
import { ProfileForm } from "./profile-form";
import { DeliveryForm } from "./delivery-form";
import ProfileCompletionPanel from "./profile-completion-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Профиль — Recruiter Radar",
  description: "Кого вы ищете: роли, отрасли, география и точная настройка радара.",
};

const PROFILE_NAV: NavItem[] = [
  { href: "/dashboard", label: "Дашборд" },
  { href: "/leads", label: "Лиды" },
  { href: "/review", label: "Ревью" },
  { href: "/profile", label: "Профиль", active: true },
];

export default async function ProfilePage() {
  const ownerId = await readOwnerSession();
  const profile = ownerId ? await getClientProfileByOwnerId(ownerId) : null;
  const deliveryPreferences =
    ownerId && profile ? await getDeliveryPreferencesByOwnerId(ownerId) : null;

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
  const resolvedHiringMode = profile ? resolveHiringMode(profile) : 'specialist';

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
            title="Профиль ещё не активирован"
            text="Профиль появится после активации пилота. Завершите онбординг, чтобы настроить идеального клиента."
            action={{ href: "/checkout", label: "Активировать пилот" }}
          />
        )}
      </ContentCard>
      {profile && deliveryPreferences ? (
        <ContentCard>
          <InternalPageHeader
            title="Как доставлять радар"
            subtitle="Telegram — основной канал. Дополнительно: браузерные уведомления и ежедневный email."
          />
          <DeliveryForm preferences={deliveryPreferences} />
        </ContentCard>
      ) : null}
    </InternalPageFrame>
  );
}
