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
  internalPageClasses as s,
  type NavItem,
} from '../../ui/internal-page';

export const dynamic = 'force-dynamic';

const LEAD_DETAIL_NAV: NavItem[] = [
  { href: '/dashboard', label: '📊 Дашборд' },
  { href: '/leads', label: '🎯 Лиды' },
];

const GATE_DESC: Record<string, string> = {
  A: '2+ независимых источника, чистое совпадение сущности',
  B: '1 сильный источник + обогащение',
  C: 'Только платформенная агрегация, требует ревью',
  D: 'Контекст без прямого доказательства найма',
};

const FEEDBACK_LABELS: Record<string, { label: string; icon: string }> = {
  accepted: { label: 'Беру', icon: '✅' },
  dismissed: { label: 'Мимо', icon: '👋' },
  later: { label: 'Позже', icon: '⏰' },
  contacted: { label: 'Уже написал', icon: '✉️' },
  replied: { label: 'Ответили', icon: '💬' },
  call: { label: 'Созвон', icon: '📞' },
  client: { label: 'Клиент', icon: '🤝' },
  badfit: { label: 'Не подходит', icon: '❌' },
};

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await getLeadDetail({ candidateId: id });

  if (!lead) {
    return (
      <NotFoundState
        icon="🔍"
        title="Лид не найден"
        backHref="/leads"
        backLabel="← Назад к списку лидов"
      />
    );
  }

  const feedback = lead.feedbackStatus && lead.feedbackStatus !== 'none'
    ? FEEDBACK_LABELS[lead.feedbackStatus] ?? { label: lead.feedbackStatus, icon: '❓' }
    : null;

  return (
    <InternalPageFrame navItems={LEAD_DETAIL_NAV}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
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
                  <ul className={s.reasonList}>
                    {lead.reasons.map((reason, i) => (
                      <li key={i} className={s.reasonItem}>{reason}</li>
                    ))}
                  </ul>
                ) : (
                  <p className={s.bodyTextMuted}>Причины не указаны</p>
                )}
              </ContentCard>

              {/* Evidence card */}
              <ContentCard>
                <ContentCardTitle>📋 Доказательства</ContentCardTitle>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                  {lead.evidenceTitles.length > 0 ? lead.evidenceTitles.map((title, i) => (
                    <EvidenceTag key={i}>{title}</EvidenceTag>
                  )) : (
                    <span className={s.bodyTextMuted}>Нет данных о вакансиях</span>
                  )}
                </div>
                <div className={s.evidenceStats}>
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
                  <ul className={s.reasonList}>
                    {lead.negativeSignals.map((signal, i) => (
                      <li key={i} className={s.signalItem}>{signal}</li>
                    ))}
                  </ul>
                </ContentCard>
              )}

              {/* Opener card */}
              <ContentCard>
                <ContentCardTitle>💬 Текст первого сообщения</ContentCardTitle>
                <p className={s.openerText}>{lead.opener}</p>
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
                <div className={s.sidebarLabel}>Уровень доверия</div>
                <GateBadgeInline gate={lead.confidenceGate} />
                <p className={s.gateDescription}>{GATE_DESC[lead.confidenceGate] ?? GATE_DESC.D}</p>
              </ContentCard>

              {/* Feedback status */}
              <ContentCard>
                <div className={s.sidebarLabel}>Обратная связь</div>
                {feedback ? (
                  <div className={s.sidebarValue}>{feedback.icon} {feedback.label}</div>
                ) : (
                  <div className={s.sidebarValueEmpty}>Ещё нет обратной связи</div>
                )}
                {lead.feedbackNote && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--c-text-muted)', marginTop: '4px', fontStyle: 'italic', marginBottom: '12px' }}>
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
                <div className={s.sidebarLabel}>Источники</div>
                {lead.sourceFamilies.length > 0 ? (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {lead.sourceFamilies.map((src) => (
                      <SourceChip key={src}>{src}</SourceChip>
                    ))}
                  </div>
                ) : (
                  <span className={s.bodyTextMuted}>Нет данных</span>
                )}
              </ContentCard>

              {/* Company info */}
              <ContentCard>
                <div className={s.sidebarLabel}>Компания</div>
                {lead.orgWebsite && (
                  <a
                    href={lead.orgWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={s.sidebarLink}
                  >
                    🌐 Сайт компании →
                  </a>
                )}
                {lead.sourceExternalId && (
                  <div className={s.sidebarMeta}>ID: {lead.sourceExternalId}</div>
                )}
                <div className={s.sidebarMeta}>
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
