import { Suspense } from 'react';
import Link from 'next/link';
import { getLeadDetail } from '@/lib/leads-data';
import FeedbackButtons from './feedback-buttons';
import OutreachPicker from './outreach-picker';
import {
  InternalPageFrame,
  InternalPageHeader,
  InternalBackLink,
  ContentCard,
  ContentCardTitle,
  DetailLayout,
  GateBadgeInline,
  ScoreGauge,
  EvidenceTag,
  SourceChip,
  NotFoundState,
  internalPageClasses as ipStyles,
  type NavItem,
  GATE_DESC,
  FEEDBACK_LABELS,
} from '../../ui/internal-page';

export const dynamic = 'force-dynamic';

const LEAD_DETAIL_NAV: NavItem[] = [
  { href: '/dashboard', label: '📊 Дашборд' },
  { href: '/leads', label: '🎯 Лиды' },
];

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await getLeadDetail({ candidateId: id });

  if (!lead) {
    return (
      <main>
        <NotFoundState
          icon="🔍"
          title="Лид не найден"
          backHref="/leads"
          backLabel="← Назад к списку лидов"
        />
      </main>
    );
  }

  const feedback = lead.feedbackStatus && lead.feedbackStatus !== 'none'
    ? FEEDBACK_LABELS[lead.feedbackStatus] ?? { label: lead.feedbackStatus, icon: '❓' }
    : null;

  return (
    <InternalPageFrame navItems={LEAD_DETAIL_NAV}>
      <div className={ipStyles.leadDetailContainer}>
        <InternalPageHeader
          title={lead.orgName}
          subtitle={
            lead.locationNames.length > 0
              ? `📍 ${lead.locationNames.join(', ')}`
              : undefined
          }
          nav={<InternalBackLink href="/leads">← Лиды</InternalBackLink>}
        />

        <DetailLayout
          main={
            <>
              {/* Reasons card */}
              <ContentCard>
                <ContentCardTitle>🎯 Почему сейчас</ContentCardTitle>
                {lead.reasons.length > 0 ? (
                  <ul className={ipStyles.reasonList}>
                    {lead.reasons.map((reason, i) => (
                      <li key={i} className={ipStyles.reasonItem}>{reason}</li>
                    ))}
                  </ul>
                ) : (
                  <p className={ipStyles.bodyTextMuted}>Причины не указаны</p>
                )}
              </ContentCard>

              {/* Evidence card */}
              <ContentCard>
                <ContentCardTitle>📋 Доказательства</ContentCardTitle>
                <div className={ipStyles.chipWrap}>
                  {lead.evidenceTitles.length > 0 ? lead.evidenceTitles.map((title, i) => (
                    <EvidenceTag key={i}>{title}</EvidenceTag>
                  )) : (
                    <span className={ipStyles.bodyTextMuted}>Нет данных о вакансиях</span>
                  )}
                </div>
                <div className={ipStyles.evidenceStats}>
                  <span>💼 {lead.vacanciesCount} вакансий</span>
                  <span>🔀 {lead.distinctVacancyNamesCount} разных ролей</span>
                  {lead.latestPublishedAt && (
                    <span>📅 Последняя: {new Date(lead.latestPublishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
                  )}
                </div>
              </ContentCard>

              {/* Negative signals */}
              {lead.negativeSignals.length > 0 && (
                <ContentCard tone="danger">
                  <ContentCardTitle tone="danger">⚠️ Факторы риска</ContentCardTitle>
                  <ul className={ipStyles.reasonList}>
                    {lead.negativeSignals.map((signal, i) => (
                      <li key={i} className={ipStyles.signalItem}>{signal}</li>
                    ))}
                  </ul>
                </ContentCard>
              )}

              {/* Opener card */}
              <ContentCard>
                <ContentCardTitle>💬 Текст первого сообщения</ContentCardTitle>
                <p className={ipStyles.openerText}>{lead.opener}</p>
              </ContentCard>

              {/* Outreach templates */}
              <ContentCard>
                <ContentCardTitle>✉️ Шаблоны сообщения</ContentCardTitle>
                <OutreachPicker
                  clientProfileId={lead.clientProfileId}
                  context={{
                    orgName: lead.orgName,
                    reasons: lead.reasons,
                    vacancyCount: lead.vacanciesCount,
                    roleNames: lead.evidenceTitles,
                    sourceFamily: lead.sourceFamilies[0] ?? '',
                    locationName: lead.locationNames[0] ?? '',
                    confidenceGate: lead.confidenceGate,
                  }}
                />
              </ContentCard>
            </>
          }
          sidebar={
            <>
              {/* Score */}
              <ContentCard>
                <ScoreGauge score={lead.score} />
              </ContentCard>

              {/* Confidence gate */}
              <ContentCard>
                <div className={ipStyles.sidebarLabel}>Уровень доверия</div>
                <GateBadgeInline gate={lead.confidenceGate} />
                <p className={ipStyles.gateDescription}>{GATE_DESC[lead.confidenceGate] ?? GATE_DESC.D}</p>
              </ContentCard>

              {/* Feedback status */}
              <ContentCard>
                <div className={ipStyles.sidebarLabel}>Обратная связь</div>
                {feedback ? (
                  <div className={ipStyles.sidebarValue}>{feedback.icon} {feedback.label}</div>
                ) : (
                  <div className={ipStyles.sidebarValueEmpty}>Ещё нет обратной связи</div>
                )}
                {lead.feedbackNote && (
                  <p className={ipStyles.feedbackNote}>
                    {lead.feedbackNote}
                  </p>
                )}
                <FeedbackButtons
                  orgId={lead.orgId}
                  clientProfileId={lead.clientProfileId}
                  currentStatus={lead.feedbackStatus ?? 'none'}
                />
              </ContentCard>

              {/* Sources */}
              <ContentCard>
                <div className={ipStyles.sidebarLabel}>Источники</div>
                {lead.sourceFamilies.length > 0 ? (
                  <div className={ipStyles.chipWrapSm}>
                    {lead.sourceFamilies.map((src) => (
                      <SourceChip key={src}>{src}</SourceChip>
                    ))}
                  </div>
                ) : (
                  <span className={ipStyles.bodyTextMuted}>Нет данных</span>
                )}
              </ContentCard>

              {/* Company info */}
              <ContentCard>
                <div className={ipStyles.sidebarLabel}>Компания</div>
                {lead.orgWebsite && (
                  <a
                    href={lead.orgWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={ipStyles.sidebarLink}
                  >
                    🌐 Сайт компании →
                  </a>
                )}
                {lead.sourceExternalId && (
                  <div className={ipStyles.sidebarMeta}>ID: {lead.sourceExternalId}</div>
                )}
                <div className={ipStyles.sidebarMeta}>
                  Добавлен: {new Date(lead.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              </ContentCard>
            </>
          }
        />
      </div>
    </InternalPageFrame>
  );
}
