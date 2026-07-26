import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { isOpportunityEngineV1Enabled } from '@/lib/opportunities/config'
import { listOpportunities } from '@/lib/opportunities/repository'
import type { OpportunityStatus } from '@/lib/opportunities/opportunity-scoring'
import { getOwnerIdFromSession } from '@/lib/session'
import {
  ContentCard,
  EmptyState,
  ErrorState,
  InternalPageFrame,
  InternalPageHeader,
  MetricCard,
  MetricGrid,
} from '../ui/internal-page'
import { SiteFooter } from '../ui/site-footer'
import { OpportunityCard } from './opportunity-card'
import { buildOpportunityNavigation } from './navigation'
import styles from './opportunities.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Morning Brief — Recruiter Radar',
  description: 'Приоритетные возможности на основе подтверждённых эпизодов найма.',
}

const NAVIGATION = buildOpportunityNavigation()

export default async function OpportunitiesPage(props: {
  searchParams: Promise<{ status?: string; gate?: string }>
}) {
  if (!isOpportunityEngineV1Enabled()) notFound()

  const ownerId = await getOwnerIdFromSession()
  if (!ownerId) {
    return (
      <InternalPageFrame navItems={NAVIGATION} footer={<SiteFooter />}>
        <InternalPageHeader
          title="Коммерческие возможности на сегодня"
          subtitle="Morning Brief из подтверждённых эпизодов найма."
        />
        <ContentCard variant="hero">
          <EmptyState
            title="Нужен вход в аккаунт"
            text="Войдите, чтобы увидеть только возможности вашего агентства."
            action={{ href: '/login', label: 'Войти в аккаунт' }}
          />
        </ContentCard>
      </InternalPageFrame>
    )
  }

  const params = await props.searchParams
  const statuses = parseStatusFilter(params.status)
  let result: Awaited<ReturnType<typeof listOpportunities>> | null = null
  try {
    result = await listOpportunities({
      ownerId,
      morningBriefOnly: true,
      statuses,
      confidenceGate: params.gate === 'A' || params.gate === 'B' ||
        params.gate === 'C' || params.gate === 'D'
        ? params.gate
        : null,
      pageSize: 50,
    })
  } catch {
    result = null
  }

  if (!result) {
    return (
      <InternalPageFrame navItems={NAVIGATION} footer={<SiteFooter />}>
        <InternalPageHeader title="Коммерческие возможности на сегодня" />
        <ErrorState
          title="Brief временно не загрузился"
          description="Данные других аккаунтов не показываются. Обновите страницу через минуту."
          action={{ href: '/opportunities', label: 'Обновить' }}
        />
      </InternalPageFrame>
    )
  }

  const newCount = result.opportunities.filter(
    (opportunity) => opportunity.status === 'new',
  ).length
  const attentionCount = result.opportunities.filter(
    (opportunity) => opportunity.status === 'review',
  ).length
  const highConfidenceCount = result.opportunities.filter(
    (opportunity) => opportunity.confidenceGate === 'A',
  ).length
  const expiringSoonCount = result.opportunities.filter(
    (opportunity) => isExpiringSoon(opportunity.validUntil),
  ).length

  return (
    <InternalPageFrame navItems={NAVIGATION} footer={<SiteFooter />}>
      <InternalPageHeader
        title="Коммерческие возможности на сегодня"
        subtitle="Morning Brief: свежий эпизод найма совпал с профилем агентства и прошёл текущие evidence gates."
        nav={(
          <Link href="/leads" className={styles.headerLink}>
            Все лиды
          </Link>
        )}
      />

      <div className={styles.pageStack}>
        <MetricGrid>
          <MetricCard
            label="Новые opportunities"
            value={newCount}
            tone="info"
          />
          <MetricCard
            label="Требуют внимания"
            value={attentionCount}
            tone="neutral"
          />
          <MetricCard
            label="Высокая достоверность"
            value={highConfidenceCount}
            tone="success"
          />
          <MetricCard
            label="Истекают скоро"
            value={expiringSoonCount}
            tone="neutral"
          />
        </MetricGrid>

        <nav className={styles.filters} aria-label="Фильтры Morning Brief">
          <FilterLink href="/opportunities" active={!params.status}>
            Активные
          </FilterLink>
          <FilterLink
            href="/opportunities?status=accepted,contacted"
            active={params.status === 'accepted,contacted'}
          >
            В работе
          </FilterLink>
          <FilterLink
            href="/opportunities?status=snoozed"
            active={params.status === 'snoozed'}
          >
            Отложенные
          </FilterLink>
        </nav>

        {result.opportunities.length > 0 ? (
          <div className={styles.cardList}>
            {result.opportunities.map((opportunity) => (
              <OpportunityCard key={opportunity.id} opportunity={opportunity} />
            ))}
          </div>
        ) : (
          <ContentCard variant="hero">
            <EmptyState
              title="Радар пока не обнаружил достаточно подтверждённых коммерческих возможностей под ваш профиль."
              text="Мы не показываем компании только потому, что у них есть одна вакансия."
              action={{ href: '/leads', label: 'Открыть все лиды' }}
            />
          </ContentCard>
        )}
      </div>
    </InternalPageFrame>
  )
}

function isExpiringSoon(value: string | null): boolean {
  if (!value) return false
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return false
  const remaining = timestamp - Date.now()
  return remaining >= 0 && remaining <= 3 * 24 * 60 * 60 * 1000
}

function FilterLink(props: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={props.href}
      className={styles.filterLink}
      data-active={props.active ? 'true' : undefined}
      aria-current={props.active ? 'page' : undefined}
    >
      {props.children}
    </Link>
  )
}

function parseStatusFilter(value: string | undefined): OpportunityStatus[] {
  if (value === 'accepted,contacted') return ['accepted', 'contacted']
  if (value === 'snoozed') return ['snoozed']
  return ['new', 'review', 'accepted']
}
