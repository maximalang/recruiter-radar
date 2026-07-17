import Link from "next/link";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";

import { getSourceRegistry, getPrimarySourceIds } from "@/lib/sources/source-registry";
import {
  getDashboardSourceHealth,
  getDashboardQualityMetrics,
  getDashboardOverviewMetrics,
  getDashboardFeedbackFunnel,
  getDashboardLeadMetrics,
  getDashboardSourcePerformance,
  getDashboardSourceEvidenceQuality,
  getDashboardIngestTrend,
  getOperatorUsers,
  type IngestTrend,
  type OperatorUserRow,
} from "@/lib/dashboard-data";
import { getOperatorSettingsForDisplay } from "@/lib/operatorSettings";
import { checkOperatorAccess, isOperatorPanelConfigured, operatorLockedReason } from "@/lib/operator-auth";
import {
  InternalPageFrame,
  InternalPageHeader,
  ContentCard,
  ContentCardTitle,
  GATE_LABELS,
  internalPageClasses,
  type NavItem,
} from "../ui/internal-page";
import { SiteFooter } from "../ui/site-footer";
import AdminIngestForm from "./admin-ingest-form";
import AdminLlmConfigForm from "./admin-llm-config-form";
import AdminLoginForm from "./admin-login-form";
import AdminLogoutButton from "./admin-logout-button";
import AdminUserCard from "./admin-user-card";

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

// Tone helpers for the analytics cards — kept local to the operator console.
const GATE_COLOR: Record<string, string> = {
  A: "#047857",
  B: "#1d4ed8",
  C: "#b45309",
  D: "#64748b",
};

function rateColor(r: number): string {
  return r >= 30 ? "#047857" : r >= 15 ? "#b45309" : "#b42318";
}

