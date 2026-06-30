import { Suspense } from 'react';
import Link from 'next/link';
import { getLeadsForAllProfiles, getPendingReviewCount, type LeadItem, VALID_FEEDBACK_STATUSES } from '@/lib/leads-data';
import { listClientProfiles, type ClientProfile } from '@/lib/clientProfiles';
import { getOwnerIdFromSession } from '@/lib/session';
import { buildFitExplanation, FIT_DIMENSION_ICON } from '@/lib/leads/fit-explanation';
import LeadsFilters from './leads-filters';
import {
  InternalPageFrame,
  InternalPageHeader,
  MetricGrid,
  MetricCard,
  GateBadgeInline,
  FeedbackBadge,
  ScoreBar,
  getScoreTone,
  TableCard,
  EmptyState,
  type NavItem,
} from '../ui/internal-page';
import { internalPageClasses as ipStyles } from '../ui/internal-page';

export const dynamic = 'force-dynamic';

const LEADS_NAV: NavItem[] = [
  { href: '/dashboard', label: '📊 Дашборд' },
  { href: '/leads', label: '🎯 Лиды', active: true },
  { href: '/review', label: '🔍 Ревью' },
  { href: '/settings/profile', label: '⚙️ Профиль' },
];

function LeadCard({
  lead,
  fitPreview,
}: {
  lead: LeadItem;
  fitPreview: { icon: string; text: string } | null;
}) {
  const tone = getScoreTone(lead.score);
  const sources = lead.sourceFamilies.slice(0, 3);
  const risks = lead.negativeSignals.slice(0, 2);

  return (
    <article className={ipStyles.leadCard}>
      <div className={ipStyles.leadCardRail} data-tone={tone} aria-hidden="true" />
      <div className={ipStyles.leadCardBody}>
        <div className={ipStyles.leadCardHead}>
          <div className={ipStyles.leadCardHeadMain}>
            <Link href={`/leads/${lead.id}`} className={ipStyles.leadLink}>
              <span className={ipStyles.leadCardOrg}>{lead.orgName}</span>
            </Link>
            <div className={ipStyles.leadCardTags}>
              <GateBadgeInline gate={lead.confidenceGate} />
              <FeedbackBadge status={lead.feedbackStatus} />
              {lead.locationNames.length > 0 && (
                <span className={ipStyles.leadMetaChip}>
                  📍 {lead.locationNames.slice(0, 2).join(', ')}
                </span>
              )}
            </div>
          </div>
          <div className={ipStyles.leadCardHeadAside}>
            <div className={ipStyles.leadCardScore}>
              <ScoreBar score={lead.score} />
            </div>
            <span className={ipStyles.leadDate}>
              {new Date(lead.createdAt).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'short',
              })}
            </span>
          </div>
        </div>

        {fitPreview && (
          <div className={ipStyles.leadFieldRow} data-kind="fit">
            <span className={ipStyles.leadFieldLabel}>Почему подходит</span>
            <span className={ipStyles.leadFieldValue}>
              {fitPreview.icon} {fitPreview.text}
            </span>
          </div>
        )}
        {lead.whyNow && (
          <div className={ipStyles.leadFieldRow} data-kind="why">
            <span className={ipStyles.leadFieldLabel}>Почему сейчас</span>
            <span className={ipStyles.leadFieldValue}>{lead.whyNow}</span>
          </div>
        )}
        {lead.bestAngle && (
          <div className={ipStyles.leadFieldRow} data-kind="angle">
            <span className={ipStyles.leadFieldLabel}>Угол захода</span>
            <span className={ipStyles.leadFieldValue}>{lead.bestAngle}</span>
          </div>
        )}

        <div className={ipStyles.leadCardFooter}>
          {lead.lawfulContactPath && (
            <span className={ipStyles.leadContactChip}>
              🛡 {lead.lawfulContactPath}
            </span>
          )}
          {lead.vacanciesCount > 0 && (
            <span className={ipStyles.leadMetaChip}>💼 {lead.vacanciesCount} вакансий</span>
          )}
          {sources.map((src) => (
            <span key={src} className={ipStyles.leadMetaChip}>🔗 {src}</span>
          ))}
          {lead.evidenceTitles.length > 0 && (
            <span className={ipStyles.leadMetaChip}>
              📄 {lead.evidenceTitles.slice(0, 2).join(' · ')}
            </span>
          )}
        </div>

        {risks.length > 0 && (
          <div className={ipStyles.leadRiskRow}>
            {risks.map((risk) => (
              <span key={risk} className={ipStyles.leadRiskChip}>⚠ {risk}</span>
            ))}
          </div>
        )}
      </div>
      <div className={ipStyles.leadCardAction}>
        <Link href={`/leads/${lead.id}`} className={ipStyles.leadOpenBtn}>
          Открыть →
        </Link>
      </div>
    </article>
  );
}

