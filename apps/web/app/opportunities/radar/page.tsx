import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { listEvidenceRadarRegionBoundaries } from '@/lib/intelligence/evidence-radar-boundaries'
import { isEvidenceRadarV1EnabledForContext } from '@/lib/intelligence/evidence-radar-config'
import { listEvidenceRadarLeads } from '@/lib/intelligence/evidence-radar-repository'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import { isOpportunityEngineV1EnabledForContext } from '@/lib/opportunities/config'
import {
  ContentCard,
  EmptyState,
  ErrorState,
  InternalPageFrame,
  InternalPageHeader,
} from '../../ui/internal-page'
import { EvidenceRadarMap } from '../evidence-radar-map'
import { buildOpportunityRadarNavigation } from '../navigation'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Карта спроса — Recruiter Radar',
  description: 'Региональная карта подтверждённых кадровых возможностей.',
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
          title="Карта спроса"
          subtitle="Подтверждённые организации, события и кадровый спрос по регионам."
        />
        <ContentCard variant="hero">
          <EmptyState
            title="Нет доступа к Evidence Radar"
            text="Войдите в рабочее пространство с доступом к возможностям."
            action={{ href: '/login', label: 'Войти' }}
          />
        </ContentCard>
      </InternalPageFrame>
    )
  }

  if (!isEvidenceRadarV1EnabledForContext(authorization)) notFound()
  const access = getOpportunityDataAccessContext(authorization)
  if (!access?.workspaceId) notFound()

  const [leads, boundaries] = await Promise.all([
    listEvidenceRadarLeads({
      workspaceId: access.workspaceId,
      limit: 100,
    }).catch(() => null),
    listEvidenceRadarRegionBoundaries().catch(() => []),
  ])

  return (
    <InternalPageFrame navItems={NAVIGATION}>
      <InternalPageHeader
        title="Карта спроса"
        subtitle="Только подтверждённые организации и объекты присутствия. География, источники и оценки не синтезируются."
        nav={<Link href="/opportunities/sources">Реестр источников</Link>}
      />
      {leads ? (
        <EvidenceRadarMap leads={leads} boundaries={boundaries} />
      ) : (
        <ErrorState
          title="Evidence Radar временно не загрузился"
          description="Данные других рабочих пространств не показываются. Проверьте миграции и повторите запрос."
          action={{ href: '/opportunities/radar', label: 'Обновить' }}
        />
      )}
    </InternalPageFrame>
  )
}
