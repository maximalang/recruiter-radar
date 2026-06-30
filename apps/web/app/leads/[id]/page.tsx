import { Suspense } from 'react';
import Link from 'next/link';
import { getLeadDetail, formatLawfulContactPath } from '@/lib/leads-data';
import { getClientProfileById } from '@/lib/clientProfiles';
import { getOwnerIdFromSession } from '@/lib/session';
import { buildFitExplanation, FIT_DIMENSION_ICON } from '@/lib/leads/fit-explanation';
import { buildCompanySummary } from '@/lib/leads/company-summary';
import FeedbackButtons from './feedback-buttons';
import OutreachPicker from './outreach-picker';
import AiEnrichmentBlock from './ai-enrichment-block';
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
  { href: '/settings/profile', label: '⚙️ Профиль' },
];

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Owner-scoped reads: without a session the lead lookup returns null,
  // rendering NotFoundState (correct: no access).
  const ownerId = await getOwnerIdFromSession();
  const lead = ownerId ? await getLeadDetail({ candidateId: id, ownerId }) : null;

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

  // Deterministic Stage 1 AI-assist: fit explanation needs the agency profile to
  // match against. Degrade gracefully if the profile can't be loaded — the rest
  // of the page (evidence-first) stands on its own.
  const profile = ownerId
    ? await getClientProfileById(lead.clientProfileId, ownerId).catch(() => null)
    : null;
  const fit = profile
    ? buildFitExplanation(
        {
          structuredReasons: lead.structuredReasons,
          locationNames: lead.locationNames,
          lawfulContactPath: lead.lawfulContactPath,
          sourceFamilies: lead.sourceFamilies,
          careerPageUrl: lead.careerPageUrl,
          orgDomain: lead.orgDomain,
        },
        {
          industries: profile.industries,
          roles: profile.roles,
          excludedIndustries: profile.excludedIndustries,
          excludedLocations: profile.excludedLocations,
          contactPolicy: profile.contactPolicy,
          remoteFriendly: profile.remoteFriendly,
          targetCity: profile.targetCity,
        },
      )
    : null;

  const summary = buildCompanySummary({
    orgName: lead.orgName,
    confidenceGate: lead.confidenceGate,
    vacanciesCount: lead.vacanciesCount,
    distinctVacancyNamesCount: lead.distinctVacancyNamesCount,
    evidenceTitles: lead.evidenceTitles,
    sourceFamilies: lead.sourceFamilies,
    locationNames: lead.locationNames,
    latestPublishedAt: lead.latestPublishedAt,
  });
  const summaryLines = [summary.identity, summary.hiringMotion, summary.agencyRelevance].filter(
    (l): l is string => l !== null,
  );

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
              {/* Why now card */}
              <ContentCard variant="hero">
                <ContentCardTitle>🎯 Почему сейчас</ContentCardTitle>
                <p className={ipStyles.bodyText}>{lead.whyNow}</p>
              </ContentCard>

              {/* Why this lead fits the agency — deterministic, evidence-backed */}
              {fit && !fit.isEmpty && (
                <ContentCard variant="hero">
                  <ContentCardTitle>🤝 Почему этот лид вам подходит</ContentCardTitle>
                  <ul className={ipStyles.fitList}>
                    {fit.lines.map((line, i) => (
                      <li key={i} className={ipStyles.fitItem}>
                        <span className={ipStyles.fitItemIcon} aria-hidden="true">
                          {FIT_DIMENSION_ICON[line.dimension]}
                        </span>
                        <span>{line.text}</span>
                      </li>
                    ))}
                  </ul>
                </ContentCard>
              )}

              {/* Company / hiring summary — deterministic synthesis, no invented facts */}
              {summaryLines.length > 0 && (
                <ContentCard>
                  <ContentCardTitle>🏢 Кратко о компании и найме</ContentCardTitle>
                  <div className={ipStyles.summaryBlock}>
                    {summaryLines.map((line, i) => (
                      <p
                        key={i}
                        className={`${ipStyles.summaryLine} ${i === 0 ? ipStyles.summaryLineLead : ''}`.trim()}
                      >
                        {line}
                      </p>
                    ))}
                  </div>
                  {summary.isThin && (
                    <p className={ipStyles.summaryStrength}>
                      Доказательств немного — данные обновятся по мере поступления сигналов.
                    </p>
                  )}
                </ContentCard>
              )}

              {/* Best angle card */}
              <ContentCard>
                <ContentCardTitle>🔭 Лучший угол контакта</ContentCardTitle>
                <p className={ipStyles.bodyText}>{lead.bestAngle}</p>
              </ContentCard>

              {/* Lawful contact path */}
              {formatLawfulContactPath(lead.lawfulContactPath) && (
                <ContentCard>
                  <ContentCardTitle>📬 Безопасный путь контакта</ContentCardTitle>
                  <p className={ipStyles.bodyText}>
                    {formatLawfulContactPath(lead.lawfulContactPath)}
                  </p>
                </ContentCard>
              )}

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

              {/* AI enrichment — secondary advisory layer, only when present.
                  Sits below evidence; never affects score/gate/evidence. */}
              <AiEnrichmentBlock enrichment={lead.aiEnrichment} />

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

                {lead.orgDomain && (
                  <div className={ipStyles.sidebarMeta}>🌐 {lead.orgDomain}</div>
                )}
                {lead.orgWebsite && (
                  <a
                    href={lead.orgWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={ipStyles.sidebarLink}
                  >
                    Сайт компании →
                  </a>
                )}
                {lead.careerPageUrl && (
                  <a
                    href={lead.careerPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={ipStyles.sidebarLink}
                  >
                    💼 Карьерная страница →
                  </a>
                )}

                {(lead.orgInn || lead.orgOgrn) && (
                  <div className={ipStyles.sidebarMeta}>
                    {lead.orgInn && <div>ИНН: {lead.orgInn}</div>}
                    {lead.orgOgrn && <div>ОГРН: {lead.orgOgrn}</div>}
                  </div>
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
