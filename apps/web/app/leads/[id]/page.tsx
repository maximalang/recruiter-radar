import { Suspense } from 'react';
import type { ReactElement, SVGProps } from 'react';
import Link from 'next/link';
import { getLeadDetail, formatLawfulContactPath } from '@/lib/leads-data';
import { getClientProfileById, resolveHiringMode } from '@/lib/clientProfiles';
import { getSession } from '@/lib/auth-v2/authorization';
import { getEffectiveEntitlement } from '@/lib/entitlements';
import { buildFitExplanation, FIT_DIMENSION_ICON } from '@/lib/leads/fit-explanation';
import { buildCompanySummary } from '@/lib/leads/company-summary';
import { deriveRoleNames, splitRolesForDisplay, deriveUrgencyCue } from '@/lib/leads/lead-quality';
import { toContactPathViews, hasCorporateContact } from '@/lib/leads/contact-display';
import { filterContactPathsByPolicy } from '@/lib/contact-policy-filter';
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
  EmptyState,
  ErrorState,
  FitIcon,
  internalPageClasses as ipStyles,
  GATE_DESC,
  FEEDBACK_LABELS,
} from '../../ui/internal-page';
import { buildAccountNavigation } from '../../ui/account-navigation';
import { BriefcaseIcon, LayersIcon, CalendarIcon, HelpIcon, SearchIcon } from '../../ui/icons';

export const dynamic = 'force-dynamic';

const LEAD_DETAIL_NAV = buildAccountNavigation('leads');

