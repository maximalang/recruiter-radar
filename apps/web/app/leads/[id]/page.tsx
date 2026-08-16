import Link from 'next/link';
import { getLeadDetail, formatLawfulContactPath } from '@/lib/leads-data';
import { getClientProfileById, resolveHiringMode } from '@/lib/clientProfiles';
import { getSession } from '@/lib/auth-v2/authorization';
import { getEffectiveEntitlement } from '@/lib/entitlements';
import { buildFitExplanation } from '@/lib/leads/fit-explanation';
import { buildCompanySummary } from '@/lib/leads/company-summary';
import { deriveRoleNames, splitRolesForDisplay, deriveUrgencyCue } from '@/lib/leads/lead-quality';
import { toContactPathViews } from '@/lib/leads/contact-display';
import { filterContactPathsByPolicy } from '@/lib/contact-policy-filter';
import { leadToCrmBlock } from '@/lib/leads-csv';
import { formatScorePoints } from '@/lib/scoring/score-display';
import FeedbackButtons from './feedback-buttons';
import AiEnrichmentBlock from './ai-enrichment-block';
import NextStepsBlock from './next-steps-block';
import {
  InternalPageFrame,
  InternalPageHeader,
  InternalBackLink,
  NotFoundState,
  EmptyState,
  ErrorState,
  GATE_DESC,
  FEEDBACK_LABELS,
} from '../../ui/internal-page';
import { buildAccountNavigation } from '../../ui/account-navigation';
import { SearchIcon } from '../../ui/icons';
import styles from './lead-brief.module.css';

export const dynamic = 'force-dynamic';
const LEAD_DETAIL_NAV = buildAccountNavigation('leads');

type ConfidenceView = { level: 'high' | 'medium' | 'low'; segments: 1 | 2 | 3; label: string };

function confidenceView(gate: string): ConfidenceView {
  if (gate === 'A') return { level: 'high', segments: 3, label: 'высокая уверенность' };
  if (gate === 'B') return { level: 'medium', segments: 2, label: 'достаточная уверенность' };
  if (gate === 'C') return { level: 'medium', segments: 2, label: 'ограниченная уверенность' };
  return { level: 'low', segments: 1, label: 'низкая уверенность' };
}

