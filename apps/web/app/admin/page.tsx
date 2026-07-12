import Link from "next/link";
import type { Metadata } from "next";

import { getSourceRegistry, getPrimarySourceIds } from "@/lib/sources/source-registry";
import { getDashboardSourceHealth, getDashboardQualityMetrics, getDashboardOverviewMetrics } from "@/lib/dashboard-data";
import { checkOperatorAccess, isOperatorPanelConfigured, operatorLockedReason } from "@/lib/operator-auth";
import {
  InternalPageFrame,
  InternalPageHeader,
  ContentCard,
  ContentCardTitle,
  type NavItem,
} from "../ui/internal-page";
import ppStyles from "../ui/page-primitives.module.css";
import AdminIngestForm from "./admin-ingest-form";
import AdminLoginForm from "./admin-login-form";
import AdminLogoutButton from "./admin-logout-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Панель оператора — Recruiter Radar",
  description: "Запуск инжеста, мониторинг источников и метрики качества.",
  robots: { index: false, follow: false },
};

const ADMIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Дашборд" },
  { href: "/leads", label: "Лиды" },
  { href: "/admin", label: "Оператор", active: true },
];

function statusTone(status: string | undefined): { color: string; bg: string; label: string } {
  switch (status) {
    case "excellent":
      return { color: "#065f46", bg: "#d1fae5", label: "excellent" };
    case "good":
      return { color: "#1e40af", bg: "#dbeafe", label: "good" };
    case "warning":
      return { color: "#92400e", bg: "#fef3c7", label: "warning" };
    case "critical":
      return { color: "#b42318", bg: "#fee4e2", label: "critical" };
    default:
      return { color: "#4b5563", bg: "#f3f4f6", label: "нет данных" };
  }
}

