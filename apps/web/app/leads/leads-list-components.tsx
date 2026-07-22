import Link from 'next/link';

import type { LeadItem } from '@/lib/leads-data';
import { deriveRoleNames, splitRolesForDisplay, deriveUrgencyCue } from '@/lib/leads/lead-quality';
import { formatVacanciesCount } from '@/lib/format/plural';
import { formatScorePoints, scorePercent } from '@/lib/scoring/score-display';
import {
  GateBadgeInline,
  FeedbackBadge,
  formatSignalFreshness,
  AiHintChip,
  ForeignEmployerBadge,
  ReviewStatusBadge,
  getScoreTone,
  FitIcon,
  internalPageClasses as ipStyles,
} from '../ui/internal-page';
import { ShieldIcon, PinIcon, AlertIcon } from '../ui/icons';

export function LeadCard({
  lead,
  fitPreview,
  hiringMode,
}: {
  lead: LeadItem;
  fitPreview: { icon: string; text: string } | null;
  hiringMode: 'specialist' | 'executive' | 'volume';
}) {
  const tone = getScoreTone(lead.score);
  const risks = lead.negativeSignals.slice(0, 2);
  const roleNames = deriveRoleNames({ evidenceTitles: lead.evidenceTitles });
  const { shown: shownRoles, more: moreRoles } = splitRolesForDisplay(roleNames, 2);
  const urgency = deriveUrgencyCue({
    vacanciesCount: lead.vacanciesCount,
    latestPublishedAt: lead.latestPublishedAt,
    hiringMode,
  });
  const showWorkflowStatus =
    (Boolean(lead.reviewStatus) && lead.reviewStatus !== 'auto_approved') ||
    (Boolean(lead.feedbackStatus) && lead.feedbackStatus !== 'none');
  const points = formatScorePoints(lead.score);
  const scoreWidth = scorePercent(lead.score);
  const freshness = formatSignalFreshness(lead.latestPublishedAt)?.label;
  const vacancies = formatVacanciesCount(lead.vacanciesCount);
  const roles = shownRoles.length > 0
    ? `${shownRoles.join(' · ')}${moreRoles > 0 ? ` + ещё ${moreRoles}` : ''}`
    : 'Роли уточняются';
  const vacanciesSummary = [vacancies, freshness].filter(Boolean).join(' · ') || 'Свежесть проверяется';
  const signalSummary = lead.whyNow || urgency.label;

  return (
    <Link
      href={`/leads/${lead.id}`}
      className={ipStyles.signalLeadCardLink}
      aria-label={`Открыть полную карточку компании ${lead.orgName}`}
    >
      <article className={`${ipStyles.leadCard} ${ipStyles.signalLeadCard}`} data-signal-card="true" data-tone={tone}>
        <div className={ipStyles.signalLeadTopbar}>
          <div className={ipStyles.leadCardTags}>
            <GateBadgeInline gate={lead.confidenceGate} />
            {showWorkflowStatus ? (
              <span className={ipStyles.leadCardTagGroup} data-chip-group="status">
                <ReviewStatusBadge status={lead.reviewStatus} />
                <FeedbackBadge status={lead.feedbackStatus} />
              </span>
            ) : null}
            <ForeignEmployerBadge isForeign={lead.isForeignEmployer} />
            <AiHintChip present={lead.hasAiHint} />
          </div>
        </div>

        <div className={ipStyles.signalLeadCompanyRow}>
          <div>
            <span className={ipStyles.signalLeadName}>{lead.orgName}</span>
            {lead.locationNames.length > 0 && (
              <div className={ipStyles.signalLeadMeta}>
                <PinIcon className={ipStyles.chipIcon} /> {lead.locationNames.slice(0, 2).join(', ')}
              </div>
            )}
          </div>
          <div className={ipStyles.signalLeadScore}><strong>{points}</strong><span>/100</span></div>
        </div>

        <div
          className={ipStyles.signalLeadScoreTrack}
          role="meter"
          aria-valuenow={Number(points)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Сила сигнала: ${points} из 100`}
        >
          <span data-tone={tone} style={{ width: `${scoreWidth}%` }} />
        </div>

        <div className={ipStyles.signalLeadSections}>
          <section className={ipStyles.signalLeadSection}>
            <span>Компания и контакты</span>
            <strong><ShieldIcon className={ipStyles.chipIcon} /> {lead.lawfulContactPath || 'Корпоративный контакт уточняется'}</strong>
            {lead.locationNames.length > 0 ? <p>{lead.locationNames.slice(0, 2).join(', ')}</p> : null}
          </section>
          <section className={ipStyles.signalLeadSection}>
            <span>Релевантные вакансии</span>
            <strong>{roles}</strong>
            <p>{vacanciesSummary}</p>
          </section>
          <section className={`${ipStyles.signalLeadSection} ${ipStyles.signalLeadSectionPrimary}`}>
            <span>Сигналы</span>
            <strong>{signalSummary}</strong>
            {fitPreview ? <p><FitIcon name={fitPreview.icon} className={ipStyles.chipIcon} /> {fitPreview.text}</p> : null}
          </section>
        </div>

        {risks.length > 0 && (
          <div className={ipStyles.leadRiskRow}>
            {risks.map((risk) => <span key={risk} className={ipStyles.leadRiskChip}><AlertIcon className={ipStyles.chipIcon} /> {risk}</span>)}
          </div>
        )}

        <div className={ipStyles.signalLeadFooter} aria-hidden="true">
          <span>Полная информация о компании</span>
          <strong>Открыть →</strong>
        </div>
      </article>
    </Link>
  );
}

export function LeadsListLegend() {
  return (
    <div className={ipStyles.leadsListLegend} data-legend="true" aria-label="Условные обозначения силы сигнала">
      <span className={ipStyles.leadsListLegendItem}><span className={ipStyles.leadsListLegendDot} data-tone="success" aria-hidden="true" />высокий</span>
      <span className={ipStyles.leadsListLegendItem}><span className={ipStyles.leadsListLegendDot} data-tone="warning" aria-hidden="true" />средний</span>
      <span className={ipStyles.leadsListLegendItem}><span className={ipStyles.leadsListLegendDot} data-tone="danger" aria-hidden="true" />низкий</span>
    </div>
  );
}