export default async function AdminPage() {
  const access = await checkOperatorAccess();
  const configured = isOperatorPanelConfigured();

  // State 1: panel not configured (no ADMIN_OPERATOR_PASSWORD on server)
  if (!configured) {
    return (
      <InternalPageFrame navItems={ADMIN_NAV} footer={<SiteFooter />}>
        <InternalPageHeader title="Панель оператора" />
        <div className={internalPageClasses.narrowLayout}>
          <ContentCard>
            <ContentCardTitle>Доступ ограничен</ContentCardTitle>
            <p className={internalPageClasses.bodyText}>
              {operatorLockedReason("missing-config")}
            </p>
            <p className={internalPageClasses.bodyTextMutedBlock}>
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
      <InternalPageFrame navItems={ADMIN_NAV} footer={<SiteFooter />}>
        <InternalPageHeader title="Панель оператора" />
        <div className={internalPageClasses.narrowLayout}>
          <ContentCard>
            <ContentCardTitle>Вход оператора</ContentCardTitle>
            <p className={internalPageClasses.bodyText}>
              Панель оператора: запуск инжеста, мониторинг источников и метрики качества.
              Введите пароль, чтобы открыть консоль.
            </p>
            <AdminLoginForm />
          </ContentCard>
        </div>
      </InternalPageFrame>
    );
  }

  // State 3: authenticated operator console.
  // All fetchers are wrapped so a single DB/query failure degrades that one
  // card to "недоступно" rather than crashing the whole console (mirrors the
  // dashboard's safeDashboardFetch pattern). The raw error never reaches the
  // DOM — only the human copy.
  const registry = getSourceRegistry();
  const primaryIds = new Set(getPrimarySourceIds());

  const [health, overview, quality, feedbackFunnel, leadMetrics, sourcePerformance, sourceEvidenceQuality, ingestTrend, llmSettings, users] =
    await Promise.all([
      safe(() => getDashboardSourceHealth(), []),
      safe(() => getDashboardOverviewMetrics(), null),
      safe(() => getDashboardQualityMetrics(), null),
      safe(() => getDashboardFeedbackFunnel(), null),
      safe(() => getDashboardLeadMetrics(), null),
      safe(() => getDashboardSourcePerformance(), null),
      safe(() => getDashboardSourceEvidenceQuality(), null),
      safe(() => getDashboardIngestTrend(), null),
      safe(() => getOperatorSettingsForDisplay(), []),
      safe(() => getOperatorUsers(), [] as OperatorUserRow[]),
    ]);

  const healthById = new Map(health.map((h) => [h.id, h]));

  const sources = registry.map((s) => {
    const h = healthById.get(s.id);
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      isPrimary: primaryIds.has(s.id),
      timeoutMs: s.timeoutMs ?? 120_000,
      status: h?.status,
      overall: h?.overall,
      recordsLast24h: h?.recordsProcessed,
      lastRun: h?.lastRun ?? null,
    };
  });

  return (
    <InternalPageFrame navItems={ADMIN_NAV} footer={<SiteFooter />}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <InternalPageHeader title="Панель оператора" />
        <AdminLogoutButton />
      </div>
      <div style={{ display: "grid", gap: "16px" }}>
        {/* Overview — operational telemetry at a glance */}
        <ContentCard>
          <ContentCardTitle>Состояние системы</ContentCardTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
            <Metric label="Сигналов / 24ч" value={overview ? String(overview.totalAlerts ?? 0) : "—"} />
            <Metric label="Источников" value={String(sources.length)} />
            <Metric label="Primary" value={String(sources.filter((s) => s.isPrimary).length)} />
            <Metric label="Здоровье" value={overview ? `${overview.overallHealth}%` : "—"} />
          </div>
        </ContentCard>

        {/* Ingest volume trend (7 days) — surfaces a silently-failing source.
            A source that fetches but writes 0 every day (timeout mid-write) shows
            as an all-zero column here even when the 24h health card flips between
            0 and healthy. Read-only daily signal counts grouped by occurred_at. */}
        <ContentCard>
          <ContentCardTitle>Объём инжеста за 7 дней</ContentCardTitle>
          {ingestTrend && ingestTrend.days.length > 0 ? (
            <IngestTrendChart trend={ingestTrend} />
          ) : (
            <p className={internalPageClasses.bodyTextMutedBlock}>
              Нет данных за 7 дней.
            </p>
          )}
        </ContentCard>

        {/* Lead + funnel — what the pipeline is producing */}
        <ContentCard>
          <ContentCardTitle>Лиды и воронка</ContentCardTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
            <Metric label="Лидов всего" value={leadMetrics ? String(leadMetrics.totalLeads) : "—"} />
            <Metric label="Сегодня" value={leadMetrics ? String(leadMetrics.todayLeads) : "—"} />
            <Metric label="Ср. сила сигнала" value={leadMetrics ? `${leadMetrics.avgScore} / 4` : "—"} />
            <Metric
              label="Конверсия 7д"
              value={quality ? `${quality.acceptanceRate7d.rate}%` : "—"}
              accent={quality ? rateColor(quality.acceptanceRate7d.rate) : undefined}
            />
            <Metric
              label="Конверсия 30д"
              value={quality ? `${quality.acceptanceRate30d.rate}%` : "—"}
              accent={quality ? rateColor(quality.acceptanceRate30d.rate) : undefined}
            />
          </div>
          {feedbackFunnel && feedbackFunnel.length > 0 ? (
            <div style={{ marginTop: "14px", display: "grid", gap: "6px" }}>
              <div style={{ fontSize: "0.78rem", color: "var(--c-text-muted, #667085)", fontWeight: 700 }}>
                Воронка обратной связи
              </div>
              {feedbackFunnel.map((row) => (
                <div key={row.status} style={funnelRowStyle}>
                  <span style={{ fontSize: "0.84rem", color: "var(--c-text-secondary, #475569)" }}>{row.label}</span>
                  <span style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--c-text-primary, #0f172a)" }}>
                    {row.count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className={internalPageClasses.bodyTextMutedBlock} style={{ marginTop: "12px" }}>
              Воронка обратной связи пока пуста.
            </p>
          )}
        </ContentCard>

        {/* Gate distribution — evidence-quality breakdown */}
        <ContentCard>
          <ContentCardTitle>Распределение по уровню доверия (30 дней)</ContentCardTitle>
          {quality && quality.gateDistribution.length > 0 ? (
            <div style={{ display: "grid", gap: "8px" }}>
              {quality.gateDistribution.map((g) => {
                const max = Math.max(...quality.gateDistribution.map((x) => x.count), 1);
                return (
                  <div key={g.gate} style={funnelRowStyle}>
                    <span style={{ fontSize: "0.84rem", color: GATE_COLOR[g.gate] ?? "#64748b", fontWeight: 700, minWidth: "180px" }}>
                      {GATE_LABELS[g.gate] ?? g.gate}
                    </span>
                    <div style={{ flex: 1, height: "8px", borderRadius: "999px", background: "rgba(15,23,42,0.07)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${(g.count / max) * 100}%`, background: GATE_COLOR[g.gate] ?? "#64748b", borderRadius: "999px" }} />
                    </div>
                    <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--c-text-secondary, #475569)", whiteSpace: "nowrap" }}>
                      {g.count} · {g.percentage}%
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={internalPageClasses.bodyTextMutedBlock}>Нет данных за 30 дней.</p>
          )}
        </ContentCard>

        {/* Source performance + evidence quality — which sources carry weight */}
        <ContentCard>
          <ContentCardTitle>Источники — объём и качество доказательств</ContentCardTitle>
          {sourceEvidenceQuality && sourceEvidenceQuality.length > 0 ? (
            <div style={{ display: "grid", gap: "8px" }}>
              {sourceEvidenceQuality.map((row) => (
                <div key={row.source} style={sourceRowStyle}>
                  <div style={{ minWidth: "120px" }}>
                    <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>{row.source}</div>
                    <div style={{ fontSize: "0.74rem", color: "var(--c-text-muted, #667085)" }}>
                      {row.leads} лидов
                      {row.avgAgeDays != null ? ` · ср. свежесть ${row.avgAgeDays}д` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <Tag color="#047857" bg="#d1fae5">A {row.gateA}</Tag>
                    <Tag color="#1d4ed8" bg="#dbeafe">B {row.gateB}</Tag>
                    <Tag color="#b45309" bg="#fef3c7">C {row.gateC}</Tag>
                    <Tag color="#4b5563" bg="#f3f4f6">прям. {row.directHiringProof}</Tag>
                    <Tag color="#4b5563" bg="#f3f4f6">агр. {row.platformAggregation}</Tag>
                  </div>
                </div>
              ))}
            </div>
          ) : sourcePerformance && sourcePerformance.length > 0 ? (
            <div style={{ display: "grid", gap: "8px" }}>
              {sourcePerformance.map((row) => (
                <div key={row.source} style={sourceRowStyle}>
                  <span style={{ fontWeight: 700, fontSize: "0.88rem", minWidth: "120px" }}>{row.source}</span>
                  <span style={{ fontSize: "0.82rem", color: "var(--c-text-secondary, #475569)" }}>
                    {row.leads} лидов · ср. {row.avgScore?.toFixed(1) ?? "—"} / 4
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className={internalPageClasses.bodyTextMutedBlock}>Данные по источникам пока не накоплены.</p>
          )}
        </ContentCard>

        {/* Ingest trigger */}
        <ContentCard>
          <ContentCardTitle>Запуск инжеста</ContentCardTitle>
          <p className={internalPageClasses.bodyText}>
            Принудительный забор данных из источников. В норме запускается по расписанию (cron 06:00 МСК).
            Используйте для ручного прогона после правок конфигурации источника.
          </p>
          <AdminIngestForm sources={sources} />
        </ContentCard>

        {/* LLM provider config — switch providers at runtime (no redeploy).
            The seam for the future in-app LLM: today only Firecrawl structured
            extraction consumes these, but the resolver (llm-config) + this panel
            are the stable URL/config surface any future LLM call will route
            through. Secrets are masked in display and never logged. */}
        <ContentCard>
          <ContentCardTitle>LLM-провайдер</ContentCardTitle>
          <p className={internalPageClasses.bodyText}>
            Смена API-ключа, Base URL и модели — без редеплоя и правки env.
            Приоритет: значение из панели → env (OPENAI_API_KEY / OPENAI_BASE_URL /
            CODEXOID_MODEL).
          </p>
          <AdminLlmConfigForm settings={llmSettings} />
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

        {/* User management — who signed up + functional write-actions.
            The operator can ACT on a user from here, not just view: activate /
            extend a 7-day pilot, pause a pilot, toggle profile is_active (digest
            on/off), and unlink Telegram delivery. All actions run behind the
            operator-session gate (re-checked server-side). */}
        <ContentCard>
          <ContentCardTitle>Пользователи ({users.length})</ContentCardTitle>
          {users.length === 0 ? (
            <p className={internalPageClasses.bodyTextMutedBlock}>
              Зарегистрированных пользователей пока нет.
            </p>
          ) : (
            <div style={{ display: "grid", gap: "8px" }}>
              {users.map((u) => (
                <AdminUserCard
                  key={u.id}
                  user={{
                    id: u.id,
                    email: u.email,
                    fullName: u.fullName,
                    createdAt: u.createdAt,
                    profile: u.profile
                      ? {
                          id: u.profile.id,
                          agencyName: u.profile.agencyName,
                          isActive: u.profile.isActive,
                          specialization: u.profile.specialization,
                          telegramChatId: u.profile.telegramChatId,
                        }
                      : null,
                    pilot: u.pilot
                      ? { status: u.pilot.status, endsAt: u.pilot.endsAt }
                      : null,
                    hasPaidOrder: u.hasPaidOrder,
                    paidOrderCount: u.paidOrderCount,
                  }}
                />
              ))}
            </div>
          )}
        </ContentCard>
      </div>
    </InternalPageFrame>
  );
}

// Run a dashboard fetcher with per-card recovery: a rejection degrades that one
// card to the provided fallback value (null/[]) instead of crashing the whole
// console. The raw error is logged server-side and NEVER reaches the DOM.
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error("[admin] fetcher failed", err instanceof Error ? err.message : String(err));
    return fallback;
  }
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ padding: "12px", borderRadius: "12px", background: "rgba(241,245,249,0.6)" }}>
      <div style={{ fontSize: "1.1rem", fontWeight: 800, color: accent ?? "var(--c-text-primary, #0f172a)" }}>{value}</div>
      <div style={{ fontSize: "0.76rem", color: "var(--c-text-muted, #667085)" }}>{label}</div>
    </div>
  );
}

function Tag({ children, color, bg }: { children: ReactNode; color: string; bg: string }) {
  return (
    <span style={{ padding: "3px 8px", borderRadius: "999px", fontSize: "0.72rem", fontWeight: 700, color, background: bg, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

const funnelRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "8px 12px",
  border: "1px solid var(--c-border, #e2e8f0)",
  borderRadius: "10px",
};

const sourceRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  justifyContent: "space-between",
  flexWrap: "wrap",
  padding: "10px 12px",
  border: "1px solid var(--c-border, #e2e8f0)",
  borderRadius: "12px",
};

/**
 * Stable color per source so a given source reads the same across days. The
 * palette is deliberately distinct (not a gradient) so two adjacent stack
 * segments are easy to separate visually.
 */
const SOURCE_COLORS: Record<string, string> = {
  "career-pages": "#1d4ed8",
  "habr-career": "#7c3aed",
  "rabota-rossii": "#047857",
  superjob: "#b45309",
  hh: "#64748b",
};
const SOURCE_COLOR_FALLBACK = "#9333ea";

function sourceColor(source: string): string {
  return SOURCE_COLORS[source] ?? SOURCE_COLOR_FALLBACK;
}

/**
 * Compact 7-day ingest-volume chart with a PER-SOURCE stacked breakdown.
 *
 * Each day is a column of stacked segments (one per source that wrote that
 * day), so a source that fetched but wrote 0 — or was absent from the run —
 * shows as a missing segment / shorter column rather than being hidden inside
 * a single blue total. The total is labelled under each column. A compact
 * legend lists the sources that appeared in the window. This makes a silently
 * failing source (e.g. career-pages losing every record to a timeout mid-write)
 * visible at a glance, which the old single-color total chart could not.
 */
function IngestTrendChart({ trend }: { trend: IngestTrend }) {
  const max = Math.max(...trend.days.map((d) => d.total), 1);
  const orderedSources = trend.sources;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", height: "120px", paddingTop: "12px" }}>
        {trend.days.map((d) => {
          const heightPct = d.total > 0 ? Math.max((d.total / max) * 100, 6) : 0;
          const dayLabel = d.day.slice(8);
          const presentSources = orderedSources.filter((s) => (d.bySource[s] ?? 0) > 0);
          return (
            <div key={d.day} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", flex: 1 }}>
              <div
                style={{
                  width: "100%",
                  maxWidth: "36px",
                  height: `${heightPct}%`,
                  minHeight: d.total > 0 ? "6px" : "2px",
                  display: "flex",
                  flexDirection: "column-reverse",
                  borderRadius: "6px 6px 0 0",
                  overflow: "hidden",
                  background: d.total > 0 ? "transparent" : "rgba(15,23,42,0.08)",
                  transition: "height 0.2s ease",
                }}
                title={`${d.day}: ${d.total} сигналов\n${presentSources
                  .map((s) => `${s}: ${d.bySource[s]}`)
                  .join("\n")}`}
              >
                {d.total > 0
                  ? presentSources.map((s) => {
                      const segPct = (d.bySource[s] / d.total) * 100;
                      return (
                        <div
                          key={s}
                          style={{ height: `${segPct}%`, background: sourceColor(s), width: "100%" }}
                        />
                      );
                    })
                  : null}
              </div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: d.total > 0 ? "var(--c-text-primary, #0f172a)" : "var(--c-text-muted, #667085)" }}>
                {d.total}
              </div>
              <div style={{ fontSize: "0.7rem", color: "var(--c-text-muted, #667085)" }}>{dayLabel}</div>
            </div>
          );
        })}
      </div>
      {orderedSources.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: "10px" }}>
          {orderedSources.map((s) => (
            <span key={s} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "0.72rem", color: "var(--c-text-secondary, #475569)" }}>
              <span style={{ width: "9px", height: "9px", borderRadius: "2px", background: sourceColor(s), display: "inline-block" }} />
              {s}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

