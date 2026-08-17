import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  getLastRadarRunAt,
  getLeadsForAllProfiles,
  getPendingReviewCount,
  type LeadItem,
  VALID_FEEDBACK_STATUSES,
} from '@/lib/leads-data';
import { listClientProfiles, resolveHiringMode, type ClientProfile } from '@/lib/clientProfiles';
import { getSession } from '@/lib/auth-v2/authorization';
import { getEffectiveEntitlement } from '@/lib/entitlements';
import { buildFitExplanation } from '@/lib/leads/fit-explanation';
import { deriveRoleNames, splitRolesForDisplay, deriveUrgencyCue } from '@/lib/leads/lead-quality';
import { formatVacanciesCount } from '@/lib/format/plural';
import { formatScorePoints } from '@/lib/scoring/score-display';
import LeadsFilters from './leads-filters';
import { pluralizeLeads } from './page-helpers';
import {
  InternalPageFrame,
  InternalPageHeader,
  FeedbackBadge,
  ReviewStatusBadge,
  formatSignalFreshness,
  EmptyState,
  LoadingState,
  ErrorState,
} from '../ui/internal-page';
import { buildAccountNavigation } from '../ui/account-navigation';
import { BriefcaseIcon, ClockIcon, SearchIcon, TargetIcon } from '../ui/icons';
import styles from './leads-workspace.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Компании — Recruiter Radar',
  description: 'Компании с подтверждёнными hiring signals, приоритетом и безопасным следующим действием.',
};

const LEADS_NAV = buildAccountNavigation('leads');

type HiringMode = 'specialist' | 'executive' | 'volume';

type ConfidenceView = {
  level: 'high' | 'medium' | 'low';
  segments: 1 | 2 | 3;
  label: string;
};

function confidenceView(gate: LeadItem['confidenceGate']): ConfidenceView {
  if (gate === 'A') return { level: 'high', segments: 3, label: 'высокая' };
  if (gate === 'B') return { level: 'medium', segments: 2, label: 'достаточная' };
  if (gate === 'C') return { level: 'medium', segments: 2, label: 'требует проверки' };
  return { level: 'low', segments: 1, label: 'недостаточно' };
}

function ConfidenceIndicator({ gate }: { gate: LeadItem['confidenceGate'] }) {
  const view = confidenceView(gate);
  return (
    <div className={styles.confidence} data-level={view.level} aria-label={`Уверенность: ${view.label}`}>
      <span className={styles.segments} aria-hidden="true">
        {[1, 2, 3].map((segment) => (
          <span key={segment} className={styles.segment} data-on={segment <= view.segments ? 'true' : undefined} />
        ))}
      </span>
      <span className={styles.confidenceLabel}>{view.label}</span>
    </div>
  );
}

function WorkflowState({ lead }: { lead: LeadItem }) {
  if (lead.reviewStatus && lead.reviewStatus !== 'auto_approved') {
    return <ReviewStatusBadge status={lead.reviewStatus} />;
  }
  if (lead.feedbackStatus && lead.feedbackStatus !== 'none') {
    return <FeedbackBadge status={lead.feedbackStatus} />;
  }
  return null;
}

