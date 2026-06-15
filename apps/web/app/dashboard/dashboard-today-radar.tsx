import Link from 'next/link';
import type { LeadItem } from '@/lib/leads-data';
import { GateBadgeInline, ScoreBar } from '../ui/internal-page';
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
          Пока нет компаний для контакта. Как только дайджест соберёт лиды, они появятся здесь.
        </div>
      ) : (
        <div className={styles.todayRadarList}>
          {topLeads.map((lead) => (
            <Link key={lead.id} href={`/leads/${lead.id}`} className={styles.todayRadarCard}>
              <div className={styles.todayRadarCardTop}>
                <span className={styles.todayRadarOrg}>{lead.orgName}</span>
                <GateBadgeInline gate={lead.confidenceGate} />
              </div>

              <div className={styles.todayRadarScore}>
                <ScoreBar score={lead.score} />
              </div>

              {lead.whyNow && (
                <div className={styles.todayRadarLine}>
                  <span className={styles.todayRadarLineLabel}>Почему сейчас</span>
                  <span className={styles.todayRadarLineText}>{lead.whyNow}</span>
                </div>
              )}

              {lead.bestAngle && (
                <div className={styles.todayRadarLine}>
                  <span className={styles.todayRadarLineLabel}>Угол контакта</span>
                  <span className={styles.todayRadarLineText}>{lead.bestAngle}</span>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
