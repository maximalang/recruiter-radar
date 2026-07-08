import { Suspense } from 'react';
import type { ReactElement, SVGProps } from 'react';
import Link from 'next/link';
import { getLeadDetail, formatLawfulContactPath } from '@/lib/leads-data';
import { getClientProfileById, resolveHiringMode } from '@/lib/clientProfiles';
import { getOwnerIdFromSession } from '@/lib/session';
import { buildFitExplanation, FIT_DIMENSION_ICON } from '@/lib/leads/fit-explanation';
import { buildCompanySummary } from '@/lib/leads/company-summary';
import { deriveRoleNames, splitRolesForDisplay, deriveUrgencyCue } from '@/lib/leads/lead-quality';
import { leadToCrmBlock } from '@/lib/leads-csv';
import FeedbackButtons from './feedback-buttons';
import AiEnrichmentBlock from './ai-enrichment-block';
import NextStepsBlock from './next-steps-block';
import {
  InternalPageFrame,
  InternalPageHeader,
  InternalBackLink,
  ContentCard,
  ContentCardTitle,
  DetailLayout,
  GateBadgeInline,
  ScoreGauge,
  ScoreBandChip,
  SignalFreshnessChip,
  ForeignEmployerBadge,
  ReviewStatusBadge,
  UrgencyCueChip,
  LeadVerdictChips,
  EvidenceTag,
  SourceChip,
  NotFoundState,
  FitIcon,
  internalPageClasses as ipStyles,
  type NavItem,
  GATE_DESC,
  FEEDBACK_LABELS,
} from '../../ui/internal-page';
import { BriefcaseIcon, LayersIcon, CalendarIcon, HelpIcon, SearchIcon } from '../../ui/icons';

export const dynamic = 'force-dynamic';

const LEAD_DETAIL_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Дашборд' },
  { href: '/leads', label: 'Лиды' },
  { href: '/settings/profile', label: 'Профиль' },
];

