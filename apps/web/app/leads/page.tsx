import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getLeadsForAllProfiles, getPendingReviewCount, type LeadItem, VALID_FEEDBACK_STATUSES } from '@/lib/leads-data';
import { listClientProfiles, resolveHiringMode, type ClientProfile } from '@/lib/clientProfiles';
import { getOwnerIdFromSession } from '@/lib/session';
import { buildFitExplanation, FIT_DIMENSION_ICON } from '@/lib/leads/fit-explanation';
import { deriveRoleNames, splitRolesForDisplay, deriveUrgencyCue } from '@/lib/leads/lead-quality';
import { formatVacanciesCount } from '@/lib/format/plural';
import { formatScorePoints, scorePercent } from '@/lib/scoring/score-display';
import LeadsFilters from './leads-filters';
import { pluralizeLeads } from './page-helpers';
import {
  InternalPageFrame,
  InternalPageHeader,
  MetricGrid,
  MetricCard,
  GateBadgeInline,
  FeedbackBadge,
  formatSignalFreshness,
  AiHintChip,
  ForeignEmployerBadge,
  ReviewStatusBadge,
  getScoreTone,
  TableCard,
  EmptyState,
  LoadingState,
  ErrorState,
  FitIcon,
} from '../ui/internal-page';
import { buildAccountNavigation } from '../ui/account-navigation';
import { internalPageClasses as ipStyles } from '../ui/internal-page';
import { SiteFooter } from '../ui/site-footer';
import { ShieldIcon, PinIcon, BriefcaseIcon, AlertIcon, SearchIcon, TargetIcon, ClockIcon, CheckIcon } from '../ui/icons';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Лиды — Recruiter Radar',
  description: 'Компании с активным наймом: оценка, доказательства и безопасный путь контакта.',
};

const LEADS_NAV = buildAccountNavigation('leads');

