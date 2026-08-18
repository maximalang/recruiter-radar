import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  getAdminUserDetail,
  listAdminUserWorkspaces,
  type AdminWorkspaceMembership,
  type DiagnosticStatus,
} from "@/lib/admin/adminUserDetail";
import { checkOperatorAccess } from "@/lib/operator-auth";
import {
  ContentCard,
  ContentCardTitle,
  InternalPageFrame,
  InternalPageHeader,
  internalPageClasses,
  type NavItem,
} from "../../../ui/internal-page";
import AdminUserActions from "./admin-user-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Пользователь — Recruiter Radar",
  robots: { index: false, follow: false },
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Обзор" },
  { href: "/admin", label: "Оператор", active: true },
];

export default async function AdminUserPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ workspaceId?: string }>;
}) {
  const access = await checkOperatorAccess();
  if (!access.ok) redirect("/admin");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const requestedWorkspaceId = (await searchParams).workspaceId?.trim() || null;
  const memberships = await listAdminUserWorkspaces(id);
  if (requestedWorkspaceId && !memberships.some((item) => item.id === requestedWorkspaceId)) {
    notFound();
  }
  const selectedWorkspaceId = requestedWorkspaceId
    ?? (memberships.length === 1 ? memberships[0].id : null);

  if (memberships.length > 1 && !selectedWorkspaceId) {
    return (
      <InternalPageFrame navItems={NAV}>
        <InternalPageHeader
          title="Р’С‹Р±РµСЂРёС‚Рµ workspace"
          subtitle={`User Control Center В· #${id}`}
        />
        <p className={internalPageClasses.bodyTextMutedBlock}>
          РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃРѕСЃС‚РѕРёС‚ РІ РЅРµСЃРєРѕР»СЊРєРёС… workspace. Р”РёР°РіРЅРѕСЃС‚РёРєР° Рё РѕРїРµСЂР°С†РёРё С‚СЂРµР±СѓСЋС‚ СЏРІРЅРѕРіРѕ РІС‹Р±РѕСЂР°.
        </p>
        <WorkspaceSelector userId={id} memberships={memberships} selectedId={null} />
      </InternalPageFrame>
    );
  }
  if (!selectedWorkspaceId) notFound();

  const user = await getAdminUserDetail(id, selectedWorkspaceId);
  if (!user) notFound();

  return (
    <InternalPageFrame navItems={NAV}>
      <InternalPageHeader
        title={user.account.fullName ?? user.account.email}
        subtitle={`User Control Center · #${user.account.id}`}
      />
      <p className={internalPageClasses.bodyTextMutedBlock}>
        <Link href="/admin">← Все пользователи</Link>
      </p>

      {memberships.length > 0 ? (
        <WorkspaceSelector
          userId={id}
          memberships={memberships}
          selectedId={selectedWorkspaceId}
        />
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        <ContentCard>
          <ContentCardTitle>Действия оператора</ContentCardTitle>
          <AdminUserActions
            userId={user.account.id}
            workspaceId={user.workspace?.id ?? null}
            profileActive={user.profile?.isActive === true}
            telegramConfigured={user.delivery.telegramConfigured}
            adminGrantActive={user.access.status === "active" && user.access.activeSources.includes("admin")}
            profile={user.profile}
          />
        </ContentCard>
        <ContentCard>
          <ContentCardTitle>Диагностика готовности</ContentCardTitle>
          <div style={{ display: "grid", gap: 8 }}>
            {user.diagnostics.map((item, index) => (
              <div key={item.key} style={{ display: "grid", gridTemplateColumns: "32px minmax(120px, 180px) 96px 1fr", gap: 10, alignItems: "center" }}>
                <span aria-hidden="true" style={{ color: "var(--color-text-tertiary)" }}>{index < user.diagnostics.length - 1 ? "↓" : "✓"}</span>
                <strong>{item.label}</strong>
                <StatusBadge status={item.status} />
                <span className={internalPageClasses.bodyText}>{item.reason}</span>
              </div>
            ))}
          </div>
        </ContentCard>

        <SectionGrid>
          <ContentCard>
            <ContentCardTitle>Аккаунт</ContentCardTitle>
            <Facts rows={[
              ["Email", user.account.email],
              ["ID", user.account.id],
              ["Создан", formatDate(user.account.createdAt)],
              ["Последний вход", formatDate(user.account.lastLoginAt)],
              ["Статус", user.account.status],
              ["Email подтверждён", user.account.emailVerifiedAt ? "Да" : "Нет"],
              ["Активные сессии", String(user.account.activeSessionCount)],
            ]} />
          </ContentCard>

          <ContentCard>
            <ContentCardTitle>Workspace</ContentCardTitle>
            <Facts rows={user.workspace ? [
              ["Название", user.workspace.name],
              ["ID", user.workspace.id],
              ["Роль", user.workspace.role],
              ["Статус", user.workspace.status],
            ] : [["Состояние", "Workspace не найден"]]} />
          </ContentCard>
        </SectionGrid>

        <SectionGrid>
          <ContentCard>
            <ContentCardTitle>Профиль агентства</ContentCardTitle>
            {user.profile ? <Facts rows={[
              ["Агентство", user.profile.agencyName],
              ["Статус Radar", user.profile.isActive ? "Активен" : "Приостановлен"],
              ["Специализация", user.profile.specialization ?? "—"],
              ["География", user.profile.targetCity ?? "—"],
              ["Роли", list(user.profile.roles)],
              ["Отрасли", list(user.profile.industries)],
              ["Размеры компаний", list(user.profile.companySizes)],
              ["Исключённые отрасли", list(user.profile.excludedIndustries)],
              ["Мин. hiring intent", nullable(user.profile.thresholds.hiringIntentMin)],
              ["Свежесть сигнала, дней", nullable(user.profile.thresholds.signalFreshnessDays)],
              ["Мин. открытых ролей", nullable(user.profile.thresholds.minOpenRoles)],
            ]} /> : <p className={internalPageClasses.bodyTextMutedBlock}>Профиль не создан.</p>}
          </ContentCard>

          <ContentCard>
            <ContentCardTitle>Доступ</ContentCardTitle>
            <Facts rows={user.access.status === "active" ? [
              ["План", user.access.plan],
              ["Источник", user.access.source],
              ["Начало", formatDate(user.access.startsAt)],
              ["Окончание", formatDate(user.access.expiresAt)],
              ["Осталось", remaining(user.access.expiresAt)],
              ["Возможности", list(user.access.features)],
              ["Активные источники", list(user.access.activeSources)],
            ] : [["Состояние", "Активного доступа нет"]]} />
          </ContentCard>
        </SectionGrid>

        <SectionGrid>
          <ContentCard>
            <ContentCardTitle>Доставка</ContentCardTitle>
            <Facts rows={[
              ["Главный переключатель", user.delivery.enabled ? "Включён" : "Выключен"],
              ["Telegram", user.delivery.telegramConfigured ? "Настроен" : "Не настроен"],
              ["Email", user.delivery.emailEnabled && user.delivery.emailConfigured ? "Включён" : "Не настроен"],
              ["Web push", user.delivery.webPushEnabled ? `${user.delivery.activeWebPushCount} активных` : "Выключен"],
              ["Другие endpoints", String(user.delivery.activeEndpointCount)],
              ["Последняя доставка", formatDate(user.delivery.lastSuccessAt)],
              ["Последняя ошибка", user.delivery.lastErrorAt ? `${formatDate(user.delivery.lastErrorAt)} · ${user.delivery.lastErrorCode ?? "без кода"}` : "—"],
            ]} />
          </ContentCard>

          <ContentCard>
            <ContentCardTitle>Radar</ContentCardTitle>
            <Facts rows={[
              ["Профиль активен", user.profile?.isActive ? "Да" : "Нет"],
              ["Компании с совпадениями", String(user.radar.matchingCompanyCount)],
              ["Текущие opportunities", String(user.radar.currentOpportunityCount)],
              ["Последний запуск", formatDate(user.radar.lastRunAt)],
              ["Последний дайджест", formatDate(user.radar.lastDigestAt)],
              ["Статус дайджеста", user.radar.lastDigestStatus ?? "—"],
              ["Последний сигнал", formatDate(user.radar.lastSignalAt)],
            ]} />
          </ContentCard>
        </SectionGrid>

        <ContentCard>
          <ContentCardTitle>Платежи и заказы</ContentCardTitle>
          {user.payments.length === 0 ? (
            <p className={internalPageClasses.bodyTextMutedBlock}>Заказов нет.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead><tr>{["ID", "Провайдер", "План", "Сумма", "Статус", "Payment ID", "Создан", "Оплачен"].map((label) => <th key={label} style={cellStyle}>{label}</th>)}</tr></thead>
                <tbody>{user.payments.map((order) => (
                  <tr key={order.id}>
                    <td style={cellStyle}>{order.id}</td><td style={cellStyle}>{order.provider ?? "—"}</td>
                    <td style={cellStyle}>{order.productCode}</td><td style={cellStyle}>{formatMoney(order.amountMinor, order.currency)}</td>
                    <td style={cellStyle}>{order.status}</td><td style={cellStyle}>{order.providerPaymentId ?? "—"}</td>
                    <td style={cellStyle}>{formatDate(order.createdAt)}</td><td style={cellStyle}>{formatDate(order.paidAt)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </ContentCard>
      </div>
    </InternalPageFrame>
  );
}

function WorkspaceSelector({ userId, memberships, selectedId }: {
  userId: string;
  memberships: AdminWorkspaceMembership[];
  selectedId: string | null;
}) {
  return (
    <ContentCard>
      <ContentCardTitle>Workspace</ContentCardTitle>
      <nav aria-label="Workspace пользователя" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {memberships.map((membership) => (
          <Link
            key={membership.id}
            href={`/admin/users/${userId}?workspaceId=${membership.id}`}
            aria-current={membership.id === selectedId ? "page" : undefined}
            style={{
              border: "1px solid var(--color-separator-strong)",
              borderRadius: 8,
              padding: "8px 10px",
              background: membership.id === selectedId ? "color-mix(in srgb, var(--color-information) 10%, var(--color-surface-primary))" : "var(--color-surface-elevated)",
            }}
          >
            {membership.name} В· {membership.role}
          </Link>
        ))}
      </nav>
    </ContentCard>
  );
}

function SectionGrid({ children }: { children: ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>{children}</div>;
}

function Facts({ rows }: { rows: Array<[string, string]> }) {
  return <dl style={{ display: "grid", gridTemplateColumns: "minmax(130px, 0.8fr) 1.2fr", gap: "8px 12px", margin: 0 }}>
    {rows.map(([label, value]) => <div key={label} style={{ display: "contents" }}><dt style={{ color: "var(--color-text-tertiary)" }}>{label}</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{value}</dd></div>)}
  </dl>;
}

function StatusBadge({ status }: { status: DiagnosticStatus }) {
  const tone = status === "PASS" ? ["var(--color-signal)", "color-mix(in srgb, var(--color-signal) 16%, var(--color-surface-primary))"] : status === "WARNING" ? ["var(--color-copper)", "color-mix(in srgb, var(--color-copper) 16%, var(--color-surface-primary))"] : ["var(--color-destructive)", "color-mix(in srgb, var(--color-destructive) 10%, var(--color-surface-primary))"];
  return <span style={{ color: tone[0], background: tone[1], padding: "3px 8px", borderRadius: 999, fontWeight: 800, fontSize: "0.72rem", textAlign: "center" }}>{status}</span>;
}

const cellStyle = { borderBottom: "1px solid var(--color-separator)", padding: "8px", textAlign: "left" as const, whiteSpace: "nowrap" as const };
const list = (values: readonly string[]) => values.length ? values.join(", ") : "—";
const nullable = (value: number | null) => value === null ? "—" : String(value);
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString("ru-RU") : "—";
const formatMoney = (minor: number, currency: string) => new Intl.NumberFormat("ru-RU", { style: "currency", currency }).format(minor / 100);
const remaining = (expiresAt: string | null) => {
  if (!expiresAt) return "Без ограничения";
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  return days > 0 ? `${days} дн.` : "Истёк";
};