function ConfidenceIndicator({ gate }: { gate: string }) {
  const view = confidenceView(gate);
  return (
    <div className={styles.confidence} data-level={view.level} aria-label={view.label}>
      <span className={styles.segments} aria-hidden="true">
        {[1, 2, 3].map((segment) => (
          <span key={segment} className={styles.segment} data-on={segment <= view.segments ? 'true' : undefined} />
        ))}
      </span>
      <span className={styles.confidenceLabel}>{view.label}</span>
    </div>
  );
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorization = await getSession({ permission: 'leads:read' });
  if (!authorization) {
    return (
      <InternalPageFrame navItems={LEAD_DETAIL_NAV}>
        <InternalPageHeader title="Возможность" subtitle="Защищённое рабочее пространство" />
        <EmptyState title="Нужен вход в аккаунт" text="Войдите, чтобы открыть эту возможность в своём workspace." action={{ href: `/login?returnTo=/leads/${encodeURIComponent(id)}`, label: 'Войти' }} />
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
        <ErrorState title="Не удалось проверить доступ" description="Данные не показываются, пока сервер не подтвердит права аккаунта." action={{ href: '/settings/access', label: 'Доступ и оплата' }} />
      </InternalPageFrame>
    );
  }
  if (entitlement.status !== 'active' || !entitlement.features.includes('dashboard')) {
    return (
      <InternalPageFrame navItems={LEAD_DETAIL_NAV}>
        <InternalPageHeader title="Возможность" subtitle="Доступ не активен" />
        <EmptyState title="Нужен активный доступ" text="Профиль и история сохранены. После активации возможность снова станет доступна." action={{ href: '/settings/access', label: 'Проверить доступ' }} />
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
        <ErrorState title="Не удалось загрузить возможность" description="Это временная ошибка данных, а не признак удаления компании." action={{ href: '/leads', label: 'Вернуться к возможностям' }} />
      </InternalPageFrame>
    );
  }

  if (!lead) {
    return <main><NotFoundState icon={SearchIcon} title="Возможность не найдена" backHref="/leads" backLabel="Назад к возможностям" /></main>;
  }

  const profileResult = await Promise.allSettled([getClientProfileById(lead.clientProfileId, ownerId)]);
  const profile = profileResult[0].status === 'fulfilled' ? profileResult[0].value : null;
  const profileUnavailable = profileResult[0].status === 'rejected';
  const fit = profile
    ? buildFitExplanation({
        structuredReasons: lead.structuredReasons,
        locationNames: lead.locationNames,
        lawfulContactPath: lead.lawfulContactPath,
        sourceFamilies: lead.sourceFamilies,
        careerPageUrl: lead.careerPageUrl,
        orgDomain: lead.orgDomain,
        orgName: lead.orgName,
        evidenceTitles: lead.evidenceTitles,
      }, {
        industries: profile.industries,
        roles: profile.roles,
        excludedIndustries: profile.excludedIndustries,
        excludedLocations: profile.excludedLocations,
        contactPolicy: profile.contactPolicy,
        remoteFriendly: profile.remoteFriendly,
        targetCity: profile.targetCity,
        specialization: profile.specialization,
        includeKeywords: profile.includeKeywords,
      })
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
  const summaryLines = [summary.identity, summary.hiringMotion, summary.agencyRelevance].filter((line): line is string => line !== null);
  const roleNames = deriveRoleNames({
    evidenceTitles: lead.evidenceTitles,
    aiRoleTitles: lead.aiEnrichment?.detectedRoles?.map((role) => role.title) ?? null,
  });
  const { shown: shownRoles, more: moreRoles } = splitRolesForDisplay(roleNames, 5);
  const resolvedHiringMode = profile ? resolveHiringMode(profile) : 'specialist';
  const urgency = deriveUrgencyCue({ vacanciesCount: lead.vacanciesCount, latestPublishedAt: lead.latestPublishedAt, hiringMode: resolvedHiringMode });
  const contactPolicy = profile?.contactPolicy ?? 'corporate_only';
  const contactViews = toContactPathViews(filterContactPathsByPolicy(lead.contactPaths, contactPolicy));
  const lawfulPath = formatLawfulContactPath(lead.lawfulContactPath);

  const nextMove = contactViews.length > 0
    ? `Начать с найденного корпоративного контакта и сослаться на текущий hiring signal.`
    : lawfulPath
      ? `Использовать безопасный путь контакта: ${lawfulPath}.`
      : lead.careerPageUrl
        ? 'Открыть карьерную страницу и найти корпоративный путь контакта вручную.'
        : 'Сначала подтвердить корпоративный путь контакта, затем выходить с предложением.';

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
  const feedback = lead.feedbackStatus && lead.feedbackStatus !== 'none'
    ? FEEDBACK_LABELS[lead.feedbackStatus] ?? { label: lead.feedbackStatus }
    : null;
  const score = formatScorePoints(lead.score);
  const latestSignal = lead.latestPublishedAt
    ? new Date(lead.latestPublishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <InternalPageFrame navItems={LEAD_DETAIL_NAV}>
      <div className={styles.brief}>
        <InternalPageHeader
          title={lead.orgName}
          subtitle={lead.locationNames.length > 0 ? lead.locationNames.join(', ') : 'Регион не указан'}
          nav={<InternalBackLink href="/leads">Возможности</InternalBackLink>}
        />

        {profileUnavailable ? (
          <div className={styles.notice}>Доказательства доступны, но персональное объяснение соответствия профилю временно не рассчитано.</div>
        ) : null}

        <div className={styles.identityLine}>
          <div className={styles.identityMeta}>
            <span>{lead.vacanciesCount} вакансий</span>
            <span>{lead.distinctVacancyNamesCount} ролей</span>
            {latestSignal ? <span>последний сигнал {latestSignal}</span> : null}
            {lead.reviewStatus && lead.reviewStatus !== 'auto_approved' ? <span>на проверке</span> : null}
          </div>
          <div className={styles.scoreBlock}>
            <div className={styles.score} data-numeric="true">{score}<small>/100</small></div>
            <ConfidenceIndicator gate={lead.confidenceGate} />
          </div>
        </div>

        <section className={styles.decision} aria-label="Решение">
          <div className={styles.decisionSection}>
            <span className={styles.label}>Почему сейчас</span>
            <p className={styles.whyNow}>{lead.whyNow?.trim() || urgency.label}</p>
            <div className={styles.nextMeta}>
              {urgency.label}{shownRoles.length > 0 ? ` · ${shownRoles.join(' · ')}${moreRoles > 0 ? ` + ещё ${moreRoles}` : ''}` : ''}
            </div>
          </div>
          <div className={styles.decisionSection}>
            <span className={styles.label}>Следующий ход</span>
            <p className={styles.nextMove}>{nextMove}</p>
          </div>
        </section>

        <div className={styles.layout}>
          <main className={styles.main}>
            {summaryLines.length > 0 ? (
              <section className={styles.section}>
                <h2>Контекст компании и найма</h2>
                <div className={styles.summary}>
                  {summaryLines.map((line, index) => <p key={index}>{line}</p>)}
                  {summary.isThin ? <p>Доказательств пока немного; вывод будет уточняться по мере новых сигналов.</p> : null}
                </div>
              </section>
            ) : null}

            <section className={styles.section}>
              <h2>Evidence ledger</h2>
              <div className={styles.stats}>
                <span>{lead.vacanciesCount} вакансий</span>
                <span>{lead.distinctVacancyNamesCount} разных ролей</span>
                <span>{lead.sourceFamilies.length} источников</span>
              </div>
              {lead.evidenceTitles.length > 0 ? (
                <ol className={styles.evidenceList}>
                  {lead.evidenceTitles.map((title, index) => (
                    <li key={`${title}:${index}`}>
                      <span className={styles.evidenceIndex}>{String(index + 1).padStart(2, '0')}</span>
                      <span>{title}</span>
                    </li>
                  ))}
                </ol>
              ) : <p className={styles.body}>Фактические evidence items пока не сформированы.</p>}
              {lead.sourceFamilies.length > 0 ? (
                <div className={styles.provenance}>Provenance: {lead.sourceFamilies.join(' · ')}</div>
              ) : null}
            </section>

            {fit && !fit.isEmpty ? (
              <section className={styles.section}>
                <h2>Соответствие вашему профилю</h2>
                <ul className={styles.fitList}>{fit.lines.map((line, index) => <li key={index}>{line.text}</li>)}</ul>
              </section>
            ) : null}

            <AiEnrichmentBlock enrichment={lead.aiEnrichment} />

            {lead.negativeSignals.length > 0 ? (
              <section className={styles.section}>
                <h2>Риски и ограничения</h2>
                <ul className={styles.riskList}>{lead.negativeSignals.map((signal, index) => <li key={index}>{signal}</li>)}</ul>
              </section>
            ) : null}
          </main>

          <aside className={styles.aside} aria-label="Действия и контекст">
            <div className={styles.rail}>
              <section className={styles.railSection}>
                <span className={styles.railTitle}>Контакт</span>
                {lawfulPath ? <div className={styles.railValue}>{lawfulPath}</div> : null}
                {contactViews.length > 0 ? (
                  <ul className={styles.contactList}>
                    {contactViews.map((contact, index) => (
                      <li key={index}>
                        <span className={styles.contactLabel}>{contact.label}{contact.isHiringSurface ? ' · HR' : ''}</span>
                        {contact.href ? (
                          <a href={contact.href} target={contact.href.startsWith('http') ? '_blank' : undefined}
                            rel={contact.href.startsWith('http') ? 'noopener noreferrer' : undefined} className={styles.contactValue}>
                            {contact.value}
                          </a>
                        ) : <span className={styles.contactValue}>{contact.value}</span>}
                      </li>
                    ))}
                  </ul>
                ) : <div className={styles.metaList}>Конкретный корпоративный контакт не найден.</div>}
              </section>

              <section className={styles.railSection}>
                <span className={styles.railTitle}>Действие</span>
                <NextStepsBlock crmBlock={crmBlock} links={nextStepLinks} singleExportHref={`/api/leads/${lead.id}/export`} />
              </section>

              <section className={styles.railSection}>
                <span className={styles.railTitle}>Workflow</span>
                <div className={styles.railValue}>{feedback ? feedback.label : 'Обратной связи ещё нет'}</div>
                {lead.feedbackNote ? <p className={styles.body}>{lead.feedbackNote}</p> : null}
                <FeedbackButtons orgId={lead.orgId} clientProfileId={lead.clientProfileId} currentStatus={lead.feedbackStatus ?? 'none'} />
              </section>

              <section className={styles.railSection}>
                <span className={styles.railTitle}>Подтверждение</span>
                <div className={styles.railValue}>{confidenceView(lead.confidenceGate).label}</div>
                <div className={styles.metaList}>{GATE_DESC[lead.confidenceGate] ?? GATE_DESC.D}</div>
              </section>

              <section className={styles.railSection}>
                <span className={styles.railTitle}>Компания</span>
                <div className={styles.metaList}>
                  {lead.orgDomain ? <span>{lead.orgDomain}</span> : null}
                  {lead.orgWebsite ? <a href={lead.orgWebsite} target="_blank" rel="noopener noreferrer">Сайт компании</a> : null}
                  {lead.careerPageUrl ? <a href={lead.careerPageUrl} target="_blank" rel="noopener noreferrer">Карьерная страница</a> : null}
                  {lead.orgInn ? <span className={styles.identifier}>ИНН {lead.orgInn}</span> : null}
                  {lead.orgOgrn ? <span className={styles.identifier}>ОГРН {lead.orgOgrn}</span> : null}
                  {lead.sourceExternalId ? <span className={styles.identifier}>ID {lead.sourceExternalId}</span> : null}
                  <span>Добавлено {new Date(lead.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
              </section>
            </div>
          </aside>
        </div>
      </div>
    </InternalPageFrame>
  );
}
