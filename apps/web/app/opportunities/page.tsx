import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  isOpportunityCommercialSignalUiEnabledForContext,
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
import {
  isCommercialSignalAuthoritativeForWorkspace,
} from '@/lib/opportunities/commercial-signal-rollout'
import {
  filterActionableCommercialSignalToday,
} from '@/lib/opportunities/commercial-signal-today'
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
  InternalPageFrame,
  InternalPageHeader,
} from '../ui/internal-page'
import { ProductErrorState } from '../ui/product-error-state'
import { StaticEmptyState } from '../ui/static-empty-state'
import { SituationRow } from './situation-row'
import { OpportunityFunnel } from './opportunity-funnel'
import { OpportunityResearchMode } from './opportunity-research-mode'
import { OpportunityTodayLanes } from './opportunity-today-lanes'
import { buildOpportunityNavigation } from './navigation'
import styles from './opportunities.module.css'
import pageStyles from './situations-page.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Ситуации — Recruiter Radar',
  description: 'Подтверждённые коммерческие эпизоды, их развитие, доказательства и следующий ход.',
}

const NAVIGATION = buildOpportunityNavigation()

function StateLink({ href, label }: { href: string; label: string }) {
  return <Link href={href}>{label}</Link>
}

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
      <InternalPageFrame navItems={NAVIGATION}>
        <InternalPageHeader
          title="Ситуации"
          subtitle="Изменяющиеся hiring-эпизоды и подтверждения, которые создают окно для контакта."
        />
        <StaticEmptyState
          title="Нет доступа к ситуациям"
          description="Войдите в аккаунт с доступом к рабочему пространству или запросите подходящую роль."
          action={<StateLink href="/login" label="Войти" />}
        />
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
  const commercialSignalUiEnabled =
    isOpportunityCommercialSignalUiEnabledForContext(authorization)
  const commercialSignalAuthoritative =
    isCommercialSignalAuthoritativeForWorkspace(access.workspaceId)
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
  const researchModeActive = Boolean(
    query || confidenceGate || view === 'completed' || view === 'all',
  )
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
        commercialSignalOnly:
          commercialSignalAuthoritative && !researchModeActive,
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
      <InternalPageFrame navItems={NAVIGATION}>
        <InternalPageHeader title="Ситуации" />
        <ProductErrorState
          title="Ситуации временно не загрузились"
          description="Данные других аккаунтов не показываются. Обновите страницу через минуту."
        >
          <StateLink href="/opportunities" label="Обновить" />
        </ProductErrorState>
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
  const visibleOpportunities = commercialSignalAuthoritative && !researchModeActive
    ? filterActionableCommercialSignalToday(result.opportunities)
    : result.opportunities

  return (
    <InternalPageFrame navItems={NAVIGATION}>
      <InternalPageHeader
        title="Ситуации"
        subtitle="Коммерческие эпизоды: что изменилось, чем подтверждено и какой следующий ход имеет смысл."
        nav={(
          <Link href="/leads" className={styles.headerLink}>
            Компании
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
          <div className={pageStyles.summaryLedger} aria-label="Рабочий контур ситуаций">
            <div><span>Новые</span><strong>{operationalSummary?.newCount ?? 0}</strong></div>
            <div><span>В работе</span><strong>{operationalSummary?.acceptedCount ?? 0}</strong></div>
            <div><span>Активная работа</span><strong>{operationalSummary?.pipelineCount ?? 0}</strong></div>
            <div><span>Отложены</span><strong>{operationalSummary?.snoozedCount ?? 0}</strong></div>
          </div>
        ) : null}

        <OpportunityResearchMode
          view={view}
          query={query}
          confidenceGate={confidenceGate}
          workflowEnabled={workflowEnabled}
        >
          {funnel ? <OpportunityFunnel summary={funnel} /> : null}
        </OpportunityResearchMode>

        {visibleOpportunities.length > 0 ? (
          <div className={styles.cardList}>
            {visibleOpportunities.map((opportunity) => (
              <SituationRow
                key={opportunity.id}
                opportunity={opportunity}
                outcomesUiEnabled={outcomesUiEnabled}
                trackingCycleId={trackingCycleId}
                workflowEnabled={workflowEnabled}
                workflowAssignees={workflowAssignees}
                actorUserId={access.actorUserId}
                actorRole={access.actorRoleSnapshot}
                commercialSignalUiEnabled={commercialSignalUiEnabled}
              />
            ))}
          </div>
        ) : isNarrowedResult(view, workflowEnabled, query, confidenceGate) ? (
          <StaticEmptyState
            title="В выбранном срезе пока нет ситуаций"
            description="Выберите другой рабочий контур или сбросьте условия режима исследования."
            action={<StateLink href="/opportunities" label="Показать активные ситуации" />}
          />
        ) : (
          <StaticEmptyState
            title="Подтверждённых ситуаций пока нет"
            description="Новая ситуация появится, когда сигналы сложатся в достаточно подтверждённое коммерческое окно."
            action={<StateLink href="/leads" label="Открыть компании" />}
          />
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
  if (query || confidenceGate) return true
  if (!workflowEnabled) return view !== 'morning'
  return view !== 'today'
}
