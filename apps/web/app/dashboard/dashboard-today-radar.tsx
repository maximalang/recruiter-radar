import Link from 'next/link';
import type { LeadItem } from '@/lib/leads-data';
import { ScoreBar, ScoreBandChip, SignalFreshnessChip, ForeignEmployerBadge } from '../ui/internal-page';
import { deriveRoleNames, splitRolesForDisplay } from '@/lib/leads/lead-quality';
import styles from './dashboard.module.css';

interface DashboardTodayRadarProps {
  /** Top candidates worth contacting now, ranked by score. */
  topLeads: LeadItem[];
  /** Count of candidates awaiting analyst review. */
  pendingReview: number;
}

/**
 * "Сегодняшний радар" — the agency-facing block that answers
 * "компании, которым стоит написать сегодня": top leads with why-now /
 * best-angle, plus a pending-review counter that links into the review queue.
 */
export default function DashboardTodayRadar({ topLeads, pendingReview }: DashboardTodayRadarProps) {
  return (
    <section className={styles.todayRadarSection} aria-labelledby="today-radar-heading">
      <div className={styles.todayRadarHeader}>
        <h2 id="today-radar-heading" className={styles.analyticsHeading}>
          🎯 Сегодняшний радар
        </h2>
        <Link href="/review" className={styles.todayRadarReviewPill} data-pending={pendingReview > 0}>
          🔍 Ожидают проверки: {pendingReview}
        </Link>
      </div>

      {topLeads.length === 0 ? (
        <div className={styles.analyticsEmpty}>
          <p>Пока нет компаний для контакта. Радар подберёт их по вашему профилю: роли, отрасли, регионы.</p>
          <Link href="/settings/profile" className={styles.todayRadarReviewPill}>
            ⚙️ Проверить настройки профиля
          </Link>
        </div>
      ) : (
        <div className={styles.todayRadarList}>
          {topLeads.map((lead) => {
            const roleNames = deriveRoleNames({ evidenceTitles: lead.evidenceTitles });
            const { shown: shownRoles, more: moreRoles } = splitRolesForDisplay(roleNames, 2);
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

              {lead.latestPublishedAt && (
                <div className={styles.todayRadarFreshness}>
                  <SignalFreshnessChip latestPublishedAt={lead.latestPublishedAt} />
                </div>
              )}

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
