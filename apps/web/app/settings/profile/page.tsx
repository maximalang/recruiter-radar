import {
  InternalPageFrame,
  InternalPageHeader,
  ContentCard,
  EmptyState,
  type NavItem,
} from "../../ui/internal-page";
import { getClientProfileByOwnerId } from "../../../lib/clientProfiles";
import { getDeliveryPreferencesByOwnerId } from "../../../lib/deliveryPreferences";
import { readOwnerSession } from "../../../lib/session";
import { ProfileForm } from "./profile-form";
import { DeliveryForm } from "./delivery-form";

export const dynamic = "force-dynamic";

const SETTINGS_NAV: NavItem[] = [
  { href: "/dashboard", label: "📊 Дашборд" },
  { href: "/leads", label: "🎯 Лиды" },
  { href: "/review", label: "🔍 Ревью" },
  { href: "/settings/profile", label: "⚙️ Профиль", active: true },
];

export default async function SettingsProfilePage() {
  const ownerId = await readOwnerSession();
  const profile = ownerId ? await getClientProfileByOwnerId(ownerId) : null;
  const deliveryPreferences =
    ownerId && profile ? await getDeliveryPreferencesByOwnerId(ownerId) : null;

  return (
    <InternalPageFrame navItems={SETTINGS_NAV}>
      <InternalPageHeader
        title="Кто ваши идеальные клиенты?"
        subtitle="Чем точнее профиль, тем релевантнее радар. Эти настройки фильтруют и ранжируют ежедневную подборку — не только влияют на скоринг."
      />
      <ContentCard>
        {profile ? (
          <ProfileForm profile={profile} />
        ) : (
          <EmptyState
            icon="⚙️"
            title="Профиль ещё не активирован"
            text="Профиль появится после активации пилота. Завершите онбординг, чтобы настроить идеального клиента."
          />
        )}
      </ContentCard>
      {profile && deliveryPreferences ? (
        <ContentCard>
          <InternalPageHeader
            title="Как доставлять радар"
            subtitle="Telegram — основной канал. Дополнительно включите браузерные уведомления и ежедневный email-дайджест."
          />
          <DeliveryForm preferences={deliveryPreferences} />
        </ContentCard>
      ) : null}
    </InternalPageFrame>
  );
}