/** Renders the feedback-status icon component inline with its label. */
function FeedbackStatusIcon({ icon: Icon }: { icon: (p: SVGProps<SVGSVGElement>) => ReactElement }) {
  return <Icon className={ipStyles.chipIcon} />;
}

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
          icon={SearchIcon}
          title="Лид не найден"
          backHref="/leads"
          backLabel="Назад к списку лидов"
        />
      </main>
    );
  }

  const feedback = lead.feedbackStatus && lead.feedbackStatus !== 'none'
    ? FEEDBACK_LABELS[lead.feedbackStatus] ?? { label: lead.feedbackStatus, icon: HelpIcon }
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
          // Surface the matched specialization term by name on the detail page
          // too — the full evidence stack is visible here, so the ICP
          // re-derivation can name the niche that triggered fit.icp.match.
          orgName: lead.orgName,
          evidenceTitles: lead.evidenceTitles,
        },
        {
          industries: profile.industries,
          roles: profile.roles,
          excludedIndustries: profile.excludedIndustries,
          excludedLocations: profile.excludedLocations,
          contactPolicy: profile.contactPolicy,
          remoteFriendly: profile.remoteFriendly,
          targetCity: profile.targetCity,
          specialization: profile.specialization,
          includeKeywords: profile.includeKeywords,
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

  // Roles: normalized/deduped, capped at 5 with a "+ ещё N" overflow. AI role
  // titles fill in only when evidence carries none.
  const roleNames = deriveRoleNames({
    evidenceTitles: lead.evidenceTitles,
    aiRoleTitles: lead.aiEnrichment?.detectedRoles?.map((r) => r.title) ?? null,
  });
  const { shown: shownRoles, more: moreRoles } = splitRolesForDisplay(roleNames, 5);

  // Concrete urgency cue (burst / active / fresh / stale), shown on the verdict card.
  // Mode-aware: an executive agency sees seniority/freshness framing, a volume
  // agency sees hiring-scale framing, a specialist agency keeps the default
  // ladder. Resolved from the loaded profile so 'auto' never reaches the cue.
  const resolvedHiringMode = profile ? resolveHiringMode(profile) : 'specialist';
  const urgency = deriveUrgencyCue({
    vacanciesCount: lead.vacanciesCount,
    latestPublishedAt: lead.latestPublishedAt,
    hiringMode: resolvedHiringMode,
  });

  // "Дальнейшие шаги" handoff block — built server-side so the CRM-ready text
  // is stable and the client component only handles clipboard + open-links.
  // Only surfaces links that actually exist; the empty-array case hides the
  // links group inside the component.
  const nextStepLinks: { href: string; label: string }[] = [];
  if (lead.orgWebsite) nextStepLinks.push({ href: lead.orgWebsite, label: 'Сайт компании' });
  if (lead.careerPageUrl) nextStepLinks.push({ href: lead.careerPageUrl, label: 'Карьерная страница' });
  const crmBlock = leadToCrmBlock({
    orgName: lead.orgName,
    score: lead.score,
    confidenceGate: lead.confidenceGate,
    whyNow: lead.whyNow,
    lawfulContactPath: lead.lawfulContactPath,
    vacanciesCount: lead.vacanciesCount,
    evidenceTitles: lead.evidenceTitles,
    locationNames: lead.locationNames,
    sourceFamilies: lead.sourceFamilies,
    feedbackStatus: lead.feedbackStatus,
    latestPublishedAt: lead.latestPublishedAt,
    orgInn: lead.orgInn,
    orgOgrn: lead.orgOgrn,
    orgDomain: lead.orgDomain,
    orgWebsite: lead.orgWebsite,
    careerPageUrl: lead.careerPageUrl,
    profileName: profile?.agencyName ?? null,
    reviewStatus: lead.reviewStatus,
  });
  const singleExportHref = `/api/leads/${lead.id}/export`;

  return (
    <InternalPageFrame navItems={LEAD_DETAIL_NAV}>
      <div className={ipStyles.leadDetailContainer}>
        <InternalPageHeader
          title={lead.orgName}
          subtitle={
            lead.locationNames.length > 0
              ? lead.locationNames.join(', ')
              : 'Регион не указан'
          }
          nav={<InternalBackLink href="/leads">Лиды</InternalBackLink>}
        />

        <DetailLayout
          main={
            <>
              {/* One-glance primary answer: score band + freshness + gate + roles,
                  so the recruiter sees the verdict before reading the prose below. */}
              <ContentCard variant="hero" className={ipStyles.leadVerdict}>
                <div className={ipStyles.leadVerdictTop}>
                  <ScoreGauge score={lead.score} />
                  <LeadVerdictChips
                    score={lead.score}
                    confidenceGate={lead.confidenceGate}
                    isForeignEmployer={lead.isForeignEmployer}
                    reviewStatus={lead.reviewStatus}
                    urgencyLevel={urgency.level}
                    urgencyLabel={urgency.label}
                    latestPublishedAt={lead.latestPublishedAt}
                  />
                </div>
                <div className={ipStyles.leadVerdictRoles}>
                  <span className={ipStyles.leadVerdictRolesLabel}>Открытые роли</span>
                  {shownRoles.length > 0 ? (
                    <div className={`${ipStyles.chipWrap} ${ipStyles.chipWrapFlush}`}>
                      {shownRoles.map((title, i) => (
                        <EvidenceTag key={i}>{title}</EvidenceTag>
                      ))}
                      {moreRoles > 0 && (
                        <span className={ipStyles.bodyTextMuted}>+ ещё {moreRoles}</span>
                      )}
                    </div>
                  ) : (
                    <span className={ipStyles.bodyTextMuted}>Роли не определены</span>
                  )}
                </div>
              </ContentCard>

              {/* Why now card — only when there is an actual argument to show */}
              {lead.whyNow && lead.whyNow.trim() && (
                <ContentCard>
                  <ContentCardTitle>Почему сейчас</ContentCardTitle>
                  <p className={ipStyles.bodyText}>{lead.whyNow}</p>
                </ContentCard>
              )}

              {/* Why this lead fits the agency — deterministic, evidence-backed */}
              {fit && !fit.isEmpty && (
                <ContentCard variant="hero">
                  <ContentCardTitle>Почему этот лид вам подходит</ContentCardTitle>
                  <ul className={ipStyles.fitList}>
                    {fit.lines.map((line, i) => (
                      <li key={i} className={ipStyles.fitItem}>
                        <span className={ipStyles.fitItemIcon} aria-hidden="true">
                          <FitIcon name={FIT_DIMENSION_ICON[line.dimension]} />
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
                  <ContentCardTitle>Кратко о компании и найме</ContentCardTitle>
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

              {/* Lawful contact path */}
              {formatLawfulContactPath(lead.lawfulContactPath) && (
                <ContentCard>
                  <ContentCardTitle>Безопасный путь контакта</ContentCardTitle>
                  <p className={ipStyles.bodyText}>
                    {formatLawfulContactPath(lead.lawfulContactPath)}
                  </p>
                </ContentCard>
              )}

              {/* Evidence card */}
              <ContentCard>
                <ContentCardTitle>Доказательства</ContentCardTitle>
                <div className={ipStyles.chipWrap}>
                  {lead.evidenceTitles.length > 0 ? lead.evidenceTitles.map((title, i) => (
                    <EvidenceTag key={i}>{title}</EvidenceTag>
                  )) : (
                    <span className={ipStyles.bodyTextMuted}>Нет данных о вакансиях</span>
                  )}
                </div>
                <div className={ipStyles.evidenceStats}>
                  <span><BriefcaseIcon className={ipStyles.chipIcon} /> {lead.vacanciesCount} вакансий</span>
                  <span><LayersIcon className={ipStyles.chipIcon} /> {lead.distinctVacancyNamesCount} разных ролей</span>
                  {lead.latestPublishedAt && (
                    <span><CalendarIcon className={ipStyles.chipIcon} /> Последняя: {new Date(lead.latestPublishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
                  )}
                </div>
              </ContentCard>

              {/* AI enrichment — secondary advisory layer, only when present.
                  Sits below evidence; never affects score/gate/evidence. */}
              <AiEnrichmentBlock enrichment={lead.aiEnrichment} />

              {/* Negative signals */}
              {lead.negativeSignals.length > 0 && (
                <ContentCard tone="danger">
                  <ContentCardTitle tone="danger">Факторы риска</ContentCardTitle>
                  <ul className={ipStyles.reasonList}>
                    {lead.negativeSignals.map((signal, i) => (
                      <li key={i} className={ipStyles.signalItem}>{signal}</li>
                    ))}
                  </ul>
                </ContentCard>
              )}
            </>
          }
          sidebar={
            <>
              {/* Дальнейшие шаги — the operational handoff area. Sits at the top
                  of the sidebar so the recruiter's next action is visible the
                  moment they finish reading the verdict + evidence. */}
              <ContentCard>
                <NextStepsBlock
                  crmBlock={crmBlock}
                  links={nextStepLinks}
                  singleExportHref={singleExportHref}
                />
              </ContentCard>

              {/* Confidence gate — the verdict score/gate live in the hero card
                  at the top of the main column now, so the sidebar leads with
                  the gate explanation instead of duplicating the gauge. */}
              <ContentCard>
                <div className={ipStyles.sidebarLabel}>Уровень доверия</div>
                <GateBadgeInline gate={lead.confidenceGate} />
                <p className={ipStyles.gateDescription}>{GATE_DESC[lead.confidenceGate] ?? GATE_DESC.D}</p>
              </ContentCard>

              {/* Feedback status */}
              <ContentCard>
                <div className={ipStyles.sidebarLabel}>Обратная связь</div>
                {feedback ? (
                  <div className={ipStyles.sidebarValue}>
                    <FeedbackStatusIcon icon={feedback.icon} /> {feedback.label}
                  </div>
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
                  <div className={ipStyles.sidebarMeta}>{lead.orgDomain}</div>
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
                    Карьерная страница →
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
