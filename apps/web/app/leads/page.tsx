import { Suspense } from 'react';
import Link from 'next/link';
import { getLeadsForAllProfiles, type LeadItem, VALID_FEEDBACK_STATUSES } from '@/lib/leads-data';
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
import { internalPageClasses as s } from '../ui/internal-page';

export const dynamic = 'force-dynamic';

const LEADS_NAV: NavItem[] = [
  { href: '/dashboard', label: '📊 Дашборд' },
  { href: '/leads', label: '🎯 Лиды', active: true },
];

function LeadRow({ lead }: { lead: LeadItem }) {
  return (
    <tr className={s.dataTableTr}>
      <td className={s.dataTableTd}>
        <Link href={`/leads/${lead.id}`} className={s.leadLink}>
          <div className={s.leadOrgName}>{lead.orgName}</div>
        </Link>
        {lead.locationNames.length > 0 && (
          <div className={s.leadLocation}>📍 {lead.locationNames.slice(0, 2).join(', ')}</div>
        )}
      </td>
      <td className={s.dataTableTd} style={{ minWidth: '140px' }}>
        <ScoreBar score={lead.score} />
      </td>
      <td className={s.dataTableTd}>
        <GateBadgeInline gate={lead.confidenceGate} />
      </td>
      <td className={s.dataTableTd}>
        <FeedbackBadge status={lead.feedbackStatus} />
      </td>
      <td className={s.dataTableTd}>
        <div className={s.leadMeta}>
          {lead.vacanciesCount > 0 && <span>💼 {lead.vacanciesCount} вакансий</span>}
          {lead.evidenceTitles.length > 0 && (
            <div className={s.leadMetaDetail}>
              {lead.evidenceTitles.slice(0, 2).join(' · ')}
            </div>
          )}
        </div>
      </td>
      <td className={s.dataTableTd}>
        <span className={s.leadDate}>
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
    <div className={s.dataTableWrap}>
      <table className={s.dataTable}>
        <thead>
          <tr className={s.dataTableHead}>
            <th className={s.dataTableTh} scope="col">Компания</th>
            <th className={s.dataTableTh} scope="col">Скоринг</th>
            <th className={s.dataTableTh} scope="col">Gate</th>
            <th className={s.dataTableTh} scope="col">Статус</th>
            <th className={s.dataTableTh} scope="col">Доказательства</th>
            <th className={s.dataTableTh} scope="col">Дата</th>
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

  try {
    const result = await getLeadsForAllProfiles({
      profileIds,
      confidenceGate,
      feedbackStatus,
    });
    allLeads = result.leads;
    totalLeads = result.total;
  } catch {
    allLeads = [];
    totalLeads = 0;
  }

  const hasFilters = confidenceGate !== null || feedbackStatus !== null;

  return (
    <InternalPageFrame navItems={LEADS_NAV}>
      <InternalPageHeader
        title="🎯 Лиды"
        subtitle={
          <>
            Компании, которым стоит написать сегодня
            {hasFilters && <span className={s.filterActive}>(фильтр активен)</span>}
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
        <MetricCard label="Профилей" value={activeProfiles.length} />
      </MetricGrid>

      <TableCard>
        <Suspense fallback={<div className={s.loadingState}>Загрузка...</div>}>
          <LeadsFilters />
        </Suspense>
        <Suspense fallback={<div className={s.loadingState}>Загрузка...</div>}>
          <LeadsTable leads={allLeads} />
        </Suspense>
      </TableCard>
    </InternalPageFrame>
  );
}