function LeadsList({
  leads,
  fitPreviewFor,
  hasActiveProfile,
}: {
  leads: LeadItem[];
  fitPreviewFor: (lead: LeadItem) => { icon: string; text: string } | null;
  hasActiveProfile: boolean;
}) {
  if (leads.length === 0) {
    // Distinguish the two empty cases so the next step is obvious:
    // no profile yet → set one up; profile set → leads are on their way.
    return hasActiveProfile ? (
      <EmptyState
        icon="📭"
        title="Лидов пока нет"
        text="Профиль настроен — первая подборка придёт со следующим запуском радара. Можно уточнить фильтры, чтобы повысить релевантность."
        action={{ href: '/settings/profile', label: 'Уточнить профиль' }}
      />
    ) : (
      <EmptyState
        icon="🎯"
        title="Настройте профиль идеального клиента"
        text="Радар начнёт подбирать компании, как только вы опишете, кого ищете: роли, отрасли, регионы."
        action={{ href: '/settings/profile', label: 'Настроить профиль' }}
      />
    );
  }

  return (
    <>
      <div className={ipStyles.leadsListToolbar}>
        <div className={ipStyles.leadsListCount}>
          <strong>{leads.length}</strong> {pluralizeLeads(leads.length)} в работе
        </div>
        <div className={ipStyles.leadsListLegend} aria-hidden="true">
          <span className={ipStyles.leadsListLegendItem}>
            <span className={ipStyles.leadsListLegendDot} data-tone="success" /> высокий
          </span>
          <span className={ipStyles.leadsListLegendItem}>
            <span className={ipStyles.leadsListLegendDot} data-tone="warning" /> средний
          </span>
          <span className={ipStyles.leadsListLegendItem}>
            <span className={ipStyles.leadsListLegendDot} data-tone="danger" /> низкий
          </span>
        </div>
      </div>
      <div className={ipStyles.leadsList}>
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} fitPreview={fitPreviewFor(lead)} />
        ))}
      </div>
    </>
  );
}

function pluralizeLeads(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'лид';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'лида';
  return 'лидов';
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ gate?: string; feedback?: string; page?: string; profile?: string }>;
}) {
  const filters = await searchParams;

  // Validate and normalize filter params
  const confidenceGate = filters.gate && ['A', 'B', 'C', 'D'].includes(filters.gate)
    ? filters.gate
    : null;
  const feedbackStatus = filters.feedback && VALID_FEEDBACK_STATUSES.has(filters.feedback as never)
    ? filters.feedback
    : null;

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

  try {
    if (!ownerId) throw new Error('no-session');
    const [result, reviewCount] = await Promise.all([
      getLeadsForAllProfiles({
        profileIds,
        ownerId,
        confidenceGate,
        feedbackStatus,
      }),
      getPendingReviewCount({ profileIds, ownerId }),
    ]);
    allLeads = result.leads;
    totalLeads = result.total;
    pendingReview = reviewCount;
  } catch {
    allLeads = [];
    totalLeads = 0;
    pendingReview = 0;
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
      },
    ]),
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
      },
      profile,
    );
    const first = fit.lines[0];
    if (!first) return null;
    return { icon: FIT_DIMENSION_ICON[first.dimension], text: first.text };
  };

  const hasFilters = confidenceGate !== null || feedbackStatus !== null || selectedProfileId !== null;

  // Carry the active filters into the CSV export link so the export matches the view.
  const exportParams = new URLSearchParams();
  if (confidenceGate) exportParams.set('gate', confidenceGate);
  if (feedbackStatus) exportParams.set('feedback', feedbackStatus);
  if (selectedProfileId) exportParams.set('profile', selectedProfileId);
  const exportQuery = exportParams.toString();
  const exportHref = exportQuery ? `/api/leads/export?${exportQuery}` : '/api/leads/export';

  return (
    <InternalPageFrame navItems={LEADS_NAV}>
      <InternalPageHeader
        title="🎯 Лиды"
        subtitle={
          <>
            {selectedProfile
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
              ⬇ Экспорт CSV
            </a>
          ) : null
        }
      />

      <MetricGrid>
        <MetricCard label="Всего лидов" value={totalLeads} />
        <MetricCard
          label="Gate A/B"
          value={allLeads.filter((l) => l.confidenceGate === 'A' || l.confidenceGate === 'B').length}
          tone="success"
        />
        <MetricCard
          label="С обратной связью"
          value={allLeads.filter((l) => l.feedbackStatus && l.feedbackStatus !== 'none').length}
          tone="info"
        />
        <MetricCard
          label="Ожидают проверки"
          value={
            <Link href="/review" className={ipStyles.leadLink}>
              {pendingReview}
            </Link>
          }
          tone={pendingReview > 0 ? 'info' : 'neutral'}
        />
        <MetricCard
          label={selectedProfile ? 'Профиль' : 'Профилей'}
          value={selectedProfile ? '1' : activeProfiles.length}
        />
      </MetricGrid>

      <TableCard>
        <Suspense fallback={<div className={ipStyles.loadingState}>Загрузка...</div>}>
          <LeadsFilters
            profiles={activeProfiles.map((p) => ({ id: p.id, name: p.agencyName }))}
          />
        </Suspense>
        <Suspense fallback={<div className={ipStyles.loadingState}>Загрузка...</div>}>
          <LeadsList leads={allLeads} fitPreviewFor={fitPreviewFor} hasActiveProfile={activeProfiles.length > 0} />
        </Suspense>
      </TableCard>
    </InternalPageFrame>
  );
}