/** Renders the feedback-status icon component inline with its label. */
function FeedbackStatusIcon({ icon: Icon }: { icon: (p: SVGProps<SVGSVGElement>) => ReactElement }) {
  return <Icon className={ipStyles.chipIcon} />;
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Authentication and canonical access are resolved before the owner-scoped
  // lead query. This avoids both probing a lead without access and presenting
  // an expired session as a misleading 404.
  const authorization = await getSession({ permission: 'leads:read' });
  if (!authorization) {
    return (
      <InternalPageFrame navItems={LEAD_DETAIL_NAV}>
        <InternalPageHeader title="Возможность" subtitle="Защищённое рабочее пространство" />
        <EmptyState
          title="Нужен вход в аккаунт"
          text="Войдите, чтобы открыть эту возможность в своём workspace."
          action={{ href: `/login?returnTo=/leads/${encodeURIComponent(id)}`, label: 'Войти' }}
        />
      </InternalPageFrame>
    );
  }

  const ownerId = authorization.dataOwnerId;
  const entitlement = authorization.workspaceId
    ? await getEffectiveEntitlement(ownerId, { workspaceId: authorization.workspaceId }).catch(() => null)
    : null;
  if (!entitlement) {
    return (
      <InternalPageFrame navItems={LEAD_DETAIL_NAV}>
        <InternalPageHeader title="Возможность" subtitle="Проверка доступа" />
        <ErrorState
          title="Не удалось проверить доступ"
          description="Мы не показываем данные, пока сервер не подтвердит права аккаунта. Обновите страницу немного позже."
          action={{ href: '/settings/access', label: 'Доступ и оплата' }}
        />
      </InternalPageFrame>
    );
  }
  if (entitlement.status !== 'active' || !entitlement.features.includes('dashboard')) {
    return (
      <InternalPageFrame navItems={LEAD_DETAIL_NAV}>
        <InternalPageHeader title="Возможность" subtitle="Доступ не активен" />
        <EmptyState
          title="Нужен активный доступ"
          text="Профиль и история сохранены. После активации возможность снова станет доступна."
          action={{ href: '/settings/access', label: 'Проверить доступ' }}
        />
      </InternalPageFrame>
    );
  }

  let lead;
  try {
    lead = await getLeadDetail({ candidateId: id, ownerId });
  } catch {
    return (
      <InternalPageFrame navItems={LEAD_DETAIL_NAV}>
        <InternalPageHeader title="Возможность" subtitle="Radar" />
        <ErrorState
          title="Не удалось загрузить возможность"
          description="Это временная ошибка данных, а не признак того, что возможность удалена. Обновите страницу немного позже."
          action={{ href: '/leads', label: 'Вернуться к возможностям' }}
        />
      </InternalPageFrame>
    );
  }

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
  const profileResult = await Promise.allSettled([
    getClientProfileById(lead.clientProfileId, ownerId),
  ]);
  const profile = profileResult[0].status === 'fulfilled' ? profileResult[0].value : null;
  const profileUnavailable = profileResult[0].status === 'rejected';
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

  // Auto-discovered contact surface: the system extracted concrete contact
  // channels from the company's career-page HTML so the agency sees the actual
  // HR mailbox / phone / Telegram — not just "there is a career page". Filtered
  // by the client's contact policy (corporate_only by default) so a personal
  // route is never surfaced as a safe path. Empty when the career page exposed
  // no contact surface — the honest empty state, rendered explicitly below.
  const contactPolicy = profile?.contactPolicy ?? 'corporate_only';
  const policyFilteredContactPaths = filterContactPathsByPolicy(lead.contactPaths, contactPolicy);
  const contactViews = toContactPathViews(policyFilteredContactPaths);

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
          nav={<InternalBackLink href="/leads">Возможности</InternalBackLink>}
        />

        {profileUnavailable ? (
          <ErrorState
            title="Не удалось загрузить настройки Radar"
            description="Доказательства возможности доступны, но персональное объяснение соответствия профилю временно не рассчитано."
            action={{ href: '/settings/radar', label: 'Открыть настройки Radar' }}
          />
        ) : null}

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

              {/* Primary hiring signal — only when there is an actual argument to show */}
              {lead.whyNow && lead.whyNow.trim() && (
                <ContentCard>
                  <ContentCardTitle>Почему сейчас</ContentCardTitle>
                  <p className={ipStyles.bodyText}>{lead.whyNow}</p>
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

              {/* Auto-discovered contacts — the concrete channels the system
                  found on the company's career page, so the agency can act
                  without opening the page to hunt for an HR mailbox. */}
              <ContentCard>
                <ContentCardTitle>Найденные контакты</ContentCardTitle>
                {contactViews.length > 0 ? (
                  <ul className={ipStyles.contactList}>
                    {contactViews.map((c, i) => (
                      <li key={i} className={ipStyles.contactItem}>
                        <span className={ipStyles.contactLabel}>
                          {c.label}
                          {c.isHiringSurface && (
                            <span className={ipStyles.contactHiringTag}>HR</span>
                          )}
                        </span>
                        {c.href ? (
                          <a
                            href={c.href}
                            target={c.href.startsWith('http') ? '_blank' : undefined}
                            rel={c.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                            className={ipStyles.contactValue}
                          >
                            {c.value}
                          </a>
                        ) : (
                          <span className={ipStyles.contactValue}>{c.value}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={ipStyles.bodyTextMuted}>
                    Контакты на карьерной странице не найдены — система определила
                    карьерную страницу, но конкретный HR-ящик или форма не видны.
                    Откройте страницу, чтобы найти путь контакта вручную.
                  </p>
                )}
              </ContentCard>

              {/* Operational handoff closes the primary mobile decision layer. */}
              <ContentCard>
                <NextStepsBlock
                  crmBlock={crmBlock}
                  links={nextStepLinks}
                  singleExportHref={singleExportHref}
                />
              </ContentCard>

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
              {/* Confidence gate — the verdict score/gate live in the hero card
                  at the top of the main column now, so the sidebar leads with
                  the gate explanation instead of duplicating the gauge. */}
              <ContentCard>
                <div className={ipStyles.sidebarLabel}>Подтверждение доказательствами</div>
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
