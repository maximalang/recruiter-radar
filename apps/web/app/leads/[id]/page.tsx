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
import { formatVacanciesCount, pluralForm } from '@/lib/format/plural';
import { formatScorePoints } from '@/lib/scoring/score-display';
import FeedbackButtons from './feedback-buttons';
import AiEnrichmentBlock from './ai-enrichment-block';
import NextStepsBlock from './next-steps-block';
import {
  InternalPageFrame,
  InternalPageHeader,
  InternalBackLink,
  NotFoundState,
  GATE_DESC,
  FEEDBACK_LABELS,
} from '../../ui/internal-page';
import {
  ConfidenceIndicator,
  EvidenceTimeline,
  Provenance,
} from '../../ui/intelligence-primitives';
import { ProductErrorState } from '../../ui/product-error-state';
import { StaticEmptyState } from '../../ui/static-empty-state';
import { buildAccountNavigation } from '../../ui/account-navigation';
import { SearchIcon } from '../../ui/icons';
import styles from './lead-brief.module.css';

export const dynamic = 'force-dynamic';
const LEAD_DETAIL_NAV = buildAccountNavigation('leads');

type ConfidenceView = { level: 'high' | 'medium' | 'low'; label: string };

function confidenceView(gate: string): ConfidenceView {
  if (gate === 'A') return { level: 'high', label: 'высокая уверенность' };
  if (gate === 'B') return { level: 'medium', label: 'достаточная уверенность' };
  if (gate === 'C') return { level: 'medium', label: 'ограниченная уверенность' };
  return { level: 'low', label: 'низкая уверенность' };
}

function formatRoleCount(count: number): string {
  return `${count} ${pluralForm(count, ['роль', 'роли', 'ролей'])}`;
}

function formatSourceCount(count: number): string {
  return `${count} ${pluralForm(count, ['источник', 'источника', 'источников'])}`;
}

