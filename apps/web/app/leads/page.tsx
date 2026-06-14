import { Suspense } from 'react';
import Link from 'next/link';
import { getLeadsForAllProfiles, getPendingReviewCount, type LeadItem, VALID_FEEDBACK_STATUSES } from '@/lib/leads-data';
import { listClientProfiles, type ClientProfile } from '@/lib/clientProfiles';
import LeadsFilters from './leads-filters';
import {
  InternalPageFrame,
  InternalPageHeader,
  MetricGrid,
  MetricCard,
  GateBadgeInline,
  FeedbackBadge,
  ScoreBar,
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
];

function LeadRow({ lead }: { lead: LeadItem }) {
  return (
    <tr className={ipStyles.dataTableTr}>
      <td className={ipStyles.dataTableTd}>
        <Link href={`/leads/${lead.id}`} className={ipStyles.leadLink}>
          <div className={ipStyles.leadOrgName}>{lead.orgName}</div>
        </Link>
        {lead.locationNames.length > 0 && (
          <div className={ipStyles.leadLocation}>📍 {lead.locationNames.slice(0, 2).join(', ')}</div>
        )}
      </td>
      <td className={ipStyles.dataTableTd} style={{ minWidth: '140px' }}>
        <ScoreBar score={lead.score} />
      </td>
      <td className={ipStyles.dataTableTd}>
        <GateBadgeInline gate={lead.confidenceGate} />
      </td>
      <td className={ipStyles.dataTableTd}>
        <FeedbackBadge status={lead.feedbackStatus} />
      </td>
      <td className={ipStyles.dataTableTd}>
        <div className={ipStyles.leadMeta}>
          {lead.vacanciesCount > 0 && <span>💼 {lead.vacanciesCount} вакансий</span>}
          {lead.evidenceTitles.length > 0 && (
            <div className={ipStyles.leadMetaDetail}>
              {lead.evidenceTitles.slice(0, 2).join(' · ')}
            </div>
          )}
        </div>
      </td>
      <td className={ipStyles.dataTableTd}>
        <span className={ipStyles.leadDate}>
          {new Date(lead.createdAt).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short',
          })}
        </span>
      </td>
    </tr>
  );
}

function LeadsTable({ leads }: { leads: LeadItem[] }) {
  if (leads.length === 0) {
    return (
      <EmptyState
        icon="📭"
        title="Лидов пока нет"
        text="Когда дайджест сгенерирует лиды, они появятся здесь."
      />
    );
  }

  return (
    <div className={ipStyles.dataTableWrap}>
      <table className={ipStyles.dataTable}>
        <thead>
          <tr className={ipStyles.dataTableHead}>
            <th className={ipStyles.dataTableTh} scope="col">Компания</th>
            <th className={ipStyles.dataTableTh} scope="col">Скоринг</th>
            <th className={ipStyles.dataTableTh} scope="col">Gate</th>
            <th className={ipStyles.dataTableTh} scope="col">Статус</th>
            <th className={ipStyles.dataTableTh} scope="col">Доказательства</th>
            <th className={ipStyles.dataTableTh} scope="col">Дата</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <LeadRow key={lead.id} lead={lead} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ gate?: string; feedback?: string; page?: string }>;
}) {
  const filters = await searchParams;

  // Validate and normalize filter params
  const confidenceGate = filters.gate && ['A', 'B', 'C', 'D'].includes(filters.gate)
    ? filters.gate
    : null;
  const feedbackStatus = filters.feedback && VALID_FEEDBACK_STATUSES.has(filters.feedback as never)
    ? filters.feedback
    : null;

  let profiles: ClientProfile[];
  try {
    profiles = await listClientProfiles();
  } catch {
    profiles = [];
  }

  const activeProfiles = profiles.filter((p) => p.isActive);

  // Fetch leads for all active profiles in a single query (not N+1)
  const profileIds = activeProfiles.map((p) => p.id);
  let allLeads: LeadItem[] = [];
  let totalLeads = 0;
  let pendingReview = 0;

  try {
    const [result, reviewCount] = await Promise.all([
      getLeadsForAllProfiles({
        profileIds,
        confidenceGate,
        feedbackStatus,
      }),
      getPendingReviewCount({ profileIds }),
    ]);
    allLeads = result.leads;
    totalLeads = result.total;
    pendingReview = reviewCount;
  } catch {
    allLeads = [];
    totalLeads = 0;
    pendingReview = 0;
  }

  const hasFilters = confidenceGate !== null || feedbackStatus !== null;

  return (
    <InternalPageFrame navItems={LEADS_NAV}>
      <InternalPageHeader
        title="🎯 Лиды"
        subtitle={
          <>
            Компании, которым стоит написать сегодня
            {hasFilters && <span className={ipStyles.filterActive}>(фильтр активен)</span>}
          </>
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
        <MetricCard label="Профилей" value={activeProfiles.length} />
      </MetricGrid>

      <TableCard>
        <Suspense fallback={<div className={ipStyles.loadingState}>Загрузка...</div>}>
          <LeadsFilters />
        </Suspense>
        <Suspense fallback={<div className={ipStyles.loadingState}>Загрузка...</div>}>
          <LeadsTable leads={allLeads} />
        </Suspense>
      </TableCard>
    </InternalPageFrame>
  );
}