export default async function AdminPage() {
  const access = await checkOperatorAccess();
  const configured = isOperatorPanelConfigured();

  // State 1: panel not configured (no ADMIN_OPERATOR_PASSWORD on server)
  if (!configured) {
    return (
      <InternalPageFrame navItems={ADMIN_NAV}>
        <InternalPageHeader title="Панель оператора" />
        <div className={ppStyles.narrowLayout}>
          <ContentCard>
            <ContentCardTitle>Доступ ограничен</ContentCardTitle>
            <p className={ppStyles.bodyText}>
              {operatorLockedReason("missing-config")}
            </p>
            <p className={ppStyles.bodyTextMutedBlock}>
              Панель оператора предназначена для администратора сервиса (запуск инжеста,
              мониторинг источников, метрики качества). Обычные пользователи работают
              в <Link href="/dashboard" style={{ color: "inherit", textDecoration: "underline" }}>дашборде</Link>.
            </p>
          </ContentCard>
        </div>
      </InternalPageFrame>
    );
  }

  // State 2: configured but not logged in (no session cookie)
  if (!access.ok) {
    return (
      <InternalPageFrame navItems={ADMIN_NAV}>
        <InternalPageHeader title="Панель оператора" />
        <div className={ppStyles.narrowLayout}>
          <ContentCard>
            <ContentCardTitle>Вход оператора</ContentCardTitle>
            <p className={ppStyles.bodyText}>
              Панель оператора: запуск инжеста, мониторинг источников и метрики качества.
              Введите пароль, чтобы открыть консоль.
            </p>
            <AdminLoginForm />
          </ContentCard>
        </div>
      </InternalPageFrame>
    );
  }

  // State 3: authenticated operator console
  const registry = getSourceRegistry();
  const primaryIds = new Set(getPrimarySourceIds());
  let health: Awaited<ReturnType<typeof getDashboardSourceHealth>> = [];
  try {
    health = await getDashboardSourceHealth();
  } catch {
    health = [];
  }
  const healthById = new Map(health.map((h) => [h.id, h]));

  let quality: Awaited<ReturnType<typeof getDashboardQualityMetrics>> | null = null;
  try {
    quality = await getDashboardQualityMetrics();
  } catch {
    quality = null;
  }

  let overview: Awaited<ReturnType<typeof getDashboardOverviewMetrics>> | null = null;
  try {
    overview = await getDashboardOverviewMetrics();
  } catch {
    overview = null;
  }

  const sources = registry.map((s) => {
    const h = healthById.get(s.id);
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      isPrimary: primaryIds.has(s.id),
      status: h?.status,
      overall: h?.overall,
      recordsLast24h: h?.recordsProcessed,
      lastRun: h?.lastRun ?? null,
    };
  });

  return (
    <InternalPageFrame navItems={ADMIN_NAV}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <InternalPageHeader title="Панель оператора" />
        <AdminLogoutButton />
      </div>
      <div style={{ display: "grid", gap: "16px" }}>
        {/* Overview metrics */}
        <ContentCard>
          <ContentCardTitle>Состояние системы</ContentCardTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px" }}>
            <Metric label="Сигналов / 24ч" value={overview ? String(overview.totalAlerts ?? "—") : "—"} />
            <Metric label="Источников" value={String(sources.length)} />
            <Metric label="Primary" value={String(sources.filter((s) => s.isPrimary).length)} />
            <Metric label="Здоровье" value={overview ? `${overview.overallHealth}%` : "—"} />
          </div>
          {quality ? (
            <div style={{ marginTop: "14px", display: "grid", gap: "8px" }}>
              <div style={{ fontSize: "0.82rem", color: "var(--c-text-muted, #667085)", fontWeight: 700 }}>
                Метрики качества
              </div>
              <pre style={{ margin: 0, fontSize: "0.8rem", color: "var(--c-text-secondary, #475569)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {JSON.stringify(quality, null, 2)}
              </pre>
            </div>
          ) : (
            <p className={ppStyles.bodyTextMutedBlock} style={{ marginTop: "12px" }}>
              Метрики качества недоступны.
            </p>
          )}
        </ContentCard>

        {/* Ingest trigger */}
        <ContentCard>
          <ContentCardTitle>Запуск инжеста</ContentCardTitle>
          <p className={ppStyles.bodyText}>
            Принудительный забор данных из источников. В норме запускается по расписанию (cron 06:00 МСК).
            Используйте для ручного прогона после правок конфигурации источника.
          </p>
          <AdminIngestForm />
        </ContentCard>

        {/* Source health table */}
        <ContentCard>
          <ContentCardTitle>Источники — здоровье за 24ч</ContentCardTitle>
          <div style={{ display: "grid", gap: "8px" }}>
            {sources.map((s) => {
              const tone = statusTone(s.status);
              return (
                <div
                  key={s.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: "12px",
                    alignItems: "center",
                    padding: "10px 12px",
                    border: "1px solid var(--c-border, #e2e8f0)",
                    borderRadius: "12px",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>{s.name}</div>
                    <div style={{ fontSize: "0.76rem", color: "var(--c-text-muted, #667085)" }}>
                      {s.id} · {s.category}{s.isPrimary ? " · primary" : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: "0.8rem", color: "var(--c-text-secondary, #475569)" }}>
                    <div>{s.recordsLast24h ?? 0} зап. / 24ч</div>
                    <div style={{ fontSize: "0.72rem", color: "var(--c-text-muted, #667085)" }}>
                      {s.lastRun ?? "нет запуска"}
                    </div>
                  </div>
                  <span
                    style={{
                      padding: "3px 9px",
                      borderRadius: "999px",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      color: tone.color,
                      background: tone.bg,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tone.label}
                  </span>
                </div>
              );
            })}
          </div>
        </ContentCard>
      </div>
    </InternalPageFrame>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "12px", borderRadius: "12px", background: "rgba(241,245,249,0.6)" }}>
      <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "var(--c-text-primary, #0f172a)" }}>{value}</div>
      <div style={{ fontSize: "0.76rem", color: "var(--c-text-muted, #667085)" }}>{label}</div>
    </div>
  );
}