function StateLink({ href, label }: { href: string; label: string }) {
  return <Link href={href}>{label}</Link>;
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorization = await getSession({ permission: 'leads:read' });
  if (!authorization) {
    return (
      <InternalPageFrame navItems={LEAD_DETAIL_NAV}>
        <InternalPageHeader title="Компания" subtitle="Защищённое рабочее пространство" />
        <StaticEmptyState
          title="Нужен вход в аккаунт"
          description="Войдите, чтобы открыть эту компанию в своём workspace."
          action={<StateLink href={`/login?returnTo=/leads/${encodeURIComponent(id)}`} label="Войти" />}
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
        <InternalPageHeader title="Компания" subtitle="Проверка доступа" />
        <ProductErrorState
          title="Не удалось проверить доступ"
          description="Данные не показываются, пока сервер не подтвердит права аккаунта."
        >
          <StateLink href="/settings/access" label="Доступ и оплата" />
        </ProductErrorState>
      </InternalPageFrame>
    );
  }
  if (entitlement.status !== 'active' || !entitlement.features.includes('dashboard')) {
    return (
      <InternalPageFrame navItems={LEAD_DETAIL_NAV}>
        <InternalPageHeader title="Компания" subtitle="Доступ не активен" />
        <StaticEmptyState
          title="Нужен активный доступ"
          description="Профиль и история сохранены. После активации компания снова станет доступна."
          action={<StateLink href="/settings/access" label="Проверить доступ" />}
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
        <InternalPageHeader title="Компания" subtitle="Радар" />
        <ProductErrorState
          title="Не удалось загрузить компанию"
          description="Это временная ошибка данных, а не признак удаления компании."
        >
          <StateLink href="/leads" label="Вернуться к компаниям" />
        </ProductErrorState>
      </InternalPageFrame>
    );
  }

  if (!lead) {
    return <main><NotFoundState icon={SearchIcon} title="Компания не найдена" backHref="/leads" backLabel="Назад к компаниям" /></main>;
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
    ? `Начать с найденного корпоративного контакта и сослаться на текущий сигнал найма.`
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
  const confidence = confidenceView(lead.confidenceGate);

  return (
    <InternalPageFrame navItems={LEAD_DETAIL_NAV}>
      <div className={styles.brief}>
        <InternalPageHeader
          title={lead.orgName}
          subtitle={lead.locationNames.length > 0 ? lead.locationNames.join(', ') : 'Регион не указан'}
          nav={<InternalBackLink href="/leads">Компании</InternalBackLink>}
        />

        {profileUnavailable ? (
          <div className={styles.notice}>Доказательства доступны, но персональное объяснение соответствия профилю временно не рассчитано.</div>
        ) : null}

        <div className={styles.identityLine}>
          <div className={styles.identityMeta}>
            <span>{formatVacanciesCount(lead.vacanciesCount)}</span>
            <span>{formatRoleCount(lead.distinctVacancyNamesCount)}</span>
            {latestSignal ? <span>последний сигнал {latestSignal}</span> : null}
            {lead.reviewStatus && lead.reviewStatus !== 'auto_approved' ? <span>на проверке</span> : null}
          </div>
        </div>

        <section className={styles.decision} aria-label="Почему сейчас" data-company-brief-decision>
          <div className={styles.decisionSection}>
            <span className={styles.label}>Почему сейчас</span>
            <p className={styles.whyNow}>{lead.whyNow?.trim() || urgency.label}</p>
            <div className={styles.nextMeta}>
              {urgency.label}{shownRoles.length > 0 ? ` · ${shownRoles.join(' · ')}${moreRoles > 0 ? ` + ещё ${moreRoles}` : ''}` : ''}
            </div>
          </div>
        </section>

        <div className={styles.layout}>
          <section className={`${styles.section} ${styles.evidenceSection}`} data-company-brief-evidence>
            <h2>Лента подтверждений</h2>
            <div className={styles.stats}>
              <span>{formatVacanciesCount(lead.vacanciesCount)}</span>
              <span>{formatRoleCount(lead.distinctVacancyNamesCount)}</span>
              <span>{formatSourceCount(lead.sourceFamilies.length)}</span>
            </div>
            {lead.evidenceTitles.length > 0 ? (
              <EvidenceTimeline>
                {lead.evidenceTitles.map((title, index) => (
                  <li key={`${title}:${index}`}>
                    <div className={styles.evidenceFact}>
                      <span className={styles.evidenceIndex}>{String(index + 1).padStart(2, '0')}</span>
                      <span>{title}</span>
                    </div>
                  </li>
                ))}
              </EvidenceTimeline>
            ) : <p className={styles.body}>Подтверждённые факты пока не сформированы.</p>}
          </section>

          <section className={`${styles.section} ${styles.confidenceSection}`} data-company-brief-confidence>
            <h2>Уверенность</h2>
            <ConfidenceIndicator level={confidence.level}>{confidence.label}</ConfidenceIndicator>
            <p className={styles.body}>{GATE_DESC[lead.confidenceGate] ?? GATE_DESC.D}</p>
          </section>

          <section className={`${styles.section} ${styles.nextMoveSection}`} data-company-brief-next-move>
            <h2>Следующий ход</h2>
            <p className={styles.nextMove}>{nextMove}</p>
          </section>

          <div className={styles.provenanceSection} data-company-brief-provenance>
            <Provenance>
              <span>Источники: {lead.sourceFamilies.length > 0 ? lead.sourceFamilies.join(' · ') : 'не подтверждены'}</span>
              {latestSignal ? <span>Последний сигнал: {latestSignal}</span> : null}
              <span data-numeric="true">Сила сигнала: {score}</span>
            </Provenance>
          </div>

          <aside className={styles.aside} aria-label="Действия и контекст" data-company-brief-action>
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
                <span className={styles.railTitle}>Статус</span>
                <div className={styles.railValue}>{feedback ? feedback.label : 'Обратной связи ещё нет'}</div>
                {lead.feedbackNote ? <p className={styles.body}>{lead.feedbackNote}</p> : null}
                <FeedbackButtons orgId={lead.orgId} clientProfileId={lead.clientProfileId} currentStatus={lead.feedbackStatus ?? 'none'} />
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

          <div className={styles.main} data-company-brief-context>
            {summaryLines.length > 0 ? (
              <section className={styles.section}>
                <h2>Контекст компании и найма</h2>
                <div className={styles.summary}>
                  {summaryLines.map((line, index) => <p key={index}>{line}</p>)}
                  {summary.isThin ? <p>Доказательств пока немного; вывод будет уточняться по мере новых сигналов.</p> : null}
                </div>
              </section>
            ) : null}

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
          </div>
        </div>
      </div>
    </InternalPageFrame>
  );
}