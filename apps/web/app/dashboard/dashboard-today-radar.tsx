import Link from 'next/link';
import type { LeadItem } from '@/lib/leads-data';
import { ScoreBar, ScoreBandChip, SignalFreshnessChip, ForeignEmployerBadge, UrgencyCueChip, EmptyState } from '../ui/internal-page';
import { SearchIcon } from '../ui/icons';
import { deriveRoleNames, splitRolesForDisplay, deriveUrgencyCue } from '@/lib/leads/lead-quality';
import styles from './dashboard.module.css';

interface DashboardTodayRadarProps {
  /** Top candidates worth contacting now, ranked by score. */
  topLeads: LeadItem[];
  /** Count of candidates awaiting analyst review. */
  pendingReview: number;
  /**
   * Resolved hiring mode per active client profile id — drives mode-aware
   * urgency framing on each radar card. A lead whose profile can't be matched
   * falls back to 'specialist' (the pre-mode default behavior).
   */
  hiringModeByProfileId?: Record<string, 'specialist' | 'executive' | 'volume'>;
}

/**
 * "Сегодняшний радар" — the agency-facing block that answers
 * "компании, которым стоит написать сегодня": top leads with why-now /
 * best-angle, plus a pending-review counter that links into the review queue.
 */
export default function DashboardTodayRadar({
  topLeads,
  pendingReview,
  hiringModeByProfileId,
}: DashboardTodayRadarProps) {
  return (
    <section className={styles.todayRadarSection} aria-labelledby="today-radar-heading">
      <div className={styles.todayRadarHeader}>
        <h2 id="today-radar-heading" className={styles.analyticsHeading}>
          Сегодняшний радар
        </h2>
        <Link href="/review" className={styles.todayRadarReviewPill} data-pending={pendingReview > 0}>
          На проверке: {pendingReview}
        </Link>
      </div>

      {topLeads.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title="Пока нет компаний для контакта"
          text="Радар подберёт их по вашему профилю: роли, отрасли, регионы."
          action={{ href: '/profile', label: 'Проверить настройки профиля' }}
        />
      ) : (
        <div className={styles.todayRadarList}>
          {topLeads.map((lead) => {
            const roleNames = deriveRoleNames({ evidenceTitles: lead.evidenceTitles });
            const { shown: shownRoles, more: moreRoles } = splitRolesForDisplay(roleNames, 2);
            // Mode-aware urgency: executive → freshness/seniority framing,
            // volume → hiring-scale, specialist → default ladder. Falls back to
            // 'specialist' when the profile can't be matched (keeps prior behavior).
            const hiringMode = hiringModeByProfileId?.[lead.clientProfileId] ?? 'specialist';
            const urgency = deriveUrgencyCue({
              vacanciesCount: lead.vacanciesCount,
              latestPublishedAt: lead.latestPublishedAt,
              hiringMode,
            });
            return (
            <Link key={lead.id} href={`/leads/${lead.id}`} className={styles.todayRadarCard}>
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
                {lead.latestPublishedAt && (
                  <SignalFreshnessChip latestPublishedAt={lead.latestPublishedAt} />
                )}
              </div>

              {lead.whyNow && (
                <div className={styles.todayRadarLine}>
                  <span className={styles.todayRadarLineLabel}>Почему сейчас</span>
                  <span className={styles.todayRadarLineText}>{lead.whyNow}</span>
                </div>
              )}

              <div className={styles.todayRadarLine}>
                <span className={styles.todayRadarLineLabel}>Роли</span>
                <span className={styles.todayRadarLineText}>
                  {shownRoles.length > 0
                    ? `${shownRoles.join(' · ')}${moreRoles > 0 ? ` + ещё ${moreRoles}` : ''}`
                    : 'роли не определены'}
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
