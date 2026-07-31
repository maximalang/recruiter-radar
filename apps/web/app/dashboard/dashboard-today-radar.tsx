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
import styles from "./dashboard-v2.module.css";

interface DashboardTodayRadarProps {
  /** Top candidates worth contacting now, ranked by score. */
  topLeads: LeadItem[];
  /** Count of candidates awaiting analyst review. */
  pendingReview: number;
  /** Resolved hiring mode per active client profile id. */
  hiringModeByProfileId?: Record<string, "specialist" | "executive" | "volume">;
}

export default function DashboardTodayRadar({
  topLeads,
  pendingReview,
  hiringModeByProfileId,
}: DashboardTodayRadarProps) {
  return (
    <section className={styles.todayRadarSection} aria-labelledby="today-radar-heading">
      <div className={styles.todayRadarHeader}>
        <div className={styles.todayRadarHeadingGroup}>
          <span className={styles.sectionEyebrow}>Opportunity feed</span>
          <h2 id="today-radar-heading" className={styles.analyticsHeading}>
            Что разобрать сегодня
          </h2>
          <p className={styles.todayRadarIntro}>
            Приоритет задаёт не размер компании, а сочетание свежести сигнала, силы доказательств и совпадения с Agency DNA.
          </p>
        </div>
        <Link href="/review" className={styles.todayRadarReviewPill} data-pending={pendingReview > 0}>
          На проверке: {pendingReview}
        </Link>
      </div>

      {topLeads.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title="Пока нет компаний для контакта"
          text="Радар подберёт их по вашему профилю: роли, отрасли, регионы."
          action={{ href: "/profile", label: "Проверить настройки профиля" }}
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
                  <span className={styles.todayRadarRank}>0{index + 1}</span>
                  <span className={styles.todayRadarOrg}>{lead.orgName}</span>
                  {index > 0 ? <ScoreBandChip score={lead.score} /> : null}
                  <ForeignEmployerBadge isForeign={lead.isForeignEmployer} />
                </div>

                {index === 0 ? (
                  <div className={styles.todayRadarScorePanel}>
                    <div className={styles.todayRadarScoreValue}>
                      <strong>{Math.round(lead.score)}</strong>
                      <span>opportunity score</span>
                    </div>
                    <ScoreBandChip score={lead.score} />
                  </div>
                ) : null}

                <div className={styles.todayRadarBody}>
                  {index > 0 ? (
                    <div className={styles.todayRadarScore}>
                      <ScoreBar score={lead.score} />
                    </div>
                  ) : null}

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

                  <div className={styles.todayRadarLine}>
                    <span className={styles.todayRadarLineLabel}>Роли</span>
                    <span className={styles.todayRadarLineText}>
                      {shownRoles.length > 0
                        ? `${shownRoles.join(" · ")}${moreRoles > 0 ? ` + ещё ${moreRoles}` : ""}`
                        : "роли не определены"}
                    </span>
                  </div>
                </div>

                <div className={styles.todayRadarFooter}>
                  <span className={styles.todayRadarEvidence}>
                    {lead.evidenceTitles.length} фактов · {lead.vacanciesCount} вакансий в эпизоде
                  </span>
                  <span className={styles.todayRadarOpen}>Открыть opportunity brief</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
