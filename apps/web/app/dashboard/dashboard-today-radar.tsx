import Link from "next/link";

import type { LeadItem } from "@/lib/leads-data";
import { deriveRoleNames, splitRolesForDisplay, deriveUrgencyCue } from "@/lib/leads/lead-quality";
import {
  EmptyState,
  ForeignEmployerBadge,
  ScoreBandChip,
  ScoreBar,
  SignalFreshnessChip,
  UrgencyCueChip,
} from "../ui/internal-page";
import { SearchIcon } from "../ui/icons";
import styles from "./dashboard-workspace.module.css";

interface DashboardTodayRadarProps {
  /** Top candidates worth contacting now, ranked by score. */
  topLeads: LeadItem[];
  /** Count of candidates awaiting analyst review. */
  pendingReview: number;
  /** Resolved hiring mode per active client profile id. */
  hiringModeByProfileId?: Record<string, "specialist" | "executive" | "volume">;
  lastRunAt: string | null;
}

export default function DashboardTodayRadar({
  topLeads,
  pendingReview,
  hiringModeByProfileId,
  lastRunAt,
}: DashboardTodayRadarProps) {
  return (
    <section className={styles.todayRadarSection} aria-labelledby="today-radar-heading">
      <div className={styles.todayRadarHeader}>
        <h2 id="today-radar-heading" className={styles.analyticsHeading}>
          Возможности на сегодня
        </h2>
        <Link href="/review" className={styles.todayRadarReviewPill} data-pending={pendingReview > 0}>
          На проверке: {pendingReview}
        </Link>
      </div>

      {topLeads.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title={lastRunAt ? "Подходящих компаний пока нет" : "Первый запуск Radar ещё не завершён"}
          text={lastRunAt ? "Последний запуск завершён, но компании не прошли ваши текущие фильтры. Можно расширить рынок или дождаться свежих сигналов." : "Профиль сохранён. После первого сканирования здесь появятся компании с evidence и рекомендуемым действием."}
          action={{ href: "/settings/radar", label: "Проверить настройки Radar" }}
        />
      ) : (
        <div className={styles.todayRadarList}>
          {topLeads.map((lead, index) => {
            const roleNames = deriveRoleNames({ evidenceTitles: lead.evidenceTitles });
            const { shown: shownRoles, more: moreRoles } = splitRolesForDisplay(roleNames, 2);
            const hiringMode = hiringModeByProfileId?.[lead.clientProfileId] ?? "specialist";
            const urgency = deriveUrgencyCue({
              vacanciesCount: lead.vacanciesCount,
              latestPublishedAt: lead.latestPublishedAt,
              hiringMode,
            });

            return (
              <Link
                key={lead.id}
                href={`/leads/${lead.id}`}
                className={styles.todayRadarCard}
                data-rank={index}
              >
                <div className={styles.todayRadarCardTop}>
                  <span className={styles.todayRadarOrg}>{lead.orgName}</span>
                  <ScoreBandChip score={lead.score} />
                  <ForeignEmployerBadge isForeign={lead.isForeignEmployer} />
                </div>

                <div className={styles.todayRadarScore}>
                  <ScoreBar score={lead.score} />
                </div>

                <div className={styles.todayRadarFreshness}>
                  <UrgencyCueChip level={urgency.level} label={urgency.label} />
                  {lead.latestPublishedAt ? (
                    <SignalFreshnessChip latestPublishedAt={lead.latestPublishedAt} />
                  ) : null}
                </div>

                {lead.whyNow ? (
                  <div className={styles.todayRadarLine}>
                    <span className={styles.todayRadarLineLabel}>Почему сейчас</span>
                    <span className={styles.todayRadarLineText}>{lead.whyNow}</span>
                  </div>
                ) : null}

                {lead.evidenceTitles.length > 0 ? (
                  <div className={styles.todayRadarLine}>
                    <span className={styles.todayRadarLineLabel}>Evidence</span>
                    <span className={styles.todayRadarLineText}>{lead.evidenceTitles.slice(0, 2).join(" · ")}</span>
                  </div>
                ) : null}

                {lead.opener ? (
                  <div className={styles.todayRadarLine}>
                    <span className={styles.todayRadarLineLabel}>Следующий шаг</span>
                    <span className={styles.todayRadarLineText}>{lead.opener}</span>
                  </div>
                ) : null}

                <div className={styles.todayRadarLine}>
                  <span className={styles.todayRadarLineLabel}>Роли</span>
                  <span className={styles.todayRadarLineText}>
                    {shownRoles.length > 0
                      ? `${shownRoles.join(" · ")}${moreRoles > 0 ? ` + ещё ${moreRoles}` : ""}`
                      : "роли не определены"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
