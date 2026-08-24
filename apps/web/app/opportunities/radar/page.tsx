import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { isEvidenceRadarV1EnabledForContext } from '@/lib/intelligence/evidence-radar-config'
import { listEvidenceRadarLeads } from '@/lib/intelligence/evidence-radar-repository'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import { isOpportunityEngineV1EnabledForContext } from '@/lib/opportunities/config'
import {
  InternalPageFrame,
  InternalPageHeader,
} from '../../ui/internal-page'
import { ProductErrorState } from '../../ui/product-error-state'
import { StaticEmptyState } from '../../ui/static-empty-state'
import { EvidenceRadarMap } from '../evidence-radar-map'
import { buildOpportunityRadarNavigation } from '../navigation'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Радар — Recruiter Radar',
  description: 'Свежие подтверждённые hiring signals в пространстве свежести и уровня подтверждения.',
}

const NAVIGATION = buildOpportunityRadarNavigation()

function StateLink({ href, label }: { href: string; label: string }) {
  return <Link href={href}>{label}</Link>
}

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
        <StaticEmptyState
          title="Нет доступа к Радару"
          description="Войдите в рабочее пространство с доступом к подтверждённым сигналам."
          action={<StateLink href="/login" label="Войти" />}
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
        subtitle="Подтверждённые сигналы по свежести, силе и релевантности. География — только контекст."
      />
      {leads ? (
        <EvidenceRadarMap leads={leads} referenceTimestamp={Date.now()} />
      ) : (
        <ProductErrorState
          title="Радар временно не загрузился"
          description="Данные других рабочих пространств не показываются. Последние неподтверждённые связи не подставляются вместо результата."
        >
          <StateLink href="/opportunities/radar" label="Обновить" />
        </ProductErrorState>
      )}
    </InternalPageFrame>
  )
}