export function LeadRow({
  lead,
  fitPreview,
  hiringMode,
  rank,
}: {
  lead: LeadItem;
  fitPreview: { icon: string; text: string } | null;
  hiringMode: HiringMode;
  rank: number;
}) {
  const roleNames = deriveRoleNames({ evidenceTitles: lead.evidenceTitles });
  const { shown: shownRoles, more: moreRoles } = splitRolesForDisplay(roleNames, 2);
  const urgency = deriveUrgencyCue({
    vacanciesCount: lead.vacanciesCount,
    latestPublishedAt: lead.latestPublishedAt,
    hiringMode,
  });
  const points = formatScorePoints(lead.score);
  const freshness = formatSignalFreshness(lead.latestPublishedAt)?.label ?? 'свежесть проверяется';
  const vacancies = formatVacanciesCount(lead.vacanciesCount);
  const roles = shownRoles.length > 0
    ? `${shownRoles.join(' · ')}${moreRoles > 0 ? ` + ещё ${moreRoles}` : ''}`
    : null;
  const whyNow = lead.whyNow || urgency.label;
  const workflowState = (
    (lead.reviewStatus && lead.reviewStatus !== 'auto_approved') ||
    (lead.feedbackStatus && lead.feedbackStatus !== 'none')
  );
  const secondarySignals = [
    lead.isForeignEmployer ? 'иностранный работодатель' : null,
    lead.hasAiHint ? 'ИИ-подсказка доступна' : null,
    fitPreview?.text ?? null,
  ].filter(Boolean).join(' · ');

  return (
    <article className={styles.row} data-lead-row="true">
      <div className={styles.rank}>{String(rank).padStart(2, '0')}</div>

      <div className={styles.identity}>
        <Link href={`/leads/${lead.id}`} className={styles.company}>{lead.orgName}</Link>
        {lead.locationNames.length > 0 ? (
          <div className={styles.meta}>{lead.locationNames.slice(0, 2).join(', ')}</div>
        ) : null}
      </div>

      <div className={styles.decision}>
        <strong>{whyNow}</strong>
        <div className={styles.decisionMeta}>{[freshness, roles].filter(Boolean).join(' · ')}</div>
      </div>

      <div className={styles.evidence}>
        <strong>{vacancies} · {lead.evidenceTitles.length} подтвержд.</strong>
        <div className={styles.evidenceMeta}>
          {lead.sourceFamilies.length > 0
            ? `${lead.sourceFamilies.length} ${lead.sourceFamilies.length === 1 ? 'источник' : 'источника'}`
            : 'источник не подтверждён'}
        </div>
      </div>

      <div className={styles.score} data-numeric="true" aria-label={`Сила сигнала ${points}`}>{points}</div>
      <ConfidenceIndicator gate={lead.confidenceGate} />
      <Link href={`/leads/${lead.id}`} className={styles.action} aria-label={`Открыть анализ компании ${lead.orgName}`}>
        Открыть
      </Link>

      {(workflowState || lead.negativeSignals[0] || secondarySignals) ? (
        <div className={styles.workflow}>
          {workflowState ? <WorkflowState lead={lead} /> : null}
          {lead.negativeSignals[0] ? <span className={styles.risk}>{lead.negativeSignals[0]}</span> : null}
          {secondarySignals ? <span className={styles.secondaryMeta}>{secondarySignals}</span> : null}
        </div>
      ) : null}
    </article>
  );
}

