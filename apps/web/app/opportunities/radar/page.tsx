import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { isEvidenceRadarV1EnabledForContext } from '@/lib/intelligence/evidence-radar-config'
import { listEvidenceRadarLeads } from '@/lib/intelligence/evidence-radar-repository'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import { isOpportunityEngineV1EnabledForContext } from '@/lib/opportunities/config'
import {
  EmptyState,
  ErrorState,
  InternalPageFrame,
  InternalPageHeader,
} from '../../ui/internal-page'
import { EvidenceRadarMap } from '../evidence-radar-map'
import { buildOpportunityRadarNavigation } from '../navigation'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Радар — Recruiter Radar',
  description: 'Свежие подтверждённые hiring signals в пространстве свежести и уровня подтверждения.',
}

const NAVIGATION = buildOpportunityRadarNavigation('radar')

export default async function EvidenceRadarPage() {
  const authorization = await getOpportunityAuthorizationContext('opportunities:read')
  const featureContext = authorization ?? { dataOwnerId: null, workspaceId: null }
  if (!isOpportunityEngineV1EnabledForContext(featureContext)) notFound()

  if (!authorization) {
    return (
      <InternalPageFrame navItems={NAVIGATION}>
        <InternalPageHeader
          title="Радар"
          subtitle="Свежесть сигнала и уровень подтверждения в одном пространстве."
        />
        <EmptyState
          title="Нет доступа к Радару"
          text="Войдите в рабочее пространство с доступом к подтверждённым сигналам."
          action={{ href: '/login', label: 'Войти' }}
        />
      </InternalPageFrame>
    )
  }

  if (!isEvidenceRadarV1EnabledForContext(authorization)) notFound()
  const access = getOpportunityDataAccessContext(authorization)
  if (!access?.workspaceId) notFound()

  const leads = await listEvidenceRadarLeads({
    workspaceId: access.workspaceId,
    limit: 100,
  }).catch(() => null)

  return (
    <InternalPageFrame navItems={NAVIGATION}>
      <InternalPageHeader
        title="Радар"
        subtitle="По горизонтали — свежесть подтверждения, по вертикали — его сила. География остаётся контекстом и не определяет положение компании."
      />
      {leads ? (
        <EvidenceRadarMap leads={leads} />
      ) : (
        <ErrorState
          title="Радар временно не загрузился"
          description="Данные других рабочих пространств не показываются. Последние неподтверждённые связи не подставляются вместо результата."
          action={{ href: '/opportunities/radar', label: 'Обновить' }}
        />
      )}
    </InternalPageFrame>
  )
}
