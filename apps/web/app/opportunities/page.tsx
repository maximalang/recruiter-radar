import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  isOpportunityEngineV1EnabledForContext,
  isOpportunityOutcomesUiEnabledForContext,
  isOpportunityWorkflowV1EnabledForContext,
} from '@/lib/opportunities/config'
import { getOutcomeFunnelSummary } from '@/lib/opportunities/outcome-repository'
import {
  getOpportunityOutcomeOperationalSummary,
  listOpportunities,
  type OpportunityView,
} from '@/lib/opportunities/repository'
import type { OpportunityStatus } from '@/lib/opportunities/opportunity-scoring'
import {
  listOpportunityWorkflowAssignees,
  type OpportunityWorkflowAssignee,
} from '@/lib/opportunities/opportunity-workflow-repository'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
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
import { OpportunityFunnel } from './opportunity-funnel'
import { OpportunityResearchMode } from './opportunity-research-mode'
import { OpportunityTodayLanes } from './opportunity-today-lanes'
import { buildOpportunityNavigation } from './navigation'
import styles from './opportunities.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Сегодня — Recruiter Radar',
  description: 'Действия по подтверждённым коммерческим возможностям на сегодня.',
}

const NAVIGATION = buildOpportunityNavigation()

export default async function OpportunitiesPage(props: {
  searchParams: Promise<{
    status?: string
    view?: string
    gate?: string
    q?: string
    preview?: string
    demo?: string
  }>
}) {
  const authorization = await getOpportunityAuthorizationContext(
    'opportunities:read',
  )
  const featureContext = authorization ?? {
    dataOwnerId: null,
    workspaceId: null,
  }
  if (!isOpportunityEngineV1EnabledForContext(featureContext)) notFound()

  if (!authorization) {
    return (
      <InternalPageFrame navItems={NAVIGATION} footer={<SiteFooter />}>
        <InternalPageHeader
          title="Сегодня"
          subtitle="Подтверждённые возможности и следующие действия вашего агентства."
        />
        <ContentCard variant="hero">
          <EmptyState
            title="Нет доступа к возможностям"
            text="Войдите в аккаунт с доступом к рабочему пространству или запросите подходящую роль."
            action={{ href: '/login', label: 'Войти' }}
          />
        </ContentCard>
      </InternalPageFrame>
    )
  }
  const access = getOpportunityDataAccessContext(authorization)
  if (!access) notFound()

  const params = await props.searchParams
  const query = normalizeSearchQuery(params.q)
  const confidenceGate = params.gate === 'A' || params.gate === 'B' ||
    params.gate === 'C' || params.gate === 'D'
    ? params.gate
    : ''
  const outcomesUiEnabled =
    isOpportunityOutcomesUiEnabledForContext(authorization) &&
    params.preview !== '1' && params.demo !== '1'
  const workflowEnabled = outcomesUiEnabled &&
    isOpportunityWorkflowV1EnabledForContext(authorization)
  const trackingCycleId = outcomesUiEnabled
    ? `${workflowEnabled ? 'today' : 'morning-brief'}:${new Date().toISOString().slice(0, 10)}`
    : null
  const funnelTo = new Date()
  const funnelFrom = new Date(funnelTo.getTime() - 30 * 24 * 60 * 60 * 1000)
  const statuses = parseStatusFilter(params.status)
  const view = workflowEnabled
    ? parseView(params.view, 'today')
    : outcomesUiEnabled
      ? parseView(params.view, 'morning')
      : 'morning'
  let result: Awaited<ReturnType<typeof listOpportunities>> | null = null
  let workflowAssignees: OpportunityWorkflowAssignee[] = []
  let operationalSummary: Awaited<
    ReturnType<typeof getOpportunityOutcomeOperationalSummary>
  > | null = null
  try {
    [result, operationalSummary, workflowAssignees] = await Promise.all([
      listOpportunities({
        ownerId: access.ownerId,
        workspaceId: access.workspaceId,
        morningBriefOnly: view === 'morning',
        view,
        statuses,
        confidenceGate: confidenceGate || null,
        query: query || null,
        pageSize: 50,
      }),
      outcomesUiEnabled
        ? getOpportunityOutcomeOperationalSummary(
            access.ownerId,
            undefined,
            access.workspaceId,
          )
        : Promise.resolve(null),
      workflowEnabled && access.workspaceId
        ? listOpportunityWorkflowAssignees(access.workspaceId)
        : Promise.resolve([]),
    ])
  } catch {
    result = null
  }

  if (!result) {
    return (
      <InternalPageFrame navItems={NAVIGATION} footer={<SiteFooter />}>
        <InternalPageHeader title="Сегодня" />
        <ErrorState
          title="Brief временно не загрузился"
          description="Данные других аккаунтов не показываются. Обновите страницу через минуту."
          action={{ href: '/opportunities', label: 'Обновить' }}
        />
      </InternalPageFrame>
    )
  }

  const funnel = outcomesUiEnabled
    ? await getOutcomeFunnelSummary({
        ownerId: access.ownerId,
        workspaceId: access.workspaceId,
        from: funnelFrom.toISOString(),
        to: funnelTo.toISOString(),
      }).catch(() => null)
    : null

  return (
    <InternalPageFrame navItems={NAVIGATION} footer={<SiteFooter />}>
      <InternalPageHeader
        title="Сегодня"
        subtitle="Сначала действия: новые возможности, контакт, follow-up и активный pipeline."
        nav={(
          <Link href="/leads" className={styles.headerLink}>
            Все лиды
          </Link>
        )}
      />

      <div className={styles.pageStack}>
        {workflowEnabled ? (
          <OpportunityTodayLanes
            summary={operationalSummary}
            activeView={view}
          />
        ) : outcomesUiEnabled ? (
          <MetricGrid>
            <MetricCard
              label="Новые возможности"
              value={operationalSummary?.newCount ?? 0}
              tone="info"
            />
            <MetricCard
              label="В работе"
              value={operationalSummary?.acceptedCount ?? 0}
              tone="neutral"
            />
            <MetricCard
              label="Коммерческий pipeline"
              value={operationalSummary?.pipelineCount ?? 0}
              tone="success"
            />
            <MetricCard
              label="Отложены"
              value={operationalSummary?.snoozedCount ?? 0}
              tone="neutral"
            />
          </MetricGrid>
        ) : null}

        <OpportunityResearchMode
          view={view}
          query={query}
          confidenceGate={confidenceGate}
          workflowEnabled={workflowEnabled}
        >
          {funnel ? <OpportunityFunnel summary={funnel} /> : null}
        </OpportunityResearchMode>

        {result.opportunities.length > 0 ? (
          <div className={styles.cardList}>
            {result.opportunities.map((opportunity) => (
              <OpportunityCard
                key={opportunity.id}
                opportunity={opportunity}
                outcomesUiEnabled={outcomesUiEnabled}
                trackingCycleId={trackingCycleId}
                workflowEnabled={workflowEnabled}
                workflowAssignees={workflowAssignees}
                actorUserId={access.actorUserId}
                actorRole={access.actorRoleSnapshot}
              />
            ))}
          </div>
        ) : (
          <ContentCard variant="hero">
            {isNarrowedResult(view, workflowEnabled, query, confidenceGate) ? (
              <EmptyState
                title="В выбранной очереди пока нет возможностей."
                text="Выберите другую очередь или сбросьте условия Режима исследования."
                action={{ href: '/opportunities', label: 'Вернуться к Сегодня' }}
              />
            ) : (
              <EmptyState
                title="Радар пока не обнаружил достаточно подтверждённых коммерческих возможностей под ваш профиль."
                text="Мы не показываем компании только потому, что у них есть одна вакансия."
                action={{ href: '/leads', label: 'Открыть все лиды' }}
              />
            )}
          </ContentCard>
        )}
      </div>
    </InternalPageFrame>
  )
}

function parseStatusFilter(value: string | undefined): OpportunityStatus[] {
  if (value === 'accepted,contacted') return ['accepted', 'contacted']
  if (value === 'snoozed') return ['snoozed']
  return []
}

function parseView(
  value: string | undefined,
  fallback: OpportunityView,
): OpportunityView {
  return value === 'today' || value === 'morning' || value === 'accepted' ||
    value === 'follow_up' || value === 'overdue' || value === 'pipeline' ||
    value === 'snoozed' || value === 'completed' || value === 'all'
    ? value
    : fallback
}

function normalizeSearchQuery(value: string | undefined): string {
  return value?.trim().slice(0, 80) ?? ''
}

function isNarrowedResult(
  view: OpportunityView,
  workflowEnabled: boolean,
  query: string,
  confidenceGate: string,
): boolean {
  const defaultView: OpportunityView = workflowEnabled ? 'today' : 'morning'
  return view !== defaultView || Boolean(query) || Boolean(confidenceGate)
}