export function LeadsList({
  leads,
  fitPreviewFor,
  hiringModeFor,
  hasActiveProfile,
  hasAnyProfile,
  lastRunAt,
  narrowProfile,
  workingSet,
}: {
  leads: LeadItem[];
  fitPreviewFor: (lead: LeadItem) => { icon: string; text: string } | null;
  hiringModeFor: (lead: LeadItem) => HiringMode;
  hasActiveProfile: boolean;
  hasAnyProfile: boolean;
  lastRunAt: string | null;
  narrowProfile: boolean;
  workingSet: boolean;
}) {
  if (leads.length === 0) {
    if (workingSet) {
      return <div className={styles.emptyWrap}><EmptyState icon={ClockIcon} title="Ничего в работе" text="Вы ещё не взяли компании в работу. Откройте полный список и выберите компании для контакта." action={{ href: '/leads', label: 'Открыть компании' }} /></div>;
    }
    if (!hasActiveProfile) {
      if (hasAnyProfile) {
        return <div className={styles.emptyWrap}><EmptyState icon={TargetIcon} title="Профиль радара приостановлен" text="Настройки сохранены, но новые компании не формируются. Включите профиль для следующего сканирования." action={{ href: '/settings/radar', label: 'Включить профиль радара' }} /></div>;
      }
      return <div className={styles.emptyWrap}><EmptyState icon={TargetIcon} title="Настройте профиль радара" text="Опишите роли, отрасли и регионы — после этого Радар начнёт ранжировать компании по подтверждённым сигналам." action={{ href: '/settings/radar', label: 'Настроить профиль' }} /></div>;
    }
    if (!lastRunAt) {
      return <div className={styles.emptyWrap}><EmptyState icon={ClockIcon} title="Первое сканирование ещё не завершено" text="Профиль сохранён. После первого прохода здесь появятся компании, причины приоритета и подтверждения." action={{ href: '/settings/radar', label: 'Проверить профиль радара' }} /></div>;
    }
    if (narrowProfile) {
      return <div className={styles.emptyWrap}><EmptyState icon={SearchIcon} title="По специализации пока мало сигналов" text="Для узкой практики это нормальный результат. Расширьте ключевые фразы или дождитесь следующего сканирования." action={{ href: '/settings/radar#fine-tuning', label: 'Расширить профиль' }} /></div>;
    }
    return <div className={styles.emptyWrap}><EmptyState icon={BriefcaseIcon} title="Подходящих компаний пока нет" text="Последний запуск завершён, но текущие условия не дали достаточно сильных сигналов." action={{ href: '/settings/radar#fine-tuning', label: 'Уточнить профиль' }} /></div>;
  }

  return (
    <div className={styles.list} data-motion-list>
      {leads.map((lead, index) => (
        <LeadRow key={lead.id} lead={lead} rank={index + 1} fitPreview={fitPreviewFor(lead)} hiringMode={hiringModeFor(lead)} />
      ))}
    </div>
  );
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; gate?: string; feedback?: string; page?: string; profile?: string; today?: string }>;
}) {
  const filters = await searchParams;
  const query = filters.q?.trim().toLocaleLowerCase('ru-RU') ?? '';
  const confidenceGate = filters.gate && ['A', 'B', 'C', 'D'].includes(filters.gate) ? filters.gate : null;
  const feedbackStatus = filters.feedback && VALID_FEEDBACK_STATUSES.has(filters.feedback as never) ? filters.feedback : null;
  const workingSet = filters.today === '1';
  const effectiveFeedbackStatus = workingSet ? null : feedbackStatus;

  const authorization = await getSession({ permission: 'leads:read' });
  if (!authorization) {
    return (
      <InternalPageFrame navItems={LEADS_NAV}>
        <InternalPageHeader title="Компании" subtitle="Защищённое рабочее пространство" />
        <EmptyState title="Нужен вход в аккаунт" text="Войдите, чтобы открыть компании только вашего рабочего пространства." action={{ href: '/login?returnTo=/leads', label: 'Войти' }} />
      </InternalPageFrame>
    );
  }

  const ownerId = authorization.dataOwnerId;
  const entitlement = authorization.workspaceId
    ? await getEffectiveEntitlement(ownerId, { workspaceId: authorization.workspaceId }).catch(() => null)
    : null;
  if (!entitlement) {
    return (
      <InternalPageFrame navItems={LEADS_NAV}>
        <InternalPageHeader title="Компании" subtitle="Проверка доступа" />
        <ErrorState title="Не удалось проверить доступ" description="Обновите страницу позже. Данные не показываются, пока сервер не подтвердит права аккаунта." action={{ href: '/settings/access', label: 'Доступ и оплата' }} />
      </InternalPageFrame>
    );
  }
  if (entitlement.status !== 'active' || !entitlement.features.includes('dashboard')) {
    return (
      <InternalPageFrame navItems={LEADS_NAV}>
        <InternalPageHeader title="Компании" subtitle="Доступ не активен" />
        <EmptyState title="Нужен активный доступ" text="Профиль и история сохранены. После активации компании снова станут доступны." action={{ href: '/settings/access', label: 'Проверить доступ' }} />
      </InternalPageFrame>
    );
  }

  let profiles: ClientProfile[];
  try {
    profiles = await listClientProfiles(ownerId);
  } catch {
    return (
      <InternalPageFrame navItems={LEADS_NAV}>
        <InternalPageHeader title="Компании" subtitle="Профиль радара" />
        <ErrorState title="Не удалось загрузить профиль" description="Это временная ошибка данных, а не пустой результат Радара." action={{ href: '/settings/radar', label: 'Открыть профиль радара' }} />
      </InternalPageFrame>
    );
  }

  const activeProfiles = profiles.filter((profile) => profile.isActive);
  const selectedProfileId = filters.profile && activeProfiles.some((profile) => profile.id === filters.profile) ? filters.profile : null;
  const selectedProfile = selectedProfileId ? activeProfiles.find((profile) => profile.id === selectedProfileId) ?? null : null;
  const profileIds = selectedProfileId ? [selectedProfileId] : activeProfiles.map((profile) => profile.id);

  let allLeads: LeadItem[] = [];
  let totalLeads = 0;
  let pendingReview = 0;
  let lastRunAt: string | null = null;
  let leadsFetchError = false;

  try {
    const [result, reviewCount, latestRun] = await Promise.all([
      getLeadsForAllProfiles({ profileIds, ownerId, confidenceGate, feedbackStatus: effectiveFeedbackStatus, workingSet }),
      getPendingReviewCount({ profileIds, ownerId }),
      getLastRadarRunAt({ profileIds, ownerId }),
    ]);
    allLeads = result.leads;
    totalLeads = result.total;
    pendingReview = reviewCount;
    lastRunAt = latestRun;
  } catch {
    leadsFetchError = true;
  }

  const fitProfilesById = new Map(activeProfiles.map((profile) => [profile.id, {
    industries: profile.industries,
    roles: profile.roles,
    excludedIndustries: profile.excludedIndustries,
    excludedLocations: profile.excludedLocations,
    contactPolicy: profile.contactPolicy,
    remoteFriendly: profile.remoteFriendly,
    targetCity: profile.targetCity,
    specialization: profile.specialization,
    includeKeywords: profile.includeKeywords,
  }]));
  const hiringModeByProfileId = new Map(activeProfiles.map((profile) => [profile.id, resolveHiringMode(profile)]));

  const fitPreviewFor = (lead: LeadItem): { icon: string; text: string } | null => {
    const profile = fitProfilesById.get(lead.clientProfileId);
    if (!profile) return null;
    const fit = buildFitExplanation({
      structuredReasons: lead.structuredReasons,
      locationNames: lead.locationNames,
      lawfulContactPath: lead.lawfulContactPath,
      sourceFamilies: lead.sourceFamilies,
      orgName: lead.orgName,
      evidenceTitles: lead.evidenceTitles,
    }, profile);
    const first = fit.lines[0];
    return first ? { icon: first.dimension, text: first.text } : null;
  };

  const visibleLeads = query
    ? allLeads.filter((lead) => [
        lead.orgName,
        lead.whyNow,
        ...lead.evidenceTitles,
        ...lead.locationNames,
      ].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU').includes(query))
    : allLeads;

  const hasFilters = Boolean(query || confidenceGate || effectiveFeedbackStatus || selectedProfileId || workingSet);
  const narrowProfile = selectedProfile
    ? Boolean((selectedProfile.specialization && selectedProfile.specialization.trim() !== '') || selectedProfile.includeKeywords.length > 0)
    : activeProfiles.some((profile) => (profile.specialization && profile.specialization.trim() !== '') || profile.includeKeywords.length > 0);

  const exportParams = new URLSearchParams();
  if (confidenceGate) exportParams.set('gate', confidenceGate);
  if (effectiveFeedbackStatus) exportParams.set('feedback', effectiveFeedbackStatus);
  if (selectedProfileId) exportParams.set('profile', selectedProfileId);
  if (workingSet) exportParams.set('today', '1');
  const exportQuery = exportParams.toString();
  const exportHref = exportQuery ? `/api/leads/export?${exportQuery}` : '/api/leads/export';
  const readyCount = allLeads.filter((lead) => lead.confidenceGate === 'A' || lead.confidenceGate === 'B').length;

  return (
    <InternalPageFrame navItems={LEADS_NAV}>
      <InternalPageHeader
        title="Компании"
        subtitle={workingSet
          ? 'Компании, по которым уже начата работа сегодня'
          : selectedProfile
            ? `Практика: ${selectedProfile.agencyName}`
            : 'Кому написать сейчас — и на каких подтверждениях держится приоритет'}
        nav={allLeads.length > 0 ? <a href={exportHref} download>Экспорт CSV</a> : null}
      />

      <div className={styles.summaryStrip} aria-label="Сводка рабочего набора">
        <div>
          <strong>{visibleLeads.length}</strong> {pluralizeLeads(visibleLeads.length)}{hasFilters ? ' в текущем срезе' : ''}
        </div>
        <div className={styles.summaryLinks}>
          <span><strong>{readyCount}</strong> готовы к контакту</span>
          <Link href="/review"><strong>{pendingReview}</strong> на проверке</Link>
          {totalLeads !== visibleLeads.length ? <span>{totalLeads} всего</span> : null}
        </div>
      </div>

      <div className={styles.workspace}>
        <div className={styles.filters}>
          <Suspense fallback={<LoadingState variant="inline" />}>
            <LeadsFilters profiles={activeProfiles.map((profile) => ({ id: profile.id, name: profile.agencyName }))} />
          </Suspense>
        </div>

        {leadsFetchError ? (
          <ErrorState title="Не удалось загрузить компании" description="Повторите через минуту. Если ошибка сохранится, проверьте профиль радара или напишите в поддержку." action={{ href: '/settings/radar', label: 'Проверить профиль' }} />
        ) : (
          <Suspense fallback={<LoadingState variant="skeleton" />}>
            <LeadsList
              leads={visibleLeads}
              fitPreviewFor={fitPreviewFor}
              hiringModeFor={(lead) => hiringModeByProfileId.get(lead.clientProfileId) ?? 'specialist'}
              hasActiveProfile={activeProfiles.length > 0}
              hasAnyProfile={profiles.length > 0}
              lastRunAt={lastRunAt}
              narrowProfile={narrowProfile}
              workingSet={workingSet}
            />
          </Suspense>
        )}
      </div>
    </InternalPageFrame>
  );
}