export function LeadCard({
  lead,
  fitPreview,
  hiringMode,
}: {
  lead: LeadItem;
  fitPreview: { icon: string; text: string } | null;
  /**
   * Resolved hiring mode for the profile that produced this lead (never 'auto'
   * — resolveHiringMode runs at the profile boundary). Drives mode-aware
   * urgency framing so an executive agency does not see volume-shaped cues and
   * a volume agency sees hiring-scale emphasis. Defaults to 'specialist' when
   * the profile can't be matched (keeps the pre-mode behavior).
   */
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
        <div className={ipStyles.signalLeadScore}>
          <strong>{points}</strong><span>/100</span>
        </div>
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
          {risks.map((risk) => (
            <span key={risk} className={ipStyles.leadRiskChip}><AlertIcon className={ipStyles.chipIcon} /> {risk}</span>
          ))}
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

/**
 * Score-tone legend for the leads list. Previously rendered as a blind
 * `aria-hidden` decoration — now it carries a `data-legend` root and visible
 * labels tied to the rail tones, so the colour key is announced to AT and
 * reads as part of the page, not as decoration. The dots stay visual; the
 * labels do the a11y work.
 */
export function LeadsListLegend() {
  return (
    <div className={ipStyles.leadsListLegend} data-legend="true" aria-label="Условные обозначения силы сигнала">
      <span className={ipStyles.leadsListLegendItem}>
        <span className={ipStyles.leadsListLegendDot} data-tone="success" aria-hidden="true" />
        высокий
      </span>
      <span className={ipStyles.leadsListLegendItem}>
        <span className={ipStyles.leadsListLegendDot} data-tone="warning" aria-hidden="true" />
        средний
      </span>
      <span className={ipStyles.leadsListLegendItem}>
        <span className={ipStyles.leadsListLegendDot} data-tone="danger" aria-hidden="true" />
        низкий
      </span>
    </div>
  );
}

function LeadsList({
  leads,
  fitPreviewFor,
  hiringModeFor,
  hasActiveProfile,
  narrowProfile,
  workingSet,
}: {
  leads: LeadItem[];
  fitPreviewFor: (lead: LeadItem) => { icon: string; text: string } | null;
  /**
   * Resolved hiring mode for the profile that produced a given lead. Falls back
   * to 'specialist' (the pre-mode default) when the profile can't be matched.
   */
  hiringModeFor: (lead: LeadItem) => 'specialist' | 'executive' | 'volume';
  hasActiveProfile: boolean;
  /**
   * True when an active profile has a narrow ICP (specialization or include
   * keywords set). Used to give an honest, distinct empty state: a specialized
   * agency with 0 leads is likely facing thin supply for their niche, not a
   * pipeline failure — the next step is to broaden keywords or wait for the
   * next run, not to reconfigure the whole profile.
   */
  narrowProfile: boolean;
  /**
   * True when the "Сегодня в работе" working-set filter is active. Changes the
   * toolbar count noun ("в работе" vs "всего") and the empty-state copy so the
   * page reads as an open-pipeline view, not the full scored pool.
   */
  workingSet: boolean;
}) {
  if (leads.length === 0) {
    // Distinguish three empty cases so the next step is obvious and the
    // product never feels broken:
    //  today view, 0         → honest "ничего в работе" — take a lead from the full pool
    //  no profile yet        → set one up
    //  narrow profile, 0     → honest "thin supply for your niche" — broaden or wait
    //  broad profile, 0      → first batch comes with the next radar run
    if (workingSet) {
      return (
        <EmptyState
          icon={ClockIcon}
          title="Ничего в работе"
          text="Вы ещё не взяли лиды в работу на этом профиле. Откройте полный радар, оцените компании и отметьте первые — они появятся здесь."
          action={{ href: '/leads', label: 'Открыть полный радар' }}
        />
      );
    }
    if (!hasActiveProfile) {
      return (
        <EmptyState
          icon={TargetIcon}
          title="Настройте профиль идеального клиента"
          text="Радар начнёт подбирать компании, как только вы опишете, кого ищете: роли, отрасли, регионы."
          action={{ href: '/profile', label: 'Настроить профиль' }}
        />
      );
    }
    if (narrowProfile) {
      return (
        <EmptyState
          icon={SearchIcon}
          title="По вашей специализации пока мало сигналов"
          text="С узкой специализацией радар находит реже — это нормально. Расширьте ключевые фразы в профиле (например, смежные роли или отрасли) или дождитесь следующего запуска: новые карьерные страницы и платформенные сигналы появляются ежедневно."
          action={{ href: '/profile#fine-tuning', label: 'Расширить ключевые фразы' }}
        />
      );
    }
    return (
      <EmptyState
        icon={BriefcaseIcon}
        title="Лидов пока нет"
        text="Профиль настроен — первая подборка придёт со следующим запуском радара. Можно уточнить фильтры, чтобы повысить релевантность."
        action={{ href: '/profile#fine-tuning', label: 'Уточнить профиль' }}
      />
    );
  }

  return (
    <>
      <div className={ipStyles.leadsListToolbar}>
        <div className={ipStyles.leadsListCount}>
          <strong>{leads.length}</strong> {pluralizeLeads(leads.length)}{workingSet ? ' в работе' : ' всего'}
        </div>
        <LeadsListLegend />
      </div>
      <div className={`${ipStyles.leadsList} ${ipStyles.signalCardList}`}>
        {leads.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            fitPreview={fitPreviewFor(lead)}
            hiringMode={hiringModeFor(lead)}
          />
        ))}
      </div>
    </>
  );
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ gate?: string; feedback?: string; page?: string; profile?: string; today?: string }>;
}) {
  const filters = await searchParams;

  // Validate and normalize filter params
  const confidenceGate = filters.gate && ['A', 'B', 'C', 'D'].includes(filters.gate)
    ? filters.gate
    : null;
  const feedbackStatus = filters.feedback && VALID_FEEDBACK_STATUSES.has(filters.feedback as never)
    ? filters.feedback
    : null;
  // "Сегодня в работе" — the agency's open pipeline (contacted/replied).
  // Supersedes feedbackStatus when both are set (the filter component clears
  // feedback when today is toggled on, but defend against manual URL edits).
  const workingSet = filters.today === '1';
  const effectiveFeedbackStatus = workingSet ? null : feedbackStatus;

  // Owner-scope every read: without a session there are no accessible profiles,
  // so the page renders empty rather than leaking another tenant's leads.
  const ownerId = await getOwnerIdFromSession();

  let profiles: ClientProfile[];
  try {
    profiles = ownerId ? await listClientProfiles(ownerId) : [];
  } catch {
    profiles = [];
  }

  const activeProfiles = profiles.filter((p) => p.isActive);

  // Optional profile switcher: narrow to a single practice when ?profile= is a valid active id
  const selectedProfileId =
    filters.profile && activeProfiles.some((p) => p.id === filters.profile)
      ? filters.profile
      : null;
  const selectedProfile = selectedProfileId
    ? activeProfiles.find((p) => p.id === selectedProfileId) ?? null
    : null;

  // Fetch leads for the selected profile, or all active profiles, in a single query (not N+1)
  const profileIds = selectedProfileId
    ? [selectedProfileId]
    : activeProfiles.map((p) => p.id);
  let allLeads: LeadItem[] = [];
  let totalLeads = 0;
  let pendingReview = 0;
  // leadsFetchError — surfaced as an ErrorState when the leads/review fetch
  // genuinely fails. A missing session is NOT an error (it's the legitimate
  // "no profiles → empty" path), so only a real fetch failure sets the flag.
  let leadsFetchError = false;

  try {
    if (!ownerId) throw new Error('no-session');
    const [result, reviewCount] = await Promise.all([
      getLeadsForAllProfiles({
        profileIds,
        ownerId,
        confidenceGate,
        feedbackStatus: effectiveFeedbackStatus,
        workingSet,
      }),
      getPendingReviewCount({ profileIds, ownerId }),
    ]);
    allLeads = result.leads;
    totalLeads = result.total;
    pendingReview = reviewCount;
  } catch (err) {
    // 'no-session' is a control-flow signal for the empty (no-profiles) path,
    // not a real failure — keep the calm empty state. Anything else is a genuine
    // fetch error → surface an ErrorState instead of a silent empty list that
    // would read as "radar found nothing".
    if (err instanceof Error && err.message === 'no-session') {
      allLeads = [];
      totalLeads = 0;
      pendingReview = 0;
    } else {
      leadsFetchError = true;
    }
  }

  // Compact per-lead fit preview: the single strongest "почему подходит этому агентству"
  // line, computed with the same deterministic builder the detail page uses. Keyed by the
  // profile that produced the lead so multi-profile views stay correct.
  const fitProfilesById = new Map(
    activeProfiles.map((p) => [
      p.id,
      {
        industries: p.industries,
        roles: p.roles,
        excludedIndustries: p.excludedIndustries,
        excludedLocations: p.excludedLocations,
        contactPolicy: p.contactPolicy,
        remoteFriendly: p.remoteFriendly,
        targetCity: p.targetCity,
        // Fold the agency's free-text ICP fields into the profile so the fit
        // explanation can name the concrete specialization / keyword that
        // matched, instead of a generic «совпадает с ICP» label. This is the
        // single most useful line for a narrow/specialized agency.
        specialization: p.specialization,
        includeKeywords: p.includeKeywords,
      },
    ]),
  );

  // Resolved hiring mode per profile — drives mode-aware urgency framing on
  // each lead card. resolveHiringMode turns 'auto' into a concrete mode from
  // the agency's declared roles, so the card never has to handle 'auto'.
  const hiringModeByProfileId = new Map(
    activeProfiles.map((p) => [p.id, resolveHiringMode(p)]),
  );

  const fitPreviewFor = (lead: LeadItem): { icon: string; text: string } | null => {
    const profile = fitProfilesById.get(lead.clientProfileId);
    if (!profile) return null;
    const fit = buildFitExplanation(
      {
        // careerPageUrl / orgDomain live only on LeadDetail, not the list LeadItem.
        // FitLeadInput marks them optional; the builder degrades gracefully — the
        // reachability line just isn't surfaced in the compact list preview.
        structuredReasons: lead.structuredReasons,
        locationNames: lead.locationNames,
        lawfulContactPath: lead.lawfulContactPath,
        sourceFamilies: lead.sourceFamilies,
        // Pass the visible free-text fields so the ICP re-derivation can name
        // the matched specialization term from evidence the recruiter can see.
        orgName: lead.orgName,
        evidenceTitles: lead.evidenceTitles,
      },
      profile,
    );
    const first = fit.lines[0];
    if (!first) return null;
    return { icon: FIT_DIMENSION_ICON[first.dimension], text: first.text };
  };

  const hasFilters =
    confidenceGate !== null || effectiveFeedbackStatus !== null || selectedProfileId !== null || workingSet;

  // Narrow-ICP detection for the honest empty state: a specialized agency
  // (specialization text or include keywords set) sees a different message
  // when there are 0 leads — "thin supply for your niche" rather than the
  // generic "radar hasn't run yet". When a single practice is selected, judge
  // by that practice; in the all-practices view, judge by whether ANY active
  // profile is narrow (a narrow shop with one broad practice still benefits).
  const narrowProfile = selectedProfile
    ? Boolean(
        (selectedProfile.specialization && selectedProfile.specialization.trim() !== '') ||
        selectedProfile.includeKeywords.length > 0,
      )
    : activeProfiles.some(
        (p) =>
          (p.specialization && p.specialization.trim() !== '') ||
          p.includeKeywords.length > 0,
      );

  // Carry the active filters into the CSV export link so the export matches the view.
  const exportParams = new URLSearchParams();
  if (confidenceGate) exportParams.set('gate', confidenceGate);
  if (effectiveFeedbackStatus) exportParams.set('feedback', effectiveFeedbackStatus);
  if (selectedProfileId) exportParams.set('profile', selectedProfileId);
  if (workingSet) exportParams.set('today', '1');
  const exportQuery = exportParams.toString();
  const exportHref = exportQuery ? `/api/leads/export?${exportQuery}` : '/api/leads/export';

  return (
    <InternalPageFrame navItems={LEADS_NAV} footer={<SiteFooter />}>
      <InternalPageHeader
        title="Лиды"
        subtitle={
          <>
            {workingSet
              ? 'Сегодня в работе — ваши открытые лиды'
              : selectedProfile
                ? `Практика: ${selectedProfile.agencyName}`
                : 'Компании, которым стоит написать сегодня'}
            {hasFilters && <span className={ipStyles.filterActive}>(фильтр активен)</span>}
          </>
        }
        nav={
          allLeads.length > 0 ? (
            <a
              href={exportHref}
              className={ipStyles.leadOpenBtn}
              download
              aria-label="Экспортировать лиды в CSV"
            >
              Экспорт CSV
            </a>
          ) : null
        }
      />

      {/* Triage-relevant metrics. In the "Сегодня в работе" view the lead
          metric is the open-pipeline count (contacted/replied) — the number a
          recruiter actually acts on — instead of the total scored pool. */}
      <MetricGrid>
        {workingSet ? (
          <MetricCard label="В работе" value={totalLeads} tone="info" />
        ) : (
          <MetricCard label="Всего лидов" value={totalLeads} />
        )}
        <MetricCard
          label="Готовы к контакту (A/B)"
          value={allLeads.filter((l) => l.confidenceGate === 'A' || l.confidenceGate === 'B').length}
          tone="success"
        />
        <MetricCard
          label="На проверке"
          value={
            <Link href="/review" className={ipStyles.leadLink}>
              {pendingReview}
            </Link>
          }
          tone={pendingReview > 0 ? 'info' : 'neutral'}
        />
      </MetricGrid>

      <TableCard>
        <Suspense fallback={<LoadingState variant="inline" />}>
          <LeadsFilters
            profiles={activeProfiles.map((p) => ({ id: p.id, name: p.agencyName }))}
          />
        </Suspense>
        {leadsFetchError ? (
          <ErrorState
            title="Не удалось загрузить лиды"
            description="Радар подбирает компании по вашему профилю. Повторите через минуту — если лиды не появятся, проверьте настройки профиля или напишите поддержку."
            action={{ href: '/profile', label: 'Проверить профиль' }}
          />
        ) : (
          <Suspense fallback={<LoadingState variant="skeleton" />}>
            <LeadsList
              leads={allLeads}
              fitPreviewFor={fitPreviewFor}
              hiringModeFor={(lead) => hiringModeByProfileId.get(lead.clientProfileId) ?? 'specialist'}
              hasActiveProfile={activeProfiles.length > 0}
              narrowProfile={narrowProfile}
              workingSet={workingSet}
            />
          </Suspense>
        )}
      </TableCard>
    </InternalPageFrame>
  );
}
