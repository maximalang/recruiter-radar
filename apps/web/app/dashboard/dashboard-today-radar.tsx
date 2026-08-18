import Link from "next/link";
import type { LeadItem } from "@/lib/leads-data";
import { deriveRoleNames, splitRolesForDisplay, deriveUrgencyCue } from "@/lib/leads/lead-quality";
import { formatVacanciesCount, pluralForm } from "@/lib/format/plural";
import { formatSignalFreshness } from "../ui/internal-page";
import { StaticEmptyState } from "../ui/static-empty-state";
import { TargetIcon } from "../ui/icons";
import styles from "./dashboard-workspace.module.css";

interface DashboardTodayRadarProps {
  topLeads: LeadItem[];
  pendingReview: number;
  hiringModeByProfileId?: Record<string, "specialist" | "executive" | "volume">;
  lastRunAt: string | null;
}

function confidenceLabel(gate: LeadItem["confidenceGate"]) {
  if (gate === "A") return "высокое подтверждение";
  if (gate === "B") return "достаточное подтверждение";
  if (gate === "C") return "требует проверки";
  return "недостаточно подтверждений";
}

function formatEvidenceCount(count: number) {
  return `${count} ${pluralForm(count, ["подтверждение", "подтверждения", "подтверждений"])}`;
}

function formatSourceCount(count: number) {
  return `${count} ${pluralForm(count, ["источник", "источника", "источников"])}`;
}

export default function DashboardTodayRadar({ topLeads, pendingReview, hiringModeByProfileId, lastRunAt }: DashboardTodayRadarProps) {
  return (
    <section className={styles.todayRadarSection} aria-labelledby="today-radar-heading">
      <div className={styles.todayRadarHeader}>
        <div>
          <span className={styles.sectionEyebrow}>Приоритет</span>
          <h2 id="today-radar-heading" className={styles.analyticsHeading}>Что требует внимания</h2>
        </div>
      </div>

      {topLeads.length === 0 ? (
        <StaticEmptyState
          icon={TargetIcon}
          title={lastRunAt ? "Подходящих компаний пока нет" : "Первое сканирование ещё не завершено"}
          description={lastRunAt ? "Последний запуск завершён, но компании не прошли текущие условия. Можно уточнить профиль или дождаться новых сигналов." : "После первого сканирования здесь появятся компании, причины приоритета и подтверждения."}
          action={<Link href="/settings/radar">Проверить профиль радара</Link>}
        />
      ) : (
        <div className={styles.todayRadarList}>
          {topLeads.slice(0, 5).map((lead, index) => {
            const roleNames = deriveRoleNames({ evidenceTitles: lead.evidenceTitles });
            const { shown: shownRoles, more: moreRoles } = splitRolesForDisplay(roleNames, 2);
            const hiringMode = hiringModeByProfileId?.[lead.clientProfileId] ?? "specialist";
            const urgency = deriveUrgencyCue({ vacanciesCount: lead.vacanciesCount, latestPublishedAt: lead.latestPublishedAt, hiringMode });
            const freshness = formatSignalFreshness(lead.latestPublishedAt)?.label ?? "свежесть уточняется";
            const roles = shownRoles.length > 0 ? `${shownRoles.join(" · ")}${moreRoles > 0 ? ` + ещё ${moreRoles}` : ""}` : "роли уточняются";

            return (
              <Link key={lead.id} href={`/leads/${lead.id}`} className={styles.todayRadarRow}>
                <span className={styles.todayRank}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.todayIdentity}>
                  <strong>{lead.orgName}</strong>
                  <small>{lead.locationNames.slice(0, 2).join(", ") || "география уточняется"}</small>
                </span>
                <span className={styles.todayDecision}>
                  <strong>{lead.whyNow || urgency.label}</strong>
                  <small>{freshness} · {roles}</small>
                </span>
                <span className={styles.todayEvidence}>
                  <strong>{formatEvidenceCount(lead.evidenceTitles.length)}</strong>
                  <small>{formatSourceCount(lead.sourceFamilies.length)} · {formatVacanciesCount(lead.vacanciesCount)}</small>
                </span>
                <span className={styles.todayConfidence}>{confidenceLabel(lead.confidenceGate)}</span>
                <span className={styles.todayAction}>Открыть</span>
              </Link>
            );
          })}
        </div>
      )}

      <div className={styles.todayWorkflow} aria-labelledby="today-workflow-heading">
        <h3 id="today-workflow-heading">Рабочий контур</h3>
        <Link href="/review" className={styles.todayWorkflowRow}>
          <span>На проверке</span>
          <strong>{pendingReview}</strong>
          <i aria-hidden="true">→</i>
        </Link>
      </div>
    </section>
  );
}
